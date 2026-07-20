# Deploying Web3.0

This guide walks through taking Web3.0 from a local checkout to a live, public network
using **only free infrastructure** (plus pennies-per-call for Genesis agent creation).

## The deployment shape

```
 Dashboard SPA (public)     →  GitHub Pages            ($0)  ─┐
 Node backend (@web3/node)  →  Oracle Cloud Always Free ($0) ─┼→  MongoDB Atlas  (free tier)
 Genesis LLM (qwen2.5:7b)   →  hosted API, pennies/call      ─┘
 $300 GCP credit            →  reserve for temporary GPU LLM experiments only
```

Three layers, each hosted where it's cheapest and safest:

| Layer | What it is | Where it runs | Why there |
|---|---|---|---|
| **Front-end** | the React dashboard (static files) | **GitHub Pages** | free, public, no server needed |
| **Backend** | `@web3/node` (Fastify API + relay) | **Oracle Always Free VM** | 24/7, free, big enough to also host a local LLM |
| **Database** | agents, wallets, ledger, blocks | **MongoDB Atlas** | you already have it; only the backend touches it |
| **Genesis LLM** | the "brain" that writes agents | **hosted API** (OpenRouter / DeepInfra / Together) | faster + cheaper than renting a GPU |

> **Golden rule:** the browser never talks to MongoDB. It talks to `@web3/node`, and only
> `@web3/node` holds the database credentials. Never put a connection string in front-end code.

---

## Repository layout: public client + private core

GitHub repository visibility is **all-or-nothing per repo** — you cannot expose one folder and
hide the rest. So the split is two repositories:

| Repo | Visibility | Contents |
|---|---|---|
| **`web3-console`** | 🌍 Public | `apps/dashboard` · `packages/web3-sdk-py` · docs / landing · Pages workflow |
| **`Web3.0`** (this repo) | 🔒 Private | `services/web3-node` · `web3-consensus` · `web3-ledger` · `web3-core` · `web3-crypto` · desktop app |

The dashboard is self-contained (it depends only on React and its own `api.ts` HTTP client — no
`@web3/*` workspace imports), so moving it to the public repo is a clean copy. The public repo is
the network's **front door**; the private repo runs the actual network.

---

## Part 1 — MongoDB Atlas (the database)

You already have this. Confirm these are ready:

1. A cluster (the free **M0** shared tier is plenty to start).
2. A database user with a password.
3. **Network access:** add the Oracle VM's public IP to the Atlas IP allow-list
   (Atlas → *Network Access* → *Add IP Address*). Avoid `0.0.0.0/0` in production.
4. Your connection string, e.g.
   `mongodb+srv://USER:PASSWORD@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority`

---

## Part 2 — Oracle Cloud Always Free (the node backend)

Oracle's **Always Free** tier gives you up to **4 Arm (Ampere A1) cores + 24 GB RAM** at no cost,
forever. That is enough to run `@web3/node` *and*, if you ever want it, a local `qwen2.5:7b` on CPU.

### 2.1 Create the VM

1. Sign up at <https://cloud.oracle.com> and pick your home region.
2. **Compute → Instances → Create Instance.**
3. **Image:** Canonical **Ubuntu 22.04** (or 24.04).
4. **Shape:** *Change shape* → **Ampere** → **VM.Standard.A1.Flex** →
   set **2 OCPU / 12 GB** (leaves headroom in the free allocation; bump to 4/24 if you'll host the LLM).
5. Add your **SSH public key** (upload or paste).
6. **Create.** Note the **public IPv4 address** once it boots.

> If the region says "out of capacity" for A1.Flex, retry later or switch region — Arm capacity is
> shared. An **AMD `VM.Standard.E2.1.Micro`** (1 core / 1 GB, also Always Free) works for the backend
> alone (it's lightweight), just not for a local LLM.

### 2.2 Open the firewall (two layers)

Oracle has **two** firewalls; open the port in both.

**a) Cloud security list** — VCN → your subnet → *Security List* → *Add Ingress Rule*:
- Source `0.0.0.0/0`, IP protocol **TCP**, destination port **8787** (the node's HTTP port).

**b) OS firewall** — SSH in, then:

```bash
ssh ubuntu@YOUR_VM_IP
sudo iptables -I INPUT -p tcp --dport 8787 -j ACCEPT
sudo netfilter-persistent save          # persist across reboots
```

### 2.3 Install the runtime

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm i -g pnpm pm2                   # pnpm to build, pm2 to keep it running
```

### 2.4 Get the code and build

The backend lives in the **private** `Web3.0` repo. Use a deploy key or a fine-grained PAT to clone
it on the server (it stays private — only your VM has it):

```bash
git clone https://github.com/sanjaydoc/Web3.0.git
cd Web3.0
pnpm install
pnpm -r build                            # builds all workspace packages incl. @web3/node
```

### 2.5 Configure it

Create `services/web3-node/.env` (or export these in your shell / pm2 config):

```bash
# --- network binding ---
WEB3_HOST=0.0.0.0                        # listen on all interfaces (required on a VM)
WEB3_PORT=8787

# --- database (Atlas) ---
WEB3_MONGODB_URI="mongodb+srv://USER:PASSWORD@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority"
WEB3_MONGODB_DB=web3

# --- genesis identities (see network.json.example) ---
WEB3_TREASURY=treasury@web3.0
WEB3_FAUCET=100000                       # 1,000 aETH grant per new account (minor units)

# --- consensus ---
WEB3_CONSENSUS=solo                      # single-node to start; add authorities later
```

> The full list of tunables (fees, burn, block reward, authority stake, rate limits, settlement,
> peers) lives in `services/web3-node/src/config.ts`. Genesis defaults can also come from a
> `network.json` file via `WEB3_NETWORK_FILE` — see `network.json.example`.

### 2.6 Run it 24/7

```bash
cd services/web3-node
pm2 start "node dist/index.js" --name web3-node --update-env
pm2 save
pm2 startup                              # follow the printed command so it survives reboots
```

Verify from your laptop:

```bash
curl http://YOUR_VM_IP:8787/stats        # should return JSON, not a connection error
```

### 2.7 (Recommended) HTTPS with a domain

Browsers on an HTTPS page (GitHub Pages) **cannot call an `http://` backend** — mixed content is
blocked. So give the node a hostname and a TLS certificate:

1. Point a domain/subdomain (e.g. `api.web3.example`) at `YOUR_VM_IP` (an A record).
2. Put **Caddy** in front — it auto-provisions a Let's Encrypt cert:

```bash
sudo apt-get install -y caddy
# /etc/caddy/Caddyfile
api.web3.example {
    reverse_proxy localhost:8787
}
sudo systemctl restart caddy
```

Now `https://api.web3.example/stats` works, and that's the URL the dashboard will use.

> **Free alternative to a VM + domain:** [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-tunnel/)
> gives the node a public `https://…` hostname with zero open ports and free TLS.

---

## Part 3 — GitHub Pages (the dashboard)

The dashboard is a static build that talks to the backend URL baked in at build time via
`VITE_WEB3_URL` (defaults to `http://127.0.0.1:8787` for local dev — see `apps/dashboard/src/api.ts`).

In the **public `web3-console`** repo, add `.github/workflows/pages.yml`:

```yaml
name: Deploy dashboard to Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install
      - run: pnpm --filter @web3/dashboard build
        env:
          VITE_WEB3_URL: ${{ vars.WEB3_API_URL }}   # e.g. https://api.web3.example
      - uses: actions/upload-pages-artifact@v3
        with: { path: apps/dashboard/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deploy.outputs.page_url }}" }
    steps:
      - id: deploy
        uses: actions/deploy-pages@v4
```

Then:

1. In the public repo: **Settings → Secrets and variables → Actions → Variables** → add
   `WEB3_API_URL = https://api.web3.example` (your node's public HTTPS URL).
2. **Settings → Pages → Source: GitHub Actions.**
3. Push to `main`. The dashboard deploys to `https://sanjaydoc.github.io/web3-console/`
   (or your custom domain).

> **Vite base path:** if the site is served from a subpath (`/web3-console/`), set
> `base: '/web3-console/'` in `apps/dashboard/vite.config.ts`, or use a custom domain served at root.

### 3.1 Allow the Pages origin to call the node (CORS)

The node must send CORS headers permitting the Pages origin, or the browser will block the calls.
Set the allowed origin to your Pages URL when you start `@web3/node`. (If CORS isn't yet wired in the
backend, that's a one-line `@fastify/cors` addition — ask and it can be added.)

---

## Part 4 — Genesis LLM (hosted API, recommended)

Genesis creates agents with an LLM. **Renting a GPU is not worth it** — a hosted `qwen2.5:7b` costs
fractions of a cent per agent and is far faster than CPU inference. The node already supports
multi-provider LLM presets, so point Genesis at a hosted endpoint:

- **OpenRouter** — `https://openrouter.ai/api/v1`, model `qwen/qwen-2.5-7b-instruct`
- **DeepInfra** / **Together** — similar OpenAI-compatible endpoints

Configure the provider + API key in the node's LLM settings (Genesis panel / node config). Keep the
API key on the **server**, never in the dashboard.

### Optional: self-hosted qwen2.5:7b on the Oracle VM

If you want zero external API dependency (privacy/offline), run it locally on the A1 VM:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b
# point the node's local-LLM preset at http://localhost:11434
```

Expect a few tokens/sec on CPU — fine for occasional agent creation, slow for anything real-time.
Needs the 24 GB shape; keep it on `localhost`, never expose the Ollama port.

---

## Part 5 — The $300 GCP credit (use it deliberately)

GCP credits **expire (~90 days)**, so they are the *wrong* tool for an always-on service — you'd burn
them, then start paying. Reserve them for **short, GPU-heavy bursts**:

- Spin up an `n1-standard` + **T4 GPU** VM to benchmark or fine-tune a model,
- run your experiment, then **stop the instance** (you're billed while it runs),
- keep the always-on network on Oracle's free tier.

---

## Verification checklist

- [ ] `curl https://api.web3.example/stats` returns JSON from the VM.
- [ ] MongoDB Atlas shows the VM's IP in *Network Access*; data appears after signup.
- [ ] `pm2 status` shows `web3-node` **online**; it survives `sudo reboot`.
- [ ] Pages site loads; the console header shows **node online** (not offline).
- [ ] Creating an account on the live site persists (visible in Atlas).
- [ ] Genesis creates an agent using the hosted LLM.

## Cost summary

| Item | Cost |
|---|---|
| Oracle Always Free VM | **$0** |
| GitHub Pages | **$0** |
| MongoDB Atlas M0 | **$0** |
| Genesis LLM (hosted) | ~cents per agent |
| Domain (optional, for HTTPS) | ~$1–12 / year |
| **Recurring total** | **≈ $0 / year** |
