#!/usr/bin/env bash
#
# deploy-multi.sh — Deploy one MultiSig across multiple EVM networks (CREATE2
# gives the same address everywhere), then verify balances and sync status.
#
# Usage:
#   OWNERS=0xabc...,0xdef... REQUIRED=2 PIN=1234 NAME=treasury \
#     NETWORKS=sepolia,base-sepolia,arbitrum-sepolia ./deploy-multi.sh
#
# Env vars:
#   OWNERS    (required) Comma-separated owner addresses
#   REQUIRED  (required) Number of confirmations required
#   PIN       (required) Account management PIN
#   NAME      (required) Account name / alias
#   NETWORKS  (required) Comma-separated network keys
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
require NETWORKS

command -v ethnotary >/dev/null 2>&1 || { echo "error: ethnotary CLI not found. Install with: npm install -g ethnotary" >&2; exit 1; }

CREATE_ARGS=(create
  --owners "$OWNERS"
  --required "$REQUIRED"
  --pin "$PIN"
  --name "$NAME"
  --network "$NETWORKS"
  --json --yes)
[ -n "${PRIVATE_KEY:-}" ] && CREATE_ARGS+=(--private-key "$PRIVATE_KEY")

echo "==> Deploying '$NAME' to: $NETWORKS"
ethnotary "${CREATE_ARGS[@]}"

echo "==> Saved contracts:"
ethnotary list

echo "==> Balances across networks:"
ethnotary data balance --address "$NAME" --json

echo "==> Sync status:"
ethnotary account status --address "$NAME"
