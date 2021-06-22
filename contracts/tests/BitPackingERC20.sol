// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../ERC20.sol";

contract BitPackingERC20 is ERC20 {
    uint256 private constant MAX_UINT256 = 2**256 - 1;
    uint96 private constant MAX_UINT96 = 2**96 - 1;
    uint64 private constant MAX_UINT64 = 2**64 - 1;

    constructor()
        public
        ERC20(
            "BitPackingERC20",
            "ERC20",
            address(0),
            address(0),
            address(0),
            address(0),
            address(0)
        )
    {}

    function testPackUnpackedData() public pure {
        UnpackedData memory unpacked;

        // Test highest balance only
        unpacked = _unpackPackedData(MAX_UINT96);
        require(unpacked.balance == MAX_UINT96, "unexpected balance 1");
        require(unpacked.hodlBalance == 0, "unexpected hodlBalance 1");
        require(unpacked.nonce == 0, "unexpected nonce 1");

        // Test highest hodlBalance only
        unpacked = _unpackPackedData(uint256(MAX_UINT96) << 96);
        require(unpacked.balance == 0, "unexpected balance 2");
        require(unpacked.hodlBalance == MAX_UINT96, "unexpected hodlBalance 2");
        require(unpacked.nonce == 0, "unexpected nonce 2");

        // Test highest nonce only
        unpacked = _unpackPackedData(uint256(MAX_UINT64) << 192);
        require(unpacked.balance == 0, "unexpected balance 3");
        require(unpacked.hodlBalance == 0, "unexpected hodlBalance 3");
        require(unpacked.nonce == MAX_UINT64, "unexpected nonce 3");

        // Test all bits set
        unpacked = _unpackPackedData(MAX_UINT256);
        require(unpacked.balance == MAX_UINT96, "unexpected balance 4");
        require(unpacked.hodlBalance == MAX_UINT96, "unexpected hodlBalance 4");
        require(unpacked.nonce == MAX_UINT64, "unexpected nonce 4");
    }

    function testUnpackPackedData() public pure {
        UnpackedData memory unpacked;

        // Test highest balance only
        unpacked.balance = MAX_UINT96;

        uint256 packedData = _packUnpackedData(unpacked);
        require(packedData == uint256(MAX_UINT96), "unexpected packedData 1");

        // Test highest hodlBalance only
        unpacked.balance = 0;
        unpacked.hodlBalance = MAX_UINT96;
        packedData = _packUnpackedData(unpacked);
        require(
            packedData == uint256(MAX_UINT96) << 96,
            "unexpected packedData 2"
        );

        // Test highest nonce only
        unpacked.hodlBalance = 0;
        unpacked.nonce = MAX_UINT64;
        packedData = _packUnpackedData(unpacked);
        require(
            packedData == uint256(MAX_UINT64) << 192,
            "unexpected packedData 3"
        );

        // Test all bits set
        unpacked.balance = MAX_UINT96;
        unpacked.hodlBalance = MAX_UINT96;
        unpacked.nonce = MAX_UINT64;
        packedData = _packUnpackedData(unpacked);
        require(packedData == MAX_UINT256, "unexpected packedData 4");
    }

    function _getHasherContracts()
        internal
        override
        returns (address[] memory)
    {
        return new address[](0);
    }

    function _burnBoostedSendFuel(
        address from,
        BoosterFuel memory fuel,
        UnpackedData memory unpacked
    ) internal override returns (FuelBurn memory) {}

    function _burnBoostedBurnFuel(
        address from,
        BoosterFuel memory fuel,
        UnpackedData memory unpacked
    ) internal override returns (FuelBurn memory) {}
}
