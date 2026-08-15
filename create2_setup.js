const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
require('dotenv').config();

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const KEYSTORE_PATH = path.join(ETHNOTARY_DIR, 'keystore.json');

/**
 * Deployment script for CREATE2Factory
 * 
 * Usage:
 *   node create2_setup.js                            # Deploy to all configured networks
 * 
 * Wallet sources (priority order):
 *   1. PRIVATE_KEY in .env
 *   2. Encrypted keystore at ~/.ethnotary/keystore.json (prompts for password)
 */

class Create2Deployer {
    constructor() {
        this.networks = {
            sepolia: {
                name: 'sepolia',
                rpc: process.env.SEPOLIA_RPC_URL
            },
            'base-sepolia': {
                name: 'base-sepolia',
                rpc: process.env.BASE_SEPOLIA_RPC_URL
            },
            'arbitrum-sepolia': {
                name: 'arbitrum-sepolia',
                rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL
            }
        };

        this.wallet = null;
        this.deployedAddresses = {};
    }

    async setup() {
        console.log('🚀 Starting CREATE2Factory deployment setup...\n');

        await this.validateEnvironment();

        console.log('🏭 Deploying CREATE2Factory to all networks...');

        // Load CREATE2Factory bytecode
        const artifactPath = './out/CREATE2Factory.sol/CREATE2Factory.json';
        if (!fs.existsSync(artifactPath)) {
            throw new Error('CREATE2Factory artifact not found. Run forge build first.');
        }

        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const bytecode = artifact.bytecode.object;

        console.log(`📦 CREATE2Factory bytecode loaded (${bytecode.length / 2 - 1} bytes)`);

        // Deploy to all networks using same nonce
        const baseNonce = await this.findBaseNonce();
        console.log(`🎯 Using base nonce: ${baseNonce}`);

        for (const [networkName, network] of Object.entries(this.networks)) {
            try {
                console.log(`\n📡 Deploying CREATE2Factory to ${networkName}...`);

                if (!network.rpc) {
                    console.log(`⚠️ Skipping ${networkName}: RPC URL not found`);
                    continue;
                }

                const provider = new ethers.JsonRpcProvider(network.rpc);
                const wallet = this.wallet.connect(provider);

                // Advance to base nonce if needed
                await this.advanceToNonce(wallet, baseNonce);

                // Deploy
                const tx = await wallet.sendTransaction({
                    data: bytecode,
                    gasLimit: 2000000,
                    nonce: baseNonce
                });

                console.log(`📤 Transaction sent: ${tx.hash}`);
                const receipt = await tx.wait();
                const address = receipt.contractAddress;

                console.log(`✅ ${networkName}: CREATE2Factory deployed at ${address}`);
                this.deployedAddresses[networkName] = address;
            } catch (error) {
                console.error(`❌ Failed on ${networkName}: ${error.message}`);
            }
        }

        // Verify same addresses
        const addresses = Object.values(this.deployedAddresses);
        if (addresses.length > 0) {
            const allSame = addresses.every(val => val === addresses[0]);
            if (allSame) {
                console.log(`\n🎉 SUCCESS: CREATE2Factory deployed to same address on all successful networks: ${addresses[0]}\n`);
            } else {
                console.warn('\n⚠️  WARNING: CREATE2Factory addresses do not match across networks!');
            }
        }
    }

    async validateEnvironment() {
        console.log('🔍 Validating environment...');

        // Priority 1: PRIVATE_KEY in .env
        if (process.env.PRIVATE_KEY) {
            this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
            console.log(`📋 Using wallet from PRIVATE_KEY: ${this.wallet.address}`);
            console.log('✅ Environment validated\n');
            return;
        }

        // Priority 2: Encrypted keystore
        if (fs.existsSync(KEYSTORE_PATH)) {
            console.log('🔐 Found keystore at ~/.ethnotary/keystore.json');
            const { password } = await inquirer.prompt([{
                type: 'password',
                name: 'password',
                message: 'Enter keystore password:',
                mask: '*'
            }]);

            const encryptedJson = fs.readFileSync(KEYSTORE_PATH, 'utf8');
            try {
                this.wallet = await ethers.Wallet.fromEncryptedJson(encryptedJson, password);
                console.log(`📋 Using wallet from keystore: ${this.wallet.address}`);
                console.log('✅ Environment validated\n');
                return;
            } catch (e) {
                throw new Error('Incorrect password or corrupted keystore');
            }
        }

        throw new Error('No wallet found. Set PRIVATE_KEY in .env or run "ethnotary wallet init"');
    }

    async findBaseNonce() {
        // Find the highest nonce across all networks
        let maxNonce = 0;

        for (const [networkName, network] of Object.entries(this.networks)) {
            if (!network.rpc) continue;
            try {
                const provider = new ethers.JsonRpcProvider(network.rpc);
                const nonce = await provider.getTransactionCount(this.wallet.address);
                console.log(`📊 ${networkName} nonce: ${nonce}`);
                maxNonce = Math.max(maxNonce, nonce);
            } catch (error) {
                console.warn(`⚠️  Failed to get nonce for ${networkName}: ${error.message}`);
            }
        }

        return maxNonce;
    }

    async advanceToNonce(wallet, targetNonce) {
        const currentNonce = await wallet.provider.getTransactionCount(wallet.address);

        if (currentNonce >= targetNonce) {
            console.log(`✅ Nonce already at or above target (${currentNonce} >= ${targetNonce})`);
            return;
        }

        console.log(`🔄 Advancing nonce from ${currentNonce} to ${targetNonce}...`);

        const dummyTxs = [];
        for (let i = currentNonce; i < targetNonce; i++) {
            try {
                const tx = await wallet.sendTransaction({
                    to: wallet.address,
                    value: 0,
                    gasLimit: 21000,
                    nonce: i
                });
                dummyTxs.push(tx);
                console.log(`📤 Dummy tx ${i}: ${tx.hash}`);
            } catch (error) {
                throw new Error(`Failed to send dummy transaction at nonce ${i}: ${error.message}`);
            }
        }

        // Wait for all dummy transactions
        console.log(`⏳ Waiting for ${dummyTxs.length} dummy transactions...`);
        for (const tx of dummyTxs) {
            await tx.wait();
        }

        console.log(`✅ Nonce advanced to ${targetNonce}`);
    }
}

// CLI usage
if (require.main === module) {
    const deployer = new Create2Deployer();
    deployer.setup().catch(error => {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    });
}

module.exports = { Create2Deployer };
