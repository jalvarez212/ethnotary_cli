# Transfers & Notifications Reference

Deeper reference for ERC-20/NFT transfers and approval notifications. Load on demand when moving tokens or generating approval links.

## Token & NFT Transfers

Both commands submit a MultiSig transaction like `tx submit`; they still require confirmation and execution per the account's threshold.

```bash
# ERC-20 transfer
ethnotary tx transfer-erc20 \
  --token <TOKEN> \
  --to <DEST> \
  --amount <VALUE> \
  --network <NETWORK>

# NFT (ERC-721) transfer
ethnotary tx transfer-nft \
  --token <TOKEN> \
  --to <DEST> \
  --tokenid <TOKENID> \
  --network <NETWORK>
```

## Approval Notifications

```bash
ethnotary tx link   --txid <TXID>          # Generate approval URL only
ethnotary tx notify --txid <TXID> --json   # Full notification payload for existing tx
```

Approval URLs use the positional format:

```
https://ethnotary.io/app/views/txn.html?<TXID>?<Network>?<address>
```

For notifying human co-owners via WhatsApp/Telegram, see the `multisig-approval` skill.

## Full Lifecycle Example (2-of-N account)

```bash
# 1. Agent submits
RESULT=$(ethnotary tx submit --dest <DEST> --value 0.5 --network sepolia \
  --json --private-key $PRIVATE_KEY)
TX_ID=$(echo $RESULT | jq -r '.transactionId')

# 2. Second owner confirms (on their machine)
ethnotary tx confirm --txid $TX_ID --network sepolia

# 3. Poll until executable
while true; do
  READY=$(ethnotary tx pending --network sepolia --json \
    | jq -r ".transactions[] | select(.id == $TX_ID) | .canExecute")
  [ "$READY" = "true" ] && break
  sleep 30
done

# 4. Execute
ethnotary tx execute --txid $TX_ID --network sepolia \
  --json --private-key $PRIVATE_KEY
```
