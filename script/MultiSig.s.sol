// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {MultiSigAccount, MSAFactory} from "../src/MultiSig.sol";

contract MultiSigDeployScript is Script {
    MSAFactory public factory;
    MultiSigAccount public multiSig;

    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);

        console.log("Deploying MultiSig contracts...");
        console.log("Deployer:", vm.addr(deployerPrivateKey));

        // Deploy MSA Factory (pinVerifier is hardcoded as constant)
        factory = new MSAFactory();
        console.log("MSAFactory deployed at:", address(factory));
        console.log("PinVerifier (constant):", factory.pinVerifier());

        vm.stopBroadcast();
    }
}

contract CreateMultiSigScript is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address factoryAddress = vm.envAddress("FACTORY_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);

        MSAFactory factory = MSAFactory(payable(factoryAddress));
        
        // Get owners from environment or use defaults
        address[] memory owners = new address[](3);
        owners[0] = vm.envOr("OWNER_1", address(0x1111111111111111111111111111111111111111));
        owners[1] = vm.envOr("OWNER_2", address(0x2222222222222222222222222222222222222222));
        owners[2] = vm.envOr("OWNER_3", address(0x3333333333333333333333333333333333333333));
        
        uint required = uint(vm.envOr("REQUIRED_CONFIRMATIONS", uint256(2)));
        bytes32 pinHash = vm.envOr("MULTISIG_PIN_HASH", bytes32(uint256(keccak256(abi.encodePacked(uint256(1234))))));
        
        console.log("Creating MultiSig with owners:");
        for (uint i = 0; i < owners.length; i++) {
            console.log("Owner", i + 1, ":", owners[i]);
        }
        console.log("Required confirmations:", required);
        console.log("PIN Hash:", uint256(pinHash));

        // Get factory fee and add some extra
        uint256 fee = 999999999999999; // Default factory fee
        uint256 value = fee + 1000000000000000; // Add 0.001 ETH extra
        
        string memory name = "My MultiSig"; // Default name for script deployment
        MultiSigAccount newMultiSig = factory.newMSA{value: value}(owners, required, pinHash, name);
        console.log("MultiSig created at:", address(newMultiSig));

        vm.stopBroadcast();
    }
}
