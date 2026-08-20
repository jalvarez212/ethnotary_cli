# Ethnotary Agent Skills

Reusable [Agent Skills](https://agentskills.io) that teach a coding agent how to drive the Ethnotary CLI. Each skill is a directory with a `SKILL.md` (YAML frontmatter + instructions) plus optional bundled `scripts/` and `references/`.

## Install

Install all skills into your agent:

```bash
npx skills add jalvarez212/ethnotary_cli
```

Install a single skill:

```bash
npx skills add jalvarez212/ethnotary_cli --skill account-setup
```

Manage installed skills:

```bash
npx skills list      # List installed skills
npx skills update    # Update to latest
npx skills remove    # Remove a skill
```

## Available Skills

| Skill | Use it to… |
|-------|-----------|
| [`account-setup`](./account-setup/SKILL.md) | Install the CLI, create/import a wallet, deploy or import a MultiSig, configure RPCs. |
| [`transaction-management`](./transaction-management/SKILL.md) | Submit, confirm, execute, revoke transactions; transfer ERC-20/NFTs. |
| [`cross-network-operations`](./cross-network-operations/SKILL.md) | Deploy one MultiSig across many chains, query data cross-network, re-sync accounts. |
| [`multisig-approval`](./multisig-approval/SKILL.md) | Request human co-owner approvals via WhatsApp/Telegram before executing. |

## Layout

```
skills/
  <skill-name>/
    SKILL.md          # frontmatter (name, description) + workflow instructions
    scripts/          # optional executable helpers (loaded on demand)
    references/       # optional deep-dive docs (loaded on demand)
```

Relative paths inside a `SKILL.md` (e.g. `scripts/setup.sh`) resolve against that skill's directory.
