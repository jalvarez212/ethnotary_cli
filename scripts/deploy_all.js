#!/usr/bin/env node

/**
 * Deploy PinVerifier and MSAFactory contracts to target networks
 * 
 * This script:
 * 1. Deploys PinVerifier (Groth16Verifier) to target networks
 * 2. Updates MSAFactory.sol with the new PinVerifier address
 * 3. Deploys MSAFactory to all target networks
 * 
 * Usage:
 *   node scripts/deploy_all.js                    # Deploy to all networks
 *   node scripts/deploy_all.js sepolia            # Deploy to specific network
 *   node scripts/deploy_all.js --dry-run          # Preview without deploying
 *   node scripts/deploy_all.js --verifier-only    # Only deploy PinVerifier
 *   node scripts/deploy_all.js --factory-only     # Only deploy MSAFactory (uses existing verifier)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

// Network configurations
const NETWORKS = {
    'sepolia': {
        name: 'Sepolia Testnet',
        chainId: 11155111,
        rpc: process.env.SEPOLIA_RPC_URL,
        explorer: 'https://sepolia.etherscan.io'
    },
    'base-sepolia': {
        name: 'Base Sepolia',
        chainId: 84532,
        rpc: process.env.BASE_SEPOLIA_RPC_URL,
        explorer: 'https://sepolia.basescan.org'
    },
};

// Note: Using regular deployment for simplicity
// CREATE2 can be added later if deterministic addresses are needed

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get compiled contract bytecode from forge output
 */
function getBytecode(contractPath, contractName) {
    const artifactPath = path.join(__dirname, '..', 'out', contractPath, `${contractName}.json`);
    
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Contract not compiled: ${contractPath}/${contractName}. Run: forge build`);
    }
    
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    return artifact.bytecode.object;
}

/**
 * Get contract ABI from forge output
 */
function getABI(contractPath, contractName) {
    const artifactPath = path.join(__dirname, '..', 'out', contractPath, `${contractName}.json`);
    
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Contract not compiled: ${contractPath}/${contractName}. Run: forge build`);
    }
    
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    return artifact.abi;
}

/**
 * Deploy contract using regular deployment
 */
async function deployRegular(wallet, bytecode, abi, constructorArgs, contractName) {
    console.log(`   🚀 Deploying ${contractName}...`);
    
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const contract = await factory.deploy(...constructorArgs);
    
    console.log(`   📝 Tx: ${contract.deploymentTransaction().hash}`);
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log(`   ✅ Deployed at ${address}`);
    
    return { address, txHash: contract.deploymentTransaction().hash };
}

/**
 * Update PinVerifier address in MultiSig.sol
 */
function updateVerifierAddressInContract(newAddress) {
    const multiSigPath = path.join(__dirname, '..', 'src', 'MultiSig.sol');
    let content = fs.readFileSync(multiSigPath, 'utf8');
    
    // Find and replace the hardcoded pinVerifier address
    const regex = /address public constant pinVerifier = 0x[a-fA-F0-9]{40};/;
    const match = content.match(regex);
    
    if (!match) {
        throw new Error('Could not find pinVerifier address in MultiSig.sol');
    }
    
    const oldAddress = match[0];
    const newLine = `address public constant pinVerifier = ${newAddress};`;
    
    if (oldAddress === newLine) {
        console.log('   ℹ️  PinVerifier address already up to date');
        return false;
    }
    
    content = content.replace(regex, newLine);
    fs.writeFileSync(multiSigPath, content);
    
    console.log(`   ✅ Updated MultiSig.sol:`);
    console.log(`      Old: ${oldAddress}`);
    console.log(`      New: ${newLine}`);
    
    return true;
}

/**
 * Compile contracts using forge
 */
function compileContracts() {
    console.log('\n🔨 Compiling contracts...');
    try {
        execSync('forge build', { 
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit' 
        });
        console.log('✅ Compilation successful\n');
        return true;
    } catch (error) {
        console.error('❌ Compilation failed');
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPLOYMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deploy PinVerifier to a network
 */
async function deployVerifier(wallet, networkConfig, dryRun) {
    console.log(`\n📡 Deploying PinVerifier to ${networkConfig.name}`);
    console.log('─'.repeat(50));
    
    const bytecode = getBytecode('PinVerifier.sol', 'Groth16Verifier');
    const abi = getABI('PinVerifier.sol', 'Groth16Verifier');
    
    if (dryRun) {
        console.log('   🔍 Dry run - skipping deployment');
        return { address: 'DRY_RUN', dryRun: true };
    }
    
    // Groth16Verifier has no constructor arguments
    return await deployRegular(wallet, bytecode, abi, [], 'Groth16Verifier');
}

/**
 * Deploy MSAFactory to a network
 */
async function deployFactory(wallet, networkConfig, dryRun) {
    console.log(`\n📡 Deploying MSAFactory to ${networkConfig.name}`);
    console.log('─'.repeat(50));
    
    const bytecode = getBytecode('MultiSig.sol', 'MSAFactory');
    const abi = getABI('MultiSig.sol', 'MSAFactory');
    
    if (dryRun) {
        console.log('   🔍 Dry run - skipping deployment');
        return { address: 'DRY_RUN', dryRun: true };
    }
    
    // MSAFactory constructor takes no arguments (pinVerifier is hardcoded)
    return await deployRegular(wallet, bytecode, abi, [], 'MSAFactory');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const verifierOnly = args.includes('--verifier-only');
    const factoryOnly = args.includes('--factory-only');
    const networkFilter = args.find(arg => !arg.startsWith('--'));
    
    console.log('═'.repeat(60));
    console.log('🔐 PinVerifier & MSAFactory Deployment Script');
    console.log('═'.repeat(60));
    
    if (dryRun) console.log('🔍 DRY RUN MODE - No transactions will be sent');
    if (verifierOnly) console.log('📦 Deploying PinVerifier only');
    if (factoryOnly) console.log('📦 Deploying MSAFactory only');
    
    // Check private key
    if (!process.env.PRIVATE_KEY) {
        console.error('\n❌ PRIVATE_KEY not set in .env file');
        process.exit(1);
    }
    
    // Filter networks
    const networksToProcess = networkFilter
        ? { [networkFilter]: NETWORKS[networkFilter] }
        : NETWORKS;
    
    if (networkFilter && !NETWORKS[networkFilter]) {
        console.error(`\n❌ Unknown network: ${networkFilter}`);
        console.log('Available networks:', Object.keys(NETWORKS).join(', '));
        process.exit(1);
    }
    
    // Step 1: Deploy PinVerifier (if not factory-only)
    let verifierAddress = null;
    const verifierResults = {};
    
    if (!factoryOnly) {
        // Compile first
        if (!compileContracts()) {
            process.exit(1);
        }
        
        console.log('\n' + '═'.repeat(60));
        console.log('STEP 1: Deploy PinVerifier (Groth16Verifier)');
        console.log('═'.repeat(60));
        
        for (const [networkKey, config] of Object.entries(networksToProcess)) {
            if (!config.rpc) {
                console.log(`\n⚠️  ${config.name}: RPC URL not configured, skipping...`);
                continue;
            }
            
            try {
                const provider = new ethers.JsonRpcProvider(config.rpc);
                const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
                
                const result = await deployVerifier(wallet, config, dryRun);
                verifierResults[networkKey] = result;
                
                if (!verifierAddress) {
                    verifierAddress = result.address;
                }
            } catch (error) {
                console.error(`\n❌ ${config.name}: ${error.message}`);
                verifierResults[networkKey] = { error: error.message };
            }
        }
        
        // Get the first successful deployment address for updating MultiSig.sol
        const successfulResults = Object.entries(verifierResults)
            .filter(([_, r]) => r.address && !r.error && !r.dryRun);
        
        if (successfulResults.length > 0) {
            // Use the first network's verifier address
            const [firstNetwork, firstResult] = successfulResults[0];
            verifierAddress = firstResult.address;
            console.log(`\n✅ PinVerifier deployed. Using ${NETWORKS[firstNetwork].name} address: ${verifierAddress}`);
            
            // Note: With regular deployment, each network has a different address
            // The MSAFactory on each network needs to reference its own network's verifier
            if (successfulResults.length > 1) {
                console.log('\n⚠️  Note: Each network has a different PinVerifier address.');
                console.log('   You may need to deploy MSAFactory separately per network with the correct verifier.');
            }
        }
    }
    
    // Step 2: Update MultiSig.sol with new verifier address
    if (!factoryOnly && !verifierOnly && verifierAddress) {
        console.log('\n' + '═'.repeat(60));
        console.log('STEP 2: Update MultiSig.sol with new PinVerifier address');
        console.log('═'.repeat(60));
        
        if (dryRun) {
            console.log(`   🔍 Would update to: ${verifierAddress}`);
        } else {
            const updated = updateVerifierAddressInContract(verifierAddress);
            if (updated) {
                // Recompile after updating
                console.log('\n   🔨 Recompiling with updated address...');
                if (!compileContracts()) {
                    process.exit(1);
                }
            }
        }
    }
    
    // Step 3: Deploy MSAFactory (if not verifier-only)
    const factoryResults = {};
    
    if (!verifierOnly) {
        console.log('\n' + '═'.repeat(60));
        console.log('STEP 3: Deploy MSAFactory');
        console.log('═'.repeat(60));
        
        // Compile if we haven't already
        if (factoryOnly && !compileContracts()) {
            process.exit(1);
        }
        
        for (const [networkKey, config] of Object.entries(networksToProcess)) {
            if (!config.rpc) {
                console.log(`\n⚠️  ${config.name}: RPC URL not configured, skipping...`);
                continue;
            }
            
            try {
                const provider = new ethers.JsonRpcProvider(config.rpc);
                const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
                
                const result = await deployFactory(wallet, config, dryRun);
                factoryResults[networkKey] = result;
            } catch (error) {
                console.error(`\n❌ ${config.name}: ${error.message}`);
                factoryResults[networkKey] = { error: error.message };
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('\n' + '═'.repeat(60));
    console.log('📊 DEPLOYMENT SUMMARY');
    console.log('═'.repeat(60));
    
    if (Object.keys(verifierResults).length > 0) {
        console.log('\n🔐 PinVerifier (Groth16Verifier):');
        for (const [network, result] of Object.entries(verifierResults)) {
            const config = NETWORKS[network];
            if (result.error) {
                console.log(`   ❌ ${config.name}: ${result.error}`);
            } else if (result.alreadyDeployed) {
                console.log(`   ✅ ${config.name}: ${result.address} (already deployed)`);
            } else {
                console.log(`   ✅ ${config.name}: ${result.address}`);
                if (result.txHash) {
                    console.log(`      ${config.explorer}/tx/${result.txHash}`);
                }
            }
        }
    }
    
    if (Object.keys(factoryResults).length > 0) {
        console.log('\n🏭 MSAFactory:');
        for (const [network, result] of Object.entries(factoryResults)) {
            const config = NETWORKS[network];
            if (result.error) {
                console.log(`   ❌ ${config.name}: ${result.error}`);
            } else if (result.dryRun) {
                console.log(`   🔍 ${config.name}: DRY RUN`);
            } else {
                console.log(`   ✅ ${config.name}: ${result.address}`);
                if (result.txHash) {
                    console.log(`      ${config.explorer}/tx/${result.txHash}`);
                }
            }
        }
    }
    
    // Output environment variables
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Environment Variables (add to .env and frontend config):');
    console.log('═'.repeat(60));
    
    if (verifierAddress) {
        console.log(`\nPIN_VERIFIER_ADDRESS=${verifierAddress}`);
    }
    
    for (const [network, result] of Object.entries(factoryResults)) {
        if (result.address && !result.dryRun) {
            const envKey = `FACTORY_ADDRESS_${network.toUpperCase().replace('-', '_')}`;
            console.log(`${envKey}=${result.address}`);
        }
    }
    
    // Next steps
    console.log('\n' + '═'.repeat(60));
    console.log('📋 Next Steps:');
    console.log('═'.repeat(60));
    console.log('1. Update frontend wizard.js with new FACTORY_ADDRESS values');
    console.log('2. Copy ZK artifacts to public/zk/ if not already done:');
    console.log('   - zkbuild/pin_verify_js/pin_verify.wasm → public/zk/pin_verify.wasm');
    console.log('   - zkbuild/pin_verify_final.zkey → public/zk/pin_verify_final.zkey');
    console.log('3. Test proof generation and verification with a new MSA');
    console.log('');
}

// Run
main().catch(error => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
});
