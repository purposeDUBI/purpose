import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, constants, expectRevert, expectEvent, time, ether } from "@openzeppelin/test-helpers";
import { PurposeInstance, DubiInstance, HodlInstance, OptInInstance } from "../types/contracts"
import { expect } from "chai";
import { expectBigNumber, expectZeroBalance, expectBigNumberApprox, deployTestnet, HODL_MAX_DURATION, hodlDurationMonthsToDays, getHodl } from "./support";
import { PurposeDeployment, SECONDS_PER_MONTH, ZERO } from "../src/types";
import { createSignedBoostedBurnMessage, createSignedBoostedHodlMessage, createSignedBoostedReleaseMessage, createSignedBoostedWithdrawalMessage } from "../src/utils";

contract.fromArtifact("Purpose");

const [alice, bob, charlie] = accounts;

let prps: PurposeInstance;
let dubi: DubiInstance;
let hodl: HodlInstance;
let optIn: OptInInstance;

let amount = ether("1000000");

let deployment: PurposeDeployment;

beforeEach(async () => {
    deployment = await deployTestnet();
    prps = deployment.Purpose;
    hodl = deployment.Hodl;
    dubi = deployment.Dubi;
    optIn = deployment.OptIn;

    await prps.mint(alice, amount);
});

describe("Hodl - OptIn", () => {
    beforeEach(async () => {
        await optIn.activateAndRenounceOwnership();
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH));

        // Contracts are also opted-in by default
        await optIn.instantOptOut(deployment.Hodl.address, { from: deployment.booster })
        await optIn.instantOptOut(deployment.Purpose.address, { from: deployment.booster })
        await optIn.instantOptOut(deployment.Dubi.address, { from: deployment.booster })
    });

    describe("Unboosted", () => {
        it("should hodl and finalize", async () => {
            // Before HODL
            await expectPendingHodl({
                hodlId: 1,
                amount,
                duration: 0,
                prpsBeneficiary: alice,
                dubiBeneficiary: alice,
                opCounter: {
                    before: { value: 0, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 1, nextRevert: 1, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: alice });

            await expectFinalizeHodl({
                account: alice,
                hodlId: 1,
                duration: 0,
                lockedPrps: amount,
                opCounter: {
                    before: { value: 1, nextRevert: 1, nextFinalize: 1 },
                    after: { value: 1, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000")); // 4% DUBI
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });
        });

        it("should release and finalize", async () => {
            await expectPendingHodl({
                hodlId: 1,
                amount,
                duration: HODL_MAX_DURATION,
                prpsBeneficiary: alice,
                dubiBeneficiary: alice,
                opCounter: {
                    before: { value: 0, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 1, nextRevert: 1, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: alice });

            await expectFinalizeHodl({
                account: alice,
                hodlId: 1,
                duration: HODL_MAX_DURATION,
                lockedPrps: amount,
                opCounter: {
                    before: { value: 1, nextRevert: 1, nextFinalize: 1 },
                    after: { value: 1, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000")); // 4% DUBI
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });

            // Now create pending release
            await expectRevert(hodl.release(1, alice, alice, { from: alice }), "H-8");
            // Need to wait until it expired
            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            await expectPendingRelease({
                hodlId: 1,
                account: alice,
                prpsBeneficiary: alice,
                opCounter: {
                    before: { value: 1, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 2, nextRevert: 2, nextFinalize: 2 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: alice });

            await expectFinalizeRelease({
                hodlId: 1,
                account: alice,
                opCounter: {
                    before: { value: 2, nextRevert: 2, nextFinalize: 2 },
                    after: { value: 2, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    // Alice got her prps back
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                    expectBigNumber(await prps.balanceOf(alice), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });
        });

        it("should withdraw and finalize", async () => {
            await expectPendingHodl({
                hodlId: 1,
                amount,
                duration: 0,
                prpsBeneficiary: alice,
                dubiBeneficiary: alice,
                opCounter: {
                    before: { value: 0, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 1, nextRevert: 1, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: alice });

            await expectFinalizeHodl({
                account: alice,
                hodlId: 1,
                lockedPrps: amount,
                duration: 0,
                opCounter: {
                    before: { value: 1, nextRevert: 1, nextFinalize: 1 },
                    after: { value: 1, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(alice), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000")); // 4% DUBI
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });

            // Wait a year to be able to withdraw ~4%
            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            await expectPendingWithdraw({
                account: alice,
                prpsBeneficiary: alice,
                hodlId: 1,
                opCounter: {
                    before: { value: 1, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 2, nextRevert: 2, nextFinalize: 2 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: alice });

            // Finalize withdraw
            await expectFinalizeWithdraw({
                account: alice,
                hodlId: 1,
                opCounter: {
                    before: { value: 2, nextRevert: 2, nextFinalize: 2 },
                    after: { value: 2, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(alice), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(alice), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);

                    // She roughly got 4%, but since she locked 1M PRPS a few seconds difference
                    // adds some noise
                    expectBigNumberApprox(await dubi.balanceOf(alice), ether("80000"), ether("1").div(new BN(10)));
                },
            });
        });

        it("should hodl and revert while pending", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            await expectPendingHodl({
                hodlId: 1,
                amount,
                duration: HODL_MAX_DURATION,
                prpsBeneficiary: boostedAlice.address,
                dubiBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 0, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 1, nextRevert: 1, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            await expectRevertHodl({
                account: boostedAlice.address,
                signer: boostedAlice,
                hodlId: 1,
                nonce: 1,
                opCounter: {
                    before: { value: 1, nextRevert: 1, nextFinalize: 1 },
                    after: { value: 1, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                },
            });
        });

        it("should release and revert while pending", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            await expectPendingHodl({
                hodlId: 1,
                amount,
                duration: HODL_MAX_DURATION,
                prpsBeneficiary: boostedAlice.address,
                dubiBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 0, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 1, nextRevert: 1, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            await expectFinalizeHodl({
                account: boostedAlice.address,
                duration: HODL_MAX_DURATION,
                lockedPrps: amount,
                hodlId: 1,
                opCounter: {
                    before: { value: 1, nextRevert: 1, nextFinalize: 1 },
                    after: { value: 1, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000")); // 4% DUBI
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });

            // Now create pending release
            await expectRevert(hodl.release(1, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-8");
            // Need to wait until it expired
            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            await expectPendingRelease({
                hodlId: 1,
                account: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 1, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 2, nextRevert: 2, nextFinalize: 2 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            await expectRevertRelease({
                hodlId: 1,
                nonce: 2,
                account: boostedAlice.address,
                signer: boostedAlice,
                opCounter: {
                    before: { value: 2, nextRevert: 2, nextFinalize: 2 },
                    after: { value: 2, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });
        });

        it("should withdraw and revert while pending", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            await expectPendingHodl({
                hodlId: 1,
                amount,
                duration: 0,
                prpsBeneficiary: boostedAlice.address,
                dubiBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 0, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 1, nextRevert: 1, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            await expectFinalizeHodl({
                account: boostedAlice.address,
                duration: 0,
                lockedPrps: amount,
                hodlId: 1,
                opCounter: {
                    before: { value: 1, nextRevert: 1, nextFinalize: 1 },
                    after: { value: 1, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), amount);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO); // No DUBI yet
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000")); // 4% DUBI
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });

            // Wait a year to be able to withdraw ~4%
            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            await expectPendingWithdraw({
                account: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                hodlId: 1,
                opCounter: {
                    before: { value: 1, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 2, nextRevert: 2, nextFinalize: 2 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            // Revert withdraw
            await expectRevertWithdraw({
                hodlId: 1,
                nonce: 2,
                account: boostedAlice.address,
                signer: boostedAlice,
                opCounter: {
                    before: { value: 2, nextRevert: 2, nextFinalize: 2 },
                    after: { value: 2, nextRevert: 0, nextFinalize: 0 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), amount);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });
        });

        it("should finalize many pending", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            let alicePrpsBalance = amount

            // Create 4 pending hodls
            // Hodl 1: 100 PRPS 12 Months
            // Hodl 2: 200 PRPS 6 Months
            // Hodl 3: 400 PRPS 3 Months
            // Hodl 4: 100 PRPS infinite
            await expectPendingHodl({
                hodlId: 1,
                amount: ether("100"),
                duration: HODL_MAX_DURATION,
                prpsBeneficiary: boostedAlice.address,
                dubiBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 0, nextRevert: 0, nextFinalize: 0 },
                    after: { value: 1, nextRevert: 1, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance.sub(ether("100")));
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            alicePrpsBalance = await prps.balanceOf(boostedAlice.address);

            await expectPendingHodl({
                hodlId: 2,
                amount: ether("200"),
                duration: hodlDurationMonthsToDays(3) * 2,
                prpsBeneficiary: boostedAlice.address,
                dubiBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 1, nextRevert: 1, nextFinalize: 1 },
                    after: { value: 2, nextRevert: 2, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance.sub(ether("200")));
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("300"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            alicePrpsBalance = await prps.balanceOf(boostedAlice.address);

            await expectPendingHodl({
                hodlId: 3,
                amount: ether("400"),
                duration: hodlDurationMonthsToDays(3),
                prpsBeneficiary: boostedAlice.address,
                dubiBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 2, nextRevert: 2, nextFinalize: 1 },
                    after: { value: 3, nextRevert: 3, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("300"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance.sub(ether("400")));
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("700"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });

            alicePrpsBalance = await prps.balanceOf(boostedAlice.address);

            await expectPendingHodl({
                hodlId: 4,
                amount: ether("100"),
                duration: 0,
                prpsBeneficiary: boostedAlice.address,
                dubiBeneficiary: boostedAlice.address,
                opCounter: {
                    before: { value: 3, nextRevert: 3, nextFinalize: 1 },
                    after: { value: 4, nextRevert: 4, nextFinalize: 1 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("700"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance.sub(ether("100")));
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("800"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            }, { from: boostedAlice.address });


            // Now finalize / revert them which can only happen in order

            // Mix a PRPS transfer in between, since the opCounter is shared
            await prps.transfer(bob, ether("5"), { from: boostedAlice.address });
            await expectOpCounter(boostedAlice.address, { value: 5, nextRevert: 5, nextFinalize: 1, });

            // Cannot finalize out of order
            await expectRevert(hodl.finalizePendingOp(boostedAlice.address, { opType: 2, opId: 2 }, { from: deployment.booster }), "PB-9");
            await expectRevert(hodl.finalizePendingOp(boostedAlice.address, { opType: 2, opId: 3 }, { from: deployment.booster }), "PB-9");
            await expectRevert(hodl.finalizePendingOp(boostedAlice.address, { opType: 2, opId: 4 }, { from: deployment.booster }), "PB-9");
            await expectRevert(prps.finalizePendingOp(boostedAlice.address, { opType: 0, opId: 5 }, { from: deployment.booster }), "PB-9");

            // Same for revert
            await expectRevert(hodl.revertPendingOp(boostedAlice.address, { opType: 2, opId: 4 }, "0x", { r: "0x", s: "0x", v: 1 }, { from: deployment.booster }), "PB-10");
            await expectRevert(hodl.revertPendingOp(boostedAlice.address, { opType: 2, opId: 3 }, "0x", { r: "0x", s: "0x", v: 1 }, { from: deployment.booster }), "PB-10");
            await expectRevert(hodl.revertPendingOp(boostedAlice.address, { opType: 2, opId: 2 }, "0x", { r: "0x", s: "0x", v: 1 }, { from: deployment.booster }), "PB-10");
            await expectRevert(hodl.revertPendingOp(boostedAlice.address, { opType: 2, opId: 1 }, "0x", { r: "0x", s: "0x", v: 1 }, { from: deployment.booster }), "PB-10");

            // Finalize
            alicePrpsBalance = await prps.balanceOf(boostedAlice.address);

            const dubiTolerance = ether("1").div(new BN(10));

            await expectFinalizeHodl({
                account: boostedAlice.address,
                hodlId: 1,
                duration: HODL_MAX_DURATION,
                lockedPrps: ether("100"),
                opCounter: {
                    before: { value: 5, nextRevert: 5, nextFinalize: 1 },
                    after: { value: 5, nextRevert: 5, nextFinalize: 2 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("800"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("700"));
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("100"));
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    // 4% of 100 locked PRPS for 12 months
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("4"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });

            await expectFinalizeHodl({
                account: boostedAlice.address,
                hodlId: 2,
                duration: hodlDurationMonthsToDays(3) * 2,
                lockedPrps: ether("200"),
                opCounter: {
                    before: { value: 5, nextRevert: 5, nextFinalize: 2 },
                    after: { value: 5, nextRevert: 5, nextFinalize: 3 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("100"));
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("700"));
                    expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("4"));
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("500"));
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("300"));
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    // 2% of 200 locked PRPS for 6 months
                    expectBigNumberApprox(await dubi.balanceOf(boostedAlice.address), ether("8"), dubiTolerance);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });


            await expectFinalizeHodl({
                account: boostedAlice.address,
                hodlId: 3,
                lockedPrps: ether("400"),
                duration: hodlDurationMonthsToDays(3),
                opCounter: {
                    before: { value: 5, nextRevert: 5, nextFinalize: 3 },
                    after: { value: 5, nextRevert: 5, nextFinalize: 4 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("300"));
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("500"));
                    expectBigNumberApprox(await dubi.balanceOf(boostedAlice.address), ether("8"), dubiTolerance);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("700"));
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    // 1% of 400 locked PRPS for 3 months
                    expectBigNumberApprox(await dubi.balanceOf(boostedAlice.address), ether("12"), dubiTolerance);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });

            await expectFinalizeHodl({
                account: boostedAlice.address,
                hodlId: 4,
                lockedPrps: ether("100"),
                duration: 0,
                opCounter: {
                    before: { value: 5, nextRevert: 5, nextFinalize: 4 },
                    after: { value: 5, nextRevert: 5, nextFinalize: 5 },
                },
                balancesBefore: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("700"));
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));
                    expectBigNumberApprox(await dubi.balanceOf(boostedAlice.address), ether("12"), dubiTolerance);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
                balancesAfter: async () => {
                    expectBigNumber(await prps.balanceOf(boostedAlice.address), alicePrpsBalance);
                    expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                    expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("800"));
                    expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                    // 4% of 100 infinitely locked PRPS
                    expectBigNumberApprox(await dubi.balanceOf(boostedAlice.address), ether("16"), dubiTolerance);
                    expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
                },
            });

            await prps.finalizePendingOp(boostedAlice.address, { opType: 0, opId: 5 }, { from: deployment.booster });
            await expectOpCounter(boostedAlice.address, { value: 5, nextRevert: 0, nextFinalize: 0, });
        });

        it("should not burn PRPS from pending hodls", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, ether("200"));

            // Create a pending hodl with 200 PRPS
            await hodl.hodl("1", ether("200"), hodlDurationMonthsToDays(3), boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

            // All of Alice PRPS is now pending on the hodl contract
            expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.balanceOf(hodl.address), ether("200"));
            expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

            await expectRevert(prps.burn(ether("100"), "0x", { from: boostedAlice.address }), "H-14");
            await expectRevert(prps.burn(ether("1"), "0x", { from: boostedAlice.address }), "H-14");
            await expectRevert(prps.burn(ether("200"), "0x", { from: boostedAlice.address }), "H-14");
            await expectRevert(prps.burn(ether("201"), "0x", { from: boostedAlice.address }), "H-14");

            await hodl.finalizePendingOp(boostedAlice.address, { opId: 1, opType: 2 }, { from: deployment.booster });

            // The hodl has been finalized and Alice hodlBalance got updated accordingly 
            expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
            expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("200"));
            expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

            // Burning now is fine if it's less than her hodl balance
            await expectRevert(prps.burn(ether("201"), "0x", { from: boostedAlice.address }), "H-14");
            await prps.burn(ether("200"), "0x", { from: boostedAlice.address });

            expectBigNumber(await prps.balanceOf(prps.address), ZERO);
            expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
            expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("200"));
            expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

            const _hodl = await getHodl(hodl, boostedAlice.address, boostedAlice.address, 1);
            expectBigNumber(_hodl.lockedPrps, ether("200"));
            expectBigNumber(_hodl.pendingLockedPrps, ether("200"));
        });

        describe("Hodl / Release / Withdraw / PRPS Burn constraints", () => {

            it("should not hodl if creator and prps beneficiary are not opted-in to same booster", async () => {

                // Creator is opted-in, but PRPS beneficiarynot
                await optIn.instantOptOut(bob, { from: deployment.booster });

                await expectRevert(hodl.hodl("1", ether("100"), 0, bob, bob, { from: alice }), "H-23");

                await optIn.optIn(alice, { from: bob });

                await expectRevert(hodl.hodl("1", ether("100"), 0, bob, bob, { from: alice }), "H-24");

                // Also doesn't work if creator is opted-out
                await optIn.instantOptOut(alice, { from: deployment.booster });

                await expectRevert(hodl.hodl("1", ether("100"), 0, bob, bob, { from: alice }), "H-23");
            });

            it("should not release if caller isn't eligible", async () => {

                // Alice locks 100 PRPS for Charlie
                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), bob, charlie, { from: alice });
                await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Since charlie is still opted-in, only charlie as the beneficiary himself can release the PRPS

                // Reverts if bob tries to release
                await expectRevert(hodl.release(1, charlie, alice, { from: bob }), "H-6");
                // Reverts if alice tries to release
                await expectRevert(hodl.release(1, charlie, alice, { from: alice }), "H-6");

                // Also doesn't work if bob opts-out
                await optIn.instantOptOut(bob, { from: deployment.booster });
                await expectRevert(hodl.release(1, charlie, alice, { from: bob }), "H-6");

                // Also doesn't work if alice opts-out
                await optIn.instantOptOut(alice, { from: deployment.booster });
                await expectRevert(hodl.release(1, charlie, alice, { from: alice }), "H-6");

                // Charlie can release, but pending
                await hodl.release(1, charlie, alice, { from: charlie });
                await expectRevert(hodl.release(1, charlie, alice, { from: charlie }), "H-7");
            });

            it("should release if caller is eligible", async () => {

                // Alice locks 2 times 100 PRPS for Charlie
                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), bob, charlie, { from: alice });
                await hodl.hodl("2", ether("100"), hodlDurationMonthsToDays(3), bob, charlie, { from: alice });
                await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });
                await hodl.finalizePendingOp(alice, { opId: 2, opType: 2 }, { from: deployment.booster });
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Alice as the creator is not allowed to release
                await expectRevert(hodl.release(1, charlie, alice, { from: alice }), "H-6");

                // Charlie can always release, since he's the beneficiary regardless of what the creator is opted-in to
                await hodl.release(2, charlie, alice, { from: charlie });
                await expectRevert(hodl.release(1, charlie, alice, { from: alice }), "H-6");

                await optIn.instantOptOut(alice, { from: deployment.booster });
                await expectRevert(hodl.release(2, charlie, alice, { from: charlie }), "H-7");
                await expectRevert(hodl.release(1, charlie, alice, { from: alice }), "H-6");

                // Create another lock while opted-out
                await expectRevert(hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), bob, charlie, { from: alice }), "H-23");
                await optIn.instantOptOut(charlie, { from: deployment.booster });
                await hodl.hodl("3", ether("100"), hodlDurationMonthsToDays(3), bob, charlie, { from: alice });
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Opt-in alice
                await optIn.optIn(deployment.booster, { from: alice })
                // Can release for charlie who is opted-out
                await hodl.release(3, charlie, alice, { from: alice });

                // Doesn't exist anymore since it got released immediately
                const hodlItem = await getHodl(hodl, alice, charlie, 3);
                expectBigNumber(hodlItem.id, ZERO);
            });

            it("should withdraw if caller is eligible", async () => {

                // Alice locks 100 PRPS infinitely for Charlie, while Bob is the DUBI beneficiary
                await hodl.hodl("1", ether("100"), 0, bob, charlie, { from: alice });
                await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });

                // Wait 3 months to be able to withdraw 1%
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Release not possible since it's infinitely locked
                await expectRevert(hodl.release(1, charlie, alice, { from: charlie }), "H-8");

                // Charlie as the PRPS beneficiary cannot withdraw
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: charlie }), "H-6");

                // Creator also cannot withdraw
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: alice }), "H-6");

                // Bob can withdraw
                let receipt = await hodl.withdraw(1, charlie, alice, { from: bob });
                await expectEvent(receipt, "PendingOp");

                // Now pending, so withdrawing again fails because the hodl has a dependent op
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: bob }), "H-10");

                // Opt-out DUBI beneficiary bob
                await optIn.instantOptOut(bob, { from: deployment.booster });
                // It's Bob DUBI, but since it's still pending he also cannot withdraw again even if he opted-out
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: bob }), "H-10");

                // Finalize pending op
                await hodl.finalizePendingOp(bob, { opType: 4, opId: 1 }, { from: deployment.booster });

                // Wait another 1% and withdraw while opted-out
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Hodl is no longer occupied and withdraw succeeds
                receipt = await hodl.withdraw(1, charlie, alice, { from: bob });
                await expectEvent.notEmitted(receipt, "PendingOp");

                // Wait another 1% and withdraw while opted-out
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Still not possible to withdraw for bob even if he's opted-out
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: alice }), "H-6");
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: deployment.boostedAddresses[2].address /* some unrelated account */ }), "H-6");

                // Bob can do as he pleases
                receipt = await hodl.withdraw(1, charlie, alice, { from: bob });
                await expectEvent.notEmitted(receipt, "PendingOp");

                // If bob opts-in again and occupies the hodl not even booster can withdraw
                await optIn.optIn(deployment.booster, { from: bob });
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));
                receipt = await hodl.withdraw(1, charlie, alice, { from: bob });
                await expectEvent(receipt, "PendingOp");

                await expectRevert(hodl.withdraw(1, charlie, alice, { from: deployment.booster }), "H-10");
            });

            it("should withdraw if caller is booster without signature", async () => {
                // Alice locks 100 PRPS infinitely for Charlie, while Bob is the DUBI beneficiary
                await hodl.hodl("1", ether("100"), 0, bob, charlie, { from: alice });
                await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });

                // Wait 3 months to be able to withdraw 1%
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Booster of alice can withdraw
                let receipt = await hodl.withdraw(1, charlie, alice, { from: deployment.booster });
                await expectEvent.notEmitted(receipt, "PendingOp");

                // Wait another 1%
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Opt-out DUBI beneficiary bob
                await optIn.instantOptOut(bob, { from: deployment.booster });

                // Booster can no longer withdraw
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: deployment.booster }), "H-6");
            });

            it("should not withdraw if caller isn't eligible", async () => {

                // Alice locks 100 PRPS for Charlie, while Bob gets the DUBI
                await hodl.hodl("1", ether("100"), 0, bob, charlie, { from: alice });
                await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Since bob is still opted-in, only bob himself can withdraw DUBI

                // Reverts if charlie tries to release
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: charlie }), "H-6");

                // Also doesn't work if charlie opted-out
                await optIn.instantOptOut(charlie, { from: deployment.booster });
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: charlie }), "H-6");

                // Also doesn't work if creator calls while opted-out
                await optIn.instantOptOut(alice, { from: deployment.booster });
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: alice }), "H-6");

                // Creator opts-in again, but to a different booster
                await optIn.optIn(bob, { from: alice });
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: alice }), "H-6");

                // Opt-in to same booster again
                await optIn.instantOptOut(alice, { from: bob });
                await optIn.optIn(deployment.booster, { from: alice });

                // Still cannot can withdraw DUBI, but pending
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: alice }), "H-6");

                // Bob can
                await hodl.withdraw(1, charlie, alice, { from: bob });
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: alice }), "H-10");
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: bob }), "H-10");
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: charlie }), "H-10");

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Still not working, needs to be finalize
                await expectRevert(hodl.withdraw(1, charlie, alice, { from: bob }), "H-10");

                await hodl.finalizePendingOp(bob, { opType: 4, opId: 1 }, { from: deployment.booster });
                await hodl.withdraw(1, charlie, alice, { from: bob });
            });

            it("should occupy hodl on pending release/withdraw and undo on finalize", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Create two hodls - one locked for 3 months and one infinitely
                await prps.mint(boostedAlice.address, ether("200"));
                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                await hodl.hodl("2", ether("100"), 0, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                await hodl.finalizePendingOp(boostedAlice.address, { opId: 1, opType: 2 }, { from: deployment.booster });
                await hodl.finalizePendingOp(boostedAlice.address, { opId: 2, opType: 2 }, { from: deployment.booster });

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Reverts if charlie tries to release

                // Queue release on hodl 1
                await hodl.release(1, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                // Queue withdraw on hodl 2
                await hodl.withdraw(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Calling release/withdraw again fails now
                await expectRevert(hodl.release(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-7");
                await expectRevert(hodl.withdraw(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-10");

                // Finalize both, the released hodl will be deleted but the other hodl becomes unoccupied again

                await hodl.finalizePendingOp(boostedAlice.address, { opType: 3, opId: 3 }, { from: deployment.booster });
                await hodl.finalizePendingOp(boostedAlice.address, { opType: 4, opId: 4 }, { from: deployment.booster });

                // Alice can try again
                await expectRevert(hodl.release(1, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-21");

                // Works again
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));
                await hodl.withdraw(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            });

            it("should occupy hodl on pending release/withdraw and undo on revert", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Create two hodls - one locked for 3 months and one infinitely
                await prps.mint(boostedAlice.address, ether("200"));
                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                await hodl.hodl("2", ether("100"), 0, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                await hodl.finalizePendingOp(boostedAlice.address, { opId: 1, opType: 2 }, { from: deployment.booster });
                await hodl.finalizePendingOp(boostedAlice.address, { opId: 2, opType: 2 }, { from: deployment.booster });

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                // Reverts if charlie tries to release

                // Queue release on hodl 1
                await hodl.release(1, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                // Queue withdraw on hodl 2
                await hodl.withdraw(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Calling release/withdraw again fails now
                await expectRevert(hodl.release(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-7");
                await expectRevert(hodl.withdraw(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-10");

                // Revert both ops and alice can queue them again
                const { messageBytes, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                    hodlId: 1,
                    creator: boostedAlice.address,
                    amountPrps: amount,
                    duration: hodlDurationMonthsToDays(3),
                    dubiBeneficiary: boostedAlice.address,
                    prpsBeneficiary: boostedAlice.address,
                    nonce: new BN(1),
                    signer: boostedAlice,
                    verifyingContract: deployment.Hodl.address,
                    booster: deployment.booster,
                });

                // Single signed message from alice is enough to revert both given that they are recent enough
                await hodl.revertPendingOp(boostedAlice.address, { opType: 4, opId: 4 }, messageBytes, signature, { from: deployment.booster });
                await hodl.revertPendingOp(boostedAlice.address, { opType: 3, opId: 3 }, messageBytes, signature, { from: deployment.booster });

                // Alice can try again
                await hodl.release(1, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                await hodl.withdraw(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            });

            it("should occupy hodl when burning locked PRPS", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Create two hodls - one locked for 3 months and one infinitely
                await prps.mint(boostedAlice.address, ether("500"));

                expectBigNumber(await prps.balanceOf(boostedAlice.address), ether("500"));

                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                await hodl.hodl("2", ether("100"), 0, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
                await hodl.finalizePendingOp(boostedAlice.address, { opId: 1, opType: 2 }, { from: deployment.booster });
                await hodl.finalizePendingOp(boostedAlice.address, { opId: 2, opType: 2 }, { from: deployment.booster });

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                expectBigNumber(await prps.balanceOf(boostedAlice.address), ether("300"));
                expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("200"));
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);

                // Alice has 500 PRPS in total
                // 200 is locked, 300 is unlocked

                // Burn 500 PRPS
                // Hodl 1 and 2 are "occupied" until finalized and no withdraw/release is possible
                await prps.burn(ether("500"), "0x", { from: boostedAlice.address });

                // 300 unlocked PRPS was moved from Alice to PRPS contract's own balance
                expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("300"));

                // Calling release/withdraw again fails now
                await expectRevert(hodl.release(1, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-7");
                await expectRevert(hodl.withdraw(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-10");

                // Finalize burn should cause both hodls to be deleted and all PRPS is gone
                await prps.finalizePendingOp(boostedAlice.address, { opType: 1, opId: 3 }, { from: deployment.booster });

                // Deleted
                await expectRevert(hodl.release(1, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-21");
                await expectRevert(hodl.release(2, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address }), "H-21");

                // Final balances
                expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
            });

            it("should skip occupied hodls when burning locked PRPS", async () => {

                const [{ address: alice }] = deployment.boostedAddresses;

                // Create two hodls - one locked for 3 months and one infinitely
                await prps.mint(alice, ether("500"));

                expectBigNumber(await prps.balanceOf(alice), ether("500"));
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), alice, alice, { from: alice });
                expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));

                await hodl.hodl("2", ether("100"), 0, alice, alice, { from: alice });
                expectBigNumber(await prps.balanceOf(hodl.address), ether("200"));

                let receipt = await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });
                expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));

                let _hodl = await getHodl(hodl, alice, alice, 1);
                expectBigNumber(_hodl.id, new BN(1));
                expectBigNumber(_hodl.creator, alice);
                expectBigNumber(_hodl.prpsBeneficiary, alice);
                expectBigNumber(_hodl.dubiBeneficiary, alice);

                receipt = await hodl.finalizePendingOp(alice, { opId: 2, opType: 2 }, { from: deployment.booster });
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);

                _hodl = await getHodl(hodl, alice, alice, 2);
                expectBigNumber(_hodl.id, new BN(2));
                expectBigNumber(_hodl.creator, alice);
                expectBigNumber(_hodl.prpsBeneficiary, alice);
                expectBigNumber(_hodl.dubiBeneficiary, alice);

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                expectBigNumber(await prps.balanceOf(alice), ether("300"));
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("200"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Alice has 500 PRPS in total
                // 200 is locked, 300 is unlocked

                // Release Hodl 1 and then burn 300 PRPS
                receipt = await hodl.release(1, alice, alice, { from: alice });
                await expectEvent(receipt, "PendingOp", {
                    opId: "3",
                });

                // Burning 300 PRPS
                receipt = await prps.burn(ether("300"), "0x", { from: alice });
                await expectEvent(receipt, "PendingOp", {
                    opId: "4",
                });

                // Unlocked PRPS is burned first, so her unlocked balance is now 0
                // 200 locked PRPS remains - 100 on Hodl 1 (dependentOp) and 100 on Hodl 2
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("200"));
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
                // Pending burn causes PRPS to be moved to contract balance
                expectBigNumber(await prps.balanceOf(prps.address), ether("300"));

                // Hodl1 now has a dependent op due to the release
                let hodl1 = await getHodl(hodl, alice, alice, 1);
                expect(hodl1.hasDependentHodlOp).to.be.true;
                expect(hodl1.hasPendingLockedPrps).to.be.false;
                expectBigNumber(hodl1.lockedPrps, ether("100"));
                expectZeroBalance(hodl1.burnedLockedPrps);
                expectZeroBalance(hodl1.pendingLockedPrps);

                // Hodl 2 unchanged
                let hodl2 = await getHodl(hodl, alice, alice, 2);
                expect(hodl2.hasDependentHodlOp).to.be.false;
                expect(hodl2.hasPendingLockedPrps).to.be.false;
                expectBigNumber(hodl2.lockedPrps, ether("100"));
                expectZeroBalance(hodl2.burnedLockedPrps);
                expectZeroBalance(hodl2.pendingLockedPrps);

                // Burn another 50 PRPS
                receipt = await prps.burn(ether("50"), "0x", { from: alice });
                await expectEvent(receipt, "PendingOp", {
                    opId: "5",
                });

                // Balances unchanged while pending
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("200"));
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("300"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Hodl1 unchanged, since it has a dependent op
                hodl1 = await getHodl(hodl, alice, alice, 1);
                expect(hodl1.hasDependentHodlOp).to.be.true;
                expect(hodl1.hasPendingLockedPrps).to.be.false;
                expectBigNumber(hodl1.lockedPrps, ether("100"));
                expectZeroBalance(hodl1.burnedLockedPrps);
                expectZeroBalance(hodl1.pendingLockedPrps);

                // Hodl 2 now has 50 pending locked PRPS 
                hodl2 = await getHodl(hodl, alice, alice, 2);
                expect(hodl2.hasDependentHodlOp).to.be.false;
                expect(hodl2.hasPendingLockedPrps).to.be.true;
                expectBigNumber(hodl2.lockedPrps, ether("100"));
                expectZeroBalance(hodl2.burnedLockedPrps);
                expectBigNumber(hodl2.pendingLockedPrps, ether("50"));

                // Calling release/withdraw fails
                await expectRevert(hodl.release(1, alice, alice, { from: alice }), "H-7");
                await expectRevert(hodl.withdraw(2, alice, alice, { from: alice }), "H-10");

                // Finalize burn should cause Hodl 2 to be deleted and alice remaining unlocked balance is (300 - 200)
                await expectRevert(prps.finalizePendingOp(alice, { opType: 1, opId: 4 }, { from: deployment.booster }), "PB-9");

                // Burning more than available fails, remaining locked PRPS 50 when excluding the dependent op
                await expectRevert(prps.burn(ether("51"), "0x", { from: alice }), "H-14");

                // Pending hodl 

                // Burn the remaining 50 locked PRPS from hodl 2
                receipt = await prps.burn(ether("50"), "0x", { from: alice });
                await expectEvent(receipt, "PendingOp", {
                    opId: "6",
                });

                // Need to finalize the release first, which will delete hodl 1
                receipt = await hodl.finalizePendingOp(alice, { opType: 3, opId: 3 }, { from: deployment.booster });
                await expectEvent(receipt, "FinalizedOp", {
                    opId: "3",
                });

                // Hodl1 gone
                hodl1 = await getHodl(hodl, alice, alice, 1);
                expectBigNumber(hodl1.id, ZERO);

                // Hodl 2 completely pending
                hodl2 = await getHodl(hodl, alice, alice, 2);
                expectBigNumber(hodl2.id, new BN(2));
                expectBigNumber(hodl2.lockedPrps, ether("100"));
                expectBigNumber(hodl2.pendingLockedPrps, ether("100"));
                expect(hodl2.hasDependentHodlOp).to.be.false;
                expect(hodl2.hasPendingLockedPrps).to.be.true;

                // Released 100 PRPS increases alice unlocked PRPS to 100
                expectBigNumber(await prps.balanceOf(alice), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("100"));
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("300"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // No longer exists due to release
                await expectRevert(hodl.release(1, alice, alice, { from: alice }), "H-21");
                // Still exists
                await expectRevert(hodl.withdraw(2, alice, alice, { from: alice }), "H-10");

                // Hodl the released 100 PRPS again
                receipt = await hodl.hodl("3", ether("100"), hodlDurationMonthsToDays(3), alice, alice, { from: alice });
                await expectEvent(receipt, "PendingOp", {
                    opId: "7",
                });

                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("100"));
                expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));
                expectBigNumber(await prps.balanceOf(prps.address), ether("300"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Now finalize the burn
                receipt = await prps.finalizePendingOp(alice, { opType: 1, opId: 4 }, { from: deployment.booster });
                await expectEvent(receipt, "FinalizedOp", {
                    opId: "4",
                });

                await expectEvent(receipt, "Transfer", {
                    from: alice,
                    to: constants.ZERO_ADDRESS,
                    value: ether("300"),
                })

                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("100"));
                expectBigNumber(await prps.balanceOf(hodl.address), ether("100"));
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Hodl1 is still gone
                hodl1 = await getHodl(hodl, alice, alice, 1);
                expectBigNumber(hodl1.id, ZERO);

                // Hodl 2 unchanged
                hodl2 = await getHodl(hodl, alice, alice, 2);
                expectBigNumber(hodl2.id, new BN(2));
                expect(hodl2.hasDependentHodlOp).to.be.false;
                expect(hodl2.hasPendingLockedPrps).to.be.true;
                expectBigNumber(hodl2.lockedPrps, ether("100"));
                expectZeroBalance(hodl2.burnedLockedPrps);
                expectBigNumber(hodl2.pendingLockedPrps, ether("100"));

                // Hodl 3 doesn't exist yet
                let hodl3 = await getHodl(hodl, alice, alice, 3);
                expectBigNumber(hodl3.id, ZERO);

                // Up to 100 PRPS can theoretically still be burned, but it is pending on hodl 3
                await expectRevert(prps.burn(ether("50"), "0x", { from: alice }), "H-14");

                // So revert the hodl
                const { messageBytes, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                    hodlId: 1,
                    creator: alice,
                    amountPrps: amount,
                    duration: 0,
                    dubiBeneficiary: alice,
                    prpsBeneficiary: alice,
                    nonce: new BN(1),
                    signer: deployment.boostedAddresses[0],
                    verifyingContract: hodl.address,
                    booster: deployment.booster,
                });

                await hodl.revertPendingOp(alice, { opType: 2, opId: 7 }, messageBytes, signature, { from: deployment.booster });

                // The 100 PRPS shifted from the Hodl contract back to alice
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(alice), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Burning more than remaining still fails (=100)
                await expectRevert(prps.burn(ether("101"), "0x", { from: alice }), "H-14");

                // Burn 50
                await prps.burn(ether("50"), "0x", { from: alice });
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("50"));
                expectBigNumber(await prps.balanceOf(alice), ether("50"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Burn the last 50 PRPS
                await prps.burn(ether("50"), "0x", { from: alice });

                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("100"));
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Now alice only has 100 pending locked PRPS left
                await expectRevert(prps.burn(ether("50"), "0x", { from: alice }), "H-14");

                // Hodl 2 unchanged
                hodl2 = await getHodl(hodl, alice, alice, 2);
                expect(hodl2.hasDependentHodlOp).to.be.false;
                expect(hodl2.hasPendingLockedPrps).to.be.true;
                expectBigNumber(hodl2.lockedPrps, ether("100"));
                expectBigNumber(hodl2.pendingLockedPrps, ether("100"));
                expectZeroBalance(hodl2.burnedLockedPrps);

                // Finalize all remaining ops

                // Finalize burn of 50 PRPS from hodl #2
                await prps.finalizePendingOp(alice, { opType: 1, opId: 5 }, { from: deployment.booster });

                // Hodl 2 
                hodl2 = await getHodl(hodl, alice, alice, 2);
                expect(hodl2.hasDependentHodlOp).to.be.false;
                expect(hodl2.hasPendingLockedPrps).to.be.true;
                expectBigNumber(hodl2.lockedPrps, ether("100"));
                expectBigNumber(hodl2.pendingLockedPrps, ether("50"));
                expectBigNumber(hodl2.burnedLockedPrps, ether("50"));

                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("100"));
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("50"));
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Finalize the other burn of 50 PRPS from hodl #2
                await prps.finalizePendingOp(alice, { opType: 1, opId: 6 }, { from: deployment.booster });

                // Hodl 2 is now dead
                hodl2 = await getHodl(hodl, alice, alice, 2);
                expectBigNumber(hodl2.id, ZERO);
                await expectRevert(hodl.withdraw(2, alice, alice, { from: alice }), "H-21");

                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("100"));
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                // Finalize the remaining two burns
                await prps.finalizePendingOp(alice, { opType: 1, opId: 8 }, { from: deployment.booster });
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("50"));
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

                await prps.finalizePendingOp(alice, { opType: 1, opId: 9 }, { from: deployment.booster });
                expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
            });

            it("should occupy hodls when burning less locked PRPS than on hodl", async () => {

                const [{ address: alice }] = deployment.boostedAddresses;

                // Create two hodls - one locked for 3 months and one infinitely
                await prps.mint(alice, ether("500"));

                expectBigNumber(await prps.balanceOf(alice), ether("500"));
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);

                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), alice, alice, { from: alice });
                await hodl.hodl("2", ether("100"), hodlDurationMonthsToDays(3), alice, alice, { from: alice });

                await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });
                await hodl.finalizePendingOp(alice, { opId: 2, opType: 2 }, { from: deployment.booster });

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                expectBigNumber(await prps.balanceOf(alice), ether("300"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("200"));
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);

                // Alice has 500 PRPS in total
                // 200 is locked, 300 is unlocked

                // Burn 5 PRPS, which will occupy it from hodl 1
                let receipt = await prps.burn(ether("5"), "0x", { from: alice });
                await expectEvent(receipt, "PendingOp");

                // Only her unlocked balance is reduced
                expectBigNumber(await prps.balanceOf(alice), ether("295"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("200"));
                expectBigNumber(await prps.balanceOf(prps.address), ether("5"));
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);

                // Finalize burn
                await prps.finalizePendingOp(alice, { opType: 1, opId: 3 }, { from: deployment.booster });

                // Hodl PRPS balance is not reduced by 5
                expectBigNumber(await prps.balanceOf(alice), ether("295"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("200"));
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);

                // Alice burns 300 PRPS (295 unlocked + 5 locked)
                receipt = await prps.burn(ether("300"), "0x", { from: alice });
                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ether("295"));
                // Hodl balance stays the same, until the burn is finalized
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("200"));
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);

                await expectEvent(receipt, "PendingOp");

                // Releasing Hodl 1 will fail now, since it has pending PRPS
                await expectRevert(hodl.release(1, alice, alice, { from: alice }), "H-7");
                // Releasing Hodl 2 is fine
                await hodl.release(2, alice, alice, { from: alice });
                await expectRevert(hodl.release(2, alice, alice, { from: alice }), "H-7");

                // Finalize burn
                await prps.finalizePendingOp(alice, { opType: 1, opId: 4 }, { from: deployment.booster });

                expectBigNumber(await prps.balanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("195"));
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);

                // Now it can be released again since it no longer has pending PRPS
                await hodl.release(1, alice, alice, { from: alice });
                await hodl.finalizePendingOp(alice, { opType: 3, opId: 5 }, { from: deployment.booster });

                // Alice got the 100 PRPS from the hodl 2 back
                expectBigNumber(await prps.balanceOf(alice), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ether("95"));
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);

                // Finalize hodl 2
                await hodl.finalizePendingOp(alice, { opType: 3, opId: 6 }, { from: deployment.booster });

                // Alice now has the unburned PRPS back 
                expectBigNumber(await prps.balanceOf(alice), ether("195"));
                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.balanceOf(prps.address), ZERO);
                expectBigNumber(await prps.balanceOf(deployment.Hodl.address), ZERO);
            });

            it("should only allow PRPS beneficiary to burn the locked PRPS", async () => {
                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(bob), ZERO);

                await hodl.hodl("1", ether("100"), hodlDurationMonthsToDays(3), alice, bob, { from: alice });
                await hodl.hodl("2", ether("100"), 0, alice, charlie, { from: alice });

                await hodl.finalizePendingOp(alice, { opId: 1, opType: 2 }, { from: deployment.booster });
                await hodl.finalizePendingOp(alice, { opId: 2, opType: 2 }, { from: deployment.booster });

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(bob), ether("100"));

                // Alice locked 100 PRPS for Bob and Charlie respectively

                // Only Bob and Charlie can burn their locked PRPS.
                // If Alice burns 10k PRPS of her unlocked PRPS, then it has no effect
                // on either hodl.
                let receipt = await prps.burn(ether("10000"), "0x", { from: alice });
                await expectEvent(receipt, "PendingOp");

                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(bob), ether("100"));

                // Finalize burn
                await prps.finalizePendingOp(alice, { opType: 1, opId: 3 }, { from: deployment.booster });
                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(bob), ether("100"));

                // Let Charlie and Bob burn some of their locked PRPS
                receipt = await prps.burn(ether("70"), "0x", { from: bob });
                await expectEvent(receipt, "PendingOp", {
                    from: bob,
                    opId: "1",
                });

                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(bob), ether("100"));

                receipt = await prps.burn(ether("1"), "0x", { from: charlie });
                await expectEvent(receipt, "PendingOp", {
                    from: charlie,
                    opId: "1",
                });

                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ether("100"));
                expectBigNumber(await prps.hodlBalanceOf(bob), ether("100"));

                receipt = await prps.finalizePendingOp(charlie, { opType: 1, opId: 1 }, { from: deployment.booster });
                await expectEvent(receipt, "FinalizedOp", {
                    from: charlie,
                    opId: "1",
                });
                await expectEvent(receipt, "Burned");

                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ether("99"));
                expectBigNumber(await prps.hodlBalanceOf(bob), ether("100"));

                // Finalize Bob
                receipt = await prps.finalizePendingOp(bob, { opType: 1, opId: 1 }, { from: deployment.booster });
                await expectEvent(receipt, "FinalizedOp", {
                    from: bob,
                    opId: "1",
                });
                await expectEvent(receipt, "Burned");

                expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
                expectBigNumber(await prps.hodlBalanceOf(charlie), ether("99"));
                expectBigNumber(await prps.hodlBalanceOf(bob), ether("30"));
            });
        })

    });

    describe("Boosted", () => {
        it("should hodl", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            const { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                hodlId: 1,
                creator: boostedAlice.address,
                amountPrps: amount,
                duration: 0,
                dubiBeneficiary: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            });

            const receipt = await hodl.boostedHodl(message, signature, { from: deployment.booster });
            expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
        });

        it("should release", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            let { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                hodlId: 1,
                creator: boostedAlice.address,
                amountPrps: amount,
                duration: hodlDurationMonthsToDays(3),
                dubiBeneficiary: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            });

            await hodl.boostedHodl(message, signature, { from: deployment.booster });

            ({ message, signature } = await createSignedBoostedReleaseMessage(deployment.web3, {
                creator: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                id: new BN(1),
                nonce: new BN(2),
                signer: boostedAlice, // prps beneficiary
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            }));

            await expectRevert(hodl.boostedRelease(message, signature, { from: deployment.booster }), "H-8");
            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

            ({ message, signature } = await createSignedBoostedReleaseMessage(deployment.web3, {
                creator: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                id: new BN(1),
                nonce: new BN(2),
                signer: boostedAlice, // prps beneficiary
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            }));

            const receipt = await hodl.boostedRelease(message, signature, { from: deployment.booster, gas: 300_000 });
            console.log(receipt.receipt.gasUsed);
            expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
        });

        it("should not release if not signed by prps beneficiary", async () => {
            const [boostedAlice, boostedBob] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            let { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                hodlId: 1,
                creator: boostedAlice.address,
                amountPrps: amount,
                duration: hodlDurationMonthsToDays(3),
                dubiBeneficiary: boostedAlice.address,
                prpsBeneficiary: boostedBob.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            });

            await hodl.boostedHodl(message, signature, { from: deployment.booster });

            ({ message, signature } = await createSignedBoostedReleaseMessage(deployment.web3, {
                creator: boostedAlice.address,
                prpsBeneficiary: boostedBob.address,
                id: new BN(1),
                nonce: new BN(1),
                signer: boostedAlice, // wrong prps beneficiary
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            }));

            await expectRevert(hodl.boostedRelease(message, signature, { from: deployment.booster }), "AB-5");

            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3 + 1));

            await expectRevert(hodl.boostedRelease(message, signature, { from: deployment.booster }), "AB-4");

            ({ message, signature } = await createSignedBoostedReleaseMessage(deployment.web3, {
                creator: boostedAlice.address,
                prpsBeneficiary: boostedBob.address,
                id: new BN(1),
                nonce: new BN(1),
                signer: boostedBob, // correct prps beneficiary
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            }));

            // Now it can be released
            await hodl.boostedRelease(message, signature, { from: deployment.booster })

            expectBigNumber(await prps.balanceOf(boostedBob.address), amount);
        });

        it("should withdraw", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            let { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                hodlId: 1,
                creator: boostedAlice.address,
                amountPrps: amount,
                duration: 0,
                dubiBeneficiary: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            });

            await hodl.boostedHodl(message, signature, { from: deployment.booster });

            // Wait three months for 1% DUBI
            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

            ({ message, signature } = await createSignedBoostedWithdrawalMessage(deployment.web3, {
                creator: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                id: new BN(1),
                nonce: new BN(2),
                signer: boostedAlice, // dubi beneficiary
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            }));

            const receipt = await hodl.boostedWithdraw(message, signature, { from: deployment.booster, gas: 300_000 });
            expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("50000"));
        });

        it("should not withdraw if not signed by dubi beneficiary", async () => {
            const [boostedAlice, boostedBob] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            let { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                hodlId: 1,
                creator: boostedAlice.address,
                amountPrps: amount,
                duration: 0,
                dubiBeneficiary: boostedBob.address,
                prpsBeneficiary: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            });

            await hodl.boostedHodl(message, signature, { from: deployment.booster });

            ({ message, signature } = await createSignedBoostedWithdrawalMessage(deployment.web3, {
                creator: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                id: new BN(1),
                nonce: new BN(1),
                signer: boostedAlice, // wrong dubi beneficiary
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            }));

            await expectRevert(hodl.boostedWithdraw(message, signature, { from: deployment.booster }), "AB-5");

            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

            await expectRevert(hodl.boostedWithdraw(message, signature, { from: deployment.booster }), "AB-4");

            ({ message, signature } = await createSignedBoostedWithdrawalMessage(deployment.web3, {
                creator: boostedAlice.address,
                prpsBeneficiary: boostedAlice.address,
                id: new BN(1),
                nonce: new BN(1),
                signer: boostedBob, // correct prps beneficiary
                verifyingContract: deployment.Hodl.address,
                booster: deployment.booster,
            }));

            const receipt = await hodl.boostedWithdraw(message, signature, { from: deployment.booster, gas: 300_000 });
            console.log(receipt.receipt.gasUsed);
            expectBigNumberApprox(await dubi.balanceOf(boostedBob.address), ether("50000"), ether("1").div(new BN(100)));
        });

        it("should burn locked PRPS and skip dependent hodls", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await prps.mint(boostedAlice.address, ether("10000"));

            // Create 7 locks 1000 PRPS each unboosted

            await hodl.hodl("1", ether("1000"), HODL_MAX_DURATION, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            await hodl.hodl("2", ether("1000"), HODL_MAX_DURATION, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            await hodl.hodl("3", ether("1000"), HODL_MAX_DURATION, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            await hodl.hodl("4", ether("1000"), HODL_MAX_DURATION, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            await hodl.hodl("5", ether("1000"), HODL_MAX_DURATION, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            await hodl.hodl("6", ether("1000"), HODL_MAX_DURATION, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            await hodl.hodl("7", ether("1000"), 0, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

            expectBigNumber(await prps.balanceOf(boostedAlice.address), ether("3000"));
            expectBigNumber(await prps.balanceOf(hodl.address), ether("7000"));
            expectBigNumber(await dubi.balanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await dubi.balanceOf(hodl.address), ZERO);
            expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

            // Finalize them all
            await hodl.finalizePendingOp(boostedAlice.address, { opId: "1", opType: "2" }, { from: deployment.booster });
            await hodl.finalizePendingOp(boostedAlice.address, { opId: "2", opType: "2" }, { from: deployment.booster });
            await hodl.finalizePendingOp(boostedAlice.address, { opId: "3", opType: "2" }, { from: deployment.booster });
            await hodl.finalizePendingOp(boostedAlice.address, { opId: "4", opType: "2" }, { from: deployment.booster });
            await hodl.finalizePendingOp(boostedAlice.address, { opId: "5", opType: "2" }, { from: deployment.booster });
            await hodl.finalizePendingOp(boostedAlice.address, { opId: "6", opType: "2" }, { from: deployment.booster });
            await hodl.finalizePendingOp(boostedAlice.address, { opId: "7", opType: "2" }, { from: deployment.booster });

            expectBigNumber(await prps.balanceOf(boostedAlice.address), ether("3000"));
            expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
            expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("7000"));
            expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
            expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("280"));
            expectBigNumber(await dubi.balanceOf(hodl.address), ZERO)

            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            // Create dependent op on last hodl (=infinite)
            await hodl.withdraw("7", boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            let infiniteHodl = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "7");
            expect(infiniteHodl.hasDependentHodlOp).to.be.true;

            let burntHodl = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "6");
            expectBigNumber(burntHodl.id, new BN("6")); // not deleted yet

            // Boosted burn 3000 unlocked PRPS and 1000 locked PRPS (= 1 hodl)
            let { message, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount: ether("4000"),
                account: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
            });

            await prps.boostedBurn(message, signature, { from: deployment.booster });

            // Burn 1 lock
            // Locks are burned from most recent to oldest. The most recent is the infinite hodl(id=7), but
            // since it has a dependent op it is skipped and hodl(id=6) is completely burned.

            // Untouched
            infiniteHodl = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "7");
            expect(infiniteHodl.hasDependentHodlOp).to.be.true;

            // Deleted
            burntHodl = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "6");
            expectBigNumber(burntHodl.id, ZERO); // deleted

            expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.balanceOf(hodl.address), ZERO);

            expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("6000"));
            expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);

            // Since 4k has been burnt, she gets 4000*0.04 worth of DUBI = 160
            expectBigNumberApprox(await dubi.balanceOf(boostedAlice.address), ether("440"), ether("1").div(new BN(100_000)));
            expectBigNumber(await dubi.balanceOf(hodl.address), ether("0"))

            // Occupy hodl 2 and 4
            // Create dependent op on last hodl (=infinite)
            await hodl.release("2", boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            let hodl2 = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "2");
            expect(hodl2.hasDependentHodlOp).to.be.true;

            await hodl.release("4", boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });
            let hodl4 = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "4");
            expect(hodl4.hasDependentHodlOp).to.be.true;

            // Now the remaining burnable hodls are:
            // Hodl 1, Hodl 2, Hodl 3, Hodl 4, Hodl 5, Hodl 7
            //  OK       X       OK      X       OK     X

            // Boost burn 3000 PRPS, which will delete all non-dependent locks
            ({ message, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount: ether("3000"),
                account: boostedAlice.address,
                nonce: new BN(2),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
            }));

            await prps.boostedBurn(message, signature, { from: deployment.booster });

            // Deleted
            let hodl1 = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "1");
            expectBigNumber(hodl1.id, ZERO);

            // Untouched
            hodl2 = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "2");
            expectBigNumber(hodl2.burnedLockedPrps, ZERO);
            expect(hodl2.hasDependentHodlOp).to.be.true;

            // Deleted
            let hodl3 = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "3");
            expectBigNumber(hodl3.id, ZERO);

            // Untouched
            hodl4 = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "4");
            expectBigNumber(hodl4.burnedLockedPrps, ZERO);
            expect(hodl4.hasDependentHodlOp).to.be.true;

            // Deleted
            let hodl5 = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "5");
            expectBigNumber(hodl5.id, ZERO);

            // Untouched
            infiniteHodl = await getHodl(hodl, boostedAlice.address, boostedAlice.address, "7");
            expectBigNumber(infiniteHodl.burnedLockedPrps, ZERO);
            expect(infiniteHodl.hasDependentHodlOp).to.be.true;

            // Assert balances
            expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.hodlBalanceOf(boostedAlice.address), ether("3000"));
            expectBigNumber(await prps.hodlBalanceOf(hodl.address), ZERO);
            expectBigNumber(await prps.balanceOf(hodl.address), ZERO);

            // Minted roughly 3x 4% = 120 DUBI
            expectBigNumberApprox(await dubi.balanceOf(boostedAlice.address), ether("560"), ether("1").div(new BN(100_000)));
            expectBigNumber(await dubi.balanceOf(hodl.address), ether("0"))
        })
    });

    describe("Boosted - Batch", () => {

        it("should batch hodl", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            // Hodl 5 times 10 PRPS from alice
            const messages: any[] = [];
            const signatures: any[] = [];

            for (let i = 0; i < 5; i++) {
                const { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                    hodlId: (i + 1),
                    creator: boostedAlice.address,
                    amountPrps: ether("10"),
                    duration: HODL_MAX_DURATION,
                    dubiBeneficiary: boostedAlice.address,
                    prpsBeneficiary: boostedAlice.address,
                    nonce: new BN(i + 1),
                    signer: boostedAlice,
                    verifyingContract: deployment.Hodl.address,
                    booster: deployment.booster,

                });

                messages.push(message);
                signatures.push(signature);
            }

            await hodl.boostedHodlBatch(messages, signatures, { from: deployment.booster, gas: 1_500_000 });

            // 5 times 10 ether for 12 months => 2 DUBI
            expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("2"));
        });

        it("should batch release", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            // Create 5 locks
            {
                const messages: any[] = [];
                const signatures: any[] = [];

                for (let i = 0; i < 5; i++) {
                    const { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                        hodlId: (i + 1),
                        creator: boostedAlice.address,
                        amountPrps: ether("10"),
                        duration: HODL_MAX_DURATION,
                        dubiBeneficiary: boostedAlice.address,
                        prpsBeneficiary: boostedAlice.address,
                        nonce: new BN(i + 1),
                        signer: boostedAlice,
                        verifyingContract: deployment.Hodl.address,
                        booster: deployment.booster,
                    });

                    messages.push(message);
                    signatures.push(signature);
                }

                await hodl.boostedHodlBatch(messages, signatures, { from: deployment.booster, gas: 1_500_000 });

                // 5 times 10 ether for 12 months => 2 DUBI
                expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("2"));
            }

            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            // Release all 5 locks
            {
                const alicePrpsBefore: any = await prps.balanceOf(boostedAlice.address);

                const messages: any[] = [];
                const signatures: any[] = [];

                for (let i = 0; i < 5; i++) {
                    const { message, signature } = await createSignedBoostedReleaseMessage(deployment.web3, {
                        creator: boostedAlice.address,
                        prpsBeneficiary: boostedAlice.address,
                        id: new BN(i + 1),
                        nonce: new BN(i + 1 + 5),  // the previous HODL increased alice's nonce to 5
                        signer: boostedAlice,
                        verifyingContract: deployment.Hodl.address,
                        booster: deployment.booster,
                    });

                    messages.push(message);
                    signatures.push(signature);
                }

                await hodl.boostedReleaseBatch(messages, signatures, { from: deployment.booster, gas: 2_000_000 });
                const alicePrpsAfter: any = await prps.balanceOf(boostedAlice.address);
                expectBigNumber(alicePrpsAfter, alicePrpsBefore.add(ether("50")));
            }
        });

        it("should batch withdraw", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            // Create 5 locks
            {
                const messages: any[] = [];
                const signatures: any[] = [];

                for (let i = 0; i < 5; i++) {
                    const { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
                        hodlId: (i + 1),
                        creator: boostedAlice.address,
                        amountPrps: ether("100"),
                        duration: 0, // infinite lock
                        dubiBeneficiary: boostedAlice.address,
                        prpsBeneficiary: boostedAlice.address,
                        nonce: new BN(i + 1),
                        signer: boostedAlice,
                        verifyingContract: deployment.Hodl.address,
                        booster: deployment.booster,
                    });

                    messages.push(message);
                    signatures.push(signature);
                }

                await hodl.boostedHodlBatch(messages, signatures, { from: deployment.booster, gas: 1_500_000 });

            }

            // 4% of 100 * 5 = 20
            expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("20"));

            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            // Withdraw from all 5 locks
            {
                const aliceDubiBefore: any = await dubi.balanceOf(boostedAlice.address);

                const messages: any[] = [];
                const signatures: any[] = [];

                for (let i = 0; i < 5; i++) {
                    const { message, signature } = await createSignedBoostedWithdrawalMessage(deployment.web3, {
                        creator: boostedAlice.address,
                        prpsBeneficiary: boostedAlice.address,
                        id: new BN(i + 1),
                        nonce: new BN(i + 1 + 5),  // the previous HODL increased alice's nonce to 5
                        signer: boostedAlice,
                        verifyingContract: deployment.Hodl.address,
                        booster: deployment.booster,
                    });

                    messages.push(message);
                    signatures.push(signature);
                }

                await hodl.boostedWithdrawBatch(messages, signatures, { from: deployment.booster, gas: 2_000_000 });
                const aliceDubiAfter: any = await dubi.balanceOf(boostedAlice.address);
                expectBigNumberApprox(aliceDubiAfter, aliceDubiBefore.add(ether("20")));
            }
        });
    });
});

interface OpCounterValues {
    value: number,
    nextFinalize: number,
    nextRevert: number,
}

interface OpCounter {
    before: OpCounterValues,
    after: OpCounterValues,
}

interface ExpectOptsHodl {
    hodlId: number,
    account: string,
    opCounter: OpCounter,
    balancesBefore: () => Promise<void>,
    balancesAfter: () => Promise<void>,
}

interface ExpectPendingHodlOpts {
    hodlId: number,
    amount: any,
    duration: any,
    dubiBeneficiary: string,
    prpsBeneficiary: string,
    opCounter: OpCounter,
    balancesBefore: () => Promise<void>,
    balancesAfter: () => Promise<void>,
}

interface ExpectPendingReleaseOpts extends ExpectOptsHodl {
    prpsBeneficiary: string;
}
interface ExpectPendingWithdrawOpts extends ExpectOptsHodl {
    prpsBeneficiary: string;
}

interface ExpectFinalizeHodlOpts extends ExpectOptsHodl {
    duration: number;
    lockedPrps: any;
    prpsBeneficiary?: string;
    dubiBeneficiary?: string;
}
interface ExpectFinalizeReleaseOpts extends ExpectOptsHodl { }
interface ExpectFinalizeWithdrawOpts extends ExpectOptsHodl { }
interface ExpectRevertOptsHodl extends ExpectOptsHodl {
    nonce: any,
    signer: { address: string, privateKey: string }
}
interface ExpectRevertHodlOpts extends ExpectRevertOptsHodl { }
interface ExpectRevertReleaseOpts extends ExpectRevertOptsHodl { }
interface ExpectRevertWithdrawOpts extends ExpectRevertOptsHodl { }

const expectPendingHodl = async (opts: ExpectPendingHodlOpts, details: Truffle.TransactionDetails) => {
    await expectOpCounter(details.from, opts.opCounter.before);

    await opts.balancesBefore();

    const receipt = await hodl.hodl(opts.hodlId, opts.amount, opts.duration, opts.dubiBeneficiary, opts.prpsBeneficiary, details);
    await expectOpCounter(details.from, opts.opCounter.after);
    console.log("PENDING HODL: " + receipt.receipt.gasUsed);

    await expectEvent(receipt, "PendingOp", {
        from: details.from,
        opId: `${opts.opCounter.after.value}`,
        opType: "2",
    });

    // After
    await opts.balancesAfter();
}

const expectFinalizeHodl = async (opts: ExpectFinalizeHodlOpts) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    // Op owner cannot finalize yet while not expired / opted-in
    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 2, opId: opts.opCounter.before.nextFinalize }, { from: opts.account }), "PB-4");

    // Booster can finalize
    const receipt = await hodl.finalizePendingOp(opts.account, { opType: 2, opId: opts.opCounter.before.nextFinalize }, { from: deployment.booster });

    await expectEvent(receipt, "FinalizedOp", {
        from: opts.account,
        opId: `${opts.opCounter.before.nextFinalize}`,
        opType: "2",
    });

    await expectOpCounter(opts.account, opts.opCounter.after);

    const _hodl = await getHodl(hodl, opts.account, opts.prpsBeneficiary ?? opts.account, opts.hodlId);
    expect(_hodl.creator).to.eq(opts.account);
    expect(_hodl.prpsBeneficiary).to.eq(opts.prpsBeneficiary ?? opts.account);
    expect(_hodl.dubiBeneficiary).to.eq(opts.dubiBeneficiary ?? opts.account);
    expectBigNumber(_hodl.id, new BN(opts.hodlId));
    expectBigNumber(_hodl.duration, new BN(opts.duration));
    expectBigNumber(_hodl.lockedPrps, opts.lockedPrps);

    await opts.balancesAfter();

    // Op gone
    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 2, opId: opts.opCounter.before.nextFinalize }, { from: deployment.booster }), "PB-1");
}

const expectRevertHodl = async (opts: ExpectRevertHodlOpts) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    // Create booster message from alice to be able to revert
    let { signature, messageBytes } = await createSignedBoostedBurnMessage(deployment.web3, {
        account: opts.account,
        amount,
        nonce: new BN(opts.nonce),
        signer: opts.signer,
        verifyingContract: deployment.Purpose.address,
        booster: deployment.booster,
    });

    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 2, opId: opts.opCounter.before.nextRevert }, { from: opts.account }), "PB-4");
    await expectRevert(hodl.revertPendingOp(opts.account, { opType: 2, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: opts.account }), "PB-6");

    // Booster can revert the pending op while it's not expired with the booster message
    const receipt = await hodl.revertPendingOp(opts.account, { opType: 2, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: deployment.booster });

    await expectOpCounter(opts.account, opts.opCounter.after);

    await expectEvent(receipt, "RevertedOp", {
        from: opts.account,
        opId: `${opts.opCounter.before.nextRevert}`,
        opType: "2",
    });

    await opts.balancesAfter();

    // Op gone
    await expectRevert(hodl.revertPendingOp(opts.account, { opType: 2, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: deployment.booster }), "PB-1");
}

const expectPendingRelease = async (opts: ExpectPendingReleaseOpts, details: Truffle.TransactionDetails) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    const receipt = await hodl.release(opts.hodlId, opts.prpsBeneficiary, opts.account, details);

    await expectOpCounter(opts.account, opts.opCounter.after);

    await expectEvent(receipt, "PendingOp", {
        from: details.from,
        opId: `${opts.opCounter.after.value}`,
        opType: "3",
    });

    await opts.balancesAfter();
}

const expectFinalizeRelease = async (opts: ExpectFinalizeReleaseOpts) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    // Op owner cannot finalize yet while not expired / opted-in
    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 3, opId: opts.opCounter.before.nextFinalize }, { from: opts.account }), "PB-4");

    // Booster can finalize
    const receipt = await hodl.finalizePendingOp(opts.account, { opType: 3, opId: opts.opCounter.before.nextFinalize }, { from: deployment.booster });

    await expectEvent(receipt, "FinalizedOp", {
        from: opts.account,
        opId: `${opts.opCounter.before.nextFinalize}`,
        opType: "3",
    });

    await expectOpCounter(opts.account, opts.opCounter.after);

    await opts.balancesAfter();

    // Op gone
    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 3, opId: opts.opCounter.before.nextFinalize }, { from: deployment.booster }), "PB-1");
}

const expectRevertRelease = async (opts: ExpectRevertReleaseOpts) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    // Create booster message to be able to revert
    let { signature, messageBytes } = await createSignedBoostedBurnMessage(deployment.web3, {
        account: opts.account,
        amount,
        nonce: new BN(opts.nonce),
        signer: opts.signer,
        verifyingContract: deployment.Purpose.address,
        booster: deployment.booster,
    });

    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 3, opId: opts.opCounter.before.nextRevert }, { from: opts.account }), "PB-4");
    await expectRevert(hodl.revertPendingOp(opts.account, { opType: 3, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: opts.account }), "PB-6");

    // Booster can revert the pending op while it's not expired with the booster message
    const receipt = await hodl.revertPendingOp(opts.account, { opType: 3, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: deployment.booster });

    await expectOpCounter(opts.account, opts.opCounter.after);

    await expectEvent(receipt, "RevertedOp", {
        from: opts.account,
        opId: `${opts.opCounter.before.nextRevert}`,
        opType: "3",
    });

    await opts.balancesAfter();

    // Op gone
    await expectRevert(hodl.revertPendingOp(opts.account, { opType: 3, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: deployment.booster }), "PB-1");
}

const expectPendingWithdraw = async (opts: ExpectPendingWithdrawOpts, details: Truffle.TransactionDetails) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    const receipt = await hodl.withdraw(opts.hodlId, opts.prpsBeneficiary, opts.account, details);

    await expectOpCounter(opts.account, opts.opCounter.after);

    await expectEvent(receipt, "PendingOp", {
        from: details.from,
        opId: `${opts.opCounter.after.value}`,
        opType: "4",
    });

    await opts.balancesAfter();
}

const expectFinalizeWithdraw = async (opts: ExpectFinalizeWithdrawOpts) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    // Op owner cannot finalize yet while not expired / opted-in
    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 4, opId: opts.opCounter.before.nextFinalize }, { from: opts.account }), "PB-4");

    // Booster can finalize
    const receipt = await hodl.finalizePendingOp(opts.account, { opType: 4, opId: opts.opCounter.before.nextFinalize }, { from: deployment.booster });

    await expectEvent(receipt, "FinalizedOp", {
        from: opts.account,
        opId: `${opts.opCounter.before.nextFinalize}`,
        opType: "4",
    });

    await expectOpCounter(opts.account, opts.opCounter.after);

    await opts.balancesAfter();

    // Op gone
    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 4, opId: opts.opCounter.before.nextFinalize }, { from: deployment.booster }), "PB-1");
}

const expectRevertWithdraw = async (opts: ExpectRevertWithdrawOpts) => {
    await expectOpCounter(opts.account, opts.opCounter.before);

    await opts.balancesBefore();

    // Create booster message to be able to revert
    let { signature, messageBytes } = await createSignedBoostedBurnMessage(deployment.web3, {
        account: opts.account,
        amount,
        nonce: new BN(opts.nonce),
        signer: opts.signer,
        verifyingContract: deployment.Purpose.address,
        booster: deployment.booster,
    });

    await expectRevert(hodl.finalizePendingOp(opts.account, { opType: 4, opId: opts.opCounter.before.nextRevert }, { from: opts.account }), "PB-4");
    await expectRevert(hodl.revertPendingOp(opts.account, { opType: 4, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: opts.account }), "PB-6");

    // Booster can revert the pending op while it's not expired with the booster message
    const receipt = await hodl.revertPendingOp(opts.account, { opType: 4, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: deployment.booster });

    await expectOpCounter(opts.account, opts.opCounter.after);

    await expectEvent(receipt, "RevertedOp", {
        from: opts.account,
        opId: `${opts.opCounter.before.nextRevert}`,
        opType: "4",
    });

    await opts.balancesAfter();

    // Op gone
    await expectRevert(hodl.revertPendingOp(opts.account, { opType: 4, opId: opts.opCounter.before.nextRevert }, messageBytes, signature, { from: deployment.booster }), "PB-1");
}
const expectOpCounter = async (user: any, { value, nextRevert, nextFinalize, }: OpCounterValues) => {
    // Hodl calls into PRPS for the pending op state so they have to be identical
    const opCounterHodl = await hodl.getOpCounter(user);
    expectBigNumber(opCounterHodl.value, new BN(value));
    expectBigNumber(opCounterHodl.nextFinalize, new BN(nextFinalize));
    expectBigNumber(opCounterHodl.nextRevert, new BN(nextRevert));

    const opCounterPrps = await prps.getOpCounter(user);
    expectBigNumber(opCounterHodl.value, opCounterPrps.value);
    expectBigNumber(opCounterHodl.nextFinalize, opCounterPrps.nextFinalize);
    expectBigNumber(opCounterHodl.nextRevert, opCounterPrps.nextRevert);

    const optedInTo = await deployment.OptIn.getOptedInAddressOf(user);

    if (nextFinalize > 0) {
        // must exist
        expect((await hodl.getOpMetadata(user, nextFinalize)).booster).to.eq(optedInTo)
        expect((await prps.getOpMetadata(user, nextFinalize)).booster).to.eq(optedInTo);
    }

    if (nextRevert > 0) {
        // must exist
        expect((await hodl.getOpMetadata(user, nextRevert)).booster).to.eq(optedInTo);
        expect((await prps.getOpMetadata(user, nextRevert)).booster).to.eq(optedInTo);
    }
}
