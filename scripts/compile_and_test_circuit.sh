#!/bin/bash

# Circuit Compilation and Test Script
# This script recompiles the pin_verify circuit and tests proof generation

set -e

echo "🔧 ZK Circuit Compilation and Test Script"
echo "=========================================="

# Directories
PROJECT_DIR="/Users/johncarlosalvarez/Desktop/v3"
CIRCUIT_DIR="$PROJECT_DIR/circuits"
BUILD_DIR="$PROJECT_DIR/zkbuild"
OUTPUT_DIR="$PROJECT_DIR/public/zk"
PTAU_FILE="$BUILD_DIR/powersOfTau28_hez_final_12.ptau"

# Create build directory if it doesn't exist
mkdir -p "$BUILD_DIR"

echo ""
echo "📁 Directories:"
echo "  - Circuit: $CIRCUIT_DIR"
echo "  - Build: $BUILD_DIR"
echo "  - Output: $OUTPUT_DIR"
echo "  - Powers of Tau: $PTAU_FILE"

# Step 1: Compile the circuit
echo ""
echo "🔨 Step 1: Compiling circuit..."
cd "$CIRCUIT_DIR"
circom pin_verify.circom --r1cs --wasm --sym -o "$BUILD_DIR"

echo "✅ Circuit compiled successfully!"

# Step 2: Generate the proving key (zkey)
echo ""
echo "🔑 Step 2: Generating proving key..."
cd "$BUILD_DIR"

# Initial setup
snarkjs groth16 setup pin_verify.r1cs "$PTAU_FILE" pin_verify_0000.zkey

# Add a contribution (for production, you'd want multiple contributions)
echo "test_entropy_12345" | snarkjs zkey contribute pin_verify_0000.zkey pin_verify_final.zkey --name="Test Contribution" -v

echo "✅ Proving key generated!"

# Step 3: Export verification key
echo ""
echo "📤 Step 3: Exporting verification key..."
snarkjs zkey export verificationkey pin_verify_final.zkey verification_key.json

echo "✅ Verification key exported!"

# Step 4: Copy files to public/zk
echo ""
echo "📦 Step 4: Copying files to public/zk..."
cp "$BUILD_DIR/pin_verify_js/pin_verify.wasm" "$OUTPUT_DIR/pin_verify.wasm"
cp "$BUILD_DIR/pin_verify_final.zkey" "$OUTPUT_DIR/pin_verify_final.zkey"
cp "$BUILD_DIR/verification_key.json" "$OUTPUT_DIR/verification_key.json"

echo "✅ Files copied to $OUTPUT_DIR"

# Step 5: Display file sizes
echo ""
echo "📊 Output files:"
ls -lh "$OUTPUT_DIR"

echo ""
echo "🎉 Circuit compilation complete!"
echo ""
echo "Next step: Run 'node scripts/test_zk_proof.js' to test proof generation"
