---
name: cross-network-operations
description: Deploy and manage the same MultiSig across multiple EVM networks. Use when deploying to several chains at once (CREATE2 deterministic address), querying balances/events/tokens/pending across networks, or diagnosing and re-syncing "decoupled" accounts. Trigger on requests like "deploy to sepolia and base", "check balances across networks", or "sync my multisig".
license: GPL-3.0
compatibility: claude-code cursor windsurf
---

# Cross-Network Operations

This skill covers deploying and managing the same MultiSig across multiple EVM networks, querying data cross-network, and keeping accounts in sync.

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$PRIVATE_KEY` | Signing key (hex string with 0x prefix) | `0xYOUR_TESTNET_KEY` |
| `<ALIAS>` | Saved contract alias | `treasury` |
| `<OWNER_ADDRESSES>` | Comma-separated owner addresses | `0x123...,0x456...` |
| `<REQUIRED>` | Required confirmations | `2` |
| `<PIN>` | Account management PIN | `1234` |
| `<NETWORKS>` | Comma-separated network keys | `sepolia,base-sepolia` |
| `<CHAIN_IDS>` | Comma-separated chain IDs | `11155111,84532` |

## When to Use

Use this workflow when:
- Deploying one MultiSig to several networks at once (deterministic address via CREATE2)
- Querying balances, events, tokens, or pending txs across all networks
- Diagnosing or repairing accounts that fell out of sync ("decoupled")

## Prerequisites

1. Wallet configured (see the `account-setup` skill)
2. RPC URLs configured for each target network
3. Gas funds on each network you intend to deploy/manage

## Quick Path (bundled script)

To deploy across multiple networks and verify balances + sync in one command, use the bundled helper (see `scripts/deploy-multi.sh`):

```bash
OWNERS=<OWNER_ADDRESSES> REQUIRED=<REQUIRED> PIN=<PIN> NAME=<ALIAS> \
  NETWORKS=<NETWORKS> ./scripts/deploy-multi.sh
```

For step-by-step control, follow the workflow below.

## Workflow Steps

### Step 1: Deploy to Multiple Networks

```bash
ethnotary create \
  --owners <OWNER_ADDRESSES> \
  --required <REQUIRED> \
  --pin <PIN> \
  --name <ALIAS> \
  --network <NETWORKS>
```

The `create` command:
1. Prompts for the keystore password once
2. Runs a pre-flight check across all networks (balance, gas, factory availability)
3. Shows a deployment summary and asks for a single confirmation
4. Deploys sequentially to each ready network

Contracts are saved with a network suffix, e.g. `treasury-sepolia`, `treasury-base-sepolia`. Because CREATE2 is used, the predicted address is identical across networks.

You can also target by chain ID:

```bash
ethnotary create --owners <OWNER_ADDRESSES> --required <REQUIRED> --pin <PIN> \
  --name <ALIAS> --chain-id <CHAIN_IDS>
```

### Step 2: Import an Existing Contract on Multiple Networks

```bash
ethnotary add --alias <ALIAS> --address 0x123... --network <NETWORKS>
# Validates the contract exists on each network before saving
```

### Step 3: Query Data Cross-Network

Data commands query ALL networks the contract is deployed on by default. Add `--network <name>` to filter.

```bash
ethnotary data balance --address <ALIAS>   # Total + per-network balance
ethnotary data events  --address <ALIAS>   # Events across networks, sorted by time
ethnotary data pending --address <ALIAS>   # Pending txs across networks
ethnotary data tokens  --address <ALIAS>   # Token holdings across networks

# Filter to one network
ethnotary data events --address <ALIAS> --network sepolia --limit 20
```

### Step 4: Account Management Across Networks

Owner changes and requirement updates apply to ALL networks. A pre-flight check estimates gas, checks balances, and dry-run simulates on each network.

```bash
ethnotary account add --owner 0xNew... --pin <PIN> --address <ALIAS>

# If pre-flight fails on some networks, force it:
ethnotary account add --owner 0xNew... --pin <PIN> --address <ALIAS> --force
```

### Step 5: Check Sync Status and Re-Sync

If a change succeeds on some networks but fails on others, the account becomes "decoupled".

```bash
# Check sync status across all networks
ethnotary account status --address <ALIAS>

# Preview a re-sync without applying
ethnotary account sync --address <ALIAS> --pin <PIN> --dry-run

# Apply the re-sync
ethnotary account sync --address <ALIAS> --pin <PIN>
```

## Example: Deploy + Verify Across 3 Testnets

```bash
# Deploy to three testnets in one command
ethnotary create --owners 0x123...,0x456... --required 2 --pin 1234 \
  --name treasury --network sepolia,base-sepolia,arbitrum-sepolia

# Confirm networks and addresses
ethnotary list

# Verify balances everywhere
ethnotary data balance --address treasury

# Confirm the account is in sync
ethnotary account status --address treasury
```

## Bundled Resources

- `scripts/deploy-multi.sh` — multi-network deploy + balance/sync verification.

## Related Commands

| Command | Description |
|---------|-------------|
| `ethnotary create` | Deploy MultiSig to one or more networks |
| `ethnotary add` | Import existing contract on one or more networks |
| `ethnotary list` | List saved contracts and their networks |
| `ethnotary data balance` | Cross-network balance |
| `ethnotary data events` | Cross-network events |
| `ethnotary data tokens` | Cross-network token holdings |
| `ethnotary account status` | Check sync across networks |
| `ethnotary account sync` | Re-sync decoupled accounts |
