---
name: transaction-management
description: Manage the full lifecycle of a MultiSig transaction. Use when submitting, confirming, executing, or revoking a transaction, transferring ERC-20 tokens or NFTs from a MultiSig, or checking pending transactions. Trigger on requests like "send ETH from the multisig", "confirm transaction 5", "execute a tx", or "transfer a token".
license: GPL-3.0
compatibility: claude-code cursor windsurf
---

# Transaction Management

This skill covers the full lifecycle of a MultiSig transaction: submit, confirm, execute, and revoke — plus ERC-20 and NFT transfers.

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$PRIVATE_KEY` | Signing key (hex string with 0x prefix) | `0xYOUR_TESTNET_KEY` |
| `<ALIAS>` | Saved contract alias or address | `treasury` |
| `<DEST>` | Destination address | `0x789...` |
| `<VALUE>` | Native amount (ETH/HBAR, decimal) | `0.1` |
| `<TXID>` | Numeric transaction ID | `5` |
| `<NETWORK>` | Target network key | `sepolia` |
| `<TOKEN>` | Token contract address | `0xTokenContract...` |

## When to Use

Use this workflow when:
- Moving native currency or tokens out of a MultiSig
- Confirming or executing a transaction another owner submitted
- Revoking a confirmation you previously gave
- Checking which transactions are pending

## Prerequisites

1. A MultiSig account is deployed and set active (`ethnotary checkout <ALIAS>`)
2. Your wallet is an owner of the MultiSig
3. RPC configured for the target network

> Transaction commands require a network. If `--network` is omitted, the CLI prompts you to select from the contract's configured networks.

## Quick Path (bundled script)

To submit, poll until confirmable, and execute in one command, use the bundled helper (see `scripts/submit-and-execute.sh`):

```bash
ALIAS=<ALIAS> DEST=<DEST> VALUE=<VALUE> NETWORK=<NETWORK> \
  ./scripts/submit-and-execute.sh
```

For step-by-step control (or multi-owner flows), follow the workflow below.

## Workflow Steps

### Step 1: Submit a Transaction

```bash
ethnotary tx submit \
  --dest <DEST> \
  --value <VALUE> \
  --network <NETWORK>
```

Optional calldata: add `--data <hex>`.

Agent-friendly (no prompts):

```bash
ethnotary tx submit \
  --dest <DEST> \
  --value <VALUE> \
  --network <NETWORK> \
  --private-key $PRIVATE_KEY \
  --json
```

The output includes `transactionId`, `approvalUrl`, `confirmations` (e.g. `1/2`), and `canExecute`.

### Step 2: Confirm (other owners)

```bash
ethnotary tx confirm --txid <TXID> --network <NETWORK>
```

### Step 3: Check Pending Status

```bash
ethnotary tx pending --network <NETWORK>

# Or across all deployed networks
ethnotary data pending --json | jq '.transactions[] | select(.canExecute)'
```

### Step 4: Execute When Fully Confirmed

```bash
ethnotary tx execute --txid <TXID> --network <NETWORK>
```

### Step 5: Revoke a Confirmation (if needed)

```bash
ethnotary tx revoke --txid <TXID> --network <NETWORK>
```

## Token, NFT & Notifications

For ERC-20/NFT transfers (`tx transfer-erc20`, `tx transfer-nft`), approval links (`tx link`, `tx notify`), and a full 2-of-N lifecycle example, see `references/transfers-and-notifications.md`.

To notify human co-owners for approval, use the `multisig-approval` skill.

## Bundled Resources

- `scripts/submit-and-execute.sh` — submit → poll pending → execute in one run.
- `references/transfers-and-notifications.md` — ERC-20/NFT transfers, approval URLs, and a full lifecycle example.

## Related Commands

| Command | Description |
|---------|-------------|
| `ethnotary tx submit` | Submit a new transaction |
| `ethnotary tx confirm --txid N` | Confirm a transaction |
| `ethnotary tx execute --txid N` | Execute a confirmed transaction |
| `ethnotary tx revoke --txid N` | Revoke your confirmation |
| `ethnotary tx pending` | List pending transactions on a network |
| `ethnotary data pending` | List pending across all networks |
| `ethnotary tx transfer-erc20` | Submit an ERC-20 transfer |
| `ethnotary tx transfer-nft` | Submit an NFT transfer |
