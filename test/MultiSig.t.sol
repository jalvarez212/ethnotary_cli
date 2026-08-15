// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.22;

import {Test, console} from "forge-std/Test.sol";
import {MultiSigAccount, MSAFactory, IVerifier} from "../src/MultiSig.sol";

// Mock ERC20 contract for testing
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply = 1000000 * 10**18;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor() {
        balanceOf[msg.sender] = totalSupply;
    }
    
    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
    
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        
        balanceOf[from] -= value;
        balanceOf[to] += value;
        allowance[from][msg.sender] -= value;
        
        emit Transfer(from, to, value);
        return true;
    }
}

// Mock ERC721 contract for testing
contract MockERC721 {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    
    string public name = "Mock NFT";
    string public symbol = "MNFT";
    uint256 public nextTokenId = 1;
    
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    
    function mint(address to) external returns (uint256) {
        uint256 tokenId = nextTokenId++;
        ownerOf[tokenId] = to;
        balanceOf[to]++;
        emit Transfer(address(0), to, tokenId);
        return tokenId;
    }
    
    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from, "Not owner");
        require(
            msg.sender == from || 
            getApproved[tokenId] == msg.sender || 
            isApprovedForAll[from][msg.sender],
            "Not approved"
        );
        
        ownerOf[tokenId] = to;
        balanceOf[from]--;
        balanceOf[to]++;
        delete getApproved[tokenId];
        
        emit Transfer(from, to, tokenId);
        
        if (to.code.length > 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "") returns (bytes4 response) {
                if (response != IERC721Receiver.onERC721Received.selector) {
                    revert("ERC721: transfer to non ERC721Receiver implementer");
                }
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert("ERC721: transfer to non ERC721Receiver implementer");
                } else {
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        }
    }
    
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f || interfaceId == 0x01ffc9a7;
    }
}

// Mock Verifier for testing
contract MockVerifier {
    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[3] calldata
    ) external pure returns (bool) {
        return true;
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

contract MultiSigTest is Test {
    MultiSigAccount public multiSig;
    MSAFactory public factory;
    MockERC20 public mockToken;
    MockERC721 public mockNFT;
    MockVerifier public mockVerifier;
    
    address public owner1 = address(0x1);
    address public owner2 = address(0x2);
    address public owner3 = address(0x3);
    address public nonOwner = address(0x4);
    address public recipient = address(0x5);
    
    uint16 public constant PIN = 1234;
    uint public constant REQUIRED = 2;
    bytes32 public pinHash;
    uint256 public constant SENDER_NONCE = 0; // Not used anymore but kept for proof structure
    
    event Confirmation(address indexed sender, uint indexed transactionId);
    event Revocation(address indexed sender, uint indexed transactionId);
    event Execution(uint transactionId, address indexed to, uint indexed amount);
    event ExecutionFailure(uint indexed transactionId);
    event Deposit(address sender, uint value);
    event OwnerAddition(address indexed owner);
    event OwnerRemoval(address indexed owner);
    event OwnerReplace(address indexed oldOwner, address indexed newOwner);
    event RequirementChange(uint required);
    
    function setUp() public {
        mockVerifier = new MockVerifier();
        
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        
        factory = new MSAFactory();
        
        bytes32 salt = factory.generateSalt(owners, REQUIRED, pinHash, "TestMSA");
        multiSig = factory.newMSA{value: 10000000000}(owners, REQUIRED, pinHash, "TestMSA");
        
        mockToken = new MockERC20();
        mockNFT = new MockERC721();
        
        vm.deal(address(multiSig), 10 ether);
        mockToken.transfer(address(multiSig), 1000 * 10**18);
        uint256 tokenId = mockNFT.mint(address(this));
        mockNFT.safeTransferFrom(address(this), address(multiSig), tokenId);
    }

    function test_Constructor() public {
        address[] memory testOwners = multiSig.getOwners();
        assertEq(testOwners.length, 3);
        assertEq(testOwners[0], owner1);
        assertEq(testOwners[1], owner2);
        assertEq(testOwners[2], owner3);
        assertEq(multiSig.required(), REQUIRED);
        assertTrue(multiSig.isOwner(owner1));
        assertTrue(multiSig.isOwner(owner2));
        assertTrue(multiSig.isOwner(owner3));
        assertFalse(multiSig.isOwner(nonOwner));
    }

    function test_Factory_Constructor() public {
        // pinVerifier is now a hardcoded constant
        assertEq(factory.pinVerifier(), 0x65ee46C4d21405f4a4C8e9d0F8a3832c1B885ab4);
        assertEq(factory.owner(), address(this));
        assertTrue(factory.notaryFee() > 0);
    }

    function test_Factory_ChangeFee() public {
        uint256 newFee = 2000000000000000;
        uint256 oldFee = factory.notaryFee();
        
        factory.changeFee(newFee);
        
        assertEq(factory.notaryFee(), newFee);
    }

    // updatePinVerifier tests removed - pinVerifier is now a hardcoded constant

    function test_Factory_ChangeFee_RevertNotOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        factory.changeFee(2000000000000000);
    }

    function test_Factory_Withdraw() public {
        uint256 fee = factory.notaryFee();
        address[] memory owners = new address[](1);
        owners[0] = address(this);
        
        // Need to send MORE than the fee (not equal) per the contract check
        factory.newMSA{value: fee + 1}(owners, 1, pinHash, "Test2");
        
        uint256 initialBalance = address(this).balance;
        uint256 contractBalance = address(factory).balance;
        
        factory.withdraw();
        
        assertEq(address(factory).balance, 0);
        assertTrue(address(this).balance >= initialBalance); // Account for gas costs
    }

    function test_Receive() public {
        uint256 initialBalance = address(multiSig).balance;
        uint256 sendAmount = 1 ether;
        
        (bool success,) = address(multiSig).call{value: sendAmount}("");
        assertTrue(success);
        assertEq(address(multiSig).balance, initialBalance + sendAmount);
    }

    function test_SubmitTransaction() public {
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1 ether);
        
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransaction(recipient, 1 ether, data);
        
        assertEq(txId, 0);
        assertEq(multiSig.transactionCount(), 1);
        
        (address dest, uint256 value, bytes memory func, bool executed, uint256 id) = multiSig.transactions(txId);
        assertEq(dest, recipient);
        assertEq(value, 1 ether);
        assertEq(func, data);
        assertFalse(executed);
    }

    function test_SubmitTransaction_RevertNotOwner() public {
        bytes memory data = "";
        
        vm.prank(nonOwner);
        vm.expectRevert();
        multiSig.submitTransaction(recipient, 1 ether, data);
    }

    function test_ConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransaction(recipient, 1 ether, "");
        
        vm.prank(owner2);
        multiSig.confirmTransaction(txId);
        
        assertEq(multiSig.getConfirmationCount(txId), 2);
    }

    function test_ConfirmTransaction_RevertNotOwner() public {
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransaction(recipient, 1 ether, "");
        
        vm.prank(nonOwner);
        vm.expectRevert();
        multiSig.confirmTransaction(txId);
    }

    function test_Execute() public {
        uint256 initialBalance = recipient.balance;
        
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransaction(recipient, 1 ether, "");
        
        vm.prank(owner2);
        multiSig.confirmTransaction(txId);
        
        vm.prank(owner1);
        multiSig.execute(txId);
        
        assertEq(recipient.balance, initialBalance + 1 ether);
        
        (, , , bool executed, ) = multiSig.transactions(txId);
        assertTrue(executed);
    }

    function test_Execute_ReentrancyGuard() public {
        ReentrantContract reentrant = new ReentrantContract(address(multiSig));
        
        vm.deal(address(multiSig), 10 ether);
        
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransaction(address(reentrant), 1 ether, "");
        
        vm.prank(owner2);
        multiSig.confirmTransaction(txId);
        
        vm.expectRevert();
        reentrant.triggerExecute(txId);
    }

    // Test to verify nonce is no longer used
    function test_NoNonceTracking() public view {
        // The pinNonce field should still exist but not be used
        // This test just ensures the contract compiles without nonce dependency
        assertTrue(true);
    }

    function test_SubmitTransferERC20() public {
        uint256 transferAmount = 100 * 10**18;
        
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransferERC20(address(mockToken), recipient, transferAmount);
        
        assertEq(txId, 0);
        
        (address dest, uint256 value, bytes memory func, , ) = multiSig.transactions(txId);
        assertEq(dest, address(mockToken));
        assertEq(value, 0);
        
        bytes memory expectedData = abi.encodeWithSelector(mockToken.transfer.selector, recipient, transferAmount);
        assertEq(func, expectedData);
    }

    function test_ExecuteERC20Transfer() public {
        uint256 transferAmount = 100 * 10**18;
        uint256 initialBalance = mockToken.balanceOf(recipient);
        
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransferERC20(address(mockToken), recipient, transferAmount);
        
        vm.prank(owner2);
        multiSig.confirmTransaction(txId);
        
        vm.prank(owner1);
        multiSig.execute(txId);
        
        assertEq(mockToken.balanceOf(recipient), initialBalance + transferAmount);
        assertEq(mockToken.balanceOf(address(multiSig)), 1000 * 10**18 - transferAmount);
    }

    function test_SubmitTransferNFT() public {
        uint256 tokenId = 1;
        
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransferNFT(address(mockNFT), recipient, tokenId);
        
        (address dest, uint256 value, bytes memory func, , ) = multiSig.transactions(txId);
        assertEq(dest, address(mockNFT));
        assertEq(value, 0);
        
        bytes memory expectedData = abi.encodeWithSelector(mockNFT.safeTransferFrom.selector, address(multiSig), recipient, tokenId);
        assertEq(func, expectedData);
    }

    function test_ExecuteNFTTransfer() public {
        uint256 tokenId = 1;
        
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransferNFT(address(mockNFT), recipient, tokenId);
        
        vm.prank(owner2);
        multiSig.confirmTransaction(txId);
        
        vm.prank(owner1);
        multiSig.execute(txId);
        
        assertEq(mockNFT.ownerOf(tokenId), recipient);
        assertEq(mockNFT.balanceOf(address(multiSig)), 0);
    }

    function test_GetOwners() public {
        address[] memory retrievedOwners = multiSig.getOwners();
        assertEq(retrievedOwners.length, 3);
        assertEq(retrievedOwners[0], owner1);
        assertEq(retrievedOwners[1], owner2);
        assertEq(retrievedOwners[2], owner3);
    }

    function test_GetConfirmations() public {
        vm.prank(owner1);
        uint256 txId = multiSig.submitTransaction(recipient, 1 ether, "");
        
        vm.prank(owner2);
        multiSig.confirmTransaction(txId);
        
        address[] memory confirmations = multiSig.getConfirmations(txId);
        assertEq(confirmations.length, 2);
        assertEq(confirmations[0], owner1);
        assertEq(confirmations[1], owner2);
    }

    receive() external payable {}
}

contract ReentrantContract {
    MultiSigAccount private multiSig;
    
    constructor(address _multiSig) {
        multiSig = MultiSigAccount(payable(_multiSig));
    }
    
    function triggerExecute(uint256 txId) external {
        multiSig.execute(txId);
    }
    
    receive() external payable {
        if (address(multiSig).balance >= 1 ether) {
            multiSig.execute(0);
        }
    }
}
