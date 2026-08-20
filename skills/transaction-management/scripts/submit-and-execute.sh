#!/usr/bin/env bash
#
# submit-and-execute.sh — Submit a MultiSig transaction, poll until it is
# confirmable, then execute it.
#
# Usage:
#   ALIAS=treasury DEST=0xabc... VALUE=0.1 NETWORK=sepolia ./submit-and-execute.sh
#
# Env vars:
#   ALIAS     (required) Saved contract alias or address
#   DEST      (required) Destination address
#   VALUE     (required) Native amount (e.g. 0.1)
#   NETWORK   (required) Target network key
#   DATA      (optional) Hex calldata
#   PRIVATE_KEY (optional) Signing key; if unset, the encrypted keystore is used
#   POLL_INTERVAL (optional) Seconds between pending checks (default 30)
#   MAX_POLLS (optional) Max poll attempts before giving up (default 40)
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

POLL_INTERVAL="${POLL_INTERVAL:-30}"
MAX_POLLS="${MAX_POLLS:-40}"

command -v jq >/dev/null 2>&1 || { echo "error: jq is required" >&2; exit 1; }

SUBMIT_ARGS=(tx submit --address "$ALIAS" --dest "$DEST" --value "$VALUE" --network "$NETWORK" --json)
[ -n "${DATA:-}" ] && SUBMIT_ARGS+=(--data "$DATA")
[ -n "${PRIVATE_KEY:-}" ] && SUBMIT_ARGS+=(--private-key "$PRIVATE_KEY")

echo "==> Submitting transaction..."
RESULT="$(ethnotary "${SUBMIT_ARGS[@]}")"
echo "$RESULT"
TX_ID="$(echo "$RESULT" | jq -r '.transactionId')"

if [ "$TX_ID" = "null" ] || [ -z "$TX_ID" ]; then
  echo "error: could not determine transactionId from submit output" >&2
  exit 1
fi
echo "==> Transaction ID: $TX_ID"

echo "==> Polling until executable (interval ${POLL_INTERVAL}s, max ${MAX_POLLS})..."
i=0
while [ "$i" -lt "$MAX_POLLS" ]; do
  READY="$(ethnotary tx pending --address "$ALIAS" --network "$NETWORK" --json \
    | jq -r ".transactions[]? | select(.id == $TX_ID) | .canExecute")"
  if [ "$READY" = "true" ]; then
    break
  fi
  i=$((i + 1))
  sleep "$POLL_INTERVAL"
done

if [ "${READY:-}" != "true" ]; then
  echo "==> Transaction $TX_ID not yet confirmable after $MAX_POLLS polls. Exiting." >&2
  exit 2
fi

EXEC_ARGS=(tx execute --address "$ALIAS" --txid "$TX_ID" --network "$NETWORK" --json)
[ -n "${PRIVATE_KEY:-}" ] && EXEC_ARGS+=(--private-key "$PRIVATE_KEY")

echo "==> Executing transaction $TX_ID..."
ethnotary "${EXEC_ARGS[@]}"
