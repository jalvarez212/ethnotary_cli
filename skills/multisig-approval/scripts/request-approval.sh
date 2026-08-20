#!/usr/bin/env bash
#
# request-approval.sh — Submit a MultiSig transaction and emit the notification
# payload (approval URL + per-owner contact info) so an agent can message
# human co-owners for approval.
#
# Usage:
#   ALIAS=treasury DEST=0xabc... VALUE=0.5 NETWORK=sepolia ./request-approval.sh
#
# Env vars:
#   ALIAS     (required) Saved contract alias or address
#   DEST      (required) Destination address
#   VALUE     (required) Native amount (e.g. 0.5)
#   NETWORK   (required) Target network key
#   PRIVATE_KEY (optional) Signing key; if unset, the encrypted keystore is used
#
# Output (stdout, JSON): the submit result including `transactionId`,
# `approvalUrl`, `notifyOwners[]`, `confirmations`, and `canExecute`.
#
set -euo pipefail

require() {
  if [ -z "${!1:-}" ]; then
    echo "error: environment variable '$1' is required" >&2
    exit 1
  fi
}

require ALIAS
require DEST
require VALUE
require NETWORK

command -v ethnotary >/dev/null 2>&1 || { echo "error: ethnotary CLI not found. Install with: npm install -g ethnotary" >&2; exit 1; }

SUBMIT_ARGS=(tx submit --address "$ALIAS" --dest "$DEST" --value "$VALUE" --network "$NETWORK" --json)
[ -n "${PRIVATE_KEY:-}" ] && SUBMIT_ARGS+=(--private-key "$PRIVATE_KEY")

# Emit the raw JSON payload. The agent reads notifyOwners[] and uses its
# messaging tool (WhatsApp/Telegram) to deliver owner.message to each owner.
ethnotary "${SUBMIT_ARGS[@]}"
