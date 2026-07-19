#!/usr/bin/env bash
# Run a Web3.0 node on any machine — PC, Mac, Linux, server, or Android/Termux.
# Usage:  curl -fsSL <raw-url>/scripts/install-node.sh | bash
set -euo pipefail

REPO="${WEB3_REPO:-https://github.com/sanjaydoc/Web3.0.git}"
DIR="${WEB3_DIR:-web3-node}"

echo "▸ Web3.0 node installer"

have() { command -v "$1" >/dev/null 2>&1; }

# Install a package with whatever package manager this machine has (macOS/Linux/Termux).
pkg_install() {
  if have pkg;     then pkg install -y "$@"        # Android/Termux
  elif have brew;  then brew install "$@"
  elif have apt-get; then sudo apt-get update -y && sudo apt-get install -y "$@"
  elif have dnf;   then sudo dnf install -y "$@"
  elif have yum;   then sudo yum install -y "$@"
  elif have pacman; then sudo pacman -Sy --noconfirm "$@"
  elif have zypper; then sudo zypper install -y "$@"
  else return 1; fi
}

if ! have git; then
  echo "▸ installing git"
  pkg_install git || { echo "Please install git: https://git-scm.com"; exit 1; }
fi
if ! have node; then
  echo "▸ installing Node.js"
  pkg_install nodejs || pkg_install node || { echo "Please install Node 20+: https://nodejs.org"; exit 1; }
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "${NODE_MAJOR:-0}" -ge 20 ] || echo "⚠ Node ${NODE_MAJOR} found; Web3.0 wants 20+. Upgrade via nvm if it errors: https://github.com/nvm-sh/nvm"

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
pnpm --filter @web3/node start
