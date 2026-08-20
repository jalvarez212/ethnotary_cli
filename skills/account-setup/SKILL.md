---
name: account-setup
description: Set up an Ethnotary environment from scratch. Use when installing the CLI, creating or importing a signing wallet, deploying a new MultiSig account, importing an existing one, or configuring network RPCs. Trigger on requests like "set up ethnotary", "create a multisig", "add a wallet", or "configure an RPC".
license: GPL-3.0
compatibility: claude-code cursor windsurf
---

# Account & Wallet Setup

This skill sets up an Ethnotary environment from scratch: install the CLI, create a signing wallet, deploy (or import) a MultiSig account, and configure network RPCs.

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$PRIVATE_KEY` | Testnet private key (hex string with 0x prefix) that signs transactions | `0xYOUR_TESTNET_KEY` |
| `<OWNER_ADDRESSES>` | Comma-separated owner addresses for the MultiSig | `0x123...,0x456...` |
| `<REQUIRED>` | Number of confirmations required to execute | `2` |
| `<PIN>` | PIN used for account management (hashed on-chain) | `1234` |
| `<NAME>` | Account name, used as the contract alias | `treasury` |
| `<NETWORK>` | Target network key | `sepolia` |
| `<RPC_URL>` | RPC endpoint for the network | `https://sepolia.infura.io/v3/KEY` |

## When to Use

Use this workflow when:
- Setting up Ethnotary on a new machine or for a new agent
- Creating a brand-new MultiSig account
- Importing an existing MultiSig into the CLI
- Configuring RPC URLs or adding a custom network

## Prerequisites

- **Node.js** v16+ and **npm** (`node --version`, `npm --version`)
- **RPC URL** for the target network (Infura, Alchemy, or public RPC). Hedera Testnet works via the free public relay.
- **Gas funds** on the target network for deployment/transactions.

## Quick Path (bundled script)

For a one-shot setup, run the bundled helper (see `scripts/setup.sh`), which installs the CLI, ensures a wallet exists, and deploys the MultiSig:

```bash
OWNERS=<OWNER_ADDRESSES> REQUIRED=<REQUIRED> PIN=<PIN> NAME=<NAME> NETWORK=<NETWORK> \
  ./scripts/setup.sh
```

For manual, step-by-step control, follow the workflow below.

## Workflow Steps

### Step 1: Install the CLI

```bash
npm install -g ethnotary
```

### Step 2: Configure Environment

Copy the example env file and set the two required values:

```bash
cp .env.example .env
```

| Variable | Required | What to set |
|----------|----------|-------------|
| `PRIVATE_KEY` | ✅ | Testnet private key (with `0x` prefix) that signs transactions |
| `<NETWORK>_RPC_URL` | ✅ | RPC endpoint, e.g. `SEPOLIA_RPC_URL` or `HEDERA_TESTNET_RPC_URL` |

Never commit `.env` — it is gitignored.

### Step 3: Create or Import a Wallet

```bash
# Generate a new encrypted keystore wallet (stored locally, password-protected)
ethnotary wallet init

# Or import an existing key/mnemonic
ethnotary wallet import

# View the wallet address
ethnotary wallet show
```

**Wallet priority (highest first):**
1. `--private-key <key>` flag — explicit override
2. Encrypted keystore — password-protected default (recommended)
3. `PRIVATE_KEY` env var — fallback for scripts/automation

### Step 4: Configure RPC (if not using `.env`)

```bash
# Direct setup
ethnotary config rpc <NETWORK> --url <RPC_URL>

# Interactive setup (shows provider suggestions)
ethnotary config rpc <NETWORK>

# Add a custom network
ethnotary config network mychain --name "My Chain" --chain-id 12345 --rpc <RPC_URL>

# Review current config
ethnotary config show
ethnotary config path
```

### Step 5: Deploy a MultiSig Account

```bash
ethnotary account create \
  --owners <OWNER_ADDRESSES> \
  --required <REQUIRED> \
  --pin <PIN> \
  --name <NAME> \
  --network <NETWORK>
```

Agent-friendly (no prompts):

```bash
ethnotary account create \
  --owners <OWNER_ADDRESSES> \
  --required <REQUIRED> \
  --pin <PIN> \
  --name <NAME> \
  --network <NETWORK> \
  --private-key $PRIVATE_KEY \
  --json --yes
# Output: {"address":"0x...","txHash":"0x...","network":"sepolia","alias":"treasury"}
```

### Step 6: Import an Existing MultiSig (alternative to Step 5)

```bash
ethnotary add \
  --alias <NAME> \
  --address 0x123... \
  --network <NETWORK>
# Validates the contract exists on each network before saving
```

### Step 7: Activate and Inspect

```bash
ethnotary checkout <NAME>   # Set as active contract
ethnotary status            # Show current active contract
ethnotary list              # List all saved contracts
ethnotary account info      # Show owners, required confirmations, balance
```

## Managing Owners

Owner changes apply across ALL networks the contract is deployed on. A pre-flight check runs first; use `--force` to proceed despite failures.

```bash
ethnotary account add     --owner 0xNew... --pin <PIN>
ethnotary account remove  --owner 0xOld... --pin <PIN>
ethnotary account replace --old 0xOld... --new 0xNew... --pin <PIN>
ethnotary account owners  # List current owners
```

## Related Commands

| Command | Description |
|---------|-------------|
| `ethnotary wallet init` | Create encrypted keystore wallet |
| `ethnotary wallet show` | Display wallet address |
| `ethnotary account create` | Deploy new MultiSig |
| `ethnotary add` | Import existing MultiSig |
| `ethnotary checkout <alias>` | Switch active contract |
| `ethnotary config rpc <network>` | Set RPC URL |
| `ethnotary account info` | Show account details and balance |

## Bundled Resources

- `scripts/setup.sh` — one-shot install + wallet + MultiSig deploy.
- `references/config-and-networks.md` — full RPC/network config commands, supported networks, config files, and owner-management reference.

## Security Notes

- Private keys never leave your machine (encrypted keystore in `~/.ethnotary/`).
- Wallet passwords are never stored — prompted each time.
- PIN is hashed with Poseidon; only the hash is stored on-chain.
- Account management uses a zkSNARK proof to verify the PIN without revealing it.
