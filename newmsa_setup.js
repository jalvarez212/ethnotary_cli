const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to deploy a new MultiSig Account using the deployed MSAFactory
 * 
 * Usage:
 *   node newmsa_setup.js --network sepolia --owners 0x123...,0x456... --required 2 --pinhash 0x...
 */

class MSADeployer {
    constructor() {
        this.networks = {
            sepolia: {
                name: 'sepolia',
                rpc: process.env.SEPOLIA_RPC_URL,
                factory: process.env.SEPOLIA_FACTORY_ADDRESS
            },
            'base-sepolia': {
                name: 'base-sepolia',
                rpc: process.env.BASE_SEPOLIA_RPC_URL,
                factory: process.env.BASE_SEPOLIA_FACTORY_ADDRESS
            },
            'arbitrum-sepolia': {
                name: 'arbitrum-sepolia',
                rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL,
                factory: process.env.ARBITRUM_SEPOLIA_FACTORY_ADDRESS
            }
        };

        // Parse args
        this.args = this.parseArgs();
        this.network = this.networks[this.args.network];

        if (!this.network) {
            throw new Error(`Unknown or missing network: ${this.args.network}`);
        }
        if (!this.network.rpc) {
            throw new Error(`RPC URL not configured for ${this.args.network}`);
        }

        // Fallback to env factory if not provided in args (args support not implemented for factory override, using env)
        // If env is missing, try to find a common one or error
        if (!this.network.factory && process.env.MSA_FACTORY_ADDRESS) {
            this.network.factory = process.env.MSA_FACTORY_ADDRESS;
        }

        this.wallet = null;
    }

    parseArgs() {
        const args = process.argv.slice(2);
        const options = {
            network: 'sepolia', // Default
            owners: [],
            required: 0,
            pinHash: ''
        };

        for (let i = 0; i < args.length; i++) {
            switch (args[i]) {
                case '--network':
                    options.network = args[++i];
                    break;
                case '--owners':
                    options.owners = args[++i].split(',');
                    break;
                case '--required':
                    options.required = parseInt(args[++i]);
                    break;
                case '--pinhash':
                    options.pinHash = args[++i];
                    break;
                case '--help':
                    this.printHelp();
                    process.exit(0);
                    break;
            }
        }
        return options;
    }

    printHelp() {
        console.log(`
Usage: node newmsa_setup.js [options]

Options:
  --network <name>       Network to deploy to (default: sepolia)
  --owners <addr,addr>   Comma-separated list of owner addresses
  --required <num>       Number of required confirmations
  --pinhash <hash>       Hash of the PIN (uint256/bytes32 hex)
`);
    }

    async deploy() {
        console.log(`🚀 Starting New MSA Account deployment on ${this.network.name}...\n`);

        if (!process.env.PRIVATE_KEY) {
            throw new Error('PRIVATE_KEY not found in .env');
        }
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY);

        const provider = new ethers.JsonRpcProvider(this.network.rpc);
        const signer = this.wallet.connect(provider);

        // Validation
        if (!this.network.factory) {
            throw new Error(`MSAFactory address not found for ${this.network.name}. Set ${this.network.name.toUpperCase().replace('-', '_')}_FACTORY_ADDRESS in .env`);
        }
        if (this.args.owners.length === 0) {
            throw new Error('No owners specified. Use --owners');
        }
        if (this.args.required === 0) {
            throw new Error('Required confirmations not specified. Use --required');
        }
        if (!this.args.pinHash) {
            throw new Error('PIN Hash not specified. Use --pinhash');
        }

        console.log(`📋 Factory: ${this.network.factory}`);
        console.log(`👥 Owners: ${this.args.owners.join(', ')}`);
        console.log(`🔢 Required: ${this.args.required}`);
        console.log(`🔐 PIN Hash: ${this.args.pinHash}`);

        const MSAFactoryABI = [
            "function newMSA(address[] memory _owners, uint _required, bytes32 _pinHash) payable public returns (address)",
            "function predictMSAAddress(address[] memory _owners, uint _required, bytes32 _pinHash) public view returns (address)",
            "event NewMSACreated(address msaAddress, bytes32 salt)"
        ];

        const factory = new ethers.Contract(this.network.factory, MSAFactoryABI, signer);

        // Predict address
        try {
            const predicted = await factory.predictMSAAddress(
                this.args.owners,
                this.args.required,
                this.args.pinHash
            );
            console.log(`\n🔮 Predicted MSA Address: ${predicted}`);

            // Check if already deployed?
            const code = await provider.getCode(predicted);
            if (code !== '0x') {
                console.log('⚠️  Contract already deployed at this address!');
                return;
            }
        } catch (e) {
            console.warn('Could not predict address (check arguments):', e.message);
        }

        // Deploy
        // Fee is hardcoded in contract: 999999999999999 wei (~0.001 ETH)
        const fee = 1000000000000000n; // Slightly rounded up to be safe or exact? Contract says 999999999999999.
        // Let's use 1000000000000000 (0.001 ETH)

        console.log('\nPlease verify inputs. Deploying in 3 seconds...');
        await new Promise(r => setTimeout(r, 3000));

        try {
            const tx = await factory.newMSA(
                this.args.owners,
                this.args.required,
                this.args.pinHash,
                { value: fee }
            );

            console.log(`📤 Transaction sent: ${tx.hash}`);
            const receipt = await tx.wait();

            // Find event
            // Note: returns (MultiSigAccount instance) in Solidity, but standard tx return is receipt
            // We can look for NewMSACreated event
            const event = receipt.logs.find(log => {
                try {
                    return factory.interface.parseLog(log)?.name === 'NewMSACreated';
                } catch { return false; }
            });

            if (event) {
                const parsed = factory.interface.parseLog(event);
                console.log(`\n🎉 SUCCESS: New MSA Deployed at ${parsed.args.msaAddress}`);
            } else {
                console.log('\n✅ Transaction confirmed, but couldn\'t parse NewMSACreated event (might be internal tx). check etherscan.');
            }

        } catch (error) {
            console.error('\n❌ Deployment failed:', error.message);
            // Decode error if possible
            if (error.data) {
                // Try decoding custom errors
                const errors = [
                    "error InsufficientFee()",
                    "error AlreadyDeployed()",
                    "error DeploymentFailed()",
                    "error AddressMismatch()"
                ];
                // Simple check
                // ...
            }
        }
    }
}

if (require.main === module) {
    const deployer = new MSADeployer();
    deployer.deploy().catch(error => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { MSADeployer };
