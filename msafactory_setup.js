const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const inquirer = require('inquirer');
require('dotenv').config();

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const KEYSTORE_PATH = path.join(ETHNOTARY_DIR, 'keystore.json');

/**
 * Deployment script for MSAFactory using CREATE2
 * 
 * Usage:
 *   node msafactory_setup.js
 */

class MSAFactoryDeployer {
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
        this.create2Address = process.env.CREATE2_FACTORY_ADDRESS;
    }

    async setup() {
        console.log('🚀 Starting MSAFactory deployment setup...\n');

        await this.validateEnvironment();

        if (!this.create2Address) {
            // Fallback or error?
            // If not in env, maybe we can accept it as arg, but env is standard here.
            throw new Error('CREATE2_FACTORY_ADDRESS not found in .env. Please run create2_setup.js or set it manually.');
        }

        console.log(`🏭 Using CREATE2Factory at: ${this.create2Address}`);

        // Generate MSAFactory bytecode
        console.log('📦 Generating MSAFactory bytecode...');
        const bytecodeOutput = execSync('node bytecode.js', { 
            encoding: 'utf8',
            env: { ...process.env } // Pass current env to child process
        });
        const lines = bytecodeOutput.trim().split('\n');
        const bytecode = lines[lines.length - 1].trim();
        console.log(`📦 MSAFactory bytecode loaded (${bytecode.length / 2 - 1} bytes)`);

        const CREATE2_ABI = [
            "function deploy(bytes memory bytecode, bytes32 salt) external returns (address)",
            "function predictAddress(bytes memory bytecode, bytes32 salt) external view returns (address)"
        ];

        // Use deterministic salt
        const salt = "0x0000000000000000000000000000000000000000000000000000000000000001";
        console.log(`🧂 Using salt: ${salt}`);

        // Predict address
        // Can use any provider to predict
        let predictedAddress;

        for (const [networkName, network] of Object.entries(this.networks)) {
            if (!network.rpc) continue;

            try {
                console.log(`\n📡 Deploying MSAFactory to ${networkName}...`);
                const provider = new ethers.JsonRpcProvider(network.rpc);
                const wallet = this.wallet.connect(provider);
                const create2Factory = new ethers.Contract(this.create2Address, CREATE2_ABI, wallet);

                if (!predictedAddress) {
                    predictedAddress = await create2Factory.predictAddress(bytecode, salt);
                    console.log(`🔮 Predicted MSAFactory address: ${predictedAddress}`);
                }

                // Check if already deployed
                const code = await provider.getCode(predictedAddress);
                if (code !== '0x') {
                    console.log(`✅ ${networkName}: MSAFactory already deployed at ${predictedAddress}`);
                    continue;
                }

                // Deploy
                const tx = await create2Factory.deploy(bytecode, salt, {
                    gasLimit: 6000000
                });

                console.log(`📤 Transaction sent: ${tx.hash}`);
                await tx.wait();

                console.log(`✅ ${networkName}: MSAFactory deployed at ${predictedAddress}`);

            } catch (error) {
                console.error(`❌ Failed on ${networkName}: ${error.message}`);
            }
        }

        if (predictedAddress) {
            console.log(`\n🎉 MSAFactory deployment process complete.`);
            console.log(`MSAFactory Address: ${predictedAddress}`);
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
}

if (require.main === module) {
    const deployer = new MSAFactoryDeployer();
    deployer.setup().catch(error => {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    });
}

module.exports = { MSAFactoryDeployer };
