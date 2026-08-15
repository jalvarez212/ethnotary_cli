# Ethnotary — Hackathon Submission

> **Multi-agent treasury coordination infrastructure for autonomous capital allocation.**

This document maps Ethnotary's features directly to each prize track's judging criteria. It's the fastest path for a judge to verify our submission and reproduce the demo.

---

## 📺 Demo video

**Link:** _replace with your unlisted YouTube URL_ (≤5 min)

**Walkthrough timeline:**
- **0:00–0:30** — The problem with single-agent payment systems
- **0:30–1:00** — Architecture: Research / Risk / Treasury / Executor agent committee
- **1:00–3:30** — Live terminal: `node demo/agent-committee.js` running end-to-end
- **3:30–4:30** — Audit trail walkthrough (`demo/audit-trail.json`)
- **4:30–5:00** — Track alignment recap

---

## 🗺️ Architecture diagram

→ [`docs/architecture.md`](./docs/architecture.md) (rendered Mermaid)

A condensed version is also embedded in the [README](./README.md#architecture).

---

## ▶️ Run it yourself (3 commands)

```bash
git clone https://github.com/ethnotary/ethnotary-cli.git && cd ethnotary-cli && npm install
cp .env.example .env   # fill in PRIVATE_KEY (or run `ethnotary wallet init`)
node demo/agent-committee.js
```

(Pre-requisite: deploy a multi-sig once with `ethnotary create ...`, then point `demo/config.json` at it.)

---

## 🟣 Track 1 — Hedera Agent Kit

| Requirement | Status | Where |
|---|---|---|
| Agent executes payment / token transfer on Hedera Testnet | ✅ | [`demo/agent-committee.js`](./demo/agent-committee.js) — Executor Agent invokes `ethnotary tx submit/execute` against chain ID 296 |
| Public GitHub repo | ✅ | This repo |
| README + demo video | ✅ | [`README.md`](./README.md) + see above |
| Demo video ≤ 5 min | ✅ | See above |
| **Bonus:** multi-agent negotiation | ✅ | Research → Risk → Treasury → Executor flow with confidence scoring + threshold consensus |
| **Bonus:** OpenClaw / ACP-style coordination | ✅ | Existing CLI already exposes JSON I/O for agent skills (`skills/`) — agents call `ethnotary --json` for every action |

**Hedera Testnet details:**
- Chain ID: `296`
- RPC: `https://testnet.hashio.io/api` (Hashio public relay)
- Network registered in [`cli/utils/networks.js`](./cli/utils/networks.js) and [`setup.js`](./setup.js)
- Sample HashScan tx: _replace with on-chain HashScan link after demo run_
- MSAFactory address: _replace with Hedera deployment address from `node setup.js --networks hedera-testnet`_

---

## 🔵 Track 2 — Circle Agent Stack

| Requirement | Status | Where |
|---|---|---|
| Autonomous commerce flow | ✅ | Prediction-market scenario: agents detect mispriced odds, vote, settle USDC payment |
| Circle Agent Wallets integration | ✅ | [`demo/circle-funder.js`](./demo/circle-funder.js) — Treasury Agent funds the multi-sig from a Circle Developer-Controlled Wallet |
| USDC settlement | ✅ | Funding leg on Base Sepolia via Circle SDK; spend leg via Ethnotary multi-sig |
| Architecture diagram showing Circle integration | ✅ | [`docs/architecture.md`](./docs/architecture.md) — "Per-Agent Capital" subgraph |
| Documentation | ✅ | This file + [`demo/README.md`](./demo/README.md) |

**Circle integration details:**
- SDK: `@circle-fin/developer-controlled-wallets` (declared in [`package.json`](./package.json))
- Quickstart followed: https://developers.circle.com/agent-stack/agent-wallets/quickstart
- Default chain: `BASE-SEPOLIA` (configurable via `CIRCLE_BLOCKCHAIN`)
- Sample BaseScan tx (Circle-side): _replace after demo run_
- Sample BaseScan tx (multi-sig spend): _replace after demo run_

---

## ✨ What's novel

1. **First multi-agent consensus layer for autonomous capital.** Most agentic-payment stacks = 1 agent + 1 wallet. Ethnotary makes it *N agents → 1 governed treasury* with role separation (Research / Risk / Treasury / Executor).
2. **Combines Circle per-agent wallets with on-chain governance.** Agents hold individual capital in Circle wallets but must reach threshold consensus before spending from the shared treasury.
3. **Cross-chain agent coordination from one CLI/protocol.** The same agent committee can settle on Hedera Testnet, Base Sepolia, or any deployed EVM chain — the CLI's `--json` mode is agent-native.
4. **On-chain audit context.** Every committee session writes a structured record (proposal, votes, confidence, reasoning, transaction hashes) to `demo/audit-trail.json`. On-chain receipts have decision context.

---

## 🧱 Repo structure (judge-facing)

```
ethnotary-cli/
├── README.md                    ← narrative + quickstart + diagram
├── HACKATHON.md                 ← this file (track-by-track judge map)
├── docs/
│   └── architecture.md          ← full Mermaid architecture diagram
├── demo/
│   ├── agent-committee.js       ← runnable 4-agent demo
│   ├── circle-funder.js         ← Circle Agent Wallets integration
│   ├── config.json              ← demo scenario config
│   ├── audit-trail.json         ← (generated) immutable session log
│   └── README.md                ← demo-specific docs
├── cli/                         ← Ethnotary protocol CLI (agent-friendly --json mode)
│   ├── commands/                ← wallet, account, tx, data, contract, contact
│   └── utils/                   ← networks (incl. Hedera Testnet), constants, auth
├── src/                         ← MultiSigAccount + MSAFactory (Solidity)
├── setup.js                     ← cross-chain deployment (CREATE2 deterministic addresses)
└── package.json
```

---

## 📜 Sample audit-trail.json (excerpt)

```json
[
  {
    "sessionId": "session-1718136912345",
    "startedAt": "2026-06-13T20:15:12.345Z",
    "finishedAt": "2026-06-13T20:15:18.901Z",
    "network": "hedera-testnet",
    "multisig": { "alias": "joy", "address": "0x..." },
    "proposal": {
      "title": "Polymarket arbitrage opportunity",
      "amountUsdc": 25,
      "expectedValuePct": 12,
      "rationale": "Detected mispricing on Polymarket arbitrage opportunity..."
    },
    "decisions": [
      { "agent": "research", "action": "propose", "proposal": { "...": "..." } },
      { "agent": "risk", "decision": "approve", "confidence": 0.78, "reasoning": "..." },
      { "agent": "treasury", "decision": "approve", "reasoning": "..." },
      { "agent": "executor", "action": "submit", "transactionId": 0, "txHash": "0x..." },
      { "agent": "executor", "action": "execute", "txHash": "0x..." }
    ],
    "circleFunding": {
      "transactionId": "abc-123-...",
      "txHash": "0x...",
      "explorerUrl": "https://sepolia.basescan.org/tx/0x...",
      "blockchain": "BASE-SEPOLIA",
      "amountUSDC": 25
    },
    "onChain": {
      "submitTxHash": "0x...",
      "executeTxHash": "0x...",
      "transactionId": 0
    },
    "status": "executed"
  }
]
```

Every committee decision is replayable, signed by on-chain receipts, and reviewable by humans or other agents.
