/**
 * Circle Agent Wallets — USDC funding source for the demo Treasury Agent.
 *
 * In the Ethnotary architecture, each AI agent can hold its own Circle Agent
 * Wallet for individual on-chain capital. This module wraps the Circle SDK
 * so a Treasury Agent can top up the shared multi-sig before the committee
 * votes on a spend.
 *
 * Quickstart: https://developers.circle.com/agent-stack/agent-wallets/quickstart
 *
 * Required env:
 *   CIRCLE_API_KEY
 *   CIRCLE_ENTITY_SECRET
 *   CIRCLE_WALLET_ID         (pre-provisioned dev-controlled wallet)
 *   CIRCLE_USDC_TOKEN_ID     (token ID for USDC on the target chain; see Circle dashboard)
 *   CIRCLE_BLOCKCHAIN        (default: 'BASE-SEPOLIA')
 */

require('dotenv').config();

const DEFAULT_BLOCKCHAIN = process.env.CIRCLE_BLOCKCHAIN || 'BASE-SEPOLIA';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;

let _client = null;

function getClient() {
  if (_client) return _client;

  let initiateDeveloperControlledWalletsClient;
  try {
    ({ initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets'));
  } catch (err) {
    throw new Error(
      'Circle SDK not installed. Run: npm install @circle-fin/developer-controlled-wallets'
    );
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set');
  }

  _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return _client;
}

async function pollTransactionState(client, transactionId) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const resp = await client.getTransaction({ id: transactionId });
    const tx = resp?.data?.transaction;
    if (tx?.state === 'CONFIRMED' || tx?.state === 'COMPLETE') return tx;
    if (tx?.state === 'FAILED' || tx?.state === 'CANCELLED') {
      throw new Error(`Circle tx ${transactionId} ended in state ${tx.state}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Circle tx ${transactionId} did not confirm within ${POLL_TIMEOUT_MS / 1000}s`);
}

function explorerUrlFor(blockchain, txHash) {
  if (!txHash) return null;
  const map = {
    'BASE-SEPOLIA': `https://sepolia.basescan.org/tx/${txHash}`,
    'ETH-SEPOLIA': `https://sepolia.etherscan.io/tx/${txHash}`,
    'BASE': `https://basescan.org/tx/${txHash}`,
    'ETH': `https://etherscan.io/tx/${txHash}`,
    'MATIC-AMOY': `https://amoy.polygonscan.com/tx/${txHash}`,
    'MATIC': `https://polygonscan.com/tx/${txHash}`
  };
  return map[blockchain] || null;
}

/**
 * Send USDC from the configured Circle Agent Wallet to a target address.
 *
 * @param {object} opts
 * @param {string} opts.to            recipient address (the Ethnotary multi-sig)
 * @param {number} opts.amountUSDC    USDC amount as a decimal number (e.g., 25)
 * @param {string} [opts.tokenId]     Circle token ID for USDC; falls back to env
 * @param {string} [opts.walletId]    Circle wallet ID; falls back to env
 * @param {string} [opts.blockchain]  Circle blockchain key; falls back to env
 * @returns {Promise<{ txHash: string|null, transactionId: string, explorerUrl: string|null, blockchain: string }>}
 */
async function fundFromCircleWallet({ to, amountUSDC, tokenId, walletId, blockchain }) {
  if (!to) throw new Error('to (recipient) is required');
  if (!amountUSDC || Number(amountUSDC) <= 0) throw new Error('amountUSDC must be > 0');

  const wId = walletId || process.env.CIRCLE_WALLET_ID;
  const tId = tokenId || process.env.CIRCLE_USDC_TOKEN_ID;
  const chain = (blockchain || DEFAULT_BLOCKCHAIN).toUpperCase();

  if (!wId) throw new Error('CIRCLE_WALLET_ID must be set');
  if (!tId) throw new Error('CIRCLE_USDC_TOKEN_ID must be set (find it in Circle dashboard or via tokens API)');

  const client = getClient();

  const createResp = await client.createTransaction({
    walletId: wId,
    tokenId: tId,
    destinationAddress: to,
    amounts: [String(amountUSDC)],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }
  });

  const transactionId = createResp?.data?.id;
  if (!transactionId) {
    throw new Error(`Circle createTransaction returned no id: ${JSON.stringify(createResp?.data)}`);
  }

  const finalTx = await pollTransactionState(client, transactionId);

  return {
    transactionId,
    txHash: finalTx?.txHash || null,
    state: finalTx?.state || null,
    explorerUrl: explorerUrlFor(chain, finalTx?.txHash),
    blockchain: chain,
    amountUSDC: Number(amountUSDC),
    to
  };
}

module.exports = {
  fundFromCircleWallet
};
