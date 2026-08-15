const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to get all event logs from a MultiSig contract across all EVM networks
 * Usage: node events.js <multisig_address>
 */

// MultiSig ABI - only the events we need
const MULTISIG_ABI = [
    // Transaction Lifecycle Events
    "event Confirmation(address indexed sender, uint indexed transactionId)",
    "event Revocation(address indexed sender, uint indexed transactionId)",
    "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)",
    "event Execution(uint transactionId, address indexed to, uint indexed amount)",
    "event ExecutionFailure(uint indexed transactionId)",
    "event Delete(uint indexed transactionId, address indexed sender)",
    
    // Execution Type Events (emitted during execute())
    "event Swap(uint indexed transactionId, address indexed swapModule, address indexed executor, uint256 ethValue)",
    "event TokenTransfer(uint indexed transactionId, address indexed assetContract, address indexed to, uint256 amountOrTokenId, address executor, bool isNFT)",
    "event NativeTransfer(uint indexed transactionId, address indexed to, uint256 amount, address executor)",
    "event ContractInteraction(uint indexed transactionId, address indexed target, address indexed executor, uint256 value, bytes data)",
    "event CashOut(uint256 indexed approvalTxId, uint256 indexed transferTxId, address indexed depositAddress, address tokenAddress, uint256 amount, address executor, bool isNative)",
    
    // Asset Receipt Events
    "event Deposit(address sender, uint value)",
    "event NftReceived(address operator, address from, uint256 tokenId, bytes data)",
    
    // Owner Management Events
    "event OwnerAddition(address indexed owner)",
    "event OwnerRemoval(address indexed owner)",
    "event OwnerReplace(address indexed oldOwner, address indexed newOwner)",
    "event RequirementChange(uint required)"
];

// Function selector mappings for decoding submission types
const FUNCTION_SELECTORS = {
    // ERC20 Token Functions
    '0xa9059cbb': 'ERC20 Transfer',
    '0x23b872dd': 'ERC20 TransferFrom',
    '0x095ea7b3': 'ERC20 Approve',
    '0x40c10f19': 'ERC20 Mint',
    '0x42966c68': 'ERC20 Burn',
    
    // ERC721 NFT Functions
    '0x42842e0e': 'NFT SafeTransferFrom',
    '0xb88d4fde': 'NFT SafeTransferFrom (with data)',
    '0xa22cb465': 'NFT SetApprovalForAll',
    
    // MultiSig Account Management (now PIN-protected, not via submit)
    // Note: These functions no longer use submitTransaction flow
    
    // MultiSig Transaction Management
    '0x0c53c51c': 'Confirm Transaction',
    '0x20ea8d86': 'Revoke Confirmation',
    '0xee22610b': 'Execute Transaction',
    
    // Swap/Bridge Functions
    '0x38ed1739': 'Swap Exact Tokens For Tokens',
    '0x7ff36ab5': 'Swap Exact ETH For Tokens',
    '0x18cbafe5': 'Swap Exact Tokens For ETH',
    
    // Cash-Out Functions
    '0xa0712d68': 'Cash Out (Off-ramp)'
};

/**
 * Decode function selector from bytes data
 * @param {string} funcData - Hex string of function data
 * @returns {string} Human-readable function description
 */
function decodeFunctionSelector(funcData) {
    if (!funcData || funcData === '0x' || funcData === '0x0' || funcData.length < 10) {
        return 'Native Transfer (ETH)';
    }
    
    try {
        // Extract the first 4 bytes (function selector)
        const selector = funcData.slice(0, 10).toLowerCase(); // '0x' + 8 hex chars
        
        // Look up the selector
        if (FUNCTION_SELECTORS[selector]) {
            return FUNCTION_SELECTORS[selector];
        }
        
        return `Unknown Function (${selector})`;
    } catch (error) {
        return 'Unknown Function';
    }
}

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

async function getMultiSigEventsFromNetwork(multisigAddress, networkKey, networkConfig) {
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
        
        // Get all events
        const filter = {
            address: multisigAddress,
            fromBlock: 0,
            toBlock: 'latest'
        };
        
        const logs = await provider.getLogs(filter);
        console.log(`📊 ${networkConfig.name}: Found ${logs.length} total logs`);
        
        // Parse events
        const events = [];
        for (const log of logs) {
            try {
                const parsedLog = multisig.interface.parseLog(log);
                if (parsedLog) {
                    const block = await provider.getBlock(log.blockNumber);
                    
                    const eventData = {
                        event: parsedLog.name,
                        args: parsedLog.args,
                        blockNumber: log.blockNumber,
                        transactionHash: log.transactionHash,
                        timestamp: new Date(block.timestamp * 1000).toISOString(),
                        timestampUnix: block.timestamp,
                        logIndex: log.logIndex,
                        network: networkConfig.name,
                        networkKey: networkKey
                    };
                    
                    // For Submission events, decode the function type
                    if (parsedLog.name === 'Submission' && parsedLog.args.func) {
                        eventData.submissionType = decodeFunctionSelector(parsedLog.args.func);
                    }
                    
                    events.push(eventData);
                }
            } catch (error) {
                // Skip logs that don't match our ABI
                continue;
            }
        }
        
        console.log(`✅ ${networkConfig.name}: Parsed ${events.length} MultiSig events`);
        return events;
        
    } catch (error) {
        console.error(`❌ Error getting events from ${networkConfig.name}:`, error.message);
        return [];
    }
}

async function getAllMultiSigEvents(multisigAddress) {
    try {
        // Validate address
        if (!ethers.isAddress(multisigAddress)) {
            throw new Error(`Invalid address: ${multisigAddress}`);
        }

        console.log(`📋 Getting events for MultiSig: ${multisigAddress} across all networks\n`);
        
        // Get events from all networks
        const allEvents = [];
        const networkSummaries = {};
        
        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            const events = await getMultiSigEventsFromNetwork(multisigAddress, networkKey, networkConfig);
            allEvents.push(...events);
            networkSummaries[networkConfig.name] = events.length;
        }
        
        // Sort all events by timestamp (newest to oldest)
        allEvents.sort((a, b) => b.timestampUnix - a.timestampUnix);
        
        console.log('\n📈 Network Summary:');
        console.log('==================');
        Object.entries(networkSummaries).forEach(([network, count]) => {
            console.log(`${network}: ${count} events`);
        });
        console.log(`Total: ${allEvents.length} events across all networks`);
        
        // Group events by type across all networks
        const eventsByType = {};
        allEvents.forEach(event => {
            if (!eventsByType[event.event]) {
                eventsByType[event.event] = [];
            }
            eventsByType[event.event].push(event);
        });
        
        console.log('\n📊 Event Type Summary:');
        console.log('=====================');
        Object.keys(eventsByType).forEach(eventType => {
            console.log(`${eventType}: ${eventsByType[eventType].length} events`);
        });
        
        // If there are Submission events, show breakdown by type
        if (eventsByType['Submission'] && eventsByType['Submission'].length > 0) {
            console.log('\n📝 Submission Type Breakdown:');
            console.log('============================');
            const submissionsByType = {};
            eventsByType['Submission'].forEach(event => {
                const type = event.submissionType || 'Unknown';
                if (!submissionsByType[type]) {
                    submissionsByType[type] = 0;
                }
                submissionsByType[type]++;
            });
            Object.entries(submissionsByType)
                .sort((a, b) => b[1] - a[1]) // Sort by count descending
                .forEach(([type, count]) => {
                    console.log(`  ${type}: ${count}`);
                });
        }
        
        // Display all events in reverse chronological order (newest first)
        console.log('\n📋 All Events (Newest First):');
        console.log('=============================');
        allEvents.forEach(event => {
            // For Submission events, show the decoded type
            const eventTitle = event.event === 'Submission' && event.submissionType
                ? `${event.event} - ${event.submissionType}`
                : event.event;
            
            console.log(`${event.timestamp} [${event.network}] - ${eventTitle}`);
            console.log(`  Block: ${event.blockNumber}, Tx: ${event.transactionHash}`);
            
            // Show event-specific details
            if (event.event === 'Submission') {
                console.log(`  Transaction ID: ${event.args.transactionId}`);
                console.log(`  Destination: ${event.args.dest}`);
                console.log(`  Value: ${ethers.formatEther(event.args.value)} ETH`);
                if (event.submissionType) {
                    console.log(`  Type: ${event.submissionType}`);
                }
            } else if (event.event === 'TokenTransfer') {
                console.log(`  Transaction ID: ${event.args.transactionId}`);
                console.log(`  Asset Contract: ${event.args.assetContract}`);
                console.log(`  To: ${event.args.to}`);
                console.log(`  ${event.args.isNFT ? 'Token ID' : 'Amount'}: ${event.args.amountOrTokenId.toString()}`);
                console.log(`  Type: ${event.args.isNFT ? 'NFT' : 'ERC20'}`);
                console.log(`  Executor: ${event.args.executor}`);
            } else if (event.event === 'NativeTransfer') {
                console.log(`  Transaction ID: ${event.args.transactionId}`);
                console.log(`  To: ${event.args.to}`);
                console.log(`  Amount: ${ethers.formatEther(event.args.amount)} ETH`);
                console.log(`  Executor: ${event.args.executor}`);
            } else if (event.event === 'Swap') {
                console.log(`  Transaction ID: ${event.args.transactionId}`);
                console.log(`  Swap Module: ${event.args.swapModule}`);
                console.log(`  ETH Value: ${ethers.formatEther(event.args.ethValue)} ETH`);
                console.log(`  Executor: ${event.args.executor}`);
            } else if (event.event === 'CashOut') {
                console.log(`  Approval Tx ID: ${event.args.approvalTxId}`);
                console.log(`  Transfer Tx ID: ${event.args.transferTxId}`);
                console.log(`  Deposit Address: ${event.args.depositAddress}`);
                console.log(`  Token: ${event.args.isNative ? 'Native (ETH)' : event.args.tokenAddress}`);
                console.log(`  Amount: ${ethers.formatEther(event.args.amount)}`);
                console.log(`  Executor: ${event.args.executor}`);
            } else if (event.event === 'ContractInteraction') {
                console.log(`  Transaction ID: ${event.args.transactionId}`);
                console.log(`  Target: ${event.args.target}`);
                console.log(`  Value: ${ethers.formatEther(event.args.value)} ETH`);
                console.log(`  Executor: ${event.args.executor}`);
                console.log(`  Data: ${event.args.data.slice(0, 66)}...`); // Show first 32 bytes
            } else if (event.event === 'NftReceived') {
                console.log(`  From: ${event.args.from}`);
                console.log(`  Token ID: ${event.args.tokenId}`);
                console.log(`  Operator: ${event.args.operator}`);
            } else if (event.event === 'Delete') {
                console.log(`  Transaction ID: ${event.args.transactionId}`);
                console.log(`  Deleted by: ${event.args.sender}`);
            } else {
                console.log(`  Args:`, event.args);
            }
            console.log('');
        });
        
        return allEvents;
        
    } catch (error) {
        console.error('❌ Error getting MultiSig events:', error.message);
        process.exit(1);
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node events.js <multisig_address>');
        console.log('This will search across all configured EVM networks');
        process.exit(1);
    }
    
    const multisigAddress = args[0];
    getAllMultiSigEvents(multisigAddress);
}

module.exports = { 
    getAllMultiSigEvents, 
    getMultiSigEventsFromNetwork,
    decodeFunctionSelector,
    FUNCTION_SELECTORS
};
