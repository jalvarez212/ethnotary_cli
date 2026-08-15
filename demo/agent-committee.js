#!/usr/bin/env node
/**
 * Ethnotary Multi-Agent Committee Demo
 *
 * Simulates a 4-agent treasury committee that proposes, evaluates, votes on,
 * and executes a transaction through the Ethnotary multi-sig — with every
 * decision logged to an immutable audit trail.
 *
 * Usage:
 *   node demo/agent-committee.js
 *
 * Config: demo/config.json
 * Output: demo/audit-trail.json (append-only)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ──────────────────────────────────────────────────────────────────────────
// Paths & Config
// ──────────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'config.json');
const AUDIT_PATH = path.join(__dirname, 'audit-trail.json');
const CLI = path.join(__dirname, '..', 'cli', 'index.js');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(chalk.red('✗ demo/config.json not found. See demo/README.md.'));
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function banner(text) {
  const line = '═'.repeat(text.length + 4);
  console.log(chalk.cyan('\n' + line));
  console.log(chalk.cyan('║ ') + chalk.bold.white(text) + chalk.cyan(' ║'));
  console.log(chalk.cyan(line + '\n'));
}

function agentSay(emoji, name, color, action, reasoning) {
  console.log(color(`${emoji}  ${chalk.bold(name)}`));
  console.log(color(`   ${action}`));
  if (reasoning) console.log(chalk.gray(`   ↳ ${reasoning}`));
  console.log('');
}

function runCli(args) {
  const cmd = `node "${CLI}" ${args} --json --yes`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    // CLI prints non-JSON spinner lines too; grab the last JSON object
    const match = out.match(/\{[\s\S]*\}\s*$/);
    return match ? JSON.parse(match[0]) : null;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    throw new Error(`CLI failed: ${stderr || stdout || err.message}`);
  }
}

function appendAudit(record) {
  let trail = [];
  if (fs.existsSync(AUDIT_PATH)) {
    try {
      trail = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
      if (!Array.isArray(trail)) trail = [];
    } catch {
      trail = [];
    }
  }
  trail.push(record);
  fs.writeFileSync(AUDIT_PATH, JSON.stringify(trail, null, 2));
}

// ──────────────────────────────────────────────────────────────────────────
// Agent definitions (scripted reasoning — production version uses LLM
// function calling, but scripted is more reliable for video demos)
// ──────────────────────────────────────────────────────────────────────────

const agents = {
  research: {
    name: 'Research Agent',
    emoji: '🔍',
    color: chalk.cyan,
    propose() {
      const s = config.scenario;
      return {
        title: s.title,
        amountUsdc: s.amountUsdc,
        expectedValuePct: s.expectedValuePct,
        rationale: `Detected mispricing on ${s.title}. Modeled EV +${s.expectedValuePct}% vs market consensus over 200 comparable resolutions.`
      };
    }
  },
  risk: {
    name: 'Risk Agent',
    emoji: '🛡️',
    color: chalk.yellow,
    evaluate(proposal) {
      const c = config.scenario.confidence;
      return {
        decision: c >= 0.6 ? 'approve' : 'reject',
        confidence: c,
        reasoning: `Position sizing within 0.5% of treasury. Drawdown bounded at ${proposal.amountUsdc} USDC. Confidence ${(c * 100).toFixed(0)}% > 60% threshold.`
      };
    }
  },
  treasury: {
    name: 'Treasury Agent',
    emoji: '💰',
    color: chalk.green,
    evaluate(proposal) {
      return {
        decision: 'approve',
        reasoning: `Allocation budget available. ${proposal.amountUsdc} USDC < daily cap. No conflicting positions open.`
      };
    }
  },
  executor: {
    name: 'Executor Agent',
    emoji: '⚡',
    color: chalk.magenta
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Optional: Circle Agent Wallets funding
// ──────────────────────────────────────────────────────────────────────────

async function maybeFundFromCircle(multisigAddress) {
  let circle;
  try {
    circle = require('./circle-funder');
  } catch {
    return null;
  }
  if (!process.env.CIRCLE_API_KEY) {
    console.log(chalk.gray('   ⚠ Skipping Circle funding (no CIRCLE_API_KEY) — assuming pre-funded multi-sig\n'));
    return null;
  }
  try {
    return await circle.fundFromCircleWallet({
      to: multisigAddress,
      amountUSDC: config.scenario.amountUsdc
    });
  } catch (err) {
    console.log(chalk.yellow(`   ⚠ Circle funding failed: ${err.message}\n`));
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  const sessionId = `session-${Date.now()}`;
  const decisions = [];

  banner('🤖 ETHNOTARY AGENT COMMITTEE CONVENING');
  console.log(chalk.gray(`   session: ${sessionId}`));
  console.log(chalk.gray(`   multisig: ${config.multisigAlias}`));
  console.log(chalk.gray(`   network:  ${config.network}\n`));

  // Step 0 — Optional Circle funding
  let circleFunding = null;
  console.log(chalk.bold('Step 0 — Treasury Funding\n'));
  agentSay(
    agents.treasury.emoji,
    agents.treasury.name,
    agents.treasury.color,
    `Topping up multi-sig from Circle Agent Wallet (${config.scenario.amountUsdc} USDC)...`,
    null
  );
  // Resolve multisig address from CLI for circle transfer (best effort)
  let multisigAddress = null;
  try {
    const info = runCli(`account info --address ${config.multisigAlias}`);
    multisigAddress = info?.address || null;
  } catch {
    /* contract may not exist on this network — fine for funding step */
  }
  if (multisigAddress) {
    circleFunding = await maybeFundFromCircle(multisigAddress);
    if (circleFunding) {
      console.log(chalk.green(`   ✓ Funded via Circle  tx: ${circleFunding.txHash}\n`));
    }
  } else {
    console.log(chalk.gray('   (skipping — multi-sig address not resolvable)\n'));
  }
  await sleep(800);

  // Step 1 — Research proposes
  console.log(chalk.bold('Step 1 — Proposal\n'));
  const proposal = agents.research.propose();
  agentSay(
    agents.research.emoji,
    agents.research.name,
    agents.research.color,
    `Proposes: spend ${proposal.amountUsdc} USDC — ${proposal.title}`,
    proposal.rationale
  );
  decisions.push({ agent: 'research', action: 'propose', proposal });
  await sleep(900);

  // Step 2 — Risk evaluates
  console.log(chalk.bold('Step 2 — Risk Review\n'));
  const riskVote = agents.risk.evaluate(proposal);
  agentSay(
    agents.risk.emoji,
    agents.risk.name,
    agents.risk.color,
    `Vote: ${riskVote.decision.toUpperCase()}  (confidence ${(riskVote.confidence * 100).toFixed(0)}%)`,
    riskVote.reasoning
  );
  decisions.push({ agent: 'risk', ...riskVote });
  if (riskVote.decision !== 'approve') {
    console.log(chalk.red('✗ Risk Agent rejected. Halting.'));
    appendAudit({ sessionId, startedAt, status: 'rejected_by_risk', decisions });
    process.exit(1);
  }
  await sleep(900);

  // Step 3 — Treasury evaluates
  console.log(chalk.bold('Step 3 — Treasury Review\n'));
  const treasuryVote = agents.treasury.evaluate(proposal);
  agentSay(
    agents.treasury.emoji,
    agents.treasury.name,
    agents.treasury.color,
    `Vote: ${treasuryVote.decision.toUpperCase()}`,
    treasuryVote.reasoning
  );
  decisions.push({ agent: 'treasury', ...treasuryVote });
  await sleep(900);

  // Step 4 — Consensus
  console.log(chalk.bold.green('✓ Consensus reached: 3/3 approve\n'));
  await sleep(500);

  // Step 5 — Executor submits on-chain
  console.log(chalk.bold('Step 4 — On-Chain Settlement\n'));
  agentSay(
    agents.executor.emoji,
    agents.executor.name,
    agents.executor.color,
    `Submitting transaction via Ethnotary multi-sig on ${config.network}...`,
    null
  );

  let submitResult, executeResult;
  try {
    submitResult = runCli(
      `tx submit --address ${config.multisigAlias} --network ${config.network} --dest ${config.recipient} --value ${config.valueEth}`
    );
    if (!submitResult || submitResult.transactionId === undefined) {
      throw new Error(`Submit returned unexpected payload: ${JSON.stringify(submitResult)}`);
    }
    console.log(chalk.gray(`   ↳ submit txHash: ${submitResult.txHash}`));
    console.log(chalk.gray(`   ↳ confirmations: ${submitResult.confirmations}`));
    decisions.push({ agent: 'executor', action: 'submit', ...submitResult });

    if (submitResult.canExecute) {
      executeResult = runCli(
        `tx execute --address ${config.multisigAlias} --network ${config.network} --txid ${submitResult.transactionId}`
      );
      console.log(chalk.gray(`   ↳ execute txHash: ${executeResult.txHash || executeResult.executionTxHash || '(see status)'}\n`));
      decisions.push({ agent: 'executor', action: 'execute', ...executeResult });
    } else {
      console.log(chalk.yellow(`   ⚠ Threshold not met by submitter alone — additional owner confirms required.`));
      console.log(chalk.gray(`     run: ethnotary tx confirm --address ${config.multisigAlias} --network ${config.network} --txid ${submitResult.transactionId}\n`));
    }
  } catch (err) {
    console.log(chalk.red(`✗ On-chain submission failed: ${err.message}\n`));
    appendAudit({
      sessionId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'execution_failed',
      error: err.message,
      decisions,
      circleFunding
    });
    process.exit(1);
  }

  // Step 6 — Audit trail
  const finishedAt = new Date().toISOString();
  const record = {
    sessionId,
    startedAt,
    finishedAt,
    network: config.network,
    multisig: { alias: config.multisigAlias, address: multisigAddress },
    proposal,
    decisions,
    circleFunding,
    onChain: {
      submitTxHash: submitResult?.txHash || null,
      executeTxHash: executeResult?.txHash || executeResult?.executionTxHash || null,
      transactionId: submitResult?.transactionId ?? null
    },
    status: executeResult ? 'executed' : 'awaiting_confirmations'
  };
  appendAudit(record);

  banner('✅ COMMITTEE SESSION COMPLETE');
  console.log(chalk.gray(`   audit:  ${path.relative(process.cwd(), AUDIT_PATH)}`));
  if (record.onChain.submitTxHash) {
    console.log(chalk.gray(`   submit: ${record.onChain.submitTxHash}`));
  }
  if (record.onChain.executeTxHash) {
    console.log(chalk.gray(`   exec:   ${record.onChain.executeTxHash}`));
  }
  console.log('');
}

main().catch((err) => {
  console.error(chalk.red(`\n✗ Demo failed: ${err.message}`));
  process.exit(1);
});
