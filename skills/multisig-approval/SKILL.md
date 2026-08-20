---
name: multisig-approval
description: Request transaction approvals from human co-owners of a MultiSig wallet via WhatsApp or Telegram. Use when an autonomous agent needs human sign-off before executing a transaction on a MultiSig that requires more than one confirmation. Trigger on requests like "request approval for this transfer", "notify the co-owners", or "get human confirmation before executing".
license: GPL-3.0
compatibility: claude-code cursor windsurf
---

# MultiSig Approval Workflow

This skill enables autonomous agents to request transaction approvals from human co-owners of a MultiSig wallet via WhatsApp or Telegram.

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$AGENT_KEY` | Agent's private key (hex string with 0x prefix) | `0xYOUR_TESTNET_KEY` |
| `<DESTINATION_ADDRESS>` | Ethereum address to send funds/call | `0x789abc...` |
| `<ETH_AMOUNT>` | Amount of ETH to send (decimal) | `0.5` |
| `<TRANSACTION_ID>` | Numeric ID returned after tx submit | `5` |
| `owner.whatsapp` | Owner's WhatsApp number from notifyOwners | `+15551234567` |
| `owner.telegram` | Owner's Telegram chat ID from notifyOwners | `123456789` |
| `owner.message` | Pre-formatted approval request message | `🔔 MultiSig Approval...` |

## When to Use

Use this workflow when:
- You need to transfer funds or tokens from a shared MultiSig wallet
- The MultiSig requires more than 1 confirmation
- You need human approval before executing

## Prerequisites

1. **Ethnotary CLI** installed and configured with wallet
2. **Owner contacts** registered in the CLI
3. **OpenClaw WhatsApp/Telegram channel** configured

## Quick Path (bundled script)

To submit a transaction and emit the notification payload (approval URL + per-owner contacts) in one command, use the bundled helper (see `scripts/request-approval.sh`):

```bash
ALIAS=<ALIAS> DEST=<DESTINATION_ADDRESS> VALUE=<ETH_AMOUNT> NETWORK=<NETWORK> \
  ./scripts/request-approval.sh
```

Then message each owner in `notifyOwners[]` (Step 2 below). For manual control, follow the workflow.

## Workflow Steps

### Step 1: Submit Transaction

```bash
ethnotary tx submit \
  --dest <DESTINATION_ADDRESS> \
  --value <ETH_AMOUNT> \
  --json \
  --private-key $AGENT_KEY
```

The output includes:
- `transactionId` - ID to reference this transaction
- `approvalUrl` - Link for humans to review and approve
- `notifyOwners` - Array of owners to notify with their contact info and pre-formatted message
- `confirmations` - Current confirmation status (e.g., "1/2")
- `canExecute` - Whether transaction can be executed now

### Step 2: Notify Owners

For each owner in `notifyOwners`, use the OpenClaw `message` tool:

```javascript
// For WhatsApp
tools.message({
  action: "send",
  channel: "whatsapp",
  to: owner.whatsapp,
  text: owner.message
});

// For Telegram
tools.message({
  action: "send", 
  channel: "telegram",
  to: owner.telegram,
  text: owner.message
});
```

### Step 3: Wait for Approval

Poll for confirmation status:

```bash
ethnotary tx pending --json
```

Check if `canExecute` is true for your transaction.

### Step 4: Execute Transaction

Once fully confirmed:

```bash
ethnotary tx execute --txid <TRANSACTION_ID> --json --private-key $AGENT_KEY
```

## Example: Request 0.5 ETH for Trading

```bash
# Submit the transaction
RESULT=$(ethnotary tx submit \
  --dest 0xDEXContract... \
  --value 0.5 \
  --json \
  --private-key $AGENT_KEY)

# Extract notification data
TX_ID=$(echo $RESULT | jq -r '.transactionId')
APPROVAL_URL=$(echo $RESULT | jq -r '.approvalUrl')

# Send notifications via OpenClaw message tool
# (Agent handles this using the notifyOwners array)

# Poll until approved
while true; do
  STATUS=$(ethnotary tx pending --json | jq ".transactions[] | select(.id == $TX_ID)")
  if [ "$(echo $STATUS | jq -r '.canExecute')" = "true" ]; then
    break
  fi
  sleep 30
done

# Execute
ethnotary tx execute --txid $TX_ID --json --private-key $AGENT_KEY
```

## Notification Message Format

The pre-formatted message includes:
```
🔔 MultiSig Approval Request

Transaction #5 on Sepolia
To: 0x789...
Value: 0.5 ETH

Confirmations: 1/2

👉 Review & Approve: https://ethnotary.io/app/demo/views/txn.html?5?sepolia
```

## Related Commands

| Command | Description |
|---------|-------------|
| `ethnotary tx link --txid N` | Get approval URL for transaction |
| `ethnotary tx notify --txid N --json` | Get notification payload for existing tx |
| `ethnotary tx pending --json` | List all pending transactions |
| `ethnotary contact list` | List registered owner contacts |

## Setup Owner Contacts

Before using this workflow, register contact info for each owner:

```bash
ethnotary contact add \
  --address 0xOwnerAddress... \
  --telegram 123456789 \
  --whatsapp +15551234567
```
