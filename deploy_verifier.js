#!/usr/bin/env node

/**
 * Deploy PinVerifier contract using CREATE2 for deterministic addresses
 * This ensures the verifier has the same address on all EVM chains
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
require('dotenv').config();

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const KEYSTORE_PATH = path.join(ETHNOTARY_DIR, 'keystore.json');

// Shared CREATE2Factory address (same on all networks)
const SHARED_CREATE2_FACTORY = process.env.CREATE2_FACTORY_ADDRESS;

// Network configurations
const NETWORKS = {
    'sepolia': {
        name: 'Sepolia',
        rpc: process.env.SEPOLIA_RPC_URL,
        create2Factory: process.env.CREATE2_FACTORY_SEPOLIA || SHARED_CREATE2_FACTORY
    },
    'base-sepolia': {
        name: 'Base Sepolia',
        rpc: process.env.BASE_SEPOLIA_RPC_URL,
        create2Factory: process.env.CREATE2_FACTORY_BASE_SEPOLIA || SHARED_CREATE2_FACTORY
    },
    'arbitrum-sepolia': {
        name: 'Arbitrum Sepolia',
        rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL,
        create2Factory: process.env.CREATE2_FACTORY_ARBITRUM_SEPOLIA || SHARED_CREATE2_FACTORY
    }
};

// Salt for CREATE2 deployment (keccak256("PinVerifier.v1"))
const SALT = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

// CREATE2Factory ABI (minimal)
const CREATE2_FACTORY_ABI = [
    'function deploy(bytes memory bytecode, bytes32 salt) external returns (address)',
    'function predictAddress(bytes memory bytecode, bytes32 salt) external view returns (address)'
];

/**
 * Get PinVerifier bytecode from forge compilation
 */
function getVerifierBytecode() {
    const artifactPath = path.join(__dirname, 'out', 'PinVerifier.sol', 'Groth16Verifier.json');

    if (!fs.existsSync(artifactPath)) {
        console.error('❌ PinVerifier.sol not compiled. Run: forge build');
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    return artifact.bytecode.object;
}

/**
 * Predict the deterministic address
 */
function predictAddress(create2FactoryAddress, bytecode) {
    const bytecodeHash = ethers.keccak256(bytecode);
    const hash = ethers.keccak256(
        ethers.concat([
            '0xff',
            create2FactoryAddress,
            SALT,
            bytecodeHash
        ])
    );
    return ethers.getAddress('0x' + hash.slice(-40));
}

/**
 * Get wallet from PRIVATE_KEY or ethnotary keystore
 */
async function getWallet() {
    // Priority 1: PRIVATE_KEY in .env
    if (process.env.PRIVATE_KEY) {
        console.log('🔑 Using wallet from PRIVATE_KEY');
        return new ethers.Wallet(process.env.PRIVATE_KEY);
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
            const wallet = await ethers.Wallet.fromEncryptedJson(encryptedJson, password);
            console.log(`📋 Using wallet: ${wallet.address}`);
            return wallet;
        } catch (e) {
            throw new Error('Incorrect password or corrupted keystore');
        }
    }

    throw new Error('No wallet found. Set PRIVATE_KEY in .env or run "ethnotary wallet init"');
}

/**
 * Deploy PinVerifier on a single network
 */
async function deployOnNetwork(networkKey, networkConfig, bytecode, wallet, dryRun = false) {
    console.log(`\n📡 ${networkConfig.name}`);
    console.log('─'.repeat(50));

    if (!networkConfig.rpc) {
        console.log('⚠️  RPC URL not configured, skipping...');
        return null;
    }

    if (!networkConfig.create2Factory) {
        console.log('⚠️  CREATE2Factory address not configured, skipping...');
        return null;
    }

    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const connectedWallet = wallet.connect(provider);

        // Predict address
        const predictedAddress = predictAddress(networkConfig.create2Factory, bytecode);
        console.log(`📍 Predicted address: ${predictedAddress}`);

        // Check if already deployed
        const code = await provider.getCode(predictedAddress);
        if (code !== '0x') {
            console.log('✅ Already deployed at predicted address');
            return predictedAddress;
        }

        if (dryRun) {
            console.log('🔍 Dry run - would deploy here');
            return predictedAddress;
        }

        // Deploy via CREATE2Factory
        console.log('🚀 Deploying...');
        const factory = new ethers.Contract(
            networkConfig.create2Factory,
            CREATE2_FACTORY_ABI,
            connectedWallet
        );

        const tx = await factory.deploy(bytecode, SALT);
        console.log(`📝 Transaction: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`✅ Deployed in block ${receipt.blockNumber}`);
        console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

        // Verify deployment
        const deployedCode = await provider.getCode(predictedAddress);
        if (deployedCode === '0x') {
            throw new Error('Deployment failed - no code at predicted address');
        }

        return predictedAddress;

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return null;
    }
}

/**
 * Main deployment function
 */
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const networkFilter = args.find(arg => !arg.startsWith('--'));

    console.log('🔐 PinVerifier CREATE2 Deployment');
    console.log('═'.repeat(50));

    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No transactions will be sent\n');
    }

    // Compile contract if needed
    console.log('🔨 Checking compilation...');
    const { execSync } = require('child_process');
    try {
        execSync('forge build --silent', { stdio: 'inherit' });
        console.log('✅ Contracts compiled\n');
    } catch (error) {
        console.error('❌ Compilation failed');
        process.exit(1);
    }

    // Get bytecode
    const bytecode = getVerifierBytecode();
    console.log(`📦 Bytecode size: ${(bytecode.length / 2 - 1).toLocaleString()} bytes\n`);

    // Get wallet
    const wallet = await getWallet();

    // Deploy to networks
    const results = {};
    const networksToProcess = networkFilter
        ? { [networkFilter]: NETWORKS[networkFilter] }
        : NETWORKS;

    for (const [key, config] of Object.entries(networksToProcess)) {
        if (!config) {
            console.log(`\n❌ Unknown network: ${networkFilter}`);
            continue;
        }

        const address = await deployOnNetwork(key, config, bytecode, wallet, dryRun);
        if (address) {
            results[key] = address;
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 DEPLOYMENT SUMMARY');
    console.log('═'.repeat(50));

    const addresses = Object.values(results);
    const uniqueAddresses = [...new Set(addresses)];

    if (uniqueAddresses.length === 0) {
        console.log('❌ No deployments completed');
        return;
    }

    if (uniqueAddresses.length === 1) {
        console.log('✅ All deployments have the SAME address:');
        console.log(`\n   ${uniqueAddresses[0]}\n`);
    } else {
        console.log('⚠️  WARNING: Different addresses detected!');
        for (const [network, address] of Object.entries(results)) {
            console.log(`   ${network}: ${address}`);
        }
        console.log('\n❌ CREATE2 determinism failed - check factory addresses\n');
        return;
    }

    // Output for .env
    console.log('📝 Add to your .env file:');
    console.log(`\nPIN_VERIFIER_ADDRESS=${uniqueAddresses[0]}\n`);

    // Next steps
    console.log('📋 Next steps:');
    console.log('1. Add PIN_VERIFIER_ADDRESS to .env');
    console.log('2. Deploy MSAFactory with this verifier address');
    console.log('3. Update frontend zkProofGenerator.js with circuit URLs');
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
