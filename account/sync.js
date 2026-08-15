const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to synchronize MultiSig contract owners and confirmation requirements across all EVM networks
 * Usage: node sync.js <multisig_address> <pin> [--dry-run]
 */

// MultiSig ABI - functions we need for owner management
const MULTISIG_ABI = [
    "function getOwners() view returns (address[])",
    "function required() view returns (uint)",
    "function isOwner(address) view returns (bool)",
    "function addOwner(address owner, uint16 _pin)",
    "function removeOwner(address owner, uint16 _pin)",
    "function changeRequirement(uint _required)"
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

class MultiSigSynchronizer {
    constructor(multisigAddress, pin, options = {}) {
        this.multisigAddress = multisigAddress;
        this.pin = pin;
        this.dryRun = options.dryRun || false;
        this.wallet = null;
        this.networkData = {};
    }

    async initialize() {
        console.log('🔧 Initializing MultiSig Synchronizer...\n');
        
        // Validate environment
        this.validateEnvironment();
        
        // Validate multisig address
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }
        
        console.log(`📋 MultiSig Address: ${this.multisigAddress}`);
        console.log(`🔑 PIN: ${this.pin}`);
        console.log(`🔍 Mode: ${this.dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE MODE'}\n`);
    }

    validateEnvironment() {
        if (!process.env.PRIVATE_KEY) {
            throw new Error('PRIVATE_KEY not found in .env');
        }
        
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
        console.log(`👤 Using wallet: ${this.wallet.address}`);
        
        // Check available networks
        const availableNetworks = [];
        for (const [key, network] of Object.entries(NETWORKS)) {
            if (network.rpc) {
                availableNetworks.push(key);
            } else {
                console.warn(`⚠️  Skipping ${network.name}: No RPC URL configured`);
            }
        }
        
        if (availableNetworks.length === 0) {
            throw new Error('No networks configured with RPC URLs');
        }
        
        console.log(`🌐 Available networks: ${availableNetworks.join(', ')}`);
    }

    async gatherNetworkData() {
        console.log('📊 Gathering data from all networks...\n');
        
        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!networkConfig.rpc) continue;
            
            try {
                console.log(`🔗 Connecting to ${networkConfig.name}...`);
                const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
                const multisig = new ethers.Contract(this.multisigAddress, MULTISIG_ABI, provider);
                
                // Check if contract exists
                const code = await provider.getCode(this.multisigAddress);
                if (code === '0x') {
                    console.log(`⚠️  No contract found at ${this.multisigAddress} on ${networkConfig.name}`);
                    continue;
                }
                
                // Get owners and requirements
                const [owners, required] = await Promise.all([
                    multisig.getOwners(),
                    multisig.required()
                ]);
                
                this.networkData[networkKey] = {
                    name: networkConfig.name,
                    provider,
                    multisig,
                    owners: owners.map(addr => addr.toLowerCase()),
                    required: Number(required),
                    wallet: this.wallet.connect(provider)
                };
                
                console.log(`✅ ${networkConfig.name}:`);
                console.log(`   Owners: ${owners.length} (${owners.join(', ')})`);
                console.log(`   Required: ${required}\n`);
                
            } catch (error) {
                console.error(`❌ Error connecting to ${networkConfig.name}:`, error.message);
            }
        }
        
        if (Object.keys(this.networkData).length === 0) {
            throw new Error('No networks available or contracts found');
        }
    }

    analyzeDiscrepancies() {
        console.log('🔍 Analyzing discrepancies across networks...\n');
        
        // Get union of all owners across all networks (every owner on any network should be on all networks)
        const allOwnersSet = new Set();
        const ownersByNetwork = {};
        const requirementsByNetwork = {};

        for (const [networkKey, data] of Object.entries(this.networkData)) {
            ownersByNetwork[networkKey] = new Set(data.owners);
            requirementsByNetwork[networkKey] = data.required;

            // Add all owners from this network to the canonical set
            data.owners.forEach(owner => allOwnersSet.add(owner));
        }

        // Canonical owner set is the union of all owners across all networks
        const canonicalOwners = Array.from(allOwnersSet).sort();
        const canonicalOwnerSet = new Set(canonicalOwners);

        console.log(`👥 Canonical owner set (union of all networks, ${canonicalOwners.length} owners):`);
        canonicalOwners.forEach(owner => console.log(`   ${owner}`));
        
        // Determine canonical requirement (use the most common one, or highest if tied)
        const requirementCounts = {};
        Object.values(requirementsByNetwork).forEach(req => {
            requirementCounts[req] = (requirementCounts[req] || 0) + 1;
        });
        
        const canonicalRequirement = Object.entries(requirementCounts)
            .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
        
        console.log(`\n🎯 Canonical requirement: ${canonicalRequirement}`);
        
        // Find discrepancies
        const ownerDiscrepancies = {};
        const requirementDiscrepancies = {};
        
        for (const [networkKey, data] of Object.entries(this.networkData)) {
            const networkOwners = ownersByNetwork[networkKey];
            const missingOwners = canonicalOwners.filter(owner => !networkOwners.has(owner));
            const extraOwners = data.owners.filter(owner => !canonicalOwnerSet.has(owner));
            
            if (missingOwners.length > 0 || extraOwners.length > 0) {
                ownerDiscrepancies[networkKey] = { missingOwners, extraOwners };
            }
            
            if (data.required !== parseInt(canonicalRequirement)) {
                requirementDiscrepancies[networkKey] = {
                    current: data.required,
                    target: parseInt(canonicalRequirement)
                };
            }
        }
        
        return {
            canonicalOwners,
            canonicalRequirement: parseInt(canonicalRequirement),
            ownerDiscrepancies,
            requirementDiscrepancies
        };
    }

    async synchronizeOwners(canonicalOwners, ownerDiscrepancies) {
        console.log('\n👥 Synchronizing owners across networks...\n');
        
        for (const [networkKey, discrepancy] of Object.entries(ownerDiscrepancies)) {
            const networkData = this.networkData[networkKey];
            console.log(`🔧 Fixing ${networkData.name}:`);
            
            // Add missing owners
            for (const missingOwner of discrepancy.missingOwners) {
                console.log(`  ➕ Adding owner: ${missingOwner}`);
                if (!this.dryRun) {
                    await this.addOwnerToNetwork(networkKey, missingOwner);
                }
            }
            
            // Remove extra owners
            for (const extraOwner of discrepancy.extraOwners) {
                console.log(`  ➖ Removing owner: ${extraOwner}`);
                if (!this.dryRun) {
                    await this.removeOwnerFromNetwork(networkKey, extraOwner);
                }
            }
            
            console.log(`✅ ${networkData.name} owner synchronization ${this.dryRun ? 'planned' : 'completed'}\n`);
        }
    }

    async synchronizeRequirements(canonicalRequirement, requirementDiscrepancies) {
        console.log('🎯 Synchronizing confirmation requirements across networks...\n');
        
        for (const [networkKey, discrepancy] of Object.entries(requirementDiscrepancies)) {
            const networkData = this.networkData[networkKey];
            console.log(`🔧 Fixing ${networkData.name}:`);
            console.log(`  📊 Changing requirement from ${discrepancy.current} to ${discrepancy.target}`);
            
            if (!this.dryRun) {
                await this.changeRequirementOnNetwork(networkKey, discrepancy.target);
            }
            
            console.log(`✅ ${networkData.name} requirement synchronization ${this.dryRun ? 'planned' : 'completed'}\n`);
        }
    }

    async addOwnerToNetwork(networkKey, ownerAddress) {
        const networkData = this.networkData[networkKey];
        
        try {
            console.log(`    📤 Adding owner ${ownerAddress}...`);
            
            // Call addOwner directly with PIN
            const tx = await networkData.multisig.connect(networkData.wallet).addOwner(
                ownerAddress,
                this.pin,
                { gasLimit: 300000 }
            );
            
            console.log(`    📤 Transaction hash: ${tx.hash}`);
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                console.log(`    ✅ Owner added successfully (Block: ${receipt.blockNumber})`);
            } else {
                console.log(`    ❌ Transaction failed`);
            }
            
        } catch (error) {
            console.error(`    ❌ Failed to add owner on ${networkData.name}:`, error.message);
        }
    }

    async removeOwnerFromNetwork(networkKey, ownerAddress) {
        const networkData = this.networkData[networkKey];
        
        try {
            console.log(`    📤 Removing owner ${ownerAddress}...`);
            
            // Call removeOwner directly with PIN
            const tx = await networkData.multisig.connect(networkData.wallet).removeOwner(
                ownerAddress,
                this.pin,
                { gasLimit: 350000 }
            );
            
            console.log(`    📤 Transaction hash: ${tx.hash}`);
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                console.log(`    ✅ Owner removed successfully (Block: ${receipt.blockNumber})`);
            } else {
                console.log(`    ❌ Transaction failed`);
            }
            
        } catch (error) {
            console.error(`    ❌ Failed to remove owner on ${networkData.name}:`, error.message);
        }
    }

    async changeRequirementOnNetwork(networkKey, newRequirement) {
        const networkData = this.networkData[networkKey];
        
        try {
            console.log(`    📤 Changing requirement to ${newRequirement}...`);
            
            // Call changeRequirement directly (no PIN required)
            const tx = await networkData.multisig.connect(networkData.wallet).changeRequirement(
                newRequirement,
                { gasLimit: 200000 }
            );
            
            console.log(`    📤 Transaction hash: ${tx.hash}`);
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                console.log(`    ✅ Requirement changed successfully (Block: ${receipt.blockNumber})`);
            } else {
                console.log(`    ❌ Transaction failed`);
            }
            
        } catch (error) {
            console.error(`    ❌ Failed to change requirement on ${networkData.name}:`, error.message);
        }
    }


    async sync() {
        await this.initialize();
        await this.gatherNetworkData();
        
        const analysis = this.analyzeDiscrepancies();
        
        // Display summary
        console.log('\n📋 SYNCHRONIZATION SUMMARY');
        console.log('==========================');
        
        const hasOwnerDiscrepancies = Object.keys(analysis.ownerDiscrepancies).length > 0;
        const hasRequirementDiscrepancies = Object.keys(analysis.requirementDiscrepancies).length > 0;
        
        if (!hasOwnerDiscrepancies && !hasRequirementDiscrepancies) {
            console.log('✅ All networks are already synchronized!');
            return;
        }
        
        if (hasOwnerDiscrepancies) {
            console.log('\n👥 Owner Discrepancies:');
            for (const [networkKey, discrepancy] of Object.entries(analysis.ownerDiscrepancies)) {
                const networkName = this.networkData[networkKey].name;
                console.log(`\n${networkName}:`);
                if (discrepancy.missingOwners.length > 0) {
                    console.log(`  Missing: ${discrepancy.missingOwners.join(', ')}`);
                }
                if (discrepancy.extraOwners.length > 0) {
                    console.log(`  Extra: ${discrepancy.extraOwners.join(', ')}`);
                }
            }
        }
        
        if (hasRequirementDiscrepancies) {
            console.log('\n🎯 Requirement Discrepancies:');
            for (const [networkKey, discrepancy] of Object.entries(analysis.requirementDiscrepancies)) {
                const networkName = this.networkData[networkKey].name;
                console.log(`  ${networkName}: ${discrepancy.current} → ${discrepancy.target}`);
            }
        }
        
        if (this.dryRun) {
            console.log('\n🔍 DRY RUN MODE - No changes will be made');
            console.log('Run without --dry-run to apply changes');
            return;
        }
        
        console.log('\n⚠️  Proceeding to synchronize MultiSig contracts across networks...');
        
        // Perform synchronization
        if (hasOwnerDiscrepancies) {
            await this.synchronizeOwners(analysis.canonicalOwners, analysis.ownerDiscrepancies);
        }
        
        if (hasRequirementDiscrepancies) {
            await this.synchronizeRequirements(analysis.canonicalRequirement, analysis.requirementDiscrepancies);
        }
        
        console.log('\n🎉 Synchronization complete!');
        console.log('Note: Transactions have been submitted but may need additional confirmations from other owners.');
    }
}

// CLI argument parsing
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    let multisigAddress = null;
    let pin = null;
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--help':
            case '-h':
                console.log(`
Usage: node sync.js <multisig_address> <pin> [options]

Arguments:
  multisig_address   Address of the MultiSig contract
  pin                PIN code for owner management operations

Options:
  --dry-run          Show what would be changed without making any changes
  --help, -h         Show this help message

Examples:
  node sync.js 0x1234567890123456789012345678901234567890 1234 --dry-run
  node sync.js 0x1234567890123456789012345678901234567890 1234
`);
                process.exit(0);
                break;
            default:
                if (!multisigAddress && ethers.isAddress(args[i])) {
                    multisigAddress = args[i];
                } else if (multisigAddress && !pin && !isNaN(parseInt(args[i]))) {
                    pin = parseInt(args[i]);
                }
                break;
        }
    }
    
    return { multisigAddress, pin, options };
}

// CLI usage
if (require.main === module) {
    const { multisigAddress, pin, options } = parseArgs();
    
    if (!multisigAddress) {
        console.error('❌ MultiSig address is required');
        console.log('Usage: node sync.js <multisig_address> <pin> [--dry-run]');
        process.exit(1);
    }
    
    if (!pin) {
        console.error('❌ PIN is required');
        console.log('Usage: node sync.js <multisig_address> <pin> [--dry-run]');
        process.exit(1);
    }
    
    const synchronizer = new MultiSigSynchronizer(multisigAddress, pin, options);
    synchronizer.sync().catch(error => {
        console.error('❌ Synchronization failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    });
}

module.exports = { MultiSigSynchronizer };
