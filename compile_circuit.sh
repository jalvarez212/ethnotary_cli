#!/bin/bash
set -e

echo "🔧 zk-SNARK Circuit Compilation Script"
echo "======================================="
echo ""

# Check if circom is installed
if ! command -v circom &> /dev/null; then
    echo "❌ circom not found. Installing..."
    npm install -g circom
fi

# Check if snarkjs is installed
if ! command -v snarkjs &> /dev/null; then
    echo "❌ snarkjs not found. Installing..."
    npm install -g snarkjs
fi

# Install circomlib if not present
if [ ! -d "node_modules/circomlib" ]; then
    echo "📦 Installing circomlib..."
    npm install circomlib
fi

echo "✅ Dependencies ready"
echo ""

# Compile circuit
echo "🔨 Compiling circuit..."
circom circuits/pin_verify.circom --r1cs --wasm --sym -o zkbuild/

echo "✅ Circuit compiled successfully"
echo ""

# Download Powers of Tau if not present
if [ ! -f "zkbuild/powersOfTau28_hez_final_12.ptau" ]; then
    echo "⬇️  Downloading Powers of Tau (trusted setup)..."
    cd zkbuild
    wget -q https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau
    cd ..
    echo "✅ Powers of Tau downloaded"
else
    echo "✅ Powers of Tau already present"
fi
echo ""

# Generate proving and verification keys
echo "🔑 Generating proving and verification keys..."
cd zkbuild

# Phase 2 setup
echo "  - Running Groth16 setup..."
snarkjs groth16 setup pin_verify.r1cs powersOfTau28_hez_final_12.ptau pin_verify_0000.zkey

# Contribute to the ceremony
echo "  - Contributing randomness..."
echo "random entropy from compile script" | snarkjs zkey contribute pin_verify_0000.zkey pin_verify_final.zkey --name="First contribution" -v

# Export verification key
echo "  - Exporting verification key..."
snarkjs zkey export verificationkey pin_verify_final.zkey verification_key.json

echo "✅ Keys generated successfully"
echo ""

# Generate Solidity verifier
echo "📄 Generating Solidity verifier contract..."
snarkjs zkey export solidityverifier pin_verify_final.zkey ../src/PinVerifier.sol

echo "✅ Verifier contract generated at src/PinVerifier.sol"
echo ""

# Move back to root
cd ..

# Display file sizes
echo "📊 Generated files:"
echo "  - pin_verify.wasm: $(du -h zkbuild/pin_verify_js/pin_verify.wasm | cut -f1)"
echo "  - pin_verify_final.zkey: $(du -h zkbuild/pin_verify_final.zkey | cut -f1)"
echo "  - PinVerifier.sol: $(du -h src/PinVerifier.sol | cut -f1)"
echo ""

echo "✅ Circuit compilation complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Deploy PinVerifier.sol to your target networks"
echo "  2. Deploy MSAFactory with the PinVerifier address"
echo "  3. Host pin_verify.wasm and pin_verify_final.zkey on IPFS/CDN"
echo "  4. Update frontend to use the proof generation utility"
echo ""
echo "🔒 Security notes:"
echo "  - pin_verify.wasm and pin_verify_final.zkey are safe to make public"
echo "  - Consider running a multi-party ceremony for production"
echo "  - Store circuit source and artifacts in version control"
