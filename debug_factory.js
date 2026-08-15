const { ethers } = require("ethers");

const FACTORY_ADDRESS = "0xb00e3EA0715999Ef796B88F3211624D740d158F2";
const FACTORY_ABI = [
    "function pinVerifier() view returns (address)",
    "function owner() view returns (address)"
];

const NETWORKS = [
    {
        name: "Sepolia",
        rpc: "https://rpc.sepolia.org"
    },
    {
        name: "Base Sepolia",
        rpc: "https://sepolia.base.org"
    },
    {
        name: "Arbitrum Sepolia",
        rpc: "https://sepolia-rollup.arbitrum.io/rpc"
    }
];

async function checkNetworks() {
    console.log("🔍 Inspecting MSAFactory Configuration Across Networks...\n");

    for (const net of NETWORKS) {
        console.log(`🌐 Checking ${net.name}...`);
        try {
            const provider = new ethers.JsonRpcProvider(net.rpc);
            const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);

            // Check if factory exists
            const code = await provider.getCode(FACTORY_ADDRESS);
            if (code === "0x") {
                console.log(`❌ Factory NOT FOUND at ${FACTORY_ADDRESS}`);
                continue;
            }

            // Read pinVerifier
            const verifierAddr = await factory.pinVerifier();
            console.log(`   Factory found. Linked PinVerifier: ${verifierAddr}`);

            // Check if verifier has code
            const verifierCode = await provider.getCode(verifierAddr);
            if (verifierCode === "0x") {
                console.log(`❌ ⚠️  CRITICAL: PinVerifier contract at ${verifierAddr} HAS NO CODE!`);
                console.log(`      This means the Factory is pointing to an empty address.`);
            } else {
                console.log(`✅ PinVerifier exists and has code.`);
            }

        } catch (error) {
            console.log(`❌ Error connecting or reading: ${error.message}`);
        }
        console.log("---");
    }
}

checkNetworks();
