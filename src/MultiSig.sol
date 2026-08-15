// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.22;

import "./IVerifier.sol";

// Custom errors (saves gas and reduces contract size)
error NotOwner();
error NotConfirmed();
error AlreadyExecuted();
error IncorrectPin();
error ReentrantCall();
error OnlyMultiSig();
error InvalidRecipient();
error InvalidNFTData();
error InvalidERC20Data();
error InvalidDepositAddress();
error InvalidAmount();
error NotFactoryOwner();
error WithdrawalFailed();
error InsufficientFee();
error DeploymentFailed();
error AddressMismatch();
error AlreadyDeployed();
error OwnerExists();
error OwnerDoesNotExist();
error TransactionDoesNotExist();
error AlreadyConfirmed();
error NotYetConfirmed();
error NullAddress();
error InvalidRequirement();

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC721Receiver {
    /**
     * @dev Whenever an {IERC721} `tokenId` token is transferred to this contract via {IERC721-safeTransferFrom}
     * by `operator` from `from`, this function is called.
     *
     * It must return its Solidity selector to confirm the token transfer.
     * If any other value is returned or the interface is not implemented by the recipient, the transfer will be
     * reverted.
     *
     * The selector can be obtained in Solidity with `IERC721Receiver.onERC721Received.selector`.
     */
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC721 is IERC165 {
    /**
     * @dev Emitted when `tokenId` token is transferred from `from` to `to`.
     */
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /**
     * @dev Emitted when `owner` enables `approved` to manage the `tokenId` token.
     */
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

    /**
     * @dev Emitted when `owner` enables or disables (`approved`) `operator` to manage all of its assets.
     */
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    /**
     * @dev Returns the number of tokens in ``owner``'s account.
     */
    function balanceOf(address owner) external view returns (uint256 balance);

    /**
     * @dev Returns the owner of the `tokenId` token.
     *
     * Requirements:
     *
     * - `tokenId` must exist.
     */
    function ownerOf(uint256 tokenId) external view returns (address owner);

    /**
     * @dev Safely transfers `tokenId` token from `from` to `to`.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `tokenId` token must exist and be owned by `from`.
     * - If the caller is not `from`, it must be approved to move this token by either {approve} or {setApprovalForAll}.
     * - If `to` refers to a smart contract, it must implement {IERC721Receiver-onERC721Received}, which is called upon
     *   a safe transfer.
     *
     * Emits a {Transfer} event.
     */
  
    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    /**
     * @dev Transfers `tokenId` token from `from` to `to`.
     *
     * WARNING: Note that the caller is responsible to confirm that the recipient is capable of receiving ERC-721
     * or else they may be permanently lost. Usage of {safeTransferFrom} prevents loss, though the caller must
     * understand this adds an external call which potentially creates a reentrancy vulnerability.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `tokenId` token must be owned by `from`.
     * - If the caller is not `from`, it must be approved to move this token by either {approve} or {setApprovalForAll}.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 tokenId) external;

    /**
     * @dev Gives permission to `to` to transfer `tokenId` token to another account.
     * The approval is cleared when the token is transferred.
     *
     * Only a single account can be approved at a time, so approving the zero address clears previous approvals.
     *
     * Requirements:
     *
     * - The caller must own the token or be an approved operator.
     * - `tokenId` must exist.
     *
     * Emits an {Approval} event.
     */
    function approve(address to, uint256 tokenId) external;

    /**
     * @dev Approve or remove `operator` as an operator for the caller.
     * Operators can call {transferFrom} or {safeTransferFrom} for any token owned by the caller.
     *
     * Requirements:
     *
     * - The `operator` cannot be the address zero.
     *
     * Emits an {ApprovalForAll} event.
     */
    function setApprovalForAll(address operator, bool approved) external;

    /**
     * @dev Returns the account approved for `tokenId` token.
     *
     * Requirements:
     *
     * - `tokenId` must exist.
     */
    function getApproved(uint256 tokenId) external view returns (address operator);

    /**
     * @dev Returns if the `operator` is allowed to manage all of the assets of `owner`.
     *
     * See {setApprovalForAll}
     */
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IEthnotaryMultiSig {
    function isEthnotaryMultiSig() external pure returns (bool);
}

contract MultiSigAccount is IEthnotaryMultiSig {
    //Multi Sig Constants

    string public name;
    bytes32 public pinHash;
    IVerifier public pinVerifier;
    uint256 public pinNonce;

    uint public constant MAX_OWNER_COUNT = 13;
    
    // Reentrancy guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    //Storage for Multi Sig

    enum TransactionType {
        Unknown,
        Swap,
        TokenTransfer,
        NativeTransfer,
        ContractInteraction,
        CashOut
    }

    struct CashOutData {
        uint256 approvalTxId;
        uint256 transferTxId;
        address depositAddress;
        address tokenAddress;
        uint256 amount;
        bool isNative;
    }

    mapping(uint => Transaction) public transactions;
    mapping(uint => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;
    mapping(uint => address) public swapTransactions; // Maps txId to swap module address
    mapping(uint => TransactionType) public transactionTypes; // Maps txId to transaction type
    mapping(uint => CashOutData) public cashOutTransactions; // Maps transferTxId to cash-out data
    address[] public owners;
    uint public required;
    uint public transactionCount;

    struct Transaction {
        address dest;
        uint value;
        bytes func;
        bool executed;
        uint id;
    }

    //Multi Sig Events

    event Confirmation(address indexed sender, uint indexed transactionId);
    event Revocation(address indexed sender, uint indexed transactionId);
    event Submission(
        uint indexed transactionId,
        address dest,
        uint256 value,
        bytes func
    );

    event ExecutionFailure(uint indexed transactionId);
    event Deposit(address sender, uint value);
    event OwnerAddition(address indexed owner);
    event OwnerRemoval(address indexed owner);
    event OwnerReplace(address indexed oldOwner, address indexed newOwner);
    event RequirementChange(uint required);
    event Delete(uint indexed transactionId, address indexed sender);
    event NftReceived(
        address operator,
        address from,
        uint256 tokenId,
        bytes data
    );
    event Swap(
        uint indexed transactionId,
        address indexed swapModule,
        address indexed executor,
        uint256 ethValue
    );
    event TokenTransfer(
        uint indexed transactionId,
        address indexed assetContract,
        address indexed to,
        uint256 amountOrTokenId,
        address executor,
        bool isNFT
    );
    event NativeTransfer(
        uint indexed transactionId,
        address indexed to,
        uint256 amount,
        address executor
    );
    event ContractInteraction(
        uint indexed transactionId,
        address indexed target,
        address indexed executor,
        uint256 value,
        bytes data
    );
    event CashOut(
        uint256 indexed approvalTxId,
        uint256 indexed transferTxId,
        address indexed depositAddress,
        address tokenAddress,
        uint256 amount,
        address executor,
        bool isNative
    );

    //Multi Sig Modifiers

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    modifier ownerDoesNotExist(address accountOwner) {
        if (isOwner[accountOwner]) revert OwnerExists();
        _;
    }

    modifier ownerExists(address accountOwner) {
        if (!isOwner[accountOwner]) revert OwnerDoesNotExist();
        _;
    }

    modifier transactionExists(uint transactionId) {
        if (transactions[transactionId].dest == address(0)) revert TransactionDoesNotExist();
        _;
    }

    modifier confirmed(uint transactionId, address accountOwner) {
        if (!confirmations[transactionId][accountOwner]) revert NotYetConfirmed();
        _;
    }

    modifier notConfirmed(uint transactionId, address accountOwner) {
        if (confirmations[transactionId][accountOwner]) revert AlreadyConfirmed();
        _;
    }

    modifier notExecuted(uint transactionId) {
        if (transactions[transactionId].executed) revert AlreadyExecuted();
        _;
    }

    modifier notNull(address _address) {
        if (_address == address(0)) revert NullAddress();
        _;
    }

    modifier verifyPinProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC
    ) {
        // [pinHash, sender] - nonce removed for better UX
        // msg.sender binding prevents proof replay attacks
        uint[2] memory pubSignals = [uint256(pinHash), uint256(uint160(msg.sender))];
        bool valid = pinVerifier.verifyProof(_pA, _pB, _pC, pubSignals);
        if (!valid) revert IncorrectPin();
        _;
    }

    modifier validRequirement(uint ownerCount, uint _required) {
        if (ownerCount > MAX_OWNER_COUNT || _required > ownerCount || _required == 0 || ownerCount == 0) {
            revert InvalidRequirement();
        }
        _;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    constructor(
        address[] memory _owners,
        uint _required,
        bytes32 _pinHash,
        address _pinVerifier,
        string memory _name
    ) payable validRequirement(_owners.length, _required) {
        for (uint i = 0; i < _owners.length; i++) {
            require(!isOwner[_owners[i]] && _owners[i] != address(0));
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
        pinHash = _pinHash;
        pinVerifier = IVerifier(_pinVerifier);
        pinNonce = 0;
        name = _name;
        _status = _NOT_ENTERED; // Initialize reentrancy guard
    }

    function isEthnotaryMultiSig() external pure override returns (bool) {
        return true;
    }

    function _onlyOwner() internal view {
        if (!isOwner[msg.sender] && msg.sender != address(this)) revert NotOwner();
    }

    function _requireFromOwner() internal view {
        if (!isOwner[msg.sender]) revert NotOwner();
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // This function is called by the ERC721 contract when an NFT is transferred to this contract.
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes memory data
    ) public returns (bytes4) {
        // Emit an event noting that an NFT has been received
        emit NftReceived(operator, from, tokenId, data);

        // Return this magic value that signifies the contract's ability to receive NFTs correctly.
        // It's a must; otherwise, the transaction will fail.
        return this.onERC721Received.selector;
    }

    //Multi Sig Functions

    function addOwner(
        address accountOwner,
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC
    )
        public
        verifyPinProof(_pA, _pB, _pC)
        ownerDoesNotExist(accountOwner)
        notNull(accountOwner)
        validRequirement(owners.length + 1, required)
    {
        _requireFromOwner();
        isOwner[accountOwner] = true;
        owners.push(accountOwner);
        emit OwnerAddition(accountOwner);
    }

    function removeOwner(
        address accountOwner,
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC
    ) public verifyPinProof(_pA, _pB, _pC) ownerExists(accountOwner) {
        _requireFromOwner();
        isOwner[accountOwner] = false;
        for (uint i = 0; i < owners.length - 1; i++)
            if (owners[i] == accountOwner) {
                owners[i] = owners[owners.length - 1];
                break;
            }
        owners.pop();
        if (required > owners.length) {
            required = owners.length;
            emit RequirementChange(owners.length);
        }
        emit OwnerRemoval(accountOwner);
    }

    function replaceOwner(
        address accountOwner,
        address newOwner,
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC
    )
        public
        verifyPinProof(_pA, _pB, _pC)
        ownerExists(accountOwner)
        ownerDoesNotExist(newOwner)
    {
        // P1 FIX: Validate newOwner is not null
        if (newOwner == address(0)) revert NullAddress();
        _requireFromOwner();
        for (uint i = 0; i < owners.length; i++)
            if (owners[i] == accountOwner) {
                owners[i] = newOwner;
                break;
            }
        isOwner[accountOwner] = false;
        isOwner[newOwner] = true;
        emit OwnerReplace(accountOwner, newOwner);
    }


    function changeRequirement(
        uint _required,
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC
    ) public verifyPinProof(_pA, _pB, _pC) validRequirement(owners.length, _required) {
        _requireFromOwner();
        required = _required;
        emit RequirementChange(_required);
    }

    /**
     * @dev Execute a confirmed transaction
     * @param transactionId Transaction ID to execute
     * 
     * @notice This function handles all transaction types:
     * - Swap: Emits Swap event with swap module address
     * - TokenTransfer: Emits TokenTransfer event (ERC20 or NFT)
     * - NativeTransfer: Emits NativeTransfer event (ETH, MATIC, etc.)
     * - ContractInteraction: Emits ContractInteraction event
     * - CashOut: Emits CashOut event with off-ramp details
     * - Unknown: Emits ContractInteraction event as fallback
     * 
     * All events are emitted BEFORE the external call (Checks-Effects-Interactions pattern)
     */
    function execute(uint transactionId) public nonReentrant {
        // CHECKS
        _requireFromOwner();
        if (!isConfirmed(transactionId)) revert NotConfirmed();
        if (transactions[transactionId].executed) revert AlreadyExecuted();

        Transaction storage txn = transactions[transactionId];
        
        // EFFECTS - Update all state before external calls
        txn.executed = true;
        
        // Cache values for events
        address dest = txn.dest;
        uint256 value = txn.value;
        bytes memory func = txn.func;
        TransactionType txType = transactionTypes[transactionId];
        

        
        // Emit type-specific event based on transaction type
        if (txType == TransactionType.Swap) {
            // Swap transaction via UniswapSwapModule or similar
            emit Swap(transactionId, swapTransactions[transactionId], msg.sender, value);
            
        } else if (txType == TransactionType.TokenTransfer) {
            // Token transfer (ERC20 or NFT)
            if (func.length >= 68) {
                address to;
                uint256 amountOrTokenId;
                bool isNFT = func.length >= 100; // NFT transfers have more data
                
                if (isNFT) {
                    // NFT: safeTransferFrom(address from, address to, uint256 tokenId)
                    // P1 FIX: Improved bounds checking with cached length
                    if (func.length < 100) revert InvalidNFTData();
                    
                    assembly {
                        // func layout: [length:32][selector:4][from:32][to:32][tokenId:32]...
                        let dataPtr := add(func, 32) // Skip length prefix
                        let dataLen := mload(func)   // Cache data length
                        
                        // Double-check bounds before reading
                        if lt(dataLen, 100) {
                            mstore(0x00, 0x8b891d3d00000000000000000000000000000000000000000000000000000000)
                            revert(0x00, 0x04)
                        }
                        
                        // Read 'to' address (offset 36: 4 selector + 32 from)
                        to := mload(add(dataPtr, 36))
                        
                        // Read tokenId (offset 68: 4 selector + 32 from + 32 to)
                        amountOrTokenId := mload(add(dataPtr, 68))
                        
                        // Validate 'to' is not zero
                        if iszero(to) {
                            mstore(0x00, 0x7d6a0c6e00000000000000000000000000000000000000000000000000000000)
                            revert(0x00, 0x04)
                        }
                    }
                } else {
                    // ERC20: transfer(address to, uint256 amount)
                    // P1 FIX: Improved bounds checking with cached length
                    if (func.length < 68) revert InvalidERC20Data();
                    
                    assembly {
                        let dataPtr := add(func, 32) // Skip length prefix
                        let dataLen := mload(func)   // Cache data length
                        
                        // Double-check bounds before reading
                        if lt(dataLen, 68) {
                            mstore(0x00, 0x6e9a8b0f00000000000000000000000000000000000000000000000000000000)
                            revert(0x00, 0x04)
                        }
                        
                        // Read 'to' address (offset 4: 4 selector)
                        to := mload(add(dataPtr, 4))
                        
                        // Read amount (offset 36: 4 selector + 32 to)
                        amountOrTokenId := mload(add(dataPtr, 36))
                        
                        // Validate 'to' is not zero
                        if iszero(to) {
                            mstore(0x00, 0x7d6a0c6e00000000000000000000000000000000000000000000000000000000)
                            revert(0x00, 0x04)
                        }
                    }
                }
                
                if (to == address(0)) revert InvalidRecipient();
                emit TokenTransfer(transactionId, dest, to, amountOrTokenId, msg.sender, isNFT);
            }
            
        } else if (txType == TransactionType.NativeTransfer) {
            // Native token transfer (ETH, MATIC, etc.)
            emit NativeTransfer(transactionId, dest, value, msg.sender);
            
        } else if (txType == TransactionType.ContractInteraction) {
            // Generic contract interaction
            emit ContractInteraction(transactionId, dest, msg.sender, value, func);
            
        } else if (txType == TransactionType.CashOut) {
            // Cash-out transaction (MoonPay, Ramp, etc.)
            CashOutData memory cashOutData = cashOutTransactions[transactionId];
            emit CashOut(
                cashOutData.approvalTxId,
                cashOutData.transferTxId,
                cashOutData.depositAddress,
                cashOutData.tokenAddress,
                cashOutData.amount,
                msg.sender,
                cashOutData.isNative
            );
            
        } else {
            // Unknown type - emit ContractInteraction as fallback
            // This handles edge cases where type wasn't set properly
            emit ContractInteraction(transactionId, dest, msg.sender, value, func);
        }
        
        // INTERACTIONS - External call last
        _call(dest, value, func);
    }

    function submitTransaction(
        address dest,
        uint256 value,
        bytes memory func
    ) public returns (uint transactionId) {
        _requireFromOwner();
        transactionId = addTransaction(dest, value, func);
        confirmations[transactionId][msg.sender] = true;
        emit Submission(transactionId, dest, value, func);
        
        // Auto-detect transaction type if not already set
        if (transactionTypes[transactionId] == TransactionType.Unknown) {
            if (value > 0 && func.length == 0) {
                // Native token transfer (ETH, MATIC, etc.)
                transactionTypes[transactionId] = TransactionType.NativeTransfer;
            } else if (func.length > 0) {
                // Contract interaction with data
                transactionTypes[transactionId] = TransactionType.ContractInteraction;
            }
        }
    }

    function confirmTransaction(
        uint transactionId
    )
        public
        ownerExists(msg.sender)
        transactionExists(transactionId)
        notConfirmed(transactionId, msg.sender)
    {
        confirmations[transactionId][msg.sender] = true;
        emit Confirmation(msg.sender, transactionId);
    }

    function revokeConfirmation(
        uint transactionId
    )
        public
        ownerExists(msg.sender)
        confirmed(transactionId, msg.sender)
        notExecuted(transactionId)
    {
        confirmations[transactionId][msg.sender] = false;
        emit Revocation(msg.sender, transactionId);
    }

    function deleteTransaction(
        uint transactionId,
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC
    )
        public
        ownerExists(msg.sender)
        transactionExists(transactionId)
        notExecuted(transactionId)
        verifyPinProof(_pA, _pB, _pC)
    {
        // P0 FIX: Only allow deletion if transaction has no confirmations OR caller is the only confirmator
        // This prevents one owner from deleting a transaction that others have confirmed
        uint confirmationCount = 0;
        bool callerConfirmed = confirmations[transactionId][msg.sender];
        for (uint i = 0; i < owners.length; i++) {
            if (confirmations[transactionId][owners[i]]) {
                confirmationCount++;
            }
        }
        
        // Only allow deletion if: no confirmations, or only the caller has confirmed
        if (confirmationCount > 1 || (confirmationCount == 1 && !callerConfirmed)) {
            revert("Cannot delete transaction with other owner confirmations");
        }
        
        // Clear all confirmations for this transaction
        for (uint i = 0; i < owners.length; i++) {
            confirmations[transactionId][owners[i]] = false;
        }
        
        // Delete the transaction struct from memory
        delete transactions[transactionId];
        
        emit Delete(transactionId, msg.sender);
    }


    function isConfirmed(uint transactionId) public view returns (bool) {
        uint count = 0;
        for (uint i = 0; i < owners.length; i++) {
            if (confirmations[transactionId][owners[i]]) count += 1;
            if (count == required) return true;
        }
        return false;
    }


    function submitTransferNFT(address nftContractAddress, address to, uint256 tokenId) public returns (uint256) {
        _requireFromOwner();    
        bytes memory data = abi.encodeWithSelector(IERC721(nftContractAddress).safeTransferFrom.selector, address(this), to, tokenId);
        uint256 transactionId = submitTransaction(nftContractAddress, 0, data);
        transactionTypes[transactionId] = TransactionType.TokenTransfer;
        return transactionId;
    }

    function submitTransferERC20(address erc20ContractAddress, address to, uint256 amount) public returns (uint256) {
        _requireFromOwner();    
        bytes memory data = abi.encodeWithSelector(IERC20(erc20ContractAddress).transfer.selector, to, amount);
        uint256 transactionId = submitTransaction(erc20ContractAddress, 0, data);
        transactionTypes[transactionId] = TransactionType.TokenTransfer;
        return transactionId;
    }

    // /**
    //  * @dev Submit a transaction to interact with the UniswapSwapModule
    //  * @param swapModuleAddress Address of the deployed UniswapSwapModule
    //  * @param swapData Encoded function call data for the swap
    //  * @param ethValue Amount of ETH to send (for ETH swaps)
    //  */
    // function submitSwapTransaction(
    //     address swapModuleAddress,
    //     bytes memory swapData,
    //     uint256 ethValue
    // ) public returns (uint256) {
    //     _requireFromOwner();
    //     uint256 transactionId = submitTransaction(swapModuleAddress, ethValue, swapData);
    //     swapTransactions[transactionId] = swapModuleAddress; // Mark as swap transaction
    //     transactionTypes[transactionId] = TransactionType.Swap;
    //     return transactionId;
    // }

    // /**
    //  * @dev Submit a cash-out transaction to off-ramp service (MoonPay, Ramp, etc.)
    //  * @param depositAddress Address to send tokens (MoonPay deposit address)
    //  * @param tokenAddress Address of the token to cash out (address(0) for native)
    //  * @param amount Amount to cash out
    //  * @return approvalTxId Transaction ID for token approval (0 if native token)
    //  * @return transferTxId Transaction ID for token transfer
    //  * 
    //  * @notice For ERC20 tokens, this returns TWO transaction IDs:
    //  * 1. approvalTxId - Must be confirmed and executed first
    //  * 2. transferTxId - Must be confirmed and executed second
    //  * Both transactions must succeed for cash-out to work.
    //  * 
    //  * For native tokens (ETH), approvalTxId will be 0.
    //  */
    // function submitCashOut(
    //     address depositAddress,
    //     address tokenAddress,
    //     uint256 amount
    // ) public returns (uint256 approvalTxId, uint256 transferTxId) {
    //     _requireFromOwner();
    //     if (depositAddress == address(0)) revert InvalidDepositAddress();
    //     if (amount == 0) revert InvalidAmount();
        
    //     bool isNative = tokenAddress == address(0);
        
    //     if (isNative) {
    //         // Native token cash-out (ETH, MATIC, etc.)
    //         // No approval needed, just transfer
    //         approvalTxId = 0;
    //         transferTxId = submitTransaction(depositAddress, amount, "");
    //         transactionTypes[transferTxId] = TransactionType.CashOut;
    //     } else {
    //         // ERC20 token cash-out
    //         // Step 1: Approve the deposit address
    //         bytes memory approveData = abi.encodeWithSelector(
    //             IERC20(tokenAddress).approve.selector,
    //             depositAddress,
    //             amount
    //         );
    //         approvalTxId = submitTransaction(tokenAddress, 0, approveData);
    //         transactionTypes[approvalTxId] = TransactionType.ContractInteraction;
            
    //         // Step 2: Transfer tokens to deposit address
    //         bytes memory transferData = abi.encodeWithSelector(
    //             IERC20(tokenAddress).transfer.selector,
    //             depositAddress,
    //             amount
    //         );
    //         transferTxId = submitTransaction(tokenAddress, 0, transferData);
    //         transactionTypes[transferTxId] = TransactionType.CashOut;
    //     }
        
    //     // Store cash-out data for event emission during execution
    //     cashOutTransactions[transferTxId] = CashOutData({
    //         approvalTxId: approvalTxId,
    //         transferTxId: transferTxId,
    //         depositAddress: depositAddress,
    //         tokenAddress: tokenAddress,
    //         amount: amount,
    //         isNative: isNative
    //     });
        
    //     return (approvalTxId, transferTxId);
    // }

    function addTransaction(
        address dest,
        uint256 value,
        bytes memory func
    ) internal notNull(dest) returns (uint transactionId) {
        transactionId = transactionCount;
        transactions[transactionId] = Transaction({
            dest: dest,
            value: value,
            func: func,
            executed: false,
            id: transactionId
        });
        transactionCount += 1;
        //i don't think this event is needed or find a way to only call one of confirm or submit
    }

    function getConfirmationCount(
        uint transactionId
    ) public view returns (uint count) {
        for (uint i = 0; i < owners.length; i++)
            if (confirmations[transactionId][owners[i]]) count += 1;
    }

    function getOwners() public view returns (address[] memory) {
        return owners;
    }

    function getConfirmations(
        uint transactionId
    ) public view returns (address[] memory _confirmations) {
        address[] memory confirmationsTemp = new address[](owners.length);
        uint count = 0;
        uint i;
        for (i = 0; i < owners.length; i++)
            if (confirmations[transactionId][owners[i]]) {
                confirmationsTemp[count] = owners[i];
                count += 1;
            }
        _confirmations = new address[](count);
        for (i = 0; i < count; i++) _confirmations[i] = confirmationsTemp[i];
    }
}

contract MSAFactory {

    uint256 public notaryFee = 9999999999;
    address payable public owner;
    address public constant pinVerifier = 0x65ee46C4d21405f4a4C8e9d0F8a3832c1B885ab4;

    event NewMSACreated(address indexed msaAddress);
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    receive() external payable {
    }

    constructor() {
        owner = payable(msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotFactoryOwner();
        _;
    }

    function changeFee(uint256 newFee) public onlyOwner {
        uint256 oldFee = notaryFee;
        notaryFee = newFee;
        emit FeeUpdated(oldFee, newFee);
    }

    function withdraw() public onlyOwner {
        uint balance = address(this).balance;
        (bool success, ) = payable(msg.sender).call{value: balance}("");
        if (!success) revert WithdrawalFailed();
    }

    /**
     * @dev Generates a deterministic salt based on input parameters
     * @param _owners Array of owner addresses
     * @param _required Number of required confirmations
     * @param _pinHash Hash of the PIN for the multisig
     * @param _name Name of the multisig account
     * @return salt The generated salt
     */
    function generateSalt(address[] calldata _owners, uint _required, bytes32 _pinHash, string calldata _name) public pure returns (bytes32 salt) {
        salt = keccak256(abi.encodePacked(_owners, _required, _pinHash, _name));
    }

    /**
     * @dev Predicts the address of a MultiSigAccount before deployment
     * @param _owners Array of owner addresses
     * @param _required Number of required confirmations
     * @param _pinHash Hash of the PIN for the multisig
     * @param _name Name of the multisig account
     * @return predictedAddress The predicted address
     */
    function predictMSAAddress(address[] calldata _owners, uint _required, bytes32 _pinHash, string calldata _name) external view returns (address predictedAddress) {
        bytes32 salt = generateSalt(_owners, _required, _pinHash, _name);
        bytes memory bytecode = abi.encodePacked(
            type(MultiSigAccount).creationCode,
            abi.encode(_owners, _required, _pinHash, pinVerifier, _name)
        );
        
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )
        );
        
        predictedAddress = address(uint160(uint256(hash)));
    }

    /**
     * @dev Creates a new MultiSigAccount using CREATE2 for deterministic addresses
     * @param _owners Array of owner addresses
     * @param _required Number of required confirmations
     * @param _pinHash Hash of the PIN for the multisig (computed off-chain)
     * @param _name Name of the multisig account
     * @return instance The deployed MultiSigAccount
     */
    function newMSA(address[] calldata _owners, uint _required, bytes32 _pinHash, string calldata _name) payable public returns (MultiSigAccount instance) {
        if (msg.value <= notaryFee) revert InsufficientFee();

        bytes32 salt = generateSalt(_owners, _required, _pinHash, _name);
        
        // Check if already deployed
        address predicted = this.predictMSAAddress(_owners, _required, _pinHash, _name);
        uint256 size;
        assembly {
            size := extcodesize(predicted)
        }
        if (size != 0) revert AlreadyDeployed();

        bytes memory bytecode = abi.encodePacked(
            type(MultiSigAccount).creationCode,
            abi.encode(_owners, _required, _pinHash, pinVerifier, _name)
        );

        address deployedAddress;
        assembly {
            deployedAddress := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        
        if (deployedAddress == address(0)) revert DeploymentFailed();
        if (deployedAddress != predicted) revert AddressMismatch();

        instance = MultiSigAccount(payable(deployedAddress));
        emit NewMSACreated(deployedAddress);
    }
    
}