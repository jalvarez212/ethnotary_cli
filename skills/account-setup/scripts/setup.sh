#!/usr/bin/env bash
#
# setup.sh — Guided Ethnotary environment setup.
# Installs the CLI (if missing), creates a wallet, and deploys a MultiSig.
#
# Usage:
#   OWNERS=0xabc...,0xdef... REQUIRED=2 PIN=1234 NAME=treasury NETWORK=sepolia \
#     ./setup.sh
#
# Env vars:
#   OWNERS    (required) Comma-separated owner addresses
#   REQUIRED  (required) Number of confirmations required
#   PIN       (required) Account management PIN
#   NAME      (required) Account name / alias
#   NETWORK   (required) Target network key (e.g. sepolia, hedera-testnet)
#   PRIVATE_KEY (optional) Signing key; if unset, the encrypted keystore is used
#
set -euo pipefail

require() {
  if [ -z "${!1:-}" ]; then
    echo "error: environment variable '$1' is required" >&2
    exit 1
  fi
}

require OWNERS
require REQUIRED
require PIN
require NAME
require NETWORK

# 1. Install the CLI if it is not already available.
if ! command -v ethnotary >/dev/null 2>&1; then
  echo "==> Installing ethnotary globally..."
  npm install -g ethnotary
fi

# 2. Ensure a signing wallet exists (skip if PRIVATE_KEY is provided).
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "==> No PRIVATE_KEY set; ensuring a keystore wallet exists..."
  ethnotary wallet show >/dev/null 2>&1 || ethnotary wallet init
fi

# 3. Deploy the MultiSig account.
echo "==> Creating MultiSig '$NAME' on $NETWORK..."
CREATE_ARGS=(account create
  --owners "$OWNERS"
  --required "$REQUIRED"
  --pin "$PIN"
  --name "$NAME"
  --network "$NETWORK"
  --json --yes)

if [ -n "${PRIVATE_KEY:-}" ]; then
  CREATE_ARGS+=(--private-key "$PRIVATE_KEY")
fi

ethnotary "${CREATE_ARGS[@]}"

# 4. Activate and show account info.
echo "==> Activating '$NAME'..."
ethnotary checkout "$NAME"
ethnotary account info --json
