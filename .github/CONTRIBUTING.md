# Contributing to ACP

Thanks for your interest in building the agentic internet. ACP is **module-first**:
every capability is a module you can add or remove. New features should almost
always arrive as a new module or a change scoped to an existing one.

## Development setup

```bash
# TypeScript workspace (protocol, services, dashboard)
pnpm install
pnpm typecheck
pnpm test

# Python agent SDK (in an isolated virtualenv)
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -e "packages/acp-sdk-py[dev]"
pytest packages/acp-sdk-py -q
ruff check packages/acp-sdk-py examples
```

Boot the stack locally:

```bash
pnpm --filter @acp/node dev        # ACP kernel + modules on :8787
pnpm --filter @acp/dashboard dev   # observability console on :5173
python examples/two-agents-demo/demo.py
```

## Ground rules

- **Every change keeps `pnpm typecheck && pnpm test` green.** Python changes also keep `pytest` green.
- **Crypto stays standard.** We only use NIST-standardized post-quantum algorithms
  (ML-DSA / ML-KEM / SLH-DSA) via audited libraries. No home-rolled cryptography.
- **No "unhackable" claims.** We say *quantum-resistant*. Be precise in code and docs.
- **Modules are self-contained.** A module registers its own routes/handlers through the
  kernel's `ModuleContext` and does not reach into another module's internals.
- **No secrets in the repo.** Keys, tokens, and `.env` files stay out of version control.

## Commit & PR

- Small, focused commits with a clear message.
- Fill in the PR template, including which module(s) you touched.
- Reference the standard you're aligning with (A2A, MCP, x402, FIPS 203/204/205) where relevant.
