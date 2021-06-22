import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, expectEvent, expectRevert, time, constants } from "@openzeppelin/test-helpers";
import { OptInInstance } from "../types/contracts"
import { expect } from "chai";
import { deployTestnet, expectBigNumber } from "./support";
import { PurposeDeployment, ZERO } from "../src/types";

const [alice, bob, charlie, dave] = accounts;

const OptIn = contract.fromArtifact("OptIn");

let deployment: PurposeDeployment;
let optIn: OptInInstance;

beforeEach(async () => {
    deployment = await deployTestnet();
    optIn = deployment.OptIn;
});

const optOutPeriod = async (): Promise<number> => {
    return (await optIn.getOptOutPeriod()).toNumber();
}

describe("OptIn", () => {
    it("should be opted-in by default", async () => {
        await expectIsOptedIn(alice, true);

        await expectIsOptedInBy(deployment.booster, alice, true);
        await expectIsOptedInBy(bob, alice, false);

        expectBigNumber(await optIn.getPendingOptOutRemaining(alice), ZERO);
    });

    it("should active permaboost and then renounce ownership", async () => {
        const expectAll = async () => {
            await expectIsOptedIn(alice, true);

            // Default address is also opted-in by default
            await expectIsOptedIn(deployment.Hodl.address, true);
            await expectIsOptedIn(deployment.booster, true);

            await expectIsOptedInBy(deployment.booster, alice, true);
            await expectIsOptedInBy(deployment.booster, bob, true);

            await expectIsOptedInBy(alice, deployment.booster, false);
            await expectIsOptedInBy(bob, deployment.booster, false);

            await expectIsOptedInBy(alice, alice, false);
            await expectIsOptedInBy(bob, alice, false);
            await expectIsOptedInBy(alice, bob, false);
            await expectIsOptedInBy(bob, bob, false);
        }

        expect(await optIn.getPermaBoostActive()).to.be.false;
        let status = await optIn.getOptInStatus(alice);
        expect(status.permaBoostActive).to.be.false;

        // This should be the same before and after permaboost is active
        await expectAll();

        const receipt = await optIn.activateAndRenounceOwnership({ from: deployment.owner });
        await expectEvent(receipt, "OwnershipTransferred", {
            previousOwner: deployment.owner,
            newOwner: constants.ZERO_ADDRESS,
        });

        expect(await optIn.owner()).to.eq(constants.ZERO_ADDRESS);
        expect(await optIn.getPermaBoostActive()).to.be.true;
        status = await optIn.getOptInStatus(alice);
        expect(status.permaBoostActive).to.be.true;

        // Still opted-in
        await expectAll();

        await expectRevert(optIn.activateAndRenounceOwnership({ from: deployment.owner }), "Ownable: caller is not the owner");
    });

    it("should opt-in caller", async () => {
        // First alice needs to opt-out
        await optIn.optOut({ from: alice });

        // Still pending
        await expectIsOptedIn(alice, true);
        await expectIsOptedInBy(deployment.booster, alice, true);
        await expectIsOptedInBy(bob, alice, false);

        // Wait
        await time.increase(time.duration.seconds(await optOutPeriod()));

        // No longer opted-in
        await expectIsOptedIn(alice, false);
        await expectIsOptedInBy(deployment.booster, alice, false);
        await expectIsOptedInBy(bob, alice, false);

        // Opt-in bob
        const receipt = await optIn.optIn(bob, { from: alice });
        await expectEvent(receipt, "OptedIn", {
            account: alice,
            to: bob,
        });

        await expectIsOptedIn(alice, true);
        await expectIsOptedInBy(bob, alice, true);
        await expectIsOptedInBy(charlie, alice, false);
        await expectIsOptedInBy(charlie, charlie, false);
    });

    it("should opt-out caller after opt-out period ends", async () => {
        await optIn.optOut({ from: alice });
        await time.increase(time.duration.seconds(await optOutPeriod()));

        // New opt-in
        await expectIsOptedIn(alice, false);
        await expectIsOptedInBy(bob, alice, false);

        await optIn.optIn(bob, { from: alice });

        await expectIsOptedIn(alice, true);
        await expectIsOptedInBy(bob, alice, true);

        const receipt = await optIn.optOut({ from: alice });
        await expectEvent(receipt, "OptedOut", {
            account: alice,
            to: bob,
        });

        await expectRevert(optIn.optIn(bob, { from: alice }), "OptIn: sender already opted-in");
        await expectRevert(optIn.optIn(charlie, { from: alice }), "OptIn: sender already opted-in");

        await expectIsOptedIn(alice, true);
        await expectIsOptedInBy(bob, alice, true);

        // Opt-out period almost over with 60 seconds left
        await time.increase(time.duration.seconds(await optOutPeriod()) - 60);

        await expectIsOptedIn(alice, true);
        await expectIsOptedInBy(bob, alice, true);

        // Now Alice is no longer opted-in
        await time.increase(time.duration.seconds(60));

        await expectIsOptedIn(alice, false);
        await expectIsOptedInBy(bob, alice, false);
    });

    it("should return opt-out period", async () => {
        const seconds = await optOutPeriod();
        // Equals 1 day
        expect(seconds).to.eq(24 * 60 * 60);
    });

    it("should not opt-out caller, when not opted-in", async () => {
        await optIn.instantOptOut(alice, { from: deployment.booster });
        await expectRevert(optIn.optOut({ from: alice }), "OptIn: sender not opted-in");
    });

    it("should not opt-out caller, when already opted-out", async () => {
        await optIn.optOut({ from: alice })

        await expectRevert(optIn.optOut({ from: alice }), "OptIn: sender not opted-in or opt-out pending");
        await time.increase(time.duration.seconds(await optOutPeriod()));

        await optIn.optIn(bob, { from: alice });
        await optIn.optOut({ from: alice })
    });

    it("should not opt-in caller, when already opted-in", async () => {
        await expectRevert(optIn.optIn(bob, { from: alice }), "OptIn: sender already opted-in");
    });

    it("should return remaining opt-out period", async () => {
        expectBigNumber(await optIn.getPendingOptOutRemaining(alice, { from: bob }), ZERO);

        // Opted-out and checked immeditately => full duration
        const optOutPeriodSeconds = await optOutPeriod();

        await optIn.optOut({ from: alice })
        expectBigNumber(await optIn.getPendingOptOutRemaining(alice, { from: bob }), new BN(optOutPeriodSeconds));

        // Period is almost over => 60s
        await time.increase(time.duration.seconds(optOutPeriodSeconds - 60));
        await expectIsOptedIn(alice, true);

        // Period is over => 0s
        await time.increase(time.duration.seconds(60));
        expectBigNumber(await optIn.getPendingOptOutRemaining(alice, { from: bob }), ZERO)
        await expectIsOptedIn(alice, false);
    });

    it("should opt-in default address", async () => {
        const optIn2: OptInInstance = await OptIn.new(deployment.booster);

        const expectIsOptedIn2 = async (account: string, yesOrNo: boolean) => {
            const status = await optIn2.getOptInStatus(account);
            expect(status.isOptedIn).to.be[yesOrNo ? "true" : "false"];
        }

        // Booster is opted--in by default as well
        await expectIsOptedIn2(deployment.booster, true);

        // But he can opt-out
        await optIn2.instantOptOut(deployment.booster, { from: deployment.booster });

        await expectIsOptedIn2(deployment.booster, false);

        // Then opt-in doesn't work again
        await expectRevert(optIn2.optIn(alice, { from: deployment.booster }), "OptIn: default address cannot opt-in");
    });

    it("should not opt-in contracts again after opt-out", async () => {
        // Everything is opted-in by default for efficiency reasons
        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(deployment.Hodl.address, true);
        await expectIsOptedIn(deployment.Dubi.address, true);
        await expectIsOptedIn(deployment.Purpose.address, true);

        await optIn.instantOptOut(deployment.Hodl.address, { from: deployment.booster });
        await optIn.instantOptOut(deployment.Dubi.address, { from: deployment.booster });
        await optIn.instantOptOut(deployment.Purpose.address, { from: deployment.booster });

        // However, opting-out and then opting-in again fails
        await expectIsOptedIn(deployment.Hodl.address, false);
        await expectIsOptedIn(deployment.Dubi.address, false);
        await expectIsOptedIn(deployment.Purpose.address, false);

        await expectRevert(optIn.optIn(deployment.booster, { from: deployment.Hodl.address }), "OptIn: sender is a contract");
        await expectRevert(optIn.optIn(deployment.booster, { from: deployment.Dubi.address }), "OptIn: sender is a contract");
        await expectRevert(optIn.optIn(deployment.booster, { from: deployment.Purpose.address }), "OptIn: sender is a contract");
    });

    it("should instantly opt-out", async () => {
        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);

        const receipt = await optIn.instantOptOut(alice, { from: deployment.booster });
        await expectEvent(receipt, "OptedOut", {
            account: alice,
            to: deployment.booster,
        });

        await expectIsOptedIn(alice, false);
        await expectIsOptedIn(bob, true);

        // Alice can opt-in again
        await optIn.optIn(deployment.booster, { from: alice });
        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);
    });

    it("should instantly opt-out while already pending", async () => {
        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);

        let receipt = await optIn.optOut({ from: alice });
        await expectEvent(receipt, "OptedOut", {
            account: alice,
            to: deployment.booster,
        });

        // Wait a bit
        await time.increase(time.duration.seconds(24800));

        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);

        receipt = await optIn.instantOptOut(alice, { from: deployment.booster });
        await expectEvent(receipt, "OptedOut");

        await expectIsOptedIn(alice, false);
        await expectIsOptedIn(bob, true);

        // Alice can opt-in again
        await optIn.optIn(deployment.booster, { from: alice });
        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);
    });

    it("should revert when instant opt-out called by non-booster", async () => {
        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);

        await expectRevert(optIn.instantOptOut(alice, { from: bob }), "OptIn: account must be opted-in to msg.sender");

        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);

        // Also doesn't work if alice is pending
        await optIn.optOut({ from: alice });
        await expectRevert(optIn.instantOptOut(alice, { from: bob }), "OptIn: account must be opted-in to msg.sender");

        await expectIsOptedIn(alice, true);
        await expectIsOptedIn(bob, true);
    });

    it("should revert when instant opt-out called for non-opted-in account", async () => {
        // Opt-out alice for good
        await optIn.instantOptOut(alice, { from: deployment.booster });

        await expectIsOptedIn(alice, false);
        await expectIsOptedIn(bob, true);

        // Calling again fails now
        await expectRevert(optIn.instantOptOut(alice, { from: deployment.booster }), "OptIn: cannot instant opt-out not opted-in account");
    });
});

const expectIsOptedIn = async (account: string, yesOrNo: boolean) => {
    const status = await optIn.getOptInStatus(account);
    expect(status.isOptedIn).to.eq(yesOrNo);

    const pair = await optIn.getOptInStatusPair(account, account);
    expect(pair[0].isOptedIn).to.eq(yesOrNo);
    expect(pair[1].isOptedIn).to.eq(yesOrNo);
}

const expectIsOptedInBy = async (booster: string, account: string, yesOrNo: boolean) => {
    const status = await optIn.getOptInStatus(account);
    const isOptedInTo = booster === status.optedInTo;
    expect(isOptedInTo).to.eq(yesOrNo);

    const optedInTo = await optIn.getOptedInAddressOf(account);
    if (yesOrNo) {
        expect(optedInTo).to.eq(booster);
    } else {
        expect(optedInTo).to.not.eq(booster);
    }
}
