# Ethnotary Agent Committee Demo

End-to-end demo of a 4-agent treasury committee proposing, evaluating, voting on, and executing a transaction through the Ethnotary multi-sig — with every decision logged to an immutable audit trail.

## Run it

```bash
# 1. Install deps
npm install

# 2. Configure
cp .env.example .env
# fill in PRIVATE_KEY (or use ethnotary wallet init)
# optionally fill CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET/CIRCLE_WALLET_ID for Track 2

# 3. Make sure you have a multi-sig deployed and aliased
ethnotary create --owners <your-address> --required 1 --pin 1234 --name joy --network hedera-testnet

# 4. Update demo/config.json with your alias + recipient

# 5. Run the demo
node demo/agent-committee.js
```

## Files

- `agent-committee.js` — main demo script (4 agents + on-chain settlement)
- `circle-funder.js` — Circle Agent Wallets USDC funding (Track 2)
- `config.json` — recipient, network, multi-sig alias, scenario params
- `audit-trail.json` — append-only log of every committee session

## What you'll see

```
🤖 ETHNOTARY AGENT COMMITTEE CONVENING

Step 0 — Treasury Funding
💰  Treasury Agent — Topping up multi-sig from Circle Agent Wallet (25 USDC)...

Step 1 — Proposal
🔍  Research Agent — Proposes: spend 25 USDC — Polymarket arbitrage opportunity

Step 2 — Risk Review
🛡️   Risk Agent — Vote: APPROVE (confidence 78%)

Step 3 — Treasury Review
💰  Treasury Agent — Vote: APPROVE

✓ Consensus reached: 3/3 approve

Step 4 — On-Chain Settlement
⚡  Executor Agent — Submitting transaction via Ethnotary multi-sig on hedera-testnet...

✅ COMMITTEE SESSION COMPLETE
```

## Notes for judges

- **Agent reasoning is scripted** for video reliability. Production version uses LLM function calling — the agent objects in `agent-committee.js` have a clean `decide()`-style interface that swaps for OpenAI/Anthropic calls without changing the rest of the flow.
- **All on-chain writes go through the Ethnotary CLI in `--json` mode** — proving the protocol is agent-ready, not just human-friendly.
- **Audit trail is append-only JSON** including agent decisions, confidence scores, transaction hashes, and timestamps — every committee decision is reviewable.
