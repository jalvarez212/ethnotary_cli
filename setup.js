const { ethers } = require('ethers');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config();

/**
 * Complete deployment script for CREATE2Factory and MSAFactory
 * Supports deploying to new networks while maintaining identical addresses
 * 
 * Usage:
 *   node setup.js                                    # Deploy to all configured networks
 *   node setup.js --network arbitrum-sepolia \      # Deploy to specific network
 *     --create2-address 0x1234... \                 # Target CREATE2Factory address
 *     --msa-address 0x5678...                       # Target MSAFactory address
 */

class CrossChainDeployer {
    constructor(options = {}) {
        const allNetworks = {
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
            },
            'hedera-testnet': {
                name: 'hedera-testnet',
                rpc: process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api',
                chainId: 296
            }
        };
        
        // Filter networks if --networks flag provided
        if (options.filterNetworks && options.filterNetworks.length > 0) {
            this.networks = {};
            for (const netKey of options.filterNetworks) {
                if (allNetworks[netKey]) {
                    this.networks[netKey] = allNetworks[netKey];
                } else {
                    console.warn(`⚠️  Unknown network: ${netKey}, skipping`);
                }
            }
            if (Object.keys(this.networks).length === 0) {
                throw new Error('No valid networks specified');
            }
        } else {
            this.networks = allNetworks;
        }
        
        this.wallet = null;
        this.deployedAddresses = {};
        this.targetNetwork = options.targetNetwork;
        this.targetAddresses = options.targetAddresses || {};
        this.singleNetworkMode = !!options.targetNetwork;
    }

    async setup() {
        console.log('🚀 Starting cross-chain deployment setup...\n');
        
        // Validate environment and network configuration
        this.validateEnvironment();
        await this.validateNetworkConfiguration();
        
        // Compile contracts
        await this.compileContracts();
        
        if (this.singleNetworkMode) {
            // Deploy to specific network with address matching
            await this.deployToNewNetwork();
        } else {
            // Deploy CREATE2Factory to all networks
            await this.deployCREATE2Factories();
            
            // Deploy Groth16 verifier to all networks using CREATE2
            await this.deployVerifiers();
            
            // Deploy MSAFactory to all networks using CREATE2
            await this.deployMSAFactories();
        }
        
        // Summary
        this.printSummary();
    }

    validateEnvironment() {
        console.log('🔍 Validating environment...');
        
        if (!process.env.PRIVATE_KEY) {
            throw new Error('PRIVATE_KEY not found in .env');
        }
        
        // Validate network RPC URLs based on mode
        const networksToCheck = this.singleNetworkMode 
            ? [this.targetNetwork] 
            : Object.keys(this.networks);
            
        for (const networkName of networksToCheck) {
            const network = this.networks[networkName];
            if (!network) {
                throw new Error(`Unknown network: ${networkName}`);
            }
            if (!network.rpc) {
                throw new Error(`${networkName.toUpperCase().replace('-', '_')}_RPC_URL not found in .env`);
            }
        }
        
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
        console.log(`📋 Using wallet: ${this.wallet.address}`);
        console.log('✅ Environment validated\n');
    }

    async validateNetworkConfiguration() {
        console.log('🌐 Validating network configuration...');
        
        if (this.singleNetworkMode) {
            // Validate target addresses are provided
            if (!this.targetAddresses.create2Factory || !this.targetAddresses.msaFactory) {
                throw new Error('Both --create2-address and --msa-address must be provided for single network deployment');
            }
            
            // Validate addresses are valid Ethereum addresses
            if (!ethers.isAddress(this.targetAddresses.create2Factory)) {
                throw new Error('Invalid CREATE2Factory address format');
            }
            if (!ethers.isAddress(this.targetAddresses.msaFactory)) {
                throw new Error('Invalid MSAFactory address format');
            }
            
            console.log(`🎯 Target CREATE2Factory: ${this.targetAddresses.create2Factory}`);
            console.log(`🎯 Target MSAFactory: ${this.targetAddresses.msaFactory}`);
        }
        
        console.log('✅ Network configuration validated\n');
    }

    async compileContracts() {
        console.log('🔨 Compiling contracts...');
        try {
            execSync('forge build', { stdio: 'inherit' });
            console.log('✅ Contracts compiled\n');
        } catch (error) {
            throw new Error('Failed to compile contracts. Make sure Forge is installed.');
        }
    }

    async deployCREATE2Factories() {
        console.log('🏭 Deploying CREATE2Factory to both networks...');
        
        // Load CREATE2Factory bytecode
        const artifactPath = './out/CREATE2Factory.sol/CREATE2Factory.json';
        if (!fs.existsSync(artifactPath)) {
            throw new Error('CREATE2Factory artifact not found');
        }
        
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const bytecode = artifact.bytecode.object;
        
        console.log(`📦 CREATE2Factory bytecode loaded (${bytecode.length / 2 - 1} bytes)`);
        
        // Deploy to both networks using same nonce
        const baseNonce = await this.findBaseNonce();
        console.log(`🎯 Using base nonce: ${baseNonce}`);
        
        const deployments = [];
        
        for (const [networkName, network] of Object.entries(this.networks)) {
            console.log(`\n📡 Deploying CREATE2Factory to ${networkName}...`);
            
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
            deployments.push({ networkName, tx, provider });
        }
        
        // Wait for all deployments
        for (const { networkName, tx, provider } of deployments) {
            const receipt = await tx.wait();
            const address = receipt.contractAddress;
            
            console.log(`✅ ${networkName}: CREATE2Factory deployed at ${address}`);
            this.deployedAddresses[networkName] = { create2Factory: address };
        }
        
        // Verify same addresses
        const addresses = Object.values(this.deployedAddresses).map(d => d.create2Factory);
        if (new Set(addresses).size === 1) {
            console.log(`🎉 SUCCESS: CREATE2Factory deployed to same address on all networks: ${addresses[0]}\n`);
        } else {
            throw new Error('CREATE2Factory addresses do not match across networks');
        }
    }

    async deployVerifiers() {
        console.log('🔐 Deploying Groth16 Verifier using CREATE2...');
        
        // Load Groth16Verifier bytecode from forge output
        const artifactPath = './out/PinVerifier.sol/Groth16Verifier.json';
        if (!fs.existsSync(artifactPath)) {
            throw new Error('Groth16Verifier artifact not found. Make sure PinVerifier.sol is compiled.');
        }
        
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const bytecode = artifact.bytecode.object;
        console.log(`📦 Groth16Verifier bytecode loaded (${bytecode.length / 2 - 1} bytes)`);
        
        const CREATE2_ABI = [
            "function deploy(bytes memory bytecode, bytes32 salt) external returns (address)",
            "function predictAddress(bytes memory bytecode, bytes32 salt) external view returns (address)"
        ];
        
        // Use deterministic salt for verifier (different from MSAFactory salt)
        const salt = "0x0000000000000000000000000000000000000000000000000000000000000002";
        console.log(`🧂 Using salt: ${salt}`);
        
        // Predict address (should be same on all networks)
        const firstNetwork = Object.values(this.networks)[0];
        const firstProvider = new ethers.JsonRpcProvider(firstNetwork.rpc);
        const firstCreate2Factory = new ethers.Contract(
            this.deployedAddresses[Object.keys(this.networks)[0]].create2Factory,
            CREATE2_ABI,
            firstProvider
        );
        
        const predictedAddress = await firstCreate2Factory.predictAddress(bytecode, salt);
        console.log(`🔮 Predicted Groth16Verifier address: ${predictedAddress}`);
        
        // Store verifier address for MSAFactory deployment
        this.verifierAddress = predictedAddress;
        
        // Deploy to all networks
        const deployments = [];
        
        for (const [networkName, network] of Object.entries(this.networks)) {
            console.log(`\n📡 Deploying Groth16Verifier to ${networkName}...`);
            
            const provider = new ethers.JsonRpcProvider(network.rpc);
            const wallet = this.wallet.connect(provider);
            const create2Factory = new ethers.Contract(
                this.deployedAddresses[networkName].create2Factory,
                CREATE2_ABI,
                wallet
            );
            
            // Check if already deployed
            const code = await provider.getCode(predictedAddress);
            if (code !== '0x') {
                console.log(`✅ ${networkName}: Groth16Verifier already deployed at ${predictedAddress}`);
                this.deployedAddresses[networkName].verifier = predictedAddress;
                continue;
            }
            
            // Deploy
            const tx = await create2Factory.deploy(bytecode, salt, {
                gasLimit: 3000000
            });
            
            console.log(`📤 Transaction sent: ${tx.hash}`);
            deployments.push({ networkName, tx });
        }
        
        // Wait for deployments
        for (const { networkName, tx } of deployments) {
            await tx.wait();
            console.log(`✅ ${networkName}: Groth16Verifier deployed at ${predictedAddress}`);
            this.deployedAddresses[networkName].verifier = predictedAddress;
        }
        
        console.log(`🎉 SUCCESS: Groth16Verifier deployed to same address on all networks: ${predictedAddress}\n`);
        
        // Update .env with verifier address for bytecode.js
        this.updateEnvWithVerifier(predictedAddress);
    }

    updateEnvWithVerifier(verifierAddress) {
        const envPath = './.env';
        let envContent = '';
        
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        // Check if PIN_VERIFIER_ADDRESS already exists
        if (envContent.includes('PIN_VERIFIER_ADDRESS=')) {
            // Update existing
            envContent = envContent.replace(
                /PIN_VERIFIER_ADDRESS=.*/,
                `PIN_VERIFIER_ADDRESS=${verifierAddress}`
            );
        } else {
            // Add new
            envContent += `\nPIN_VERIFIER_ADDRESS=${verifierAddress}\n`;
        }
        
        fs.writeFileSync(envPath, envContent);
        console.log(`📝 Updated .env with PIN_VERIFIER_ADDRESS=${verifierAddress}`);
        
        // Also set in process.env for bytecode.js
        process.env.PIN_VERIFIER_ADDRESS = verifierAddress;
    }

    async deployMSAFactories() {
        console.log('🏭 Deploying MSAFactory using CREATE2...');
        
        // Generate MSAFactory bytecode
        console.log('📦 Generating MSAFactory bytecode...');
        const bytecodeOutput = execSync('node bytecode.js', { encoding: 'utf8' });
        
        // Extract bytecode from output (last line is the bytecode)
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
        
        // Predict address (should be same on all networks)
        const firstNetwork = Object.values(this.networks)[0];
        const firstProvider = new ethers.JsonRpcProvider(firstNetwork.rpc);
        const firstCreate2Factory = new ethers.Contract(
            this.deployedAddresses[Object.keys(this.networks)[0]].create2Factory,
            CREATE2_ABI,
            firstProvider
        );
        
        const predictedAddress = await firstCreate2Factory.predictAddress(bytecode, salt);
        console.log(`🔮 Predicted MSAFactory address: ${predictedAddress}`);
        
        // Deploy to all networks
        const deployments = [];
        
        for (const [networkName, network] of Object.entries(this.networks)) {
            console.log(`\n📡 Deploying MSAFactory to ${networkName}...`);
            
            const provider = new ethers.JsonRpcProvider(network.rpc);
            const wallet = this.wallet.connect(provider);
            const create2Factory = new ethers.Contract(
                this.deployedAddresses[networkName].create2Factory,
                CREATE2_ABI,
                wallet
            );
            
            // Check if already deployed
            const code = await provider.getCode(predictedAddress);
            if (code !== '0x') {
                console.log(`✅ ${networkName}: MSAFactory already deployed at ${predictedAddress}`);
                this.deployedAddresses[networkName].msaFactory = predictedAddress;
                continue;
            }
            
            // Deploy
            const tx = await create2Factory.deploy(bytecode, salt, {
                gasLimit: 5000000
            });
            
            console.log(`📤 Transaction sent: ${tx.hash}`);
            deployments.push({ networkName, tx });
        }
        
        // Wait for deployments
        for (const { networkName, tx } of deployments) {
            await tx.wait();
            console.log(`✅ ${networkName}: MSAFactory deployed at ${predictedAddress}`);
            this.deployedAddresses[networkName].msaFactory = predictedAddress;
        }
        
        console.log(`🎉 SUCCESS: MSAFactory deployed to same address on all networks: ${predictedAddress}\n`);
    }

    async findBaseNonce(networksToCheck = null) {
        // Find the highest nonce across specified networks or all networks
        const networks = networksToCheck || Object.entries(this.networks);
        let maxNonce = 0;
        
        for (const [networkName, network] of networks) {
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

    async checkContractExists(provider, address, expectedBytecode = null) {
        const code = await provider.getCode(address);
        const exists = code !== '0x';
        
        if (exists && expectedBytecode) {
            // Compare deployed bytecode (runtime) with expected
            const matches = code === expectedBytecode;
            return { exists, matches, code };
        }
        
        return { exists, code };
    }

    async deployToNewNetwork() {
        console.log(`🎯 Deploying to new network: ${this.targetNetwork}`);
        
        const network = this.networks[this.targetNetwork];
        const provider = new ethers.JsonRpcProvider(network.rpc);
        const wallet = this.wallet.connect(provider);
        
        // Check if contracts already exist at target addresses
        console.log('🔍 Checking if contracts already exist at target addresses...');
        
        const create2Check = await this.checkContractExists(provider, this.targetAddresses.create2Factory);
        const msaCheck = await this.checkContractExists(provider, this.targetAddresses.msaFactory);
        
        if (create2Check.exists) {
            console.log(`✅ CREATE2Factory already exists at ${this.targetAddresses.create2Factory}`);
            this.deployedAddresses[this.targetNetwork] = { create2Factory: this.targetAddresses.create2Factory };
        }
        
        if (msaCheck.exists) {
            console.log(`✅ MSAFactory already exists at ${this.targetAddresses.msaFactory}`);
            this.deployedAddresses[this.targetNetwork].msaFactory = this.targetAddresses.msaFactory;
        }
        
        if (create2Check.exists && msaCheck.exists) {
            console.log('🎉 Both contracts already deployed at target addresses!');
            return;
        }
        
        // Calculate required nonce for CREATE2Factory deployment
        const requiredNonce = await this.calculateRequiredNonce(
            wallet.address, 
            this.targetAddresses.create2Factory
        );
        
        console.log(`🎯 Required nonce for CREATE2Factory deployment: ${requiredNonce}`);
        
        // Deploy CREATE2Factory if needed
        if (!create2Check.exists) {
            await this.deployCreate2FactoryToNetwork(wallet, requiredNonce);
        }
        
        // Deploy MSAFactory if needed
        if (!msaCheck.exists) {
            await this.deployMSAFactoryToNetwork(wallet);
        }
    }

    async calculateRequiredNonce(deployerAddress, targetAddress) {
        // Calculate what nonce would produce the target address
        // This uses the standard CREATE opcode address calculation: keccak256(rlp([sender, nonce]))
        for (let nonce = 0; nonce < 10000; nonce++) {
            const predictedAddress = ethers.getCreateAddress({ from: deployerAddress, nonce });
            if (predictedAddress.toLowerCase() === targetAddress.toLowerCase()) {
                return nonce;
            }
        }
        throw new Error(`Could not find nonce that produces target address ${targetAddress}`);
    }

    async deployCreate2FactoryToNetwork(wallet, requiredNonce) {
        console.log(`🏭 Deploying CREATE2Factory to ${this.targetNetwork}...`);
        
        // Load CREATE2Factory bytecode
        const artifactPath = './out/CREATE2Factory.sol/CREATE2Factory.json';
        if (!fs.existsSync(artifactPath)) {
            throw new Error('CREATE2Factory artifact not found');
        }
        
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const bytecode = artifact.bytecode.object;
        
        // Advance to required nonce
        await this.advanceToNonce(wallet, requiredNonce);
        
        // Deploy
        const tx = await wallet.sendTransaction({
            data: bytecode,
            gasLimit: 2000000,
            nonce: requiredNonce
        });
        
        console.log(`📤 Transaction sent: ${tx.hash}`);
        const receipt = await tx.wait();
        const deployedAddress = receipt.contractAddress;
        
        if (deployedAddress.toLowerCase() !== this.targetAddresses.create2Factory.toLowerCase()) {
            throw new Error(`Address mismatch! Expected ${this.targetAddresses.create2Factory}, got ${deployedAddress}`);
        }
        
        console.log(`✅ CREATE2Factory deployed at ${deployedAddress}`);
        this.deployedAddresses[this.targetNetwork] = { create2Factory: deployedAddress };
    }

    async deployMSAFactoryToNetwork(wallet) {
        console.log(`🏭 Deploying MSAFactory to ${this.targetNetwork} using CREATE2...`);
        
        // Generate MSAFactory bytecode
        console.log('📦 Generating MSAFactory bytecode...');
        execSync('node bytecode.js', { stdio: 'inherit' });
        
        const bytecode = fs.readFileSync('msafactory-creation-bytecode.txt', 'utf8').trim();
        
        const CREATE2_ABI = [
            "function deploy(bytes memory bytecode, bytes32 salt) external returns (address)",
            "function predictAddress(bytes memory bytecode, bytes32 salt) external view returns (address)"
        ];
        
        const create2Factory = new ethers.Contract(
            this.deployedAddresses[this.targetNetwork].create2Factory,
            CREATE2_ABI,
            wallet
        );
        
        // Find the salt that produces the target address
        const salt = await this.findSaltForAddress(create2Factory, bytecode, this.targetAddresses.msaFactory);
        console.log(`🧂 Using salt: ${salt}`);
        
        // Deploy
        const tx = await create2Factory.deploy(bytecode, salt, {
            gasLimit: 5000000
        });
        
        console.log(`📤 Transaction sent: ${tx.hash}`);
        await tx.wait();
        
        console.log(`✅ MSAFactory deployed at ${this.targetAddresses.msaFactory}`);
        this.deployedAddresses[this.targetNetwork].msaFactory = this.targetAddresses.msaFactory;
    }

    async findSaltForAddress(create2Factory, bytecode, targetAddress) {
        // Try different salts to find one that produces the target address
        for (let i = 0; i < 10000; i++) {
            const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
            const predictedAddress = await create2Factory.predictAddress(bytecode, salt);
            
            if (predictedAddress.toLowerCase() === targetAddress.toLowerCase()) {
                return salt;
            }
        }
        
        throw new Error(`Could not find salt that produces target address ${targetAddress}`);
    }

    printSummary() {
        console.log('📋 DEPLOYMENT SUMMARY');
        console.log('====================');
        
        for (const [networkName, addresses] of Object.entries(this.deployedAddresses)) {
            console.log(`\n${networkName.toUpperCase()}:`);
            console.log(`  CREATE2Factory: ${addresses.create2Factory}`);
            if (addresses.verifier) {
                console.log(`  Groth16Verifier: ${addresses.verifier}`);
            }
            console.log(`  MSAFactory: ${addresses.msaFactory}`);
        }
        
        if (!this.singleNetworkMode) {
            console.log('\n💾 Add these to your .env file:');
            const firstNetwork = Object.keys(this.deployedAddresses)[0];
            console.log(`CREATE2_FACTORY_ADDRESS=${this.deployedAddresses[firstNetwork].create2Factory}`);
            
            if (this.verifierAddress) {
                console.log(`PIN_VERIFIER_ADDRESS=${this.verifierAddress}`);
            }
            
            for (const [networkName, addresses] of Object.entries(this.deployedAddresses)) {
                const envName = networkName.toUpperCase().replace('-', '_');
                console.log(`${envName}_FACTORY_ADDRESS=${addresses.msaFactory}`);
            }
        }
        
        console.log('\n🎉 Setup complete! You can now deploy MultiSig accounts with identical addresses across networks.');
    }
}

// CLI argument parsing
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--network':
                options.targetNetwork = args[++i];
                break;
            case '--networks':
                options.filterNetworks = args[++i].split(',').map(n => n.trim());
                break;
            case '--create2-address':
                options.targetAddresses = options.targetAddresses || {};
                options.targetAddresses.create2Factory = args[++i];
                break;
            case '--msa-address':
                options.targetAddresses = options.targetAddresses || {};
                options.targetAddresses.msaFactory = args[++i];
                break;
            case '--help':
            case '-h':
                console.log(`
Usage: node setup.js [options]

Options:
  --networks <list>          Comma-separated networks (e.g., sepolia,base-sepolia)
  --network <name>           Deploy to specific network with address matching
  --create2-address <addr>   Target CREATE2Factory address to match
  --msa-address <addr>       Target MSAFactory address to match
  --help, -h                 Show this help message

Examples:
  node setup.js                                    # Deploy to all networks
  node setup.js --networks sepolia,base-sepolia    # Deploy to selected networks
  node setup.js --network arbitrum-sepolia \\     # Deploy to specific network
    --create2-address 0x1234... \\                # with matching addresses
    --msa-address 0x5678...
`);
                process.exit(0);
                break;
        }
    }
    
    return options;
}

// CLI usage
if (require.main === module) {
    const options = parseArgs();
    const deployer = new CrossChainDeployer(options);
    
    deployer.setup().catch(error => {
        console.error('❌ Deployment failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    });
}

module.exports = { CrossChainDeployer };
