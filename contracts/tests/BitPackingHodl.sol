// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../HodlLib.sol";

contract BitPackingHodl {
    uint256 private constant MAX_UINT256 = 2**256 - 1;
    uint96 private constant MAX_UINT96 = 2**96 - 1;
    uint64 private constant MAX_UINT64 = 2**64 - 1;
    uint32 private constant MAX_UINT31 = 2**31 - 1;
    uint24 private constant MAX_UINT20 = 2**20 - 1;
    uint16 private constant MAX_UINT9 = 2**9 - 1;

    function testUnpackPackedData() public pure {
        HodlLib.UnpackedHodlItem memory unpacked;

        // Test highest id only
        unpacked = HodlLib.unpackHodlItem(MAX_UINT20);
        require(unpacked.id == MAX_UINT20, "unexpected hodl id 1");
        require(unpacked.duration == 0, "unexpected hodl duration 1");

        // Test highest duration only
        unpacked = HodlLib.unpackHodlItem(uint256(MAX_UINT9) << 20);
        require(unpacked.id == 0, "unexpected hodl id 2");
        require(unpacked.duration == MAX_UINT9, "unexpected hodl duration 2");
        require(
            unpacked.lastWithdrawal == 0,
            "unexpected hodl last withdrawal 2"
        );

        // Test highest last withdrawal only
        unpacked = HodlLib.unpackHodlItem(uint256(MAX_UINT31) << 29);
        require(unpacked.id == 0, "unexpected hodl id 3");
        require(unpacked.duration == 0, "unexpected hodl duration 3");
        require(
            unpacked.lastWithdrawal == MAX_UINT31,
            "unexpected hodl last withdrawal 3"
        );
        require(
            unpacked.flags.hasDifferentCreator == false,
            "unexpected hodl creator flag 3"
        );
        require(
            unpacked.flags.hasDifferentDubiBeneficiary == false,
            "unexpected hodl dubi beneficiary flag 3"
        );
        require(
            unpacked.flags.hasDependentHodlOp == false,
            "unexpected hodl dependent hodl flag 3"
        );
        require(
            unpacked.flags.hasPendingLockedPrps == false,
            "unexpected hodl pending flag 3"
        );

        // Test creator flag only
        unpacked = HodlLib.unpackHodlItem(1 << 60);
        require(unpacked.id == 0, "unexpected hodl id 4");
        require(unpacked.duration == 0, "unexpected hodl duration 4");
        require(
            unpacked.lastWithdrawal == 0,
            "unexpected hodl last withdrawal 4"
        );
        require(
            unpacked.flags.hasDifferentCreator == true,
            "unexpected hodl creator flag 4"
        );
        require(
            unpacked.flags.hasDifferentDubiBeneficiary == false,
            "unexpected hodl dubi beneficiary flag 4"
        );
        require(
            unpacked.flags.hasDependentHodlOp == false,
            "unexpected hodl dependent hodl flag 4"
        );
        require(
            unpacked.flags.hasPendingLockedPrps == false,
            "unexpected hodl pending flag 4"
        );

        // Test hasDifferentDubiBeneficiary flag only
        unpacked = HodlLib.unpackHodlItem(1 << 61);
        require(unpacked.id == 0, "unexpected hodl id 5");
        require(unpacked.duration == 0, "unexpected hodl duration 5");
        require(
            unpacked.lastWithdrawal == 0,
            "unexpected hodl last withdrawal 5"
        );
        require(
            unpacked.flags.hasDifferentCreator == false,
            "unexpected hodl creator flag 5"
        );
        require(
            unpacked.flags.hasDifferentDubiBeneficiary == true,
            "unexpected hodl dubi beneficiary flag 5"
        );
        require(
            unpacked.flags.hasDependentHodlOp == false,
            "unexpected hodl dependent hodl flag 5"
        );
        require(
            unpacked.flags.hasPendingLockedPrps == false,
            "unexpected hodl pending flag 5"
        );

        // Test hasDependentHodlOp flag only
        unpacked = HodlLib.unpackHodlItem(1 << 62);
        require(unpacked.id == 0, "unexpected hodl id 6");
        require(unpacked.duration == 0, "unexpected hodl duration 6");
        require(
            unpacked.lastWithdrawal == 0,
            "unexpected hodl last withdrawal 6"
        );
        require(
            unpacked.flags.hasDifferentCreator == false,
            "unexpected hodl creator flag 6"
        );
        require(
            unpacked.flags.hasDifferentDubiBeneficiary == false,
            "unexpected hodl dubi beneficiary flag 6"
        );
        require(
            unpacked.flags.hasDependentHodlOp = true,
            "unexpected hodl dependent hodl flag 6"
        );
        require(
            unpacked.flags.hasPendingLockedPrps == false,
            "unexpected hodl pending flag 6"
        );

        // Test hasPendingLockedPrps flag only
        unpacked = HodlLib.unpackHodlItem(1 << 63);
        require(unpacked.id == 0, "unexpected hodl id 8");
        require(unpacked.duration == 0, "unexpected hodl duration 7");
        require(
            unpacked.lastWithdrawal == 0,
            "unexpected hodl last withdrawal 7"
        );
        require(
            unpacked.flags.hasDifferentCreator == false,
            "unexpected hodl creator flag 7"
        );
        require(
            unpacked.flags.hasDifferentDubiBeneficiary == false,
            "unexpected hodl dubi beneficiary flag 7"
        );
        require(
            unpacked.flags.hasDependentHodlOp == false,
            "unexpected hodl dependent hodl flag 7"
        );
        require(
            unpacked.flags.hasPendingLockedPrps == true,
            "unexpected hodl pending flag 7"
        );
        require(unpacked.lockedPrps == 0, "unexpected hodl locked PRPS 7");

        // Test highest locked PRPS
        unpacked = HodlLib.unpackHodlItem(uint256(MAX_UINT96) << 64);
        require(unpacked.id == 0, "unexpected hodl id 8");
        require(unpacked.duration == 0, "unexpected hodl duration 8");
        require(
            unpacked.lastWithdrawal == 0,
            "unexpected hodl last withdrawal 8"
        );
        require(
            unpacked.flags.hasDifferentCreator == false,
            "unexpected hodl creator flag 8"
        );
        require(
            unpacked.flags.hasDifferentDubiBeneficiary == false,
            "unexpected hodl dubi beneficiary flag 8"
        );
        require(
            unpacked.flags.hasDependentHodlOp == false,
            "unexpected hodl dependent hodl flag 8"
        );
        require(
            unpacked.flags.hasPendingLockedPrps == false,
            "unexpected hodl pending flag 8"
        );
        require(
            unpacked.lockedPrps == MAX_UINT96,
            "unexpected hodl locked PRPS 8"
        );
        require(
            unpacked.burnedLockedPrps == 0,
            "unexpected hodl burned locked PRPS 8"
        );

        // Test highest burned locked PRPS
        unpacked = HodlLib.unpackHodlItem(uint256(MAX_UINT96) << 160);
        require(unpacked.id == 0, "unexpected hodl id 9");
        require(unpacked.duration == 0, "unexpected hodl duration 9");
        require(
            unpacked.lastWithdrawal == 0,
            "unexpected hodl last withdrawal 9"
        );
        require(
            unpacked.flags.hasDifferentCreator == false,
            "unexpected hodl creator flag 9"
        );
        require(
            unpacked.flags.hasDifferentDubiBeneficiary == false,
            "unexpected hodl dubi beneficiary flag 9"
        );
        require(
            unpacked.flags.hasDependentHodlOp == false,
            "unexpected hodl dependent hodl flag 9"
        );
        require(
            unpacked.flags.hasPendingLockedPrps == false,
            "unexpected hodl pending flag 9"
        );
        require(unpacked.lockedPrps == 0, "unexpected hodl locked PRPS 9");
        require(
            unpacked.burnedLockedPrps == MAX_UINT96,
            "unexpected hodl burned locked PRPS 9"
        );
    }

    function testPackUnpackedData() public pure {
        // Test highest id
        HodlLib.UnpackedHodlItem memory unpacked1;
        unpacked1.id = MAX_UINT20;
        uint256 packedData = HodlLib.packHodlItem(unpacked1);
        require(packedData == uint256(MAX_UINT20), "unexpected packedData 1");

        // Test highest duration
        HodlLib.UnpackedHodlItem memory unpacked2;
        unpacked2.duration = MAX_UINT9;
        packedData = HodlLib.packHodlItem(unpacked2);
        require(
            packedData == uint256(MAX_UINT9) << 20,
            "unexpected packedData 2"
        );

        // Test highest last withdrawal
        HodlLib.UnpackedHodlItem memory unpacked3;
        unpacked3.lastWithdrawal = MAX_UINT31;
        packedData = HodlLib.packHodlItem(unpacked3);
        require(
            packedData == uint256(MAX_UINT31) << 29,
            "unexpected packedData 3"
        );

        // Test hasDifferentCreator
        HodlLib.UnpackedHodlItem memory unpacked4;
        unpacked4.flags.hasDifferentCreator = true;
        packedData = HodlLib.packHodlItem(unpacked4);
        require(packedData == 1 << 60, "unexpected packedData 4");

        // Test hasDifferentCreator
        HodlLib.UnpackedHodlItem memory unpacked5;
        unpacked5.flags.hasDifferentDubiBeneficiary = true;
        packedData = HodlLib.packHodlItem(unpacked5);
        require(packedData == 1 << 61, "unexpected packedData 5");

        // Test hasDifferentCreator
        HodlLib.UnpackedHodlItem memory unpacked6;
        unpacked6.flags.hasDependentHodlOp = true;
        packedData = HodlLib.packHodlItem(unpacked6);
        require(packedData == 1 << 62, "unexpected packedData 6");

        // Test hasDifferentCreator
        HodlLib.UnpackedHodlItem memory unpacked7;
        unpacked7.flags.hasPendingLockedPrps = true;
        packedData = HodlLib.packHodlItem(unpacked7);
        require(packedData == 1 << 63, "unexpected packedData 7");

        // Test lockedPRPS
        HodlLib.UnpackedHodlItem memory unpacked8;
        unpacked8.lockedPrps = MAX_UINT96;
        packedData = HodlLib.packHodlItem(unpacked8);
        require(
            packedData == uint256(MAX_UINT96) << 64,
            "unexpected packedData 8"
        );

        // Test burnedLockedPrps
        HodlLib.UnpackedHodlItem memory unpacked9;
        unpacked9.burnedLockedPrps = MAX_UINT96;
        packedData = HodlLib.packHodlItem(unpacked9);
        require(
            packedData == uint256(MAX_UINT96) << 160,
            "unexpected packedData 9"
        );
    }
}
