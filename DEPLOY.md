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

> **Prefer PostgreSQL?** The node also ships a **Postgres store** (`WEB3_POSTGRES_URL`), which keeps
> all state on the VM's own 100 GB disk — no 512 MB Atlas cap, nothing external. It takes precedence
> over MongoDB when set. See **Part 1b** below; Atlas (above) stays a fine alternative.

### Part 1b — PostgreSQL on the VM (recommended for the 100 GB box)

Run Postgres right on the Oracle instance so all state lives on its own disk, uncapped:

```bash
sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE USER web3 WITH PASSWORD 'CHANGE_ME';"
sudo -u postgres psql -c "CREATE DATABASE web3 OWNER web3;"
```

Then set one env var for the node (Part 2.5) — no MongoDB needed:

```bash
WEB3_POSTGRES_URL="postgresql://web3:CHANGE_ME@127.0.0.1:5432/web3"
```

The node auto-creates its tables (`agents`, `ledger_entries`, `settings`) on first start. Keep
Postgres bound to `127.0.0.1` (the default) so it's never exposed to the internet — only the node,
running on the same box, talks to it.

---

## Part 2 — Oracle Cloud Always Free (the node backend)

Oracle's **Always Free** tier gives you up to **4 Arm (Ampere A1) cores + 24 GB RAM** at no cost,
forever. That is enough to run `@web3/node` *and*, if you ever want it, a local `qwen2.5:7b` on CPU.

### 2.1 Create the VM

1. Sign up at <https://cloud.oracle.com> and pick your **home region** (you can't change it later —
   pick the closest, e.g. Mumbai/Hyderabad for India).
2. **Compute → Instances → Create Instance.**
3. **Image:** Canonical **Ubuntu 22.04** (or 24.04) — Arm build.
4. **Shape:** *Change shape* → **Ampere** → **VM.Standard.A1.Flex** →
   set **4 OCPUs / 24 GB** (the full Always-Free Arm allocation — enough to also run a local LLM).
5. **Boot volume:** expand it to **100 GB** (Always Free includes up to 200 GB block storage, so this
   is still free — leaves room for Docker, logs, and a `qwen2.5:7b` model). The ~47 GB default also
   works if you'll only run the node.
6. **Networking:** keep *Assign a public IPv4 address* checked.
7. Add your **SSH public key** (upload your `~/.ssh/id_ed25519.pub`, or let Oracle generate a keypair
   and download the private key).
8. **Create.** Note the **public IPv4 address** once it boots.

> **"Out of host capacity" for A1.Flex?** Arm capacity is shared and often full. Options: retry over a
> few hours (a script/`while` loop helps), try a different **Availability Domain** in the dropdown, or
> temporarily use an **AMD `VM.Standard.E2.1.Micro`** (1 core / 1 GB, also Always Free) — fine for the
> node alone, just not for a local LLM.

> **SSH key tip (do this before you travel-relax):** on your laptop run
> `ssh-keygen -t ed25519` if you don't already have `~/.ssh/id_ed25519.pub` — you'll paste that public
> key into step 7.

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

The backend lives in the **private** `web3-core` repo. Use a deploy key or a fine-grained PAT to
clone it on the server (it stays private — only your VM has it):

```bash
git clone https://github.com/sanjaydoc/web3-core.git
cd web3-core
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

# --- CORS: lock the API to your dashboard origin(s) (comma-separated) ---
WEB3_CORS_ORIGIN=https://sanjaydoc.github.io
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

A ready-to-use workflow ships in this repo at **`deploy/web3-console/pages.yml`**. Copy it into the
**public `web3-console`** repo at `.github/workflows/pages.yml`. (It lives under `deploy/` here so it
stays inert in the private repo — GitHub only runs workflows inside `.github/workflows/` — and never
collides with this repo's own `docs/` Pages deploy. A repo can host only **one** Pages site.)

Then, in the public repo:

1. **Settings → Secrets and variables → Actions → Variables** → add
   `WEB3_API_URL = https://api.web3.example` (your node's public HTTPS URL). The workflow bakes this
   into the bundle as `VITE_WEB3_URL`, so the static site knows where the live node is.
2. **Settings → Pages → Source: GitHub Actions.**
3. Push to `main`. The dashboard deploys to `https://sanjaydoc.github.io/web3-console/`
   (or your custom domain).

> **Base path:** the dashboard's `vite.config.ts` already uses `base: './'` (relative), so it loads
> correctly from a project subpath like `/web3-console/` **and** from a custom domain root — no change
> needed. Navigation is state-based (not URL routing), so there are no deep links for Pages to 404 on.

### 3.1 Allow the Pages origin to call the node (CORS) — wired

CORS is built into `@web3/node`. Set `WEB3_CORS_ORIGIN` on the backend to your dashboard origin(s),
comma-separated:

```bash
WEB3_CORS_ORIGIN=https://sanjaydoc.github.io          # or https://console.web3.example, ...
```

- **Unset/empty** ⇒ the node reflects any origin (convenient for local dev).
- **Set** ⇒ only those exact origins receive the `Access-Control-Allow-Origin` header; every other
  site's browser calls are blocked. Use the exact scheme+host (no trailing slash, no path).

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

## Part 6 — Desktop installers (built private, published public)

The desktop app bundles the node (private core), so it **builds in this private repo** but its
installers must land as **public downloads** — release assets on a private repo sit behind a login
wall. `.github/workflows/desktop.yml` is already wired to publish cross-repo to the **public**
`sanjaydoc/Web3.0` Releases. One-time setup:

1. **Create a token that can write releases on the public repo.** GitHub → *Settings → Developer
   settings → Fine-grained personal access tokens → Generate*:
   - **Resource owner:** `sanjaydoc`; **Repository access:** only `sanjaydoc/Web3.0`.
   - **Permissions:** *Repository → Contents → Read and write* (releases live under Contents).
   - Copy the token.
2. **Store it as a secret in the *private* repo.** `sanjaydoc/web3-core` → *Settings → Secrets and
   variables → Actions → New repository secret* → name **`PUBLIC_RELEASE_TOKEN`**, paste the token.
3. **Cut a release:** push a version tag in the private repo:
   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   ```
   The three OS jobs build in parallel and attach `.msi`/`.exe`, `.dmg`, `.AppImage`/`.deb` to the
   `v0.1.1` release **on the public repo**. The dashboard/README download buttons already point at
   `github.com/sanjaydoc/Web3.0/releases/latest`, so they light up automatically.

> The workflow's tag (`v0.1.1`) is created on the public repo pointing at its current `main` — it's
> just the container for the binaries. The source that built them stays private.

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
