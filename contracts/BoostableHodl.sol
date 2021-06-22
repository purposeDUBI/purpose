// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./Boostable.sol";

/**
 * @dev EIP712 boostable primitives related to Hodl for the Purpose domain
 */
abstract contract BoostableHodl is Boostable {
    /**
     * @dev A struct representing the payload of the `boostedHodl` function.
     */
    struct BoostedHodl {
        uint8 tag;
        uint24 hodlId;
        uint96 amountPrps;
        uint16 duration;
        address dubiBeneficiary;
        address prpsBeneficiary;
        address creator;
        BoosterFuel fuel;
        BoosterPayload boosterPayload;
    }

    /**
     * @dev A struct representing the payload of the `boostedRelease` function.
     */
    struct BoostedRelease {
        uint8 tag;
        uint24 id;
        address creator;
        address prpsBeneficiary;
        BoosterFuel fuel;
        BoosterPayload boosterPayload;
    }

    /**
     * @dev A struct representing the payload of the `boostedWithdrawal` function.
     */
    struct BoostedWithdrawal {
        uint8 tag;
        uint24 id;
        address creator;
        address prpsBeneficiary;
        BoosterFuel fuel;
        BoosterPayload boosterPayload;
    }

    uint8 internal constant BOOST_TAG_HODL = 2;
    uint8 internal constant BOOST_TAG_RELEASE = 3;
    uint8 internal constant BOOST_TAG_WITHDRAWAL = 4;

    bytes32 internal constant BOOSTED_HODL_TYPEHASH = keccak256(
        "BoostedHodl(uint8 tag,uint24 hodlId,uint96 amountPrps,uint16 duration,address dubiBeneficiary,address prpsBeneficiary,address creator,BoosterFuel fuel,BoosterPayload boosterPayload)BoosterFuel(uint96 dubi,uint96 unlockedPrps,uint96 lockedPrps,uint96 intrinsicFuel)BoosterPayload(address booster,uint64 timestamp,uint64 nonce,bool isLegacySignature)"
    );

    bytes32 internal constant BOOSTED_RELEASE_TYPEHASH = keccak256(
        "BoostedRelease(uint8 tag,uint24 id,address creator,address prpsBeneficiary,BoosterFuel fuel,BoosterPayload boosterPayload)BoosterFuel(uint96 dubi,uint96 unlockedPrps,uint96 lockedPrps,uint96 intrinsicFuel)BoosterPayload(address booster,uint64 timestamp,uint64 nonce,bool isLegacySignature)"
    );

    bytes32 internal constant BOOSTED_WITHDRAWAL_TYPEHASH = keccak256(
        "BoostedWithdrawal(uint8 tag,uint24 id,address creator,address prpsBeneficiary,BoosterFuel fuel,BoosterPayload boosterPayload)BoosterFuel(uint96 dubi,uint96 unlockedPrps,uint96 lockedPrps,uint96 intrinsicFuel)BoosterPayload(address booster,uint64 timestamp,uint64 nonce,bool isLegacySignature)"
    );

    constructor(address optIn) public Boostable(optIn) {}

    /**
     * @dev Returns the hash of `boostedHodl`.
     */
    function hashBoostedHodl(BoostedHodl memory hodl, address booster)
        internal
        view
        returns (bytes32)
    {
        return
            BoostableLib.hashWithDomainSeparator(
                _DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        BOOSTED_HODL_TYPEHASH,
                        BOOST_TAG_HODL,
                        hodl.hodlId,
                        hodl.amountPrps,
                        hodl.duration,
                        hodl.dubiBeneficiary,
                        hodl.prpsBeneficiary,
                        hodl.creator,
                        BoostableLib.hashBoosterFuel(hodl.fuel),
                        BoostableLib.hashBoosterPayload(
                            hodl.boosterPayload,
                            booster
                        )
                    )
                )
            );
    }

    /**
     * @dev Returns the hash of `boostedRelease`.
     */
    function hashBoostedRelease(BoostedRelease memory release, address booster)
        internal
        view
        returns (bytes32)
    {
        return
            BoostableLib.hashWithDomainSeparator(
                _DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        BOOSTED_RELEASE_TYPEHASH,
                        BOOST_TAG_RELEASE,
                        release.id,
                        release.creator,
                        release.prpsBeneficiary,
                        BoostableLib.hashBoosterFuel(release.fuel),
                        BoostableLib.hashBoosterPayload(
                            release.boosterPayload,
                            booster
                        )
                    )
                )
            );
    }

    /**
     * @dev Returns the hash of `boostedWithdrawal`.
     */
    function hashBoostedWithdrawal(
        BoostedWithdrawal memory withdrawal,
        address booster
    ) internal view returns (bytes32) {
        return
            BoostableLib.hashWithDomainSeparator(
                _DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        BOOSTED_WITHDRAWAL_TYPEHASH,
                        BOOST_TAG_WITHDRAWAL,
                        withdrawal.id,
                        withdrawal.creator,
                        withdrawal.prpsBeneficiary,
                        BoostableLib.hashBoosterFuel(withdrawal.fuel),
                        BoostableLib.hashBoosterPayload(
                            withdrawal.boosterPayload,
                            booster
                        )
                    )
                )
            );
    }

    /**
     * @dev Tries to interpret the given boosterMessage and
     * return it's hash plus creation timestamp.
     */
    function decodeAndHashBoosterMessage(
        address targetBooster,
        bytes memory boosterMessage
    ) external override view returns (bytes32, uint64) {
        require(boosterMessage.length > 0, "PB-7");

        uint8 tag = _readBoosterTag(boosterMessage);
        if (tag == BOOST_TAG_HODL) {
            BoostedHodl memory hodl = abi.decode(boosterMessage, (BoostedHodl));
            return (
                hashBoostedHodl(hodl, targetBooster),
                hodl.boosterPayload.timestamp
            );
        }

        if (tag == BOOST_TAG_RELEASE) {
            BoostedRelease memory release = abi.decode(
                boosterMessage,
                (BoostedRelease)
            );
            return (
                hashBoostedRelease(release, targetBooster),
                release.boosterPayload.timestamp
            );
        }

        if (tag == BOOST_TAG_WITHDRAWAL) {
            BoostedWithdrawal memory withdrawal = abi.decode(
                boosterMessage,
                (BoostedWithdrawal)
            );
            return (
                hashBoostedWithdrawal(withdrawal, targetBooster),
                withdrawal.boosterPayload.timestamp
            );
        }

        // Unknown tag, so just return an empty result
        return ("", 0);
    }
}
