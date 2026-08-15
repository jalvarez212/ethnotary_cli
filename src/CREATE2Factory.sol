// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.22;

/**
 * @title CREATE2Factory
 * @dev Factory contract for deterministic deployment using CREATE2
 */
contract CREATE2Factory {
    event ContractDeployed(address indexed deployedAddress, bytes32 indexed salt);

    /**
     * @dev Deploys a contract using CREATE2
     * @param bytecode The contract bytecode to deploy
     * @param salt The salt for deterministic address generation
     * @return deployedAddress The address of the deployed contract
     */
    function deploy(bytes memory bytecode, bytes32 salt) external returns (address deployedAddress) {
        assembly {
            deployedAddress := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }

        require(deployedAddress != address(0), "CREATE2Factory: deployment failed");

        emit ContractDeployed(deployedAddress, salt);
    }

    /**
     * @dev Predicts the address of a contract deployed with CREATE2
     * @param bytecode The contract bytecode
     * @param salt The salt for deterministic address generation
     * @return predictedAddress The predicted address
     */
    function predictAddress(bytes memory bytecode, bytes32 salt) external view returns (address predictedAddress) {
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(bytecode)));

        predictedAddress = address(uint160(uint256(hash)));
    }

    /**
     * @dev Checks if a contract is deployed at the given address
     * @param addr The address to check
     * @return deployed True if contract is deployed, false otherwise
     */
    function isDeployed(address addr) external view returns (bool deployed) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        deployed = size > 0;
    }
}
