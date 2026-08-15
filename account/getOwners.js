const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to retrieve all MultiSig owners across EVM networks
 * Usage: node getOwners.js <multisig_address>
 */

// MultiSig ABI - functions we need
const MULTISIG_ABI = [
    "function getOwners() view returns (address[])",
    "function required() view returns (uint)",
    "function isOwner(address) view returns (bool)"
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

class CrossChainOwnerRetriever {
    constructor(multisigAddress) {
        this.multisigAddress = multisigAddress;
        this.results = {};
        this.errors = {};
        this.allOwners = new Set();
    }

    async getOwnersAcrossNetworks() {
        console.log(`👥 Retrieving owners for MultiSig ${this.multisigAddress} across all networks\n`);

        // Validate address
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }

        // Step 1: Retrieve owners from all networks
        await this.retrieveOwners();

        // Step 2: Analyze and display results
        this.analyzeResults();

        // Step 3: Summary
        this.printSummary();

        return this.results;
    }

    async retrieveOwners() {
        console.log('🔍 Step 1: Retrieving owners from all networks...\n');

        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!networkConfig.rpc) {
                console.log(`⚠️  Skipping ${networkConfig.name}: No RPC URL configured`);
                continue;
            }

            try {
                const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
                const multisig = new ethers.Contract(this.multisigAddress, MULTISIG_ABI, provider);

                // Check if contract exists
                const code = await provider.getCode(this.multisigAddress);
                if (code === '0x') {
                    console.log(`⚠️  ${networkConfig.name}: No contract found at ${this.multisigAddress}`);
                    this.results[networkKey] = { 
                        status: 'no_contract',
                        networkName: networkConfig.name
                    };
                    continue;
                }

                // Get owners and required confirmations
                const [owners, required] = await Promise.all([
                    multisig.getOwners(),
                    multisig.required()
                ]);

                console.log(`✅ ${networkConfig.name}:`);
                console.log(`  Contract found: ✅`);
                console.log(`  Total owners: ${owners.length}`);
                console.log(`  Required confirmations: ${required}`);
                console.log(`  Owners:`);
                owners.forEach((owner, index) => {
                    console.log(`    ${index + 1}. ${owner}`);
                    this.allOwners.add(owner.toLowerCase());
                });

                this.results[networkKey] = {
                    status: 'success',
                    networkName: networkConfig.name,
                    owners: owners.map(addr => addr.toLowerCase()),
                    required: Number(required),
                    ownerCount: owners.length
                };

            } catch (error) {
                console.error(`❌ ${networkConfig.name}: Error retrieving owners - ${error.message}`);
                this.errors[networkKey] = error.message;
                this.results[networkKey] = { 
                    status: 'error',
                    networkName: networkConfig.name,
                    error: error.message
                };
            }
        }
        console.log('');
    }

    analyzeResults() {
        console.log('📊 Step 2: Cross-network analysis...\n');

        const networksWithContract = Object.values(this.results).filter(r => r.status === 'success');
        
        if (networksWithContract.length === 0) {
            console.log('⚠️  No contracts found on any network');
            return;
        }

        // Check for consistency across networks
        const firstNetwork = networksWithContract[0];
        let isConsistent = true;
        let consistencyIssues = [];

        for (let i = 1; i < networksWithContract.length; i++) {
            const network = networksWithContract[i];
            
            // Check owner count consistency
            if (network.ownerCount !== firstNetwork.ownerCount) {
                isConsistent = false;
                consistencyIssues.push(`Owner count mismatch: ${firstNetwork.networkName} has ${firstNetwork.ownerCount}, ${network.networkName} has ${network.ownerCount}`);
            }

            // Check required confirmations consistency
            if (network.required !== firstNetwork.required) {
                isConsistent = false;
                consistencyIssues.push(`Required confirmations mismatch: ${firstNetwork.networkName} has ${firstNetwork.required}, ${network.networkName} has ${network.required}`);
            }

            // Check if owners are identical
            const firstOwners = new Set(firstNetwork.owners);
            const networkOwners = new Set(network.owners);
            
            if (firstOwners.size !== networkOwners.size || 
                ![...firstOwners].every(owner => networkOwners.has(owner))) {
                isConsistent = false;
                consistencyIssues.push(`Owner list mismatch between ${firstNetwork.networkName} and ${network.networkName}`);
            }
        }

        console.log(`🔍 Cross-network consistency: ${isConsistent ? '✅ Consistent' : '❌ Inconsistent'}`);
        
        if (!isConsistent) {
            console.log('\n⚠️  Consistency Issues:');
            consistencyIssues.forEach(issue => {
                console.log(`  • ${issue}`);
            });
        }

        // Show unique owners across all networks
        console.log(`\n👥 Unique owners across all networks: ${this.allOwners.size}`);
        Array.from(this.allOwners).sort().forEach((owner, index) => {
            console.log(`  ${index + 1}. ${owner}`);
        });

        console.log('');
    }

    printSummary() {
        console.log('📋 RETRIEVAL SUMMARY');
        console.log('===================');

        let networksWithContract = 0;
        let totalNetworks = 0;

        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!networkConfig.rpc) continue;
            
            totalNetworks++;
            const result = this.results[networkKey];

            if (!result) {
                console.log(`${networkConfig.name}: ❌ No result`);
                continue;
            }

            switch (result.status) {
                case 'success':
                    console.log(`${networkConfig.name}: ✅ Success`);
                    console.log(`  Owners: ${result.ownerCount}, Required: ${result.required}`);
                    networksWithContract++;
                    break;
                case 'no_contract':
                    console.log(`${networkConfig.name}: ⚠️  No contract found`);
                    break;
                case 'error':
                    console.log(`${networkConfig.name}: ❌ Error`);
                    break;
                default:
                    console.log(`${networkConfig.name}: ❌ ${result.status}`);
            }
        }

        console.log(`\n📊 Networks: ${networksWithContract} with contract, ${totalNetworks - networksWithContract} without contract, ${totalNetworks} total`);

        if (Object.keys(this.errors).length > 0) {
            console.log('\n❌ Errors encountered:');
            Object.entries(this.errors).forEach(([network, error]) => {
                console.log(`  ${network}: ${error}`);
            });
        }

        if (networksWithContract === 0) {
            console.log('\n⚠️  No MultiSig contracts found on any network');
        } else if (networksWithContract === 1) {
            console.log('\n✅ MultiSig found on 1 network');
        } else {
            console.log(`\n✅ MultiSig found on ${networksWithContract} networks`);
        }

        // Return structured data for programmatic use
        return {
            totalNetworks,
            networksWithContract,
            allOwners: Array.from(this.allOwners),
            results: this.results,
            errors: this.errors
        };
    }

    // Method to get owners for a specific network
    getOwnersForNetwork(networkKey) {
        const result = this.results[networkKey];
        if (result && result.status === 'success') {
            return result.owners;
        }
        return null;
    }

    // Method to check if an address is an owner on any network
    isOwnerOnAnyNetwork(address) {
        return this.allOwners.has(address.toLowerCase());
    }

    // Method to get networks where a specific address is an owner
    getNetworksForOwner(address) {
        const networks = [];
        const lowerAddress = address.toLowerCase();
        
        for (const [networkKey, result] of Object.entries(this.results)) {
            if (result.status === 'success' && result.owners.includes(lowerAddress)) {
                networks.push({
                    key: networkKey,
                    name: result.networkName
                });
            }
        }
        
        return networks;
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node getOwners.js <multisig_address>');
        console.log('');
        console.log('Example:');
        console.log('  node getOwners.js 0x1234...');
        console.log('');
        console.log('This script will:');
        console.log('- Retrieve all owners from the MultiSig across all EVM networks');
        console.log('- Show owner counts and required confirmations per network');
        console.log('- Analyze consistency across networks');
        console.log('- Display unique owners across all networks');
        process.exit(1);
    }
    
    const [multisigAddress] = args;
    
    const retriever = new CrossChainOwnerRetriever(multisigAddress);
    retriever.getOwnersAcrossNetworks().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { CrossChainOwnerRetriever };
