const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to get all pending transactions from a MultiSig contract across all EVM networks
 * Usage: node pending.js <multisig_address>
 */

// MultiSig ABI - functions we need to read transaction data
const MULTISIG_ABI = [
    "function transactionCount() view returns (uint)",
    "function transactions(uint) view returns (address dest, uint value, bytes func, bool executed, uint id)",
    "function isConfirmed(uint transactionId) view returns (bool)",
    "function getConfirmationCount(uint transactionId) view returns (uint)",
    "function getConfirmations(uint transactionId) view returns (address[])",
    "function required() view returns (uint)",
    "function getOwners() view returns (address[])",
    "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)"
];

// Available networks
const NETWORKS = {
    sepolia: {
        name: 'Sepolia',
        rpc: process.env.SEPOLIA_RPC_URL
    },
    'base-sepolia': {
        name: 'Base Sepolia',
        rpc: process.env.BASE_SEPOLIA_RPC_URL
    },
    'arbitrum-sepolia': {
        name: 'Arbitrum Sepolia',
        rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL
    }
};

async function getPendingTransactionsFromNetwork(multisigAddress, networkKey, networkConfig) {
    if (!networkConfig.rpc) {
        console.log(`⚠️  Skipping ${networkConfig.name}: No RPC URL configured`);
        return [];
    }
    try {
        console.log(`🔗 Connecting to ${networkConfig.name}...`);
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        
        // Create contract instance
        const multisig = new ethers.Contract(multisigAddress, MULTISIG_ABI, provider);
        
        // Check if contract exists
        const code = await provider.getCode(multisigAddress);
        if (code === '0x') {
            console.log(`⚠️  No contract found at ${multisigAddress} on ${networkConfig.name}`);
            return [];
        }
        
        // Get basic info
        const [transactionCount, required, owners] = await Promise.all([
            multisig.transactionCount(),
            multisig.required(),
            multisig.getOwners()
        ]);
        
        console.log(`📊 ${networkConfig.name} MultiSig Info:`);
        console.log(`  Total Transactions: ${transactionCount}`);
        console.log(`  Required Confirmations: ${required}`);
        console.log(`  Total Owners: ${owners.length}`);
        
        if (transactionCount === 0n) {
            console.log(`✅ ${networkConfig.name}: No transactions found`);
            return [];
        }
        
        console.log(`🔍 ${networkConfig.name}: Checking ${transactionCount} transactions for pending status...`);
        
        const pendingTransactions = [];
        
        // Check each transaction
        for (let i = 0; i < transactionCount; i++) {
            try {
                const [transaction, isConfirmed, confirmationCount, confirmations] = await Promise.all([
                    multisig.transactions(i),
                    multisig.isConfirmed(i),
                    multisig.getConfirmationCount(i),
                    multisig.getConfirmations(i)
                ]);
                
                // Transaction is pending if it's not executed AND not deleted
                // Deleted transactions have dest = address(0)
                const isDeleted = transaction.dest === '0x0000000000000000000000000000000000000000';
                const isPending = !transaction.executed && !isDeleted;
                
                if (isPending) {
                    // Get transaction creation timestamp by finding the SubmitTransaction event
                    let timestamp = null;
                    let blockNumber = null;
                    
                    try {
                        // Search for Submission event for this transaction ID
                        const filter = multisig.filters.Submission(i);
                        const events = await multisig.queryFilter(filter);
                        
                        if (events.length > 0) {
                            const event = events[0];
                            blockNumber = event.blockNumber;
                            const block = await provider.getBlock(blockNumber);
                            timestamp = block.timestamp;
                        }
                    } catch (eventError) {
                        // If we can't get the event, skip timestamp info rather than using current time
                        console.warn(`⚠️  Could not get timestamp for transaction ${i}:`, eventError.message);
                        timestamp = null;
                        blockNumber = null;
                    }
                    
                    pendingTransactions.push({
                        id: i,
                        dest: transaction.dest,
                        value: ethers.formatEther(transaction.value),
                        valueWei: transaction.value.toString(),
                        func: transaction.func,
                        executed: transaction.executed,
                        isConfirmed: isConfirmed,
                        confirmationCount: Number(confirmationCount),
                        requiredConfirmations: Number(required),
                        confirmationsNeeded: Number(required) - Number(confirmationCount),
                        confirmedBy: confirmations,
                        decodedFunction: decodeFunctionCall(transaction.func),
                        network: networkConfig.name,
                        networkKey: networkKey,
                        timestamp: timestamp,
                        blockNumber: blockNumber,
                        createdAt: timestamp ? new Date(timestamp * 1000).toISOString() : null
                    });
                }
            } catch (error) {
                console.warn(`⚠️  Error checking transaction ${i} on ${networkConfig.name}:`, error.message);
            }
        }
        
        console.log(`✅ ${networkConfig.name}: Found ${pendingTransactions.length} pending transactions`);
        return pendingTransactions;
        
    } catch (error) {
        console.error(`❌ Error getting pending transactions from ${networkConfig.name}:`, error.message);
        return [];
    }
}

async function getAllPendingTransactions(multisigAddress) {
    try {
        // Validate address
        if (!ethers.isAddress(multisigAddress)) {
            throw new Error(`Invalid address: ${multisigAddress}`);
        }

        console.log(`📋 Getting pending transactions for MultiSig: ${multisigAddress} across all networks\n`);
        
        // Get pending transactions from all networks
        const allPendingTransactions = [];
        const networkSummaries = {};
        
        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            const transactions = await getPendingTransactionsFromNetwork(multisigAddress, networkKey, networkConfig);
            allPendingTransactions.push(...transactions);
            networkSummaries[networkConfig.name] = transactions.length;
        }
        
        // Sort transactions by timestamp in descending order (newest first)
        // If timestamp is not available, fall back to ID sorting within the same network
        allPendingTransactions.sort((a, b) => {
            // Primary sort: by timestamp (newest first)
            if (a.timestamp && b.timestamp) {
                return b.timestamp - a.timestamp;
            }
            // Secondary sort: if timestamps are equal or missing, sort by network then ID
            if (a.networkKey === b.networkKey) {
                return b.id - a.id;
            }
            // Tertiary sort: by network name for consistency
            return a.networkKey.localeCompare(b.networkKey);
        });
        
        console.log('\n📈 Network Summary:');
        console.log('==================');
        Object.entries(networkSummaries).forEach(([network, count]) => {
            console.log(`${network}: ${count} pending transactions`);
        });
        console.log(`Total: ${allPendingTransactions.length} pending transactions across all networks`);
        
        if (allPendingTransactions.length > 0) {
            console.log('\n📋 All Pending Transactions:');
            console.log('============================');
            
            allPendingTransactions.forEach(tx => {
                console.log(`\n[${tx.network}] Transaction ID: ${tx.id}`);
                if (tx.createdAt) {
                    console.log(`  Created: ${tx.createdAt} (Block: ${tx.blockNumber || 'Unknown'})`);
                }
                console.log(`  Destination: ${tx.dest}`);
                console.log(`  Value: ${tx.value} ETH (${tx.valueWei} wei)`);
                console.log(`  Function Data: ${tx.func}`);
                if (tx.decodedFunction) {
                    console.log(`  Decoded: ${tx.decodedFunction}`);
                }
                console.log(`  Confirmations: ${tx.confirmationCount}/${tx.requiredConfirmations} (need ${tx.confirmationsNeeded} more)`);
                console.log(`  Confirmed by: ${tx.confirmedBy.length > 0 ? tx.confirmedBy.join(', ') : 'None'}`);
                console.log(`  Status: ${tx.isConfirmed ? 'Ready to Execute' : 'Awaiting Confirmations'}`);
            });
        }
        
        return allPendingTransactions;
        
    } catch (error) {
        console.error('❌ Error getting pending transactions:', error.message);
        process.exit(1);
    }
}

/**
 * Try to decode common function calls
 */
function decodeFunctionCall(funcData) {
    if (!funcData || funcData === '0x') {
        return 'ETH Transfer (no function call)';
    }
    
    try {
        // Common function selectors
        const selectors = {
            '0xa9059cbb': 'transfer(address,uint256)', // ERC20 transfer
            '0x23b872dd': 'transferFrom(address,address,uint256)', // ERC20 transferFrom
            '0x42842e0e': 'safeTransferFrom(address,address,uint256)', // ERC721 safeTransferFrom
            '0xb88d4fde': 'safeTransferFrom(address,address,uint256,bytes)', // ERC721 safeTransferFrom with data
        };
        
        const selector = funcData.slice(0, 10);
        if (selectors[selector]) {
            return selectors[selector];
        }
        
        return `Unknown function (${selector})`;
    } catch (error) {
        return 'Unable to decode';
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node pending.js <multisig_address>');
        console.log('This will search across all configured EVM networks');
        process.exit(1);
    }
    
    const multisigAddress = args[0];
    getAllPendingTransactions(multisigAddress);
}

module.exports = { getAllPendingTransactions, getPendingTransactionsFromNetwork };
