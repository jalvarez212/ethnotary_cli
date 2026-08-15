const { ethers } = require('ethers');
const { getRpcUrl, validateNetwork } = require('./networks');
const { getContractNetworks, createDecoupledContract } = require('./contracts');

const MULTISIG_ABI = [
  "function getOwners() view returns (address[])",
  "function required() view returns (uint)",
  "function isOwner(address) view returns (bool)",
  "function pinHash() view returns (bytes32)",
  "function pinNonce() view returns (uint256)",
  "function addOwner(address accountOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public",
  "function removeOwner(address accountOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public",
  "function replaceOwner(address accountOwner, address newOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public",
  "function changeRequirement(uint _required, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public"
];

/**
 * Fetch account state from all configured networks
 */
async function fetchAccountStateAcrossNetworks(aliasOrAddress, address) {
  const networks = getContractNetworks(aliasOrAddress);
  const states = [];
  
  for (const networkKey of networks) {
    try {
      const rpc = getRpcUrl(networkKey);
      if (!rpc) continue;
      
      const provider = new ethers.JsonRpcProvider(rpc);
      const multisig = new ethers.Contract(address, MULTISIG_ABI, provider);
      
      const [owners, required] = await Promise.all([
        multisig.getOwners(),
        multisig.required()
      ]);
      
      states.push({
        network: networkKey,
        owners: owners.map(o => o.toLowerCase()),
        required: Number(required),
        success: true
      });
    } catch (err) {
      states.push({
        network: networkKey,
        error: err.message,
        success: false
      });
    }
  }
  
  return states;
}

/**
 * Check if account is in sync across all networks
 * Returns { inSync: boolean, canonical: { owners, required }, discrepancies: [] }
 */
function analyzeAccountSync(states) {
  const successfulStates = states.filter(s => s.success);
  
  if (successfulStates.length === 0) {
    return { inSync: false, error: 'No networks responded', discrepancies: [] };
  }
  
  if (successfulStates.length === 1) {
    return { 
      inSync: true, 
      canonical: { 
        owners: successfulStates[0].owners, 
        required: successfulStates[0].required 
      },
      discrepancies: []
    };
  }
  
  // Find canonical state (most common configuration)
  const configCounts = {};
  for (const state of successfulStates) {
    const key = JSON.stringify({ owners: state.owners.sort(), required: state.required });
    configCounts[key] = (configCounts[key] || 0) + 1;
  }
  
  // Get the most common configuration
  const sortedConfigs = Object.entries(configCounts).sort((a, b) => b[1] - a[1]);
  const canonicalConfig = JSON.parse(sortedConfigs[0][0]);
  
  // Find discrepancies
  const discrepancies = [];
  for (const state of successfulStates) {
    const stateKey = JSON.stringify({ owners: state.owners.sort(), required: state.required });
    const canonicalKey = JSON.stringify({ owners: canonicalConfig.owners.sort(), required: canonicalConfig.required });
    
    if (stateKey !== canonicalKey) {
      const missingOwners = canonicalConfig.owners.filter(o => !state.owners.includes(o));
      const extraOwners = state.owners.filter(o => !canonicalConfig.owners.includes(o));
      
      discrepancies.push({
        network: state.network,
        currentOwners: state.owners,
        currentRequired: state.required,
        missingOwners,
        extraOwners,
        requirementMismatch: state.required !== canonicalConfig.required
      });
    }
  }
  
  return {
    inSync: discrepancies.length === 0,
    canonical: canonicalConfig,
    discrepancies,
    networkCount: successfulStates.length
  };
}

/**
 * Handle decoupling when an account operation fails on some networks
 */
function handleDecoupling(alias, address, failedNetworks, out) {
  const chalk = require('chalk');
  
  if (failedNetworks.length === 0) return;
  
  out.warn(`\n⚠️  Account is now out of sync on ${failedNetworks.length} network(s):`);
  
  for (const { network, error } of failedNetworks) {
    out.warn(`  - ${network}: ${error}`);
    
    // Create decoupled contract alias
    const decoupled = createDecoupledContract(alias, address, network);
    out.info(`  Created decoupled alias: ${decoupled.alias}`);
  }
  
  out.info('\nTo re-sync accounts, run:');
  out.info(chalk.white(`  ethnotary account sync --address ${alias}`));
}

/**
 * Pre-flight check for account management operations across all networks
 * Estimates gas and checks wallet balance on each network
 * Returns { canProceed, networks: [{ network, gasEstimate, balance, sufficient, error }] }
 */
async function preflightAccountOperation(aliasOrAddress, address, walletAddress, operation, operationArgs) {
  const networks = getContractNetworks(aliasOrAddress);
  const results = [];
  let allSufficient = true;
  let hasErrors = false;
  
  for (const networkKey of networks) {
    try {
      const rpc = getRpcUrl(networkKey);
      if (!rpc) {
        results.push({
          network: networkKey,
          error: 'No RPC configured',
          sufficient: false
        });
        hasErrors = true;
        continue;
      }
      
      const provider = new ethers.JsonRpcProvider(rpc);
      const multisig = new ethers.Contract(address, MULTISIG_ABI, provider);
      
      // Get wallet balance
      const balance = await provider.getBalance(walletAddress);
      
      // Get current gas price
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
      
      // Use fixed gas estimates for account operations
      // (Can't estimate with mock proof - zkSNARK verifier rejects invalid proofs)
      // These are conservative estimates based on typical gas usage
      let gasEstimate;
      if (operation === 'addOwner' || operation === 'removeOwner') {
        gasEstimate = 350000n; // ~300k typical + buffer
      } else if (operation === 'replaceOwner') {
        gasEstimate = 400000n; // slightly higher for replace
      } else if (operation === 'changeRequirement') {
        gasEstimate = 100000n; // simpler operation
      } else {
        gasEstimate = 350000n; // default
      }
      
      // Verify contract exists on this network
      try {
        const code = await provider.getCode(address);
        if (code === '0x') {
          results.push({
            network: networkKey,
            error: 'Contract not deployed on this network',
            balance: ethers.formatEther(balance),
            sufficient: false
          });
          hasErrors = true;
          allSufficient = false;
          continue;
        }
      } catch (codeErr) {
        // Continue with balance check even if code check fails
      }
      
      // Add 20% buffer to gas estimate
      const gasWithBuffer = (gasEstimate * 120n) / 100n;
      const estimatedCost = gasWithBuffer * gasPrice;
      const sufficient = balance >= estimatedCost;
      
      if (!sufficient) {
        allSufficient = false;
      }
      
      results.push({
        network: networkKey,
        gasEstimate: Number(gasWithBuffer),
        gasPrice: ethers.formatUnits(gasPrice, 'gwei') + ' gwei',
        estimatedCost: ethers.formatEther(estimatedCost) + ' ETH',
        balance: ethers.formatEther(balance) + ' ETH',
        sufficient,
        error: null
      });
      
    } catch (err) {
      results.push({
        network: networkKey,
        error: err.message,
        sufficient: false
      });
      hasErrors = true;
      allSufficient = false;
    }
  }
  
  return {
    canProceed: allSufficient && !hasErrors,
    allSufficient,
    hasErrors,
    networks: results
  };
}

/**
 * Display preflight results to user
 */
function displayPreflightResults(preflight, out) {
  const chalk = require('chalk');
  
  if (!out.json) {
    console.log(chalk.cyan('\n📋 Pre-flight Check Results:\n'));
    
    for (const result of preflight.networks) {
      if (result.error) {
        console.log(chalk.red(`  ✗ ${result.network}: ${result.error}`));
      } else if (!result.sufficient) {
        console.log(chalk.yellow(`  ⚠ ${result.network}: Insufficient balance`));
        console.log(chalk.gray(`      Balance: ${result.balance}`));
        console.log(chalk.gray(`      Required: ~${result.estimatedCost}`));
      } else {
        console.log(chalk.green(`  ✓ ${result.network}: Ready`));
        console.log(chalk.gray(`      Balance: ${result.balance}`));
        console.log(chalk.gray(`      Est. cost: ~${result.estimatedCost}`));
      }
    }
    console.log('');
  }
  
  return preflight;
}

module.exports = {
  MULTISIG_ABI,
  fetchAccountStateAcrossNetworks,
  analyzeAccountSync,
  handleDecoupling,
  preflightAccountOperation,
  displayPreflightResults
};
