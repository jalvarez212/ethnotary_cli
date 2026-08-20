# Configuration & Networks Reference

Deeper reference for RPC/network configuration, supported networks, and config files. Load this on demand when configuring RPCs or adding custom networks.

## Configuration Commands

```bash
ethnotary config rpc [network]      # Add/update RPC URL
  --url <url>                        # RPC URL (optional, prompts if missing)

ethnotary config network [network]  # Add/update a network
  --name <text>                     # Display name
  --chain-id <number>               # Chain ID
  --rpc <url>                       # RPC URL
  --testnet                         # Mark as testnet

ethnotary config show               # Show all config (RPC URLs, networks)
ethnotary config path               # Show config file paths
```

### Examples

```bash
# Set RPC URL directly
ethnotary config rpc sepolia --url https://sepolia.infura.io/v3/YOUR_KEY

# Interactive RPC setup (shows provider suggestions)
ethnotary config rpc base-sepolia

# Add a custom network
ethnotary config network soneium --name "Soneium" --chain-id 1868 --rpc https://rpc.soneium.org
```

## Supported Networks

Use `--network <name>` or `--chain-id <id>`.

**Testnets (primary):**

| Network | Name | Chain ID |
|---------|------|----------|
| Sepolia | `sepolia` | 11155111 |
| Base Sepolia | `base-sepolia` | 84532 |
| Arbitrum Sepolia | `arbitrum-sepolia` | 421614 |
| Hedera Testnet | `hedera-testnet` | 296 |

**Mainnets (examples):** `ethereum` (1), `base` (8453), `arbitrum` (42161), `optimism` (10), `polygon` (137), and more.

## Config Files (`~/.ethnotary/`)

| File | Purpose |
|------|---------|
| `keystore.json` | Encrypted wallet (password-protected) |
| `contracts.json` | Saved contract addresses with aliases |
| `config.json` | RPC URLs and network definitions |

## Managing Owners

Owner changes apply across ALL networks the contract is deployed on. A pre-flight check runs first; use `--force` to proceed despite failures.

```bash
ethnotary account add     --owner 0xNew... --pin <PIN>
ethnotary account remove  --owner 0xOld... --pin <PIN>
ethnotary account replace --old 0xOld... --new 0xNew... --pin <PIN>
ethnotary account owners  # List current owners
```
