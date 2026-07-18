#!/usr/bin/env bash
# Run an ACP (Web3.0) node on any machine — PC, Mac, Linux, server, or Android/Termux.
# Usage:  curl -fsSL <raw-url>/scripts/install-node.sh | bash
set -euo pipefail

REPO="${ACP_REPO:-https://github.com/sanjaydoc/Web3.0.git}"
DIR="${ACP_DIR:-acp-node}"

echo "▸ ACP node installer"
command -v git  >/dev/null 2>&1 || { echo "git is required — install it first."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ is required — https://nodejs.org"; exit 1; }

if [ ! -d "$DIR" ]; then
  echo "▸ cloning $REPO"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

corepack enable >/dev/null 2>&1 || npm install -g pnpm
echo "▸ installing dependencies"
pnpm install

[ -f .env ] || cp .env.example .env
echo "▸ config is in .env  (edit it, then re-run to apply)"

echo "▸ starting the node on http://127.0.0.1:8787 …"
pnpm --filter @acp/node start
