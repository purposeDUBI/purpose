// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../ProtectedBoostable.sol";

// Only used for testing Boostable
contract DummyBoostable is ProtectedBoostable {
    using ECDSA for bytes32;

    string public constant NAME = "Dummy";
    string public constant SYMBOL = "DUMMY";

    address[] private _hasherContracts;

    constructor(address optIn)
        public
        ProtectedBoostable(
            optIn,
            keccak256(
                abi.encode(
                    EIP712_DOMAIN_TYPEHASH,
                    keccak256("Dummy"),
                    keccak256("1"),
                    _getChainId(),
                    address(this)
                )
            )
        )
    {}

    function verifyBoost(
        address from,
        string calldata a,
        string calldata b,
        BoosterPayload calldata payload,
        Signature calldata signature
    ) external {
        bytes32 messageHash = keccak256(
            abi.encode(
                a,
                b,
                payload.nonce,
                msg.sender // The signature must be intended for `msg.sender`
            )
        )
            .toEthSignedMessageHash();

        super.verifyBoost(from, messageHash, payload, signature);
    }

    function verifyBoostWithoutNonce(
        address from,
        string calldata a,
        string calldata b,
        BoosterPayload calldata payload,
        Signature calldata signature
    ) external view {
        bytes32 messageHash = keccak256(
            abi.encode(
                a,
                b,
                payload.nonce,
                msg.sender // The signature must be intended for `msg.sender`
            )
        )
            .toEthSignedMessageHash();

        super._verifyBoostWithoutNonce(from, messageHash, payload, signature);
    }

    // Expose internal functions related to pending ops

    function nextOpId(address account) external returns (uint64) {
        return _getNextOpId(account);
    }

    function createOpHandle(address account, uint8 opType) external {
        IOptIn.OptInStatus memory optInStatus = _OPT_IN.getOptInStatus({
            account: account
        });

        _createNewOpHandle(optInStatus, account, opType);
    }

    function deleteOpHandle(address account, OpHandle memory opHandle)
        external
    {
        return _deleteOpHandle(account, opHandle);
    }

    function assertCanFinalize(address account, OpHandle memory opHandle)
        external
    {
        _assertCanFinalize(account, opHandle);
    }

    function assertCanRevert(
        address account,
        OpHandle memory opHandle,
        bytes memory boosterMessage,
        Signature memory signature
    ) external {
        OpMetadata storage metadata = _opMetadata[_getOpKey(
            account,
            opHandle.opId
        )];
        _assertCanRevert(
            account,
            opHandle,
            metadata.createdAt,
            boosterMessage,
            signature
        );
    }

    function addHasherContract(address hasher) public {
        _hasherContracts.push(hasher);
    }

    function _getHasherContracts()
        internal
        override
        returns (address[] memory)
    {
        return _hasherContracts;
    }
}
