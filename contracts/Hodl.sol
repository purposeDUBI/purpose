// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IHodl.sol";
import "./HodlLib.sol";
import "./Dubi.sol";
import "./Purpose.sol";
import "./BoostableHodl.sol";
import "./MintMath.sol";

/**
 * @dev Hodl contract
 *
 * Supports Booster via:
 * - boostedHodl(Batch)
 * - boostedRelease(Batch)
 * - boostedWithdrawal(Batch)
 *
 * Hodls are always stored on the PRPS beneficiary while the hodl id comes from the
 * creator's counter.
 *
 * There are certain restrictions on hodls, releases and withdrawals. Depending on the
 * opt-in status of the respective beneficiary.
 *
 * Hodl
 * -----------------
 * - opt-in status of DUBI beneficiary doesn't matter for hodl
 *
 * Creator or PRPS beneficiary is opted-in:
 * - must be queued when non-boosted and both must be opted-in to the same booster
 *
 * Neither is opted-in:
 * - fine to hodl without queue
 *
 * Release
 * -----------------
 * PRPS beneficiary is opted-in:
 * - only the PRPS beneficiary can release (applies to boosted and non-boosted)
 *
 * PRPS beneficiary is opted-out:
 * - anyone can release, even if caller is opted-in - the release is not queued
 *
 * Withdrawal
 * -----------------
 * Only the DUBI beneficiary and his respective booster can withdraw
 *
 */

contract Hodl is IHodl, BoostableHodl, Ownable {
    using SafeMath for uint256;
    using SafeMath for uint128;
    using SafeMath for uint64;

    /**
     * @dev Mapping of address to hodl items.
     */
    mapping(address => HodlLib.PackedHodlItem[]) private _hodlsByAddress;

    Purpose private immutable _prps;
    Dubi private immutable _dubi;
    address private immutable _externalAddress1;
    address private immutable _externalAddress2;

    //---------------------------------------------------------------
    // State for pending ops
    //---------------------------------------------------------------
    uint8 internal constant OP_TYPE_HODL = BOOST_TAG_HODL;
    uint8 internal constant OP_TYPE_RELEASE = BOOST_TAG_RELEASE;
    uint8 internal constant OP_TYPE_WITHDRAWAL = BOOST_TAG_WITHDRAWAL;

    // A mapping of hash(user, opId) to pending ops.
    mapping(bytes32 => HodlLib.PendingHodl) private _pendingHodls;
    mapping(bytes32 => HodlLib.PendingRelease) private _pendingReleases;
    mapping(bytes32 => HodlLib.PendingWithdrawal) private _pendingWithdrawals;

    //---------------------------------------------------------------

    modifier onlyPurpose() {
        require(msg.sender == address(_prps), "H-1");
        _;
    }

    constructor(
        address optIn,
        address prps,
        address dubi,
        address externalAddress1,
        address externalAddress2
    ) public BoostableHodl(optIn) {
        _prps = Purpose(prps);
        _dubi = Dubi(dubi);

        _externalAddress1 = externalAddress1;
        _externalAddress2 = externalAddress2;
    }

    /**
     * @dev Get a hodl item by `id`. If the id doesn't exist (e.g. got released), a default item is returned.
     * The caller should therefore check the id of the returned item. Any non-zero value means
     * the item exists.
     */
    function getHodl(
        uint32 id,
        address prpsBeneficiary,
        address creator
    ) public view returns (HodlLib.PrettyHodlItem memory) {

            HodlLib.PackedHodlItem[] storage _hodls
         = _hodlsByAddress[prpsBeneficiary];
        for (uint256 i = 0; i < _hodls.length; i++) {
            HodlLib.PackedHodlItem storage _packed = _hodls[i];
            HodlLib.UnpackedHodlItem memory _unpacked = HodlLib.unpackHodlItem(
                _packed.packedData
            );

            address _creator = _getCreatorFromUnpacked(
                prpsBeneficiary,
                _packed,
                _unpacked
            );

            if (_unpacked.id == id && _creator == creator) {
                address _dubiBeneficiary = _getDubiBeneficiary(
                    prpsBeneficiary,
                    _packed,
                    _unpacked
                );

                HodlLib.PrettyHodlItem memory pretty;
                pretty.id = _unpacked.id;
                pretty.duration = _unpacked.duration;
                pretty.flags = _unpacked.flags;
                pretty.lastWithdrawal = _unpacked.lastWithdrawal;
                pretty.lockedPrps = _unpacked.lockedPrps;
                pretty.burnedLockedPrps = _unpacked.burnedLockedPrps;
                pretty.creator = creator;
                pretty.dubiBeneficiary = _dubiBeneficiary;
                pretty.pendingLockedPrps = _packed.pendingLockedPrps;
                return pretty;
            }
        }

        HodlLib.PrettyHodlItem memory pretty;
        return pretty;
    }

    /**
     * @dev Lock the given amount of PRPS for the specified period (or infinitely)
     * for DUBI.
     */
    function hodl(
        uint24 hodlId,
        uint96 amountPrps,
        uint16 duration,
        address dubiBeneficiary,
        address prpsBeneficiary
    ) external override {
        (
            bool pendingHodl,
            IOptIn.OptInStatus memory optInStatusCreator
        ) = _checkIfShouldCreatePendingHodl(prpsBeneficiary);
        if (pendingHodl) {
            _createPendingHodl(
                hodlId,
                amountPrps,
                duration,
                dubiBeneficiary,
                prpsBeneficiary,
                optInStatusCreator
            );

            return;
        }

        // Otherwise, hodl immediately
        _hodl(
            hodlId,
            msg.sender,
            amountPrps,
            duration,
            dubiBeneficiary,
            prpsBeneficiary,
            0
        );
    }

    /**
     * @dev Perform multiple `boostedHodl` calls in a single transaction.
     *
     * NOTE: Booster extension
     */
    function boostedHodlBatch(
        BoostedHodl[] memory hodls,
        Signature[] memory signatures
    ) external {
        require(hodls.length > 0 && hodls.length == signatures.length, "H-3");

        for (uint256 i = 0; i < hodls.length; i++) {
            boostedHodl(hodls[i], signatures[i]);
        }
    }

    /**
     * @dev Lock the given amount of PRPS from `creator` of the hodl for the specified period (or infinitely)
     * to get DUBI.
     *
     * Does not require a nonce.
     *
     * NOTE: Booster extension
     *
     */
    function boostedHodl(BoostedHodl memory message, Signature memory signature)
        public
    {
        // We do not use a nonce to invalidate the signature for hodls, but solely rely on the
        // expiry. Given that a hodl id cannot be reused while it exists, it is reasonably safe
        // to do so.
        _verifyBoostWithoutNonce(
            message.creator,
            hashBoostedHodl(message, msg.sender),
            message.boosterPayload,
            signature
        );

        // Burn the fuel. Depending on the fuel, we may take it from the PRPS that gets hodled or
        // the DUBI that gets minted. The returned `directFuel` is zero for every fuel other than the
        // aforementioned types. The lower 96 bits store the minted DUBI fuel while the upper 96
        // bits the PRPS fuel. They are mutual exclusive.
        uint192 directFuel = _burnBoostedHodlFuel(
            message.creator,
            message.fuel
        );

        _hodl(
            message.hodlId,
            message.creator,
            message.amountPrps,
            message.duration,
            message.dubiBeneficiary,
            message.prpsBeneficiary,
            directFuel
        );
    }

    /**
     * @dev Lock the given amount of PRPS for the specified period (or infinitely)
     * for DUBI.
     *
     * The lock duration is given in seconds where the maximum is `31536000` seconds (365 days) after
     * which the PRPS becomes releasable again.
     *
     * A lock duration of '0' has a special meaning and is used to lock PRPS infinitely,
     * without being able to unlock it ever again.
     *
     * DUBI minting:
     * - If locking PRPS finitely, the caller immediately receives DUBI proportionally to the
     * duration of the hodl and the amount of PRPS.
     *
     * If locking for the maximum duration of 365 days (or infinitely), the caller gets
     * 4% of the hodled PRPS worth of DUBI.
     *
     * Additionally, `withdraw` can be called with a hodl id that corresponds to a permanent
     * lock and the beneficiary receives DUBI based on the passed time since the
     * last `withdraw`.
     *
     * In both cases - whether locking infinitely or finitely - the maximum amount of DUBI per
     * year one can mint is equal to 4% of the hodled PRPS. DUBI from infinitely locked PRPS
     * is simply available earlier.
     */
    function _hodl(
        uint24 hodlId,
        address creator,
        uint96 amountPrps,
        uint16 duration,
        address dubiBeneficiary,
        address prpsBeneficiary,
        uint192 directFuel
    ) private {
        uint96 unlockedPrpsFuel = uint96(directFuel >> 96);
        if (unlockedPrpsFuel > 0) {
            require(amountPrps >= unlockedPrpsFuel, "H-4-1");
            amountPrps -= unlockedPrpsFuel;
        }

        // Prepare hodl. Reverts if input is invalid.
        (
            uint96 dubiToMint,
            HodlLib.PackedHodlItem[] storage hodls
        ) = _prepareHodl({
            hodlId: hodlId,
            creator: creator,
            amountPrps: amountPrps,
            duration: duration,
            dubiBeneficiary: dubiBeneficiary,
            prpsBeneficiary: prpsBeneficiary
        });

        // Update hodl balance of beneficiary by calling into the PRPS contract.
        _prps.increaseHodlBalance(creator, prpsBeneficiary, amountPrps);

        HodlLib.PackedHodlItem memory _packed;

        HodlLib.UnpackedHodlItem memory _unpacked;
        _unpacked.id = hodlId;
        _unpacked.duration = duration;
        _unpacked.lockedPrps = amountPrps;
        _unpacked.lastWithdrawal = uint32(block.timestamp);

        // Rare case
        if (creator != prpsBeneficiary) {
            _packed.creator = creator;
            _unpacked.flags.hasDifferentCreator = true;
        }

        // Rare case
        if (dubiBeneficiary != prpsBeneficiary) {
            _packed.dubiBeneficiary = dubiBeneficiary;
            _unpacked.flags.hasDifferentDubiBeneficiary = true;
        }

        // Write to storage and mint DUBI
        _packed.packedData = HodlLib.packHodlItem(_unpacked);
        hodls.push(_packed);

        uint96 dubiMintFuel = uint96(directFuel);
        if (dubiMintFuel > 0) {
            require(dubiToMint >= dubiMintFuel, "H-4-2");
            dubiToMint -= dubiMintFuel;
        }

        _dubi.hodlMint(dubiBeneficiary, dubiToMint);
    }

    /**
     * @dev Prepare a hodl.
     * Returns the amount of DUBI to mint and a reference to the packed hodl items
     * of the beneficiary to get rid of an unncessary read.
     */
    function _prepareHodl(
        uint24 hodlId,
        address creator,
        uint96 amountPrps,
        uint16 duration,
        address dubiBeneficiary,
        address prpsBeneficiary
    ) private view returns (uint96, HodlLib.PackedHodlItem[] storage) {
        HodlLib.PackedHodlItem[] storage hodls = _assertCanHodl(
            hodlId,
            creator,
            amountPrps,
            duration,
            dubiBeneficiary,
            prpsBeneficiary
        );

        // Calculate release time. If `duration` is 0,
        // then the PRPS is locked infinitely.
        uint96 _dubiToMint;

        // Calculate the release time and DUBI to mint.
        // When locking finitely, it is based on the actual duration.
        // When locking infinitely, a full year is minted up front.
        if (duration > 0) {
            _dubiToMint = MintMath.calculateDubiToMintByDays(
                amountPrps,
                duration
            );
        } else {
            _dubiToMint = MintMath.calculateDubiToMintMax(amountPrps);
        }

        require(_dubiToMint > 0, "H-5");
        return (_dubiToMint, hodls);
    }

    /**
     * @dev Release a hodl of `prpsBeneficiary` with the given `creator` and `id`.
     *
     * Any caller can withdraw as long as the `prpsBeneficiary` is not opted-in.
     * If the `prpsBeneficiary` is opted-in, then only the beneficiary itself can release it.
     */
    function release(
        uint24 id,
        address prpsBeneficiary,
        address creator
    ) external override {
        (
            HodlLib.PackedHodlItem storage packed,
            HodlLib.UnpackedHodlItem memory unpacked,
            uint256 index
        ) = _safeGetHodl(id, prpsBeneficiary, creator);

        IOptIn.OptInStatus memory optInStatus = getOptInStatus(prpsBeneficiary);

        if (optInStatus.isOptedIn && optInStatus.permaBoostActive) {
            require(msg.sender == prpsBeneficiary, "H-6");
        }

        _release({
            packed: packed,
            unpacked: unpacked,
            hodlIndex: index,
            prpsBeneficiary: prpsBeneficiary,
            optInStatus: optInStatus,
            directFuel: 0
        });
    }

    /**
     * @dev Perform multiple `boostedRelease` calls in a single transaction.
     *
     * NOTE: Booster extension
     */
    function boostedReleaseBatch(
        BoostedRelease[] memory messages,
        Signature[] memory signatures
    ) external {
        require(
            messages.length > 0 && messages.length == signatures.length,
            "H-3"
        );

        for (uint256 i = 0; i < messages.length; i++) {
            boostedRelease(messages[i], signatures[i]);
        }
    }

    /**
     * @dev Release a hodl with the given id.
     *
     * Requirements:
     *
     * - the signature must be from the PRPS beneficiary
     * - the caller must be opted-in by the PRPS beneficiary
     *
     * Does not require a nonce.
     *
     * NOTE: Booster extension
     */
    function boostedRelease(
        BoostedRelease memory message,
        // A signature that must have been signed by the `prpsBeneficiary` of the hodl.
        Signature memory signature
    ) public {
        // Similar to boostedHodl, we do not use a nonce here because once released
        // the hodl doesn't exist anymore. Thus relying solely on the expiry is more than sufficient.
        _verifyBoostWithoutNonce(
            message.prpsBeneficiary,
            hashBoostedRelease(message, msg.sender),
            message.boosterPayload,
            signature
        );

        IOptIn.OptInStatus memory optInStatus;

        // Burn the fuel. Depending on the fuel, we may take it from the PRPS that gets released.
        // The returned `directFuel` is zero for every fuel other than the aforementioned intrinsic fuel and
        // burned from the beneficiary released PRPS.
        uint96 directFuel = _burnBoostedReleaseFuel(
            message.creator,
            message.fuel
        );

        (
            HodlLib.PackedHodlItem storage packed,
            HodlLib.UnpackedHodlItem memory unpacked,
            uint256 index
        ) = _safeGetHodl(message.id, message.prpsBeneficiary, message.creator);

        _release({
            packed: packed,
            unpacked: unpacked,
            hodlIndex: index,
            prpsBeneficiary: message.prpsBeneficiary, // empty => no pending op
            optInStatus: optInStatus,
            directFuel: directFuel
        });
    }

    /**
     * @dev Perform multiple `boostedWithdraw` calls in a single transaction.
     *
     * NOTE: Booster extension
     */
    function boostedWithdrawBatch(
        BoostedWithdrawal[] memory messages,
        Signature[] memory signatures
    ) external {
        require(
            messages.length > 0 && messages.length == signatures.length,
            "H-3"
        );

        for (uint256 i = 0; i < messages.length; i++) {
            boostedWithdraw(messages[i], signatures[i]);
        }
    }

    /**
     * @dev Withdraw from a hodl with the given id.
     *
     * Requirements:
     *
     * - the signature must be from the DUBI beneficiary
     * - the caller must be opted-in by the DUBI beneficiary
     *
     * Does not require a nonce.
     *
     * NOTE: Booster extension
     */
    function boostedWithdraw(
        BoostedWithdrawal memory message,
        // A signature that must have been signed by the `dubiBeneficiary` of the hodl.
        Signature memory signature
    ) public {
        // Burn the fuel. Depending on the fuel, we may take it from the DUBI that is minted.
        // The returned `directFuel` is zero for every fuel other than the aforementioned intrinsic fuel.
        uint96 directFuel = _burnBoostedWithdrawalFuel(
            message.creator,
            message.fuel
        );

        (
            HodlLib.PackedHodlItem storage packed,
            HodlLib.UnpackedHodlItem memory unpacked,

        ) = _safeGetHodl(message.id, message.prpsBeneficiary, message.creator);

        address dubiBeneficiary = _getDubiBeneficiary(
            message.prpsBeneficiary,
            packed,
            unpacked
        );

        // We do not bother with nonces when withdrawing, since that is always plus EV.
        _verifyBoostWithoutNonce(
            dubiBeneficiary,
            hashBoostedWithdrawal(message, msg.sender),
            message.boosterPayload,
            signature
        );

        _withdrawInternal({
            packed: packed,
            unpacked: unpacked,
            creator: message.creator,
            prpsBeneficiary: message.prpsBeneficiary,
            isBoosted: true,
            directFuel: directFuel
        });
    }

    /**
     * @dev Release a hodl with the given index
     */
    function _release(
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked,
        uint256 hodlIndex,
        address prpsBeneficiary,
        IOptIn.OptInStatus memory optInStatus,
        uint96 directFuel
    ) private {
        require(!_hodlHasDependentOp(unpacked), "H-7");
        require(
            _isHodlExpired(unpacked.lastWithdrawal, unpacked.duration),
            "H-8"
        );

        // Get releasable PRPS, that is locked PRPS - burned PRPS
        // NOTE: a hodl with pending locked PRPS cannot be released, so we don't have
        // to take it into account here.
        assert(unpacked.lockedPrps >= unpacked.burnedLockedPrps);
        uint96 releasablePrps = unpacked.lockedPrps - unpacked.burnedLockedPrps;

        if (optInStatus.isOptedIn && optInStatus.permaBoostActive) {
            require(msg.sender == prpsBeneficiary, "H-6");

            _createPendingRelease(
                packed,
                unpacked,
                prpsBeneficiary,
                releasablePrps,
                optInStatus
            );
            return;
        }

        // Release PRPS immediately
        _releasePrpsAndDeleteHodlByIndex(
            prpsBeneficiary,
            hodlIndex,
            releasablePrps,
            directFuel
        );
    }

    /**
     * @dev Release the PRPS of a hodl and delete it.
     */
    function _releasePrpsAndDeleteHodlByIndex(
        address prpsBeneficiary,
        uint256 hodlIndex,
        uint96 releasablePrps,
        uint96 directFuel
    ) private {
        // NOTE: we already checked before calling this function that `_hodl` has no dependent ops.

        // Delete the hodl, since we already know the index we can:
        // 1) move the last hodl to the index (we dont care about order)
        // 2) pop the last item from the hodls
        // Skip 1) if there is only a single hodl.

        require(releasablePrps >= directFuel, "H-4-3");


            HodlLib.PackedHodlItem[] storage _hodls
         = _hodlsByAddress[prpsBeneficiary];
        uint256 length = _hodls.length;
        if (hodlIndex != length - 1) {
            // Move last item to the position of the to-be-deleted item
            _hodls[hodlIndex] = _hodls[length - 1];
        }
        _hodls.pop();

        // Update the hodl balance by calling into the PRPS contract
        _prps.decreaseHodlBalance({
            from: prpsBeneficiary,
            hodlAmount: releasablePrps,
            refundAmount: releasablePrps - directFuel
        });
    }

    /**
     * @dev Withdraw can be used to withdraw DUBI from infinitely locked PRPS.
     * The amount of DUBI withdrawn depends on the time passed since the last withdrawal.
     *
     * For technical reasons this function requires the creator address and prps beneficiary address
     * to look up the hodl by id.
     *
     * Only the DUBI beneficiary or his respective booster can withdraw.
     */
    function withdraw(
        uint24 id,
        address prpsBeneficiary,
        address creator
    ) external override {
        (
            HodlLib.PackedHodlItem storage packed,
            HodlLib.UnpackedHodlItem memory unpacked,

        ) = _safeGetHodl(id, prpsBeneficiary, creator);

        _withdrawInternal({
            packed: packed,
            unpacked: unpacked,
            prpsBeneficiary: prpsBeneficiary,
            creator: creator,
            isBoosted: false,
            directFuel: 0
        });
    }

    function _withdrawInternal(
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked,
        address prpsBeneficiary,
        address creator,
        bool isBoosted,
        uint96 directFuel
    ) private {
        require(unpacked.duration == 0, "H-9");
        require(!_hodlHasDependentOp(unpacked), "H-10");

        uint32 lastWithdrawal = unpacked.lastWithdrawal;

        address dubiBeneficiary = _getDubiBeneficiary(
            prpsBeneficiary,
            packed,
            unpacked
        );

        // Must be in the past (i.e. less than block timestamp)
        require(lastWithdrawal > 0 && lastWithdrawal < block.timestamp, "H-11");

        // NOTE: safe to assume that this always fits into a uint32 without overflow
        // for the forseeable future.
        uint32 timePassedSinceLastWithdrawal = uint32(
            block.timestamp - lastWithdrawal
        );

        // Take burned and pending PRPS into account
        uint96 lockedPrps = unpacked.lockedPrps - unpacked.burnedLockedPrps;

        if (unpacked.flags.hasPendingLockedPrps) {
            lockedPrps -= packed.pendingLockedPrps;
        }

        assert(lockedPrps > 0 && lockedPrps <= unpacked.lockedPrps);

        // Calculate amount of DUBI based on time passed (in seconds) since last withdrawal.
        // The minted DUBI is guaranteed to be > 0, else the transaction will revert.
        uint96 _dubiToMint = MintMath.calculateDubiToMintBySeconds(
            lockedPrps,
            timePassedSinceLastWithdrawal
        );

        // If withdraw called from a non-boosted function, check if
        // the caller is the beneficiary. Additionally, if he is opted-in
        // we must create a pending withdrawal.
        if (!isBoosted) {
            // Sender must be the beneficiary or the beneficiaries booster itself
            // which is allowed to withdraw without a requiring the beneficiarie's consent.

            IOptIn.OptInStatus memory optInStatus = getOptInStatus(
                dubiBeneficiary
            );

            bool senderIsDubiBeneficiary = msg.sender == dubiBeneficiary;
            bool senderIsBooster = msg.sender == optInStatus.optedInTo;

            require(
                senderIsDubiBeneficiary ||
                    (optInStatus.isOptedIn && senderIsBooster),
                "H-6"
            );

            if (
                optInStatus.permaBoostActive &&
                optInStatus.isOptedIn &&
                !senderIsBooster
            ) {
                _createPendingWithdrawal({
                    packed: packed,
                    unpacked: unpacked,
                    creator: creator,
                    prpsBeneficiary: prpsBeneficiary,
                    dubiBeneficiary: dubiBeneficiary,
                    dubiToMint: _dubiToMint,
                    optInStatus: optInStatus
                });
                return;
            }
        }

        _doWithdraw({
            dubiBeneficiary: dubiBeneficiary,
            packed: packed,
            unpacked: unpacked,
            withdrawalTimestamp: uint32(block.timestamp),
            dubiToMint: _dubiToMint,
            directFuel: directFuel
        });
    }

    function _doWithdraw(
        address dubiBeneficiary,
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked,
        uint32 withdrawalTimestamp,
        uint96 dubiToMint,
        uint96 directFuel
    ) private {
        require(unpacked.lastWithdrawal < withdrawalTimestamp, "H-12");
        require(dubiToMint >= directFuel, "H-4-4");

        dubiToMint -= directFuel;
        require(dubiToMint > 0, "H-13");

        // Write updated hodl item to storage
        unpacked.lastWithdrawal = withdrawalTimestamp;
        packed.packedData = HodlLib.packHodlItem(unpacked);

        // Lastly, mint the DUBI for the beneficiary.
        // NOTE(reentrancy): DUBI has no receive hooks, so the beneficiary cannot attempt reentrancy.
        _dubi.hodlMint(dubiBeneficiary, dubiToMint);
    }

    /**
     * @dev Burn `amount` of the senders locked and/or pending PRPS. A pro-rated amount of DUBI is auto-minted
     * before burning, to make up for an eventual suboptimal timing of the PRPS burn.
     *
     * Whether burning infinitely or finitely locked PRPS, the amount of minted DUBI over the same timespan
     * will be the same.
     *
     * This function is supposed to be only called by the PRPS contract and returns the amount of
     * DUBI that needs to be minted.
     */
    function burnLockedPrps(
        address from,
        uint96 amount,
        uint32 dubiMintTimestamp,
        bool burnPendingLockedPrps
    ) external override onlyPurpose returns (uint96) {
        HodlLib.PackedHodlItem[] storage hodlsSender = _hodlsByAddress[from];

        (uint96 remainingPrpsToBurn, uint96 dubiToMint) = _burnLocked(
            hodlsSender,
            amount,
            dubiMintTimestamp,
            burnPendingLockedPrps
        );

        // Revert if there's still PRPS left to burn
        require(remainingPrpsToBurn == 0, "H-14");

        return dubiToMint;
    }

    function _burnLocked(
        HodlLib.PackedHodlItem[] storage hodlsSender,
        uint96 amount,
        uint32 dubiMintTimestamp,
        bool burnPendingLockedPrps
    ) private returns (uint96, uint96) {
        uint256 dubiToMint;

        // We use an int256 to prevent a positive underflow
        int256 lastIndex = int256(hodlsSender.length - 1);
        for (int256 i = lastIndex; i >= 0; i--) {
            HodlLib.PackedHodlItem storage packed = hodlsSender[uint256(i)];
            HodlLib.UnpackedHodlItem memory unpacked = HodlLib.unpackHodlItem(
                packed.packedData
            );

            if (unpacked.flags.hasDependentHodlOp) {
                // Skip locks that are already occupied due to a pending
                // release or withdraw. However, burning multiple times from the same hodl
                // via separate burn transactions is fine.
                continue;
            }

            if (burnPendingLockedPrps && !unpacked.flags.hasPendingLockedPrps) {
                // Skip locks that have no pending locked PRPS
                continue;
            }

            (uint192 packedBurnHodlAmount, bool deleteHodl) = _burnHodl({
                packed: packed,
                unpacked: unpacked,
                remainingPrpsToBurn: amount,
                burnPendingLockedPrps: burnPendingLockedPrps,
                dubiMintTimestamp: dubiMintTimestamp
            });

            // Delete the hodl if all PRPS got burnt
            if (deleteHodl) {
                // NOTE: we traverse the hodls in reverse, so we can
                // delete `_hodl` by using swap-and-pop.
                // Only move last item to ith position if lastIndex is greater than index,
                // since otherwise there is no need to move.
                if (lastIndex > i) {
                    hodlsSender[uint256(i)] = hodlsSender[uint256(lastIndex)];
                }

                lastIndex -= 1;
                hodlsSender.pop();
            }

            // Calculate the pro-rated amount of DUBI to mint based on the PRPS
            // that gets burned from the locked.
            // The lower 96 bits of 'packedBurnHodlAmount' correspond to the `dubiToMint` amount.
            dubiToMint = dubiToMint.add(uint96(packedBurnHodlAmount));

            // Reduce amount that is left to burn from hodl
            uint96 burnedAmount = uint96(packedBurnHodlAmount >> 96);
            require(amount >= burnedAmount, "H-15");
            amount -= burnedAmount;

            // Stop iterating if we burnt enough PRPS
            if (amount == 0) {
                break;
            }
        }

        return (amount, uint96(dubiToMint));
    }

    /**
     * @dev Burn `remainingPrpsToBurn` from `_hodl`.
     *  Returns the amount of dubi to mint, actual amount of PRPS that could be burned and
     * whether `_hodl` should be deleted or not.
     */
    function _burnHodl(
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked,
        uint96 remainingPrpsToBurn,
        bool burnPendingLockedPrps,
        uint32 dubiMintTimestamp
    )
        private
        returns (
            // NOTE: we return a single uint192 which contains two separate uint96 values
            // to workaround this error: 'CompilerError: Stack too deep, try removing local variables'
            // The upper 96-bits is the 'burnAmount' and the lower part the 'dubiToMint'.
            uint192,
            bool
        )
    {
        bool deleteHodl;

        // Calculate the duration to use when minting DUBI.
        uint32 _mintDuration = _calculateMintDuration(
            unpacked,
            dubiMintTimestamp
        );

        // Remaining PRPS on the lock that can be burned.
        //
        // If called when finalizing a PRPS burn, then only
        // the pending locked PRPS is considered.
        //
        // Otherwise, the PRPS that can be burned is equal to the
        // total locked PRPS - burned locked PRPS - pending locked PRPS.
        uint96 burnablePrpsOnHodl;
        uint96 pendingLockedPrpsOnHodl;
        if (unpacked.flags.hasPendingLockedPrps) {
            pendingLockedPrpsOnHodl = packed.pendingLockedPrps;
        }

        if (burnPendingLockedPrps) {
            burnablePrpsOnHodl = pendingLockedPrpsOnHodl;
            // Sanity check
            assert(burnablePrpsOnHodl > 0);
        } else {
            // Burnable PRPS is equal to locked PRPS - burned locked PRPS - pending locked PRPS
            // NOTE: we don't use safe math because `burnedPrpsOnHodl` + `pendingPrpsOnHodl` is always
            // <= `lockedPprsOnLock`.
            burnablePrpsOnHodl =
                unpacked.lockedPrps -
                unpacked.burnedLockedPrps -
                pendingLockedPrpsOnHodl;

            // Nothing to burn
            if (burnablePrpsOnHodl == 0) {
                return (0, false);
            }
        }

        // Cap burn amount if the remaining PRPS to burn is less.
        uint96 burnAmount = remainingPrpsToBurn;
        if (burnAmount > burnablePrpsOnHodl) {
            burnAmount = burnablePrpsOnHodl;
        }

        // Burn PRPS from lock
        uint96 burnedLockedPrps = unpacked.burnedLockedPrps + burnAmount;

        // Sanity check for over/underflows
        assert(
            unpacked.burnedLockedPrps < burnedLockedPrps &&
                burnedLockedPrps <= unpacked.lockedPrps
        );

        // Delete hodl if all locked PRPS has been burned, otherwise
        // update burned / pending locked PRPS.
        if (burnedLockedPrps < unpacked.lockedPrps) {
            unpacked.burnedLockedPrps = burnedLockedPrps;

            // Remove pending locked PRPS which is equal to `burnAmount` when burning pending PRPS
            if (burnPendingLockedPrps) {
                unpacked.flags.hasPendingLockedPrps =
                    pendingLockedPrpsOnHodl - burnAmount > 0;

                packed.pendingLockedPrps = pendingLockedPrpsOnHodl - burnAmount;
            }

            // Write updated hodl item to storage
            packed.packedData = HodlLib.packHodlItem(unpacked);
        } else {
            deleteHodl = true;
        }

        // Calculate the pro-rated amount of DUBI to mint based on the PRPS
        // that gets burned from the locked.
        uint96 dubiToMint = MintMath.calculateDubiToMintBySeconds(
            burnAmount,
            _mintDuration
        );

        // NOTE: we return a single uint192 which contains two separate uint96 values
        // to workaround this error: 'CompilerError: Stack too deep, try removing local variables'
        // The upper 96-bits is the 'burnAmount' and the lower part the 'dubiToMint'.
        // Also, it is safe to downcast to uint96, because PRPS/DUBI are using 18 decimals.
        uint192 packedResult = uint192(burnAmount) << 96;
        packedResult = packedResult | dubiToMint;
        return (packedResult, deleteHodl);
    }

    /**
     * @dev Calculate the DUBI mint duration for minting DUBI when burning locked PRPS.
     */
    function _calculateMintDuration(
        HodlLib.UnpackedHodlItem memory unpacked,
        uint32 dubiMintTimestamp
    ) private pure returns (uint32) {
        uint32 lastWithdrawal = unpacked.lastWithdrawal;
        uint16 durationInDays = unpacked.duration;

        // Offset the lastWithdrawal time for finite locks that have not been locked for the full duration
        // to account for otherwise missed-out DUBI, since the mint duration is pro-rated based on the max
        // lock duration possible.
        //
        // Example:
        // If locking for 3 months (=1%) and then burning after 2 months, he would only get 2+3 months
        // worth of DUBI.
        // If he had locked for 12 months (=4%) and then burned after 2 months, he would
        // have gotten 14 months worth of DUBI.
        //
        // To fix this, subtract the difference of actual lock duration and max lock duration from the
        // lastWithdrawal time.
        //
        // Examples with applied offset:
        // When locking for 3 months and burning after 2 months: 3 + 2 + (12-3) => 14 months worth of DUBI
        // When locking for 12 months and burning after 2 months: 12 + 2 + (12-12) => 14 months worth of DUBI
        //
        // This way nobody is at a disadvantage.
        if (durationInDays > 0) {
            uint32 durationInSeconds = uint32(durationInDays) * 24 * 60 * 60;
            lastWithdrawal -=
                MintMath.MAX_FINITE_LOCK_DURATION_SECONDS -
                durationInSeconds;

            // Sanity check
            assert(lastWithdrawal <= unpacked.lastWithdrawal);
        }

        // See Utils/MintMath.sol
        return
            MintMath.calculateMintDuration(dubiMintTimestamp, lastWithdrawal);
    }

    //---------------------------------------------------------------
    // Fuel
    //---------------------------------------------------------------

    function _burnBoostedHodlFuel(address from, BoosterFuel memory fuel)
        private
        returns (uint192)
    {
        if (fuel.unlockedPrps > 0) {
            require(fuel.unlockedPrps <= MAX_BOOSTER_FUEL, "H-16");

            // Taking unlocked PRPS means, we take it from the amount that gets hodled instead
            // of reaching out to the PRPS contract to save gas.

            // Direct fuel from the PRPS that gets hodled => upper 96 bits
            return uint192(fuel.unlockedPrps) << 96;
        }

        // If the fuel is intrinsic, then it means in the context of Hodl the minted DUBI.
        if (fuel.intrinsicFuel > 0) {
            require(fuel.intrinsicFuel <= MAX_BOOSTER_FUEL, "H-16");

            // Gets subtracts from the minted DUBI at the end of the transaction and reverts if
            // not enough DUBI could be minted.

            // NOTE: Since the creator and PRPS beneficiary can be different accounts,
            // the intrinsic fuel is effectively provided by the beneficiary

            // Direct fuel from the DUBI that gets minted => lower 96 bits
            return fuel.intrinsicFuel;
        }

        if (fuel.lockedPrps > 0) {
            _burnLockedPrpsFuel(from, fuel.lockedPrps);

            // No direct fuel
            return 0;
        }

        // If the fuel is DUBI, then we have to reach out to the DUBI contract.
        if (fuel.dubi > 0) {
            // Reverts if the requested amount cannot be burned
            _dubi.burnFuel(
                from,
                TokenFuel({
                    tokenAlias: TOKEN_FUEL_ALIAS_DUBI,
                    amount: fuel.dubi
                })
            );

            // No direct fuel
            return 0;
        }

        // No fuel at all
        return 0;
    }

    function _burnBoostedReleaseFuel(address from, BoosterFuel memory fuel)
        private
        returns (uint96)
    {
        // If the fuel is intrinsic, then it means in the context of a release the PRPS that will get released
        if (fuel.intrinsicFuel > 0) {
            require(fuel.intrinsicFuel <= MAX_BOOSTER_FUEL, "H-16");

            // Gets subtracts from the released PRPS at the end of the transaction and reverts if
            // the PRPS is not sufficient.

            // NOTE: Since anyone can release a hodl for a beneficiary,
            // the intrinsic fuel is effectively provided by the beneficiary

            return fuel.intrinsicFuel;
        }

        if (fuel.lockedPrps > 0) {
            _burnLockedPrpsFuel(from, fuel.lockedPrps);

            // No direct fuel
            return 0;
        }

        if (fuel.unlockedPrps > 0) {
            require(fuel.unlockedPrps <= MAX_BOOSTER_FUEL, "H-16");

            // Call into PRPS contract

            // Reverts if the requested amount cannot be burned
            _prps.burnFuel(
                from,
                TokenFuel({
                    tokenAlias: TOKEN_FUEL_ALIAS_UNLOCKED_PRPS,
                    amount: fuel.unlockedPrps
                })
            );

            // No direct fuel
            return 0;
        }

        // If the fuel is DUBI, then we have to reach out to the DUBI contract.
        if (fuel.dubi > 0) {
            // Reverts if the requested amount cannot be burned
            _dubi.burnFuel(
                from,
                TokenFuel({
                    tokenAlias: TOKEN_FUEL_ALIAS_DUBI,
                    amount: fuel.dubi
                })
            );

            // No direct fuel
            return 0;
        }

        // No fuel at all
        return 0;
    }

    function _burnBoostedWithdrawalFuel(address from, BoosterFuel memory fuel)
        private
        returns (uint96)
    {
        // If the fuel is intrinsic, then it means in the context of withdrawal the DUBI that will get minted
        if (fuel.intrinsicFuel > 0) {
            require(fuel.intrinsicFuel <= MAX_BOOSTER_FUEL, "H-16");

            // Gets subtracts from the minted DUBI at the end of the transaction and reverts if
            // the DUBI is not sufficient.

            // NOTE: Since anyone can withdraw from an infinitely hodl for a beneficiary,
            // the intrinsic fuel is effectively provided by the beneficiary

            return fuel.intrinsicFuel;
        }

        if (fuel.lockedPrps > 0) {
            _burnLockedPrpsFuel(from, fuel.lockedPrps);

            // No direct fuel
            return 0;
        }

        if (fuel.unlockedPrps > 0) {
            require(fuel.unlockedPrps <= MAX_BOOSTER_FUEL, "H-16");

            // Call into PRPS contract

            // Reverts if the requested amount cannot be burned
            _prps.burnFuel(
                from,
                TokenFuel({
                    tokenAlias: TOKEN_FUEL_ALIAS_UNLOCKED_PRPS,
                    amount: fuel.unlockedPrps
                })
            );

            // No direct fuel
            return 0;
        }

        // If the fuel is DUBI, then we have to reach out to the DUBI contract.
        if (fuel.dubi > 0) {
            // Reverts if the requested amount cannot be burned
            _dubi.burnFuel(
                from,
                TokenFuel({
                    tokenAlias: TOKEN_FUEL_ALIAS_DUBI,
                    amount: fuel.dubi
                })
            );

            // No direct fuel
            return 0;
        }

        // No fuel at all
        return 0;
    }

    function _burnLockedPrpsFuel(address from, uint96 amount) private {
        require(amount <= MAX_BOOSTER_FUEL, "H-16");

        // Burning the fuel from locked PRPS is only plus EV if it causes a hodl to get deleted,
        // then the gas refund can make it a bit cheaper compared to the other fuels.

        // We pass a mint timestamp, but that doesn't mean that DUBI is minted.
        // The returned DUBI that should be minted is ignored.
        // Reverts if not enough locked PRPS can be burned.

        HodlLib.PackedHodlItem[] storage hodlsSender = _hodlsByAddress[from];
        _burnLocked({
            hodlsSender: hodlsSender,
            amount: amount,
            dubiMintTimestamp: uint32(block.timestamp),
            burnPendingLockedPrps: false
        });

        // Also update the hodl balance on the PRPS contract
        _prps.decreaseHodlBalance({
            from: from,
            hodlAmount: amount,
            refundAmount: 0
        });
    }

    //---------------------------------------------------------------

    /**
     * @dev Create new hodls, without minting new DUBI.
     *
     * The creator becomes the PRPS/DUBI beneficiary.
     *
     */
    function migrateHodls(
        uint24[] calldata hodlIds,
        address[] calldata creators,
        uint96[] calldata hodlBalances,
        uint16[] calldata durations,
        uint32[] calldata createdAts
    ) external onlyOwner {
        for (uint256 i = 0; i < hodlIds.length; i++) {
            uint24 hodlId = hodlIds[i];
            address creator = creators[i];
            uint96 amountPrps = hodlBalances[i];
            uint16 duration = durations[i];
            uint32 createdAt = createdAts[i];

            _assertCanHodl(
                hodlId,
                creator,
                amountPrps,
                duration,
                creator,
                creator
            );

            // Update hodl balance of beneficiary by calling into the PRPS contract.
            _prps.migrateHodlBalance(creator, amountPrps);

            HodlLib.PackedHodlItem memory _packed;

            HodlLib.UnpackedHodlItem memory _unpacked;
            _unpacked.id = hodlId;
            _unpacked.duration = duration;
            _unpacked.lockedPrps = amountPrps;
            _unpacked.lastWithdrawal = createdAt;

            _packed.packedData = HodlLib.packHodlItem(_unpacked);
            _hodlsByAddress[creator].push(_packed);
        }
    }

    function _assertCanHodl(
        uint24 hodlId,
        address creator,
        uint96 amountPrps,
        uint16 duration,
        address dubiBeneficiary,
        address prpsBeneficiary
    ) private view returns (HodlLib.PackedHodlItem[] storage) {
        require(amountPrps > 0 && hodlId > 0 && hodlId < 2**20, "H-17");
        require(duration == 0 || (duration >= 1 && duration <= 365), "H-18");
        require(
            dubiBeneficiary != address(0) && prpsBeneficiary != address(0),
            "H-19"
        );

        // Ensure that the hodl (id, creator) doesn't exist on the PRPS beneficiary
        // To do this we need to iterate over all hodls


            HodlLib.PackedHodlItem[] storage hodls
         = _hodlsByAddress[prpsBeneficiary];

        // Count the number of hodls where creator != prpsBeneficiary.
        // We put a hard limit on the number of hodls from the "outside" that can be active at the same time
        // to prevent abuse (i.e. spamming dozens of hodls). This isn't perfect, but at least keeps the gas costs
        // manageable.
        uint256 foreignHodlsCount = 0;

        uint256 length = hodls.length;
        for (uint256 i = 0; i < length; i++) {
            HodlLib.PackedHodlItem storage packed = hodls[i];
            // To make it somewhat more efficient we skip unpacking the whole item
            // since we are only interested in the id and creator.
            (uint24 _hodlId, address _creator) = _getIdAndCreatorFromPacked(
                prpsBeneficiary,
                packed, // extra read if creator is different
                packed.packedData
            );

            if (hodlId == _hodlId && creator == _creator) {
                revert("H-20");
            }

            if (_creator != prpsBeneficiary) {
                foreignHodlsCount++;
            }
        }

        // If the creator is not the beneficiary, then we revert if the beneficiary already
        // has 50 foreign hodls.
        require(creator == prpsBeneficiary || foreignHodlsCount < 50, "H-29");

        return hodls;
    }

    /**
     * @dev Returns the hodl plus it's index from `prpsBeneficiary` that has the given `id` and `creator`
     *
     * If it cannot be found, then this function reverts.
     */
    function _safeGetHodl(
        uint24 id,
        address prpsBeneficiary,
        address creator
    )
        private
        view
        returns (
            HodlLib.PackedHodlItem storage,
            HodlLib.UnpackedHodlItem memory,
            uint256
        )
    {

            HodlLib.PackedHodlItem[] storage hodls
         = _hodlsByAddress[prpsBeneficiary];

        uint256 length = hodls.length;

        // Take a shortcut for a single hodl - that is we unpack the item immediately,
        // because the loop below would inccur extra reads on average.
        if (length == 1) {
            HodlLib.PackedHodlItem storage packed = hodls[0];
            HodlLib.UnpackedHodlItem memory unpacked = HodlLib.unpackHodlItem(
                packed.packedData
            );

            address _creator = _getCreatorFromUnpacked(
                prpsBeneficiary,
                packed,
                unpacked
            );

            // If it's a match return the data, else we
            // let it run into the revert at the end of the function
            if (unpacked.id == id && _creator == creator) {
                return (packed, unpacked, 0);
            }
        } else {
            // We need to iterate over all hodls to find a possible match.
            // Since the order of hodls is not deterministic, we avoid having to
            // unpack each item by only reading the id and creator first and only
            // if it matches we unpack the whole thing.
            for (uint256 i = 0; i < length; i++) {
                HodlLib.PackedHodlItem storage packed = hodls[i];

                // Expensive read
                uint256 packedData = packed.packedData;

                (
                    uint24 unpackedId,
                    address _creator
                ) = _getIdAndCreatorFromPacked(
                    prpsBeneficiary,
                    packed, // extra read if creator is different
                    packedData
                );

                if (unpackedId == id && _creator == creator) {
                    HodlLib.UnpackedHodlItem memory unpacked = HodlLib
                        .unpackHodlItem(packedData);
                    return (packed, unpacked, i);
                }
            }
        }

        revert("H-21");
    }

    /**
     * @dev Check if a hodl is expired
     */
    function _isHodlExpired(uint32 lastWithdrawal, uint16 lockDurationInDays)
        private
        view
        returns (bool)
    {
        uint32 durationInSeconds = uint32(lockDurationInDays) * 24 * 60 * 60;
        uint32 _now = uint32(block.timestamp);

        // Sanity check
        assert(_now >= lastWithdrawal);

        bool hasExpiration = durationInSeconds > 0;
        bool isExpired = _now - lastWithdrawal >= durationInSeconds;

        return hasExpiration && isExpired;
    }

    function _getDubiBeneficiary(
        address prpsBeneficiary,
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked
    ) private view returns (address) {
        if (unpacked.flags.hasDifferentDubiBeneficiary) {
            return packed.dubiBeneficiary;
        }

        return prpsBeneficiary;
    }

    function _getCreatorFromUnpacked(
        address prpsBeneficiary,
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked
    ) private view returns (address) {
        if (unpacked.flags.hasDifferentCreator) {
            return packed.creator;
        }

        return prpsBeneficiary;
    }

    function _getIdAndCreatorFromPacked(
        address prpsBeneficiary,
        HodlLib.PackedHodlItem storage packedHodlItem,
        uint256 packedData
    ) private view returns (uint24, address) {
        // The first 20 bits of the packed data corresponds to the id. By casting to uint24,
        // and applying a bitmask we get the id without having to unpack the entire thing.
        uint24 idMask = (1 << 20) - 1;
        uint24 hodlId = uint24(packedData & idMask);

        // The `hasDifferentCreator` flag sits at bit 60
        bool hasDifferentCreator = (packedData >> 60) & 1 == 1;
        if (hasDifferentCreator) {
            return (hodlId, packedHodlItem.creator);
        }

        // Otherwise the creator is the prps beneficiary
        return (hodlId, prpsBeneficiary);
    }

    //---------------------------------------------------------------
    // Pending ops
    //---------------------------------------------------------------

    function _getHasherContracts()
        internal
        override
        returns (address[] memory)
    {
        address[] memory hashers = new address[](5);
        hashers[0] = address(this);
        hashers[1] = address(_prps);
        hashers[2] = address(_dubi);
        hashers[3] = _externalAddress1;
        hashers[4] = _externalAddress2;

        return hashers;
    }

    /**
     * @dev Set `amount` locked PRPS of `account` as pending. Can only be called by the
     * PRPS contract. Returns the amount of PRPS that could be marked pending.
     */
    function setLockedPrpsToPending(address account, uint96 amount)
        external
        override
        onlyPurpose
    {
        require(amount > 0, "H-22");

        HodlLib.PackedHodlItem[] storage hodlsSender = _hodlsByAddress[account];
        HodlLib.setLockedPrpsToPending(hodlsSender, amount);
    }

    /**
     * @dev Revert `amount` pending locked PRPS on the hodls of `account`. Can only be called by the
     * PRPS contract.
     */
    function revertLockedPrpsSetToPending(address account, uint96 amount)
        public
        override
        onlyPurpose
    {
        HodlLib.PackedHodlItem[] storage hodlsSender = _hodlsByAddress[account];
        HodlLib.revertLockedPrpsSetToPending(hodlsSender, amount);
    }

    /**
     * @dev When the permaboost is active, a pending hodl is necessary
     * when either the creator or the prpsBeneficiary  is opted-in.
     *
     * Returns false if no pending hodl is necessary, true otherwise and
     * the optInStatus of the associated creator.
     */
    function _checkIfShouldCreatePendingHodl(address prpsBeneficiary)
        private
        view
        returns (bool, IOptIn.OptInStatus memory)
    {
        (
            IOptIn.OptInStatus memory optInStatusCreator,
            IOptIn.OptInStatus memory optInStatusPrpsBeneficiary
        ) = _OPT_IN.getOptInStatusPair(msg.sender, prpsBeneficiary);

        // Don't create a pending hodl if the permaboost isn't active
        if (!optInStatusCreator.permaBoostActive) {
            return (false, optInStatusCreator);
        }

        // Don't create a pending hodl if neither is opted-in to begin with
        if (
            !optInStatusCreator.isOptedIn &&
            !optInStatusPrpsBeneficiary.isOptedIn
        ) {
            return (false, optInStatusCreator);
        }

        // Otherwise, both must be opted-in and share the same booster
        require(
            optInStatusCreator.isOptedIn &&
                optInStatusPrpsBeneficiary.isOptedIn,
            "H-23"
        );

        bool sameBooster = optInStatusCreator.optedInTo ==
            optInStatusPrpsBeneficiary.optedInTo;
        require(sameBooster, "H-24");

        // Indicate that a pending hodl is necessary
        return (true, optInStatusCreator);
    }

    /**
     * @dev Finalize a pending op
     */
    function finalizePendingOp(address user, OpHandle memory opHandle) public {
        uint8 opType = opHandle.opType;

        // Assert that the caller (msg.sender) is allowed to finalize the given op
        // and returns the creation timestamp.
        uint32 createdAt = uint32(_assertCanFinalize(user, opHandle));

        // Delete op handle to prevent reentrancy abuse using the same opId
        _deleteOpHandle(user, opHandle);

        if (opType == OP_TYPE_HODL) {
            _finalizePendingHodl(user, opHandle.opId, createdAt);
        } else if (opType == OP_TYPE_RELEASE) {
            _finalizePendingRelease(user, opHandle.opId);
        } else if (opType == OP_TYPE_WITHDRAWAL) {
            _finalizePendingWithdrawal(user, opHandle.opId, createdAt);
        } else {
            revert("H-25");
        }

        // Emit event
        emit FinalizedOp(user, opHandle.opId, opType);
    }

    /**
     * @dev Revert a pending operation.
     *
     * Only the opted-in booster can revert a transaction if it provides a signed and still valid booster message
     * from the original sender.
     */
    function revertPendingOp(
        address user,
        OpHandle memory opHandle,
        bytes memory boosterMessage,
        Signature memory signature
    ) public {
        // Prepare revert, including permission check
        _prepareOpRevert({
            user: user,
            opHandle: opHandle,
            boosterMessage: boosterMessage,
            signature: signature
        });

        uint64 opId = opHandle.opId;
        uint8 opType = opHandle.opType;

        if (opType == OP_TYPE_HODL) {
            _revertPendingHodl(user, opId);
        } else if (opType == OP_TYPE_RELEASE) {
            _revertPendingRelease(user, opId);
        } else if (opType == OP_TYPE_WITHDRAWAL) {
            _revertPendingWithdrawal(user, opId);
        } else {
            revert("H-25");
        }

        // Emit event
        emit RevertedOp(user, opId, opType);
    }

    /**
     * @dev Create a pending hodl
     */
    function _createPendingHodl(
        uint24 hodlId,
        uint96 amountPrps,
        uint16 duration,
        address dubiBeneficiary,
        address prpsBeneficiary,
        IOptIn.OptInStatus memory optInStatus
    ) private returns (uint32) {
        (uint96 dubiToMint, ) = _prepareHodl({
            hodlId: hodlId,
            creator: msg.sender,
            amountPrps: amountPrps,
            duration: duration,
            dubiBeneficiary: dubiBeneficiary,
            prpsBeneficiary: prpsBeneficiary
        });

        // Move PRPS into this contract while it's pending.
        _prps.hodlTransfer(msg.sender, amountPrps);

        OpHandle memory opHandle = _createNewOpHandle(
            optInStatus,
            msg.sender,
            OP_TYPE_HODL
        );

        // The hodl creation timestamp is later retrieved from the opMetadata.
        HodlLib.PendingHodl memory pendingHodl = HodlLib.PendingHodl({
            creator: msg.sender,
            dubiBeneficiary: dubiBeneficiary,
            prpsBeneficiary: prpsBeneficiary,
            amountPrps: amountPrps,
            duration: duration,
            dubiToMint: dubiToMint,
            hodlId: hodlId
        });

        _pendingHodls[_getOpKey(msg.sender, opHandle.opId)] = pendingHodl;

        // Emit PendingOp event
        emit PendingOp(msg.sender, opHandle.opId, opHandle.opType);
    }

    /**
     * @dev Create a pending release
     */
    function _createPendingRelease(
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked,
        address prpsBeneficiary,
        uint96 releasablePrps,
        IOptIn.OptInStatus memory optInStatus
    ) private {
        // NOTE: This function is only called in one place and the caller already
        // ensures that this flag is initially unset and that the caller is the PRPS beneficiary.

        // Mark hodl as occupied

        unpacked.flags.hasDependentHodlOp = true;

        // Ceremony
        OpHandle memory opHandle = _createNewOpHandle(
            optInStatus,
            prpsBeneficiary,
            OP_TYPE_RELEASE
        );

        // The release timestamp is later retrieved from the opMetadata.
        address creator = _getCreatorFromUnpacked(
            prpsBeneficiary,
            packed,
            unpacked
        );

        assert(creator != address(0));
        HodlLib.PendingRelease memory pendingRelease = HodlLib.PendingRelease({
            releasablePrps: releasablePrps,
            hodlId: unpacked.id,
            creator: creator
        });

        _pendingReleases[_getOpKey(
            prpsBeneficiary,
            opHandle.opId
        )] = pendingRelease;

        // Write updated hodl item to storage
        packed.packedData = HodlLib.packHodlItem(unpacked);

        // Emit PendingOp event
        emit PendingOp(prpsBeneficiary, opHandle.opId, opHandle.opType);
    }

    /**
     * @dev Create a pending withdrawal
     */
    function _createPendingWithdrawal(
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked,
        address prpsBeneficiary,
        address dubiBeneficiary,
        address creator,
        uint96 dubiToMint,
        IOptIn.OptInStatus memory optInStatus
    ) private {
        // NOTE: This function is only called in one place and the caller already
        // ensures that this flag is initially unset and that the caller is the DUBI beneficiary.

        // Mark hodl as occupied
        unpacked.flags.hasDependentHodlOp = true;

        // Ceremony
        OpHandle memory opHandle = _createNewOpHandle(
            optInStatus,
            dubiBeneficiary,
            OP_TYPE_WITHDRAWAL
        );

        // The withdrawal timestamp is later retrieved from the opMetadata.

        HodlLib.PendingWithdrawal memory pendingWithdrawal = HodlLib
            .PendingWithdrawal({
            dubiToMint: dubiToMint,
            hodlId: unpacked.id,
            creator: creator,
            prpsBeneficiary: prpsBeneficiary
        });

        _pendingWithdrawals[_getOpKey(
            dubiBeneficiary,
            opHandle.opId
        )] = pendingWithdrawal;

        // Write updated hodl item to storage
        packed.packedData = HodlLib.packHodlItem(unpacked);

        // Emit PendingOp event
        emit PendingOp(creator, opHandle.opId, opHandle.opType);
    }

    /**
     * @dev Finalize a pending hodl
     */
    function _finalizePendingHodl(
        address user,
        uint64 opId,
        uint32 createdAt
    ) private {
        bytes32 opKey = _getOpKey(user, opId);

        HodlLib.PendingHodl storage pendingHodl = _pendingHodls[opKey];

        address creator = pendingHodl.creator;
        address prpsBeneficiary = pendingHodl.prpsBeneficiary;
        address dubiBeneficiary = pendingHodl.dubiBeneficiary;

        // Sanity check
        assert(creator == user);

        // Finalize the hodl by creating
        uint24 hodlId = pendingHodl.hodlId;
        uint96 dubiToMint = pendingHodl.dubiToMint;
        uint96 amountPrps = pendingHodl.amountPrps;

        HodlLib.PackedHodlItem memory _packed;

        HodlLib.UnpackedHodlItem memory _unpacked;
        _unpacked.id = hodlId;
        _unpacked.duration = pendingHodl.duration;
        _unpacked.lastWithdrawal = createdAt;
        _unpacked.lockedPrps = amountPrps;

        // Rare case
        if (creator != prpsBeneficiary) {
            _packed.creator = creator;
            _unpacked.flags.hasDifferentCreator = true;
        }

        // Rare case
        if (dubiBeneficiary != prpsBeneficiary) {
            _packed.dubiBeneficiary = dubiBeneficiary;
            _unpacked.flags.hasDifferentDubiBeneficiary = true;
        }

        _packed.packedData = HodlLib.packHodlItem(_unpacked);

        // Delete mapping to get a ~47k gas refund
        delete _pendingHodls[opKey];

        // Write to storage and mint DUBI
        _hodlsByAddress[prpsBeneficiary].push(_packed);

        // Update hodl balance of beneficiary by calling into the PRPS contract.
        // We use PRPS from `this` contract's balance, since it has been moved to this contract
        // when the pending hodl was created.
        _prps.increaseHodlBalance(address(this), prpsBeneficiary, amountPrps);

        _dubi.hodlMint(dubiBeneficiary, dubiToMint);
    }

    /**
     * @dev Finalize a pending release
     */
    function _finalizePendingRelease(address user, uint64 opId) private {
        bytes32 opKey = _getOpKey(user, opId);

        HodlLib.PendingRelease storage pendingRelease = _pendingReleases[opKey];

        // Get hodl of user
        (, , uint256 index) = _safeGetHodl(
            pendingRelease.hodlId,
            user,
            pendingRelease.creator
        );

        // Release PRPS on hodl
        _releasePrpsAndDeleteHodlByIndex(
            user,
            index,
            pendingRelease.releasablePrps,
            0
        );

        delete _pendingReleases[opKey];
    }

    /**
     * @dev Finalize a pending withdrawal
     */
    function _finalizePendingWithdrawal(
        address user,
        uint64 opId,
        uint32 createdAt
    ) private {
        bytes32 opKey = _getOpKey(user, opId);


            HodlLib.PendingWithdrawal storage pendingWithdrawal
         = _pendingWithdrawals[opKey];

        address prpsBeneficiary = pendingWithdrawal.prpsBeneficiary;

        // Get hodl of user
        (
            HodlLib.PackedHodlItem storage packed,
            HodlLib.UnpackedHodlItem memory unpacked,

        ) = _safeGetHodl(
            pendingWithdrawal.hodlId,
            prpsBeneficiary,
            pendingWithdrawal.creator
        );

        address dubiBeneficiary = _getDubiBeneficiary(
            prpsBeneficiary,
            packed,
            unpacked
        );

        // Unset dependent op flag
        unpacked.flags.hasDependentHodlOp = false;

        // Release PRPS on hodl and update hodl in storage
        _doWithdraw({
            dubiBeneficiary: dubiBeneficiary,
            packed: packed,
            unpacked: unpacked,
            withdrawalTimestamp: createdAt, // timestamp from when withdraw was put pending
            dubiToMint: pendingWithdrawal.dubiToMint,
            directFuel: 0
        });

        delete _pendingWithdrawals[opKey];
    }

    /**
     * @dev Revert a pending hodl
     */
    function _revertPendingHodl(address user, uint64 opId) private {
        bytes32 opKey = _getOpKey(user, opId);

        HodlLib.PendingHodl storage pendingHodl = _pendingHodls[opKey];

        address creator = pendingHodl.creator;
        // Sanity check
        assert(creator == user);

        // Revert the pending hodl transfer send the PRPS back to the `creator`.
        _prps.transfer(creator, pendingHodl.amountPrps);

        // Clean up pending hodl
        delete _pendingHodls[opKey];
    }

    /**
     * @dev Revert a pending release
     */
    function _revertPendingRelease(address user, uint64 opId) private {
        bytes32 opKey = _getOpKey(user, opId);

        HodlLib.PendingRelease storage pendingRelease = _pendingReleases[opKey];

        // Get hodl of user
        (
            HodlLib.PackedHodlItem storage packed,
            HodlLib.UnpackedHodlItem memory unpacked,

        ) = _safeGetHodl(pendingRelease.hodlId, user, pendingRelease.creator);

        // Remove flag
        _unsetHasDependentHodlFlag(packed, unpacked);

        // Clean up pending release
        delete _pendingReleases[opKey];
    }

    /**
     * @dev Revert a pending withdrawal
     */
    function _revertPendingWithdrawal(address user, uint64 opId) private {
        bytes32 opKey = _getOpKey(user, opId);


            HodlLib.PendingWithdrawal storage pendingWithdrawal
         = _pendingWithdrawals[opKey];

        // Get hodl of user
        (
            HodlLib.PackedHodlItem storage packed,
            HodlLib.UnpackedHodlItem memory unpacked,

        ) = _safeGetHodl(
            pendingWithdrawal.hodlId,
            pendingWithdrawal.prpsBeneficiary,
            pendingWithdrawal.creator
        );

        // Remove flag
        _unsetHasDependentHodlFlag(packed, unpacked);

        // Clean up pending withdrawal
        delete _pendingWithdrawals[opKey];
    }

    /**
     * @dev Removes the dependent hodl op flag from the given hodl item
     */
    function _unsetHasDependentHodlFlag(
        HodlLib.PackedHodlItem storage packed,
        HodlLib.UnpackedHodlItem memory unpacked
    ) private {
        unpacked.flags.hasDependentHodlOp = false;
        packed.packedData = HodlLib.packHodlItem(unpacked);
    }

    /**
     * @dev Returns whether the given hodl item has any pending dependent operation
     * or not.
     *
     * Pending release and withdraw ops will occupy a hodl, so they have exclusive access to it.
     * Pending PRPS burns increase the pending locked PRPS and do not access the dependent flag
     * for efficiency reasons.
     */
    function _hodlHasDependentOp(HodlLib.UnpackedHodlItem memory item)
        private
        pure
        returns (bool)
    {
        // Any pending PRPS burn means the hodl has a dependent op
        if (item.flags.hasPendingLockedPrps) {
            return true;
        }

        // If true, then a pending release or withdrawal is occupying the hodl
        if (item.flags.hasDependentHodlOp) {
            return true;
        }

        // Otherwise it is still available
        return false;
    }

    //---------------------------------------------------------------
    // Share pending ops with PRPS
    //---------------------------------------------------------------

    /**
     * @dev Returns the metadata of an op. Returns a zero struct if it doesn't exist.
     * Hodl and Prps share the same opCounter to enforce a consistent order in which pending ops are finalized/reverted
     * across contracts. This function calls into `_prps` to get the metadata for `opId`.
     */
    function getOpMetadata(address user, uint64 opId)
        public
        override
        view
        returns (OpMetadata memory)
    {
        return _prps.getOpMetadata(user, opId);
    }

    /**
     * @dev Returns the metadata of an op. Returns a zero struct if it doesn't exist.
     * Hodl and Prps share the same opCounter to enforce a consistent order in which pending ops are finalized/reverted
     * across contracts. This function calls into `_prps` to get the op counter for `user`.
     */
    function getOpCounter(address user)
        public
        override
        view
        returns (OpCounter memory)
    {
        return _prps.getOpCounter(user);
    }

    /**
     * @dev Returns the metadata of an op. Reverts if it doesn't exist.
     * Hodl and Prps share the same opCounter to enforce a consistent order in which pending ops are finalized/reverted
     * across contracts. This function calls into `_prps` to safely get the metadata for `opHandle`.
     */
    function safeGetOpMetadata(address user, OpHandle memory opHandle)
        public
        override
        view
        returns (OpMetadata memory)
    {
        return _prps.safeGetOpMetadata(user, opHandle);
    }

    /**
     * @dev Creates a new opHandle with the given type for `user`.
     * Hodl and Prps share the same opCounter to enforce a consistent order in which pending ops are finalized/reverted
     * across contracts. This function calls into `_prps` to create a new opHandle.
     */
    function _createNewOpHandle(
        IOptIn.OptInStatus memory optInStatus,
        address user,
        uint8 opType
    ) internal override returns (OpHandle memory) {
        return _prps.createNewOpHandleShared(optInStatus, user, opType);
    }

    /**
     * @dev Delete the given `opHandle` from `user`.
     * Hodl and Prps share the same opCounter to enforce a consistent order in which pending ops are finalized/reverted
     * across contracts. This function calls into `_prps` to delete an opHandle.
     */
    function _deleteOpHandle(address user, OpHandle memory opHandle)
        internal
        override
    {
        bool success = _prps.deleteOpHandleShared(user, opHandle);
        require(success, "H-26");
    }

    /**
     * @dev Asserts that the given opId is the next to be finalized for `user`.
     * Hodl and Prps share the same opCounter to enforce a consistent order in which pending ops are finalized/reverted
     * across contracts. This function calls into `_prps` to perform the assertion.
     */
    function _assertFinalizeFIFO(address user, uint64 opId) internal override {
        bool success = _prps.assertFinalizeFIFOShared(user, opId);
        require(success, "H-27");
    }

    /**
     * @dev Asserts that the given opId is the next to be reverted for `user`.
     * Hodl and Prps share the same opCounter to enforce a consistent order in which pending ops are finalized/reverted
     * across contracts. This function calls into `_prps` to perform the assertion.
     */
    function _assertRevertLIFO(address user, uint64 opId) internal override {
        bool success = _prps.assertRevertLIFOShared(user, opId);
        require(success, "H-28");
    }
}
