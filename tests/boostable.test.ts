import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, expectRevert, ether, constants, time } from "@openzeppelin/test-helpers";
import { OptInInstance, DummyBoostableInstance } from "../types/contracts"
import { expect } from "chai";
import { deployTestnet, expectBigNumber, mockBoosterSignaturesAndMessages } from "./support";
import { PurposeDeployment, ZERO } from "../src/types";
import Web3 from "web3";
import { blockchainTimestampWithOffset, createSignedBoostedBurnMessage, createSignedBoostedSendMessage, fixSignature, toSignatureTriple } from "../src/utils";

const [alice, bob] = accounts;

const Boostable = contract.fromArtifact("DummyBoostable");

let deployment: PurposeDeployment;
let optIn: OptInInstance;
let boostable: DummyBoostableInstance;

beforeEach(async () => {
    deployment = await deployTestnet();
    optIn = deployment.OptIn;

    await Boostable.detectNetwork();
    await Boostable.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
    boostable = await Boostable.new(optIn.address);
});

describe("Boostable", () => {
    it("should verify booster signature and increase nonce", async () => {
        expectBigNumber(await boostable.getNonce(alice), ZERO);

        const boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: 1,
            booster: deployment.booster,
            signer: alice,
        });

        // Doesn't revert
        await boostable.verifyBoost(alice, "best", "game", {
            booster: deployment.booster,
            nonce: 1,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster });

        expectBigNumber(await boostable.getNonce(alice), new BN(1));
    });

    it("should verify booster signature and not increase nonce", async () => {
        expectBigNumber(await boostable.getNonce(alice), ZERO);

        const boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: 1,
            booster: deployment.booster,
            signer: alice,
        });

        // Doesn't revert
        await boostable.verifyBoostWithoutNonce(alice, "best", "game", {
            booster: deployment.booster,
            nonce: 1,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster });

        expectBigNumber(await boostable.getNonce(alice), ZERO);
    });

    it("should fail if nonce already used", async () => {
        let boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: 1,
            booster: deployment.booster,
            signer: alice,
        });

        await boostable.verifyBoost(alice, "best", "game", {
            nonce: 1,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            booster: deployment.booster,
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster });

        await expectRevert(boostable.verifyBoost(alice, "best", "game", {
            nonce: 1,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            booster: deployment.booster,
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-1");

        // Simply changing nonce without updating signature doesn't work either
        await expectRevert(boostable.verifyBoost(alice, "best", "game", {
            nonce: 2,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            booster: deployment.booster,
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-5");

        // Ok
        boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: 2,
            booster: deployment.booster,
            signer: alice,
        });

        await boostable.verifyBoost(alice, "best", "game", {
            nonce: 2,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            booster: deployment.booster,
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster })
    });

    it("should fail if msg.sender is not opted-in by origin", async () => {
        let boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: 1,
            booster: bob, // not the default booster
            signer: alice,
        });

        await expectRevert(boostable.verifyBoost(alice, "best", "game", {
            nonce: 1,
            timestamp: 0,
            booster: bob,
            isLegacySignature: false,
        }, boostedSignature, { from: bob }), "AB-3");
    });

    it("should return nonce of account", async () => {
        // Nonce starts at 0
        let nonce: any = await boostable.getNonce(alice);
        expectBigNumber(nonce, ZERO);

        let boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: nonce.add(new BN(1)).toString(),
            booster: deployment.booster,
            signer: alice,
        });

        await boostable.verifyBoost(alice, "best", "game", {
            nonce: nonce.add(new BN(1)).toString(),
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            booster: deployment.booster,
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster });

        // Nonce is now 1
        nonce = await boostable.getNonce(alice);
        expectBigNumber(nonce, new BN(1));

        boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: nonce.add(new BN(1)).toString(),
            booster: deployment.booster,
            signer: alice,
        });

        await boostable.verifyBoost(alice, "best", "game", {
            nonce: nonce.add(new BN(1)).toString(), booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster });

        // Nonce is now 2
        nonce = await boostable.getNonce(alice);
        expectBigNumber(nonce, new BN(2));

        // Using a nonce other than nonce + 1, results in an error
        await expectRevert(boostable.verifyBoost(alice, "best", "game", {
            nonce: 0, booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-1");

        await expectRevert(boostable.verifyBoost(alice, "best", "game", {
            nonce: nonce.add(new BN(2)).toString(), booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-1");

        await expectRevert(boostable.verifyBoost(alice, "best", "game", {
            nonce: nonce.toString(), booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-1");
    });

    it("should fail if payload doesn't match signature", async () => {
        let boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: 1,
            booster: deployment.booster,
            signer: alice,
        });

        // Valid signature doesn't blow up
        expect(await boostable.verifyBoost(alice, "best", "game", {
            nonce: 1, booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0), isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }));

        boostedSignature = await createBoostedSignature({
            a: "best",
            b: "game",
            nonce: 2,
            booster: deployment.booster,
            signer: alice,
        });

        // Swapped arguments invalidate the signature
        await expectRevert(boostable.verifyBoost(alice, "bestgame", "", {
            nonce: 2, booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-5");
        await expectRevert(boostable.verifyBoost(alice, "", "bestgame", {
            nonce: 2, booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-5");

        // Completely different arguments invalidate the signature
        await expectRevert(boostable.verifyBoost(alice, "asdf", "1234", {
            nonce: 2, booster: deployment.booster, timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
            isLegacySignature: false,
        }, boostedSignature, { from: deployment.booster }), "AB-5");
    });

    it("should accept legacy signature when signed via personal sign", async () => {
        const [boostedAlice] = deployment.boostedAddresses;

        await deployment.Purpose.mint(boostedAlice.address, ether("100000"));

        let { message, messageBytes, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
            amount: ether("1000"),
            account: boostedAlice.address,
            nonce: new BN(1),
            signer: boostedAlice,
            verifyingContract: deployment.Purpose.address,
            booster: deployment.booster,
            fuel: {},
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
        });

        // Works fine if signed EIP712 the standard way
        expect(await deployment.Purpose.boostedBurn(message, signature, { from: deployment.booster }));

        // Now pretend to be signing the message bytes via personal_sign (e.g. ledger, trezor)
        //
        let messageHash;
        ({ message, messageBytes, messageHash } = await createSignedBoostedBurnMessage(deployment.web3, {
            amount: ether("1000"),
            account: boostedAlice.address,
            nonce: new BN(2),
            signer: boostedAlice,
            verifyingContract: deployment.Purpose.address,
            booster: deployment.booster,
            fuel: {},
            isLegacySignature: true,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
        }));

        let personallySigned = fixSignature(await deployment.web3.eth.sign(messageHash, boostedAlice.address));
        signature = toSignatureTriple(personallySigned);

        // Works
        let receipt = await deployment.Purpose.boostedBurn(message, signature, { from: deployment.booster });
        // console.log(receipt.receipt.gasUsed);
        // => 60525

        ({ message, messageBytes, messageHash } = await createSignedBoostedBurnMessage(deployment.web3, {
            amount: ether("1000"),
            account: boostedAlice.address,
            nonce: new BN(3),
            signer: boostedAlice,
            verifyingContract: deployment.Purpose.address,
            booster: deployment.booster,
            fuel: {},
            isLegacySignature: false,
            timestamp: await blockchainTimestampWithOffset(deployment.web3, 0),
        }));

        personallySigned = fixSignature(await deployment.web3.eth.sign(messageHash, boostedAlice.address));
        signature = toSignatureTriple(personallySigned);

        // Works also if not specifying 'isLegacySignature', but will be more expensive
        receipt = await deployment.Purpose.boostedBurn(message, signature, { from: deployment.booster });
        // console.log(receipt.receipt.gasUsed);
        // => 64522
    });

    it("should fail if signature expired", async () => {
        const expectTimestamp = async (timestamp: number, nonce: number, revertReason?: string): Promise<void> => {
            let boostedSignature = await createBoostedSignature({
                a: "best",
                b: "game",
                nonce,
                booster: deployment.booster,
                signer: alice,
            });

            if (!revertReason) {
                expect(await boostable.verifyBoost(alice, "best", "game", { nonce, booster: deployment.booster, timestamp, isLegacySignature: false, }, boostedSignature, { from: deployment.booster }));
            } else {
                await expectRevert(boostable.verifyBoost(alice, "best", "game", { nonce, booster: deployment.booster, timestamp, isLegacySignature: false, }, boostedSignature, { from: deployment.booster }), revertReason)
            }
        }

        // Timestamp equal to current block timestamp is valid
        let timestamp = await blockchainTimestampWithOffset(deployment.web3, 0);
        await expectTimestamp(timestamp, 1);

        // Timestamp can be up to 60 minutes in the future
        timestamp = await blockchainTimestampWithOffset(deployment.web3, 60 * 60);
        await expectTimestamp(timestamp, 2);

        // Too far in the future will blow up with a generic expired error
        timestamp = await blockchainTimestampWithOffset(deployment.web3, 60 * 60 + 5);
        await expectTimestamp(timestamp, 3, "AB-4");

        // Timestamp can not be older than the opt-out period
        const optOutPeriod = (await optIn.getOptOutPeriod()).toNumber();
        timestamp = await blockchainTimestampWithOffset(deployment.web3, -optOutPeriod);
        await expectTimestamp(timestamp, 3);

        timestamp = await blockchainTimestampWithOffset(deployment.web3, -(optOutPeriod + 5));
        await expectTimestamp(timestamp, 4, "AB-4");
    });
});

describe("Boostable - Pending ops", () => {

    describe("opCounter", () => {

        const expectCounter = async (from: string, value: number, nextFinalize: number, nextRevert: number) => {
            // Assert counter after all pending ops have been reverted
            const counter = await boostable.getOpCounter(from);
            expectBigNumber(counter.value, new BN(value));
            expectBigNumber(counter.nextFinalize, new BN(nextFinalize));
            expectBigNumber(counter.nextRevert, new BN(nextRevert));
        }

        it("should correctly update on delete", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            await expectCounter(boostedAlice.address, 0, 0, 0);

            await boostable.createOpHandle(boostedAlice.address, 0); // 1
            await boostable.createOpHandle(boostedAlice.address, 0); // 2
            await boostable.createOpHandle(boostedAlice.address, 0); // 3
            await boostable.createOpHandle(boostedAlice.address, 0); // 4
            await boostable.createOpHandle(boostedAlice.address, 0); // 5

            // Remaining: [1,2,3,4,5]

            await expectCounter(boostedAlice.address, 5, 1, 5);

            // Delete 1
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 1, opType: 0 });
            await expectCounter(boostedAlice.address, 5, 2, 5);

            // Remaining: [2,3,4,5]

            // Delete 4
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 1, opType: 0 });
            await expectCounter(boostedAlice.address, 5, 2, 5);

            // Remaining: [2,3,5]

            // Delete 5
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 5, opType: 0 });
            await expectCounter(boostedAlice.address, 5, 2, 3);

            // Remaining: [2,3]

            // Create new handle
            await boostable.createOpHandle(boostedAlice.address, 0); // 6
            await expectCounter(boostedAlice.address, 6, 2, 6);

            // Remaining: [2,3,6]

            // Delete 3
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 3, opType: 0 });
            await expectCounter(boostedAlice.address, 6, 2, 6);

            // Remaining: [2,6]

            // Delete 2
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 2, opType: 0 });
            await expectCounter(boostedAlice.address, 6, 6, 6);

            // Remaining: [6]

            // Create new handle
            await boostable.createOpHandle(boostedAlice.address, 0); // 7
            await expectCounter(boostedAlice.address, 7, 6, 7);

            // Remaining: [6,7]

            // Delete 7
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 7, opType: 0 });
            await expectCounter(boostedAlice.address, 7, 6, 6);

            // Remaining: [6]

            // Delete 6
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 6, opType: 0 });
            await expectCounter(boostedAlice.address, 7, 0, 0);

            // Remaining: []

            // Create new handle
            await boostable.createOpHandle(boostedAlice.address, 0); // 8
            await expectCounter(boostedAlice.address, 8, 8, 8);

            // Remaining: [8]
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 8, opType: 0 });
            await expectCounter(boostedAlice.address, 8, 0, 0);
        });

        it("should not create more than MAX_PENDING_OPS opHandles", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            for (let i = 0; i < 25; i++) {
                await boostable.createOpHandle(boostedAlice.address, 0);
            }

            await expectCounter(boostedAlice.address, 25, 1, 25);

            // Trying to create more causes a revert
            await expectRevert(boostable.createOpHandle(boostedAlice.address, 0), "PB-3");

            // Freeing up a slot works
            await boostable.deleteOpHandle(boostedAlice.address, { opId: 25, opType: 0 });
            await expectCounter(boostedAlice.address, 25, 1, 24);
            await boostable.createOpHandle(boostedAlice.address, 0);
        });

    });

    describe("opMetaData", () => {

        it("should return opMetadata", async () => {
            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            const [boostedAlice] = deployment.boostedAddresses;
            await boostable.createOpHandle(boostedAlice.address, "27");

            let opMetadata = await boostable.getOpMetadata(boostedAlice.address, "1");
            expect(opMetadata.booster).to.eq(deployment.booster);
            expectBigNumber(opMetadata.opType, new BN(27));

            opMetadata = await boostable.safeGetOpMetadata(boostedAlice.address, { opId: "1", opType: "27" });
            expect(opMetadata.booster).to.eq(deployment.booster);
            expectBigNumber(opMetadata.opType, new BN(27));

            // safeGetOpMetadata blows up when it doesn't exist
            await expectRevert(boostable.safeGetOpMetadata(boostedAlice.address, { opId: "2", opType: "27" }), "PB-1");

            // getOpMetadata simply returns an empty item
            opMetadata = await boostable.getOpMetadata(boostedAlice.address, "99");
            expect(opMetadata.booster).to.eq(constants.ZERO_ADDRESS);
            expectBigNumber(opMetadata.opType, ZERO);
        });

    });

    describe("assertCanFinalize", () => {

        it("should not revert if finalize called by booster", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.createOpHandle(boostedAlice.address, 0);

            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: deployment.booster });
        });

        it("should not revert if finalize called by non-booster after expiry", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            await boostable.createOpHandle(boostedAlice.address, 0);

            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: bob }), "PB-4");
            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: boostedAlice.address }), "PB-4");

            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: deployment.booster });

            // Op expires after OPT_OUT period passed
            const optOutPeriod = (await optIn.getOptOutPeriod()).toNumber();

            // Almost expired
            await time.increase(time.duration.seconds(optOutPeriod - 60));
            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: bob }), "PB-4");
            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: boostedAlice.address }), "PB-4");

            // Expired
            await time.increase(time.duration.seconds(60));
            // Now it's ok
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: bob });
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: boostedAlice.address });

            // Also still works
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: deployment.booster });
        });

        it("should not revert if finalize called after instant opt-out and not expired yet", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.createOpHandle(boostedAlice.address, 0);

            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: bob }), "PB-4");
            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: boostedAlice.address }), "PB-4");

            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: deployment.booster });

            await optIn.instantOptOut(boostedAlice.address, { from: deployment.booster });

            // Now it's ok since alice opted-out completely
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: bob });
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: boostedAlice.address });

            // Also still works
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: deployment.booster });

            // Also works after she opted-in again to someone else
            await optIn.optIn(bob, { from: boostedAlice.address });

            // Now it's ok since alice opted-out completely
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: bob });
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: boostedAlice.address });

            // Also still works
            await boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: deployment.booster });
        });

        it("should revert if op doesn't exist", async () => {
            await expectRevert(boostable.assertCanFinalize(alice, { opId: 1, opType: 0 }, { from: alice }), "PB-1");
        });

        it("should revert if finalize called by non-booster while opted-in and not expired", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            await boostable.createOpHandle(boostedAlice.address, 0);
            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: bob }), "PB-4");
            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 0 }, { from: boostedAlice.address }), "PB-4");
        });

        it("should revert if finalize called with invalid opType", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            await boostable.createOpHandle(boostedAlice.address, 0);
            await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: 1, opType: 99 }, { from: bob }), "PB-2");
        });

        it("should revert if finalize called not FIFO", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            await boostable.createOpHandle(boostedAlice.address, 0); // 1
            await boostable.createOpHandle(boostedAlice.address, 0); // 2
            await boostable.createOpHandle(boostedAlice.address, 0); // 3
            await boostable.createOpHandle(boostedAlice.address, 0); // 4
            await boostable.createOpHandle(boostedAlice.address, 0); // 5

            for (let i = 1; i < 5; i++) {
                await expectRevert(boostable.assertCanFinalize(boostedAlice.address, { opId: (i + 1), opType: 0 }, { from: bob }), "PB-9");
            }

            // Called in FIFO order by current booster works
            for (let i = 0; i < 5; i++) {
                const counter = await boostable.getOpCounter(boostedAlice.address);
                expectBigNumber(counter.value, new BN(5));
                expectBigNumber(counter.nextRevert, new BN(5));

                expectBigNumber(counter.nextFinalize, new BN(i + 1));

                await boostable.assertCanFinalize(boostedAlice.address, { opId: (i + 1), opType: 0 }, { from: deployment.booster });
                await boostable.deleteOpHandle(boostedAlice.address, { opId: (i + 1), opType: 0 });
            }

            // Assert counter after all pending ops have been finalized
            const counter = await boostable.getOpCounter(boostedAlice.address);
            expectBigNumber(counter.value, new BN(5));
            expectBigNumber(counter.nextFinalize, new BN(0));
            expectBigNumber(counter.nextRevert, new BN(0));
        });
    })

    describe("assertCanRevert", () => {

        it("should not be ok if revert called without well-known hashers", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.createOpHandle(boostedAlice.address, 0);

            let mocks = await mockBoosterSignaturesAndMessages(deployment, ether("100"), bob);
            let { messageBytes, signature } = mocks[0];

            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster }), "PB-12");

            await boostable.addHasherContract(deployment.Purpose.address);

            await boostable.createOpHandle(boostedAlice.address, 0);
            await boostable.assertCanRevert(boostedAlice.address, { opId: "2", opType: 0 }, messageBytes, signature, { from: deployment.booster });
        });

        it("should be ok if revert called by booster with valid payload", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);

            await boostable.createOpHandle(boostedAlice.address, 0);

            const mocks = await mockBoosterSignaturesAndMessages(deployment, ether("100"), bob);
            const { messageBytes, signature } = mocks[0];

            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });
        });

        it("should not be ok if called by anyone else with valid payload", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);

            await boostable.createOpHandle(boostedAlice.address, 0);

            const mocks = await mockBoosterSignaturesAndMessages(deployment, ether("100"), bob);
            const { messageBytes, signature } = mocks[0];

            // Only booster can revert
            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: boostedAlice.address }), "PB-6");
            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: bob }), "PB-6");
        });

        it("should be ok if providing a valid legacy signature", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await deployment.Purpose.mint(boostedAlice.address, ether("100000"));

            const optOutPeriod = (await optIn.getOptOutPeriod()).toNumber();

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);
            await boostable.createOpHandle(boostedAlice.address, 0);

            let { message, messageBytes, signature, messageHash } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount: ether("1000"),
                account: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            });

            // Works fine if signed EIP712 the standard way
            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });

            // Works also if legacy signed via personal_sign (e.g. ledger, trezor)
            //
            const personallySigned = fixSignature(await deployment.web3.eth.sign(messageHash, boostedAlice.address));
            signature = toSignatureTriple(personallySigned);
            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });

            // But still fails if expired
            await time.increase(time.duration.seconds(optOutPeriod * 3 + 60));

            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster }), "PB-11");
        });

        it("should be ok if the booster burn message contains a big payload", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await deployment.Purpose.mint(boostedAlice.address, ether("100000"));

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);
            await boostable.createOpHandle(boostedAlice.address, 0);

            let { message, messageBytes, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount: ether("1000"),
                account: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
                data: `0x${"FF".repeat(2 ** 16)}`,
            });

            await deployment.Purpose.boostedBurn(message, signature, { from: deployment.booster });
            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });
        });

        it("should be ok if the booster burn message contains no payload", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await deployment.Purpose.mint(boostedAlice.address, ether("100000"));

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);
            await boostable.createOpHandle(boostedAlice.address, 0);

            let { message, messageBytes, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount: ether("1000"),
                account: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            });

            await deployment.Purpose.boostedBurn(message, signature, { from: deployment.booster });
            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });
        });

        it("should not be ok if called when user opted-out", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);

            await boostable.createOpHandle(boostedAlice.address, 0);

            const mocks = await mockBoosterSignaturesAndMessages(deployment, ether("100"), bob);
            const { messageBytes, signature } = mocks[0];

            // Can revert            
            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });

            // Instant opt-out alice
            await optIn.instantOptOut(boostedAlice.address, { from: deployment.booster });

            // Now it fails
            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster }), "PB-6");

            // Also fails if alice now opts-in to someone else and the previous booster tries to revert
            await optIn.optIn(bob, { from: boostedAlice.address });
            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster }), "PB-6");
        });

        it("should not be ok if provided signature is invalid", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);

            await boostable.createOpHandle(boostedAlice.address, 0);

            const mocks = await mockBoosterSignaturesAndMessages(deployment, ether("100"), bob);
            const { messageBytes, signature } = mocks[0];

            // Can revert            
            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });

            // Can not revert
            const bobsRandomSignature = toSignatureTriple(fixSignature((await deployment.web3.eth.sign("asdf", bob))));
            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, bobsRandomSignature, { from: deployment.booster }), "PB-8");
        });

        it("should not be ok if provided signature/op is too old", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);

            await boostable.createOpHandle(boostedAlice.address, 0);

            const optOutPeriod = (await optIn.getOptOutPeriod()).toNumber();

            let { messageBytes, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                to: bob,
                from: boostedAlice.address,
                amount: ether("100"),
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
                // Signed 3x optOutPeriod - 60 seconds ago means it is not yet expired
                timestamp: await blockchainTimestampWithOffset(deployment.web3, -(optOutPeriod * 3 - 60)),
            });

            // Still valid
            await boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster });

            ({ messageBytes, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                to: bob,
                from: boostedAlice.address,
                amount: ether("100"),
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
                // Signed 3x optOutPeriod + 1 seconds ago means it is not yet expired
                timestamp: await blockchainTimestampWithOffset(deployment.web3, -(optOutPeriod * 3 + 1)),
            }));

            // No longer valid
            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "1", opType: 0 }, messageBytes, signature, { from: deployment.booster }), "PB-11");


            // Now do the same with an opTimestamp

            // Create a new opHandle
            await boostable.createOpHandle(boostedAlice.address, 0);

            // Move forward in time by optOutPeriod * 3 - 60
            await time.increase(time.duration.seconds(optOutPeriod * 3 - 60));

            ({ messageBytes, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                to: bob,
                from: boostedAlice.address,
                amount: ether("100"),
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
                // Valid signature
            }));

            // Op can still be reverted
            await boostable.assertCanRevert(boostedAlice.address, { opId: "2", opType: 0 }, messageBytes, signature, { from: deployment.booster });

            // Move forward 1 minute + 1 second 
            await time.increase(time.duration.seconds(60 + 1));

            // No longer valid
            await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: "2", opType: 0 }, messageBytes, signature, { from: deployment.booster }), "PB-11");
        });

        it("should not be ok if no well-known contract can interpret messageBytes", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);
            await boostable.createOpHandle(boostedAlice.address, 0);

            let mocks = await mockBoosterSignaturesAndMessages(deployment, ether("100"), bob);
            let { messageBytes, signature } = mocks[0];

            await boostable.createOpHandle(boostedAlice.address, 0);
            await boostable.assertCanRevert(boostedAlice.address, { opId: "2", opType: 0 }, messageBytes, signature, { from: deployment.booster });
        });

        it("should not be ok if revert not called LIFO", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await optIn.activateAndRenounceOwnership({ from: deployment.owner });
            await boostable.addHasherContract(deployment.Purpose.address);

            await boostable.createOpHandle(boostedAlice.address, 0); // 1
            await boostable.createOpHandle(boostedAlice.address, 0); // 2
            await boostable.createOpHandle(boostedAlice.address, 0); // 3
            await boostable.createOpHandle(boostedAlice.address, 0); // 4
            await boostable.createOpHandle(boostedAlice.address, 0); // 5

            const mocks = await mockBoosterSignaturesAndMessages(deployment, ether("100"), bob);
            const { messageBytes, signature } = mocks[0];

            // Cannot revert FIFO
            for (let i = 0; i < 5; i++) {
                await expectRevert(boostable.assertCanRevert(boostedAlice.address, { opId: i, opType: 0 }, messageBytes, signature, { from: deployment.booster }), "PB-10");
            }

            // But calling LIFO works
            for (let i = (5 - 1); i >= 0; i--) {
                const counter = await boostable.getOpCounter(boostedAlice.address);
                expectBigNumber(counter.value, new BN(5));
                expectBigNumber(counter.nextFinalize, new BN(1));

                expectBigNumber(counter.nextRevert, new BN(5 - (5 - (i + 1))));

                await boostable.assertCanRevert(boostedAlice.address, { opId: (i + 1), opType: 0 }, messageBytes, signature, { from: deployment.booster });
                await boostable.deleteOpHandle(boostedAlice.address, { opId: (i + 1), opType: 0 });
            }

            // Assert counter after all pending ops have been reverted
            const counter = await boostable.getOpCounter(boostedAlice.address);
            expectBigNumber(counter.value, new BN(5));
            expectBigNumber(counter.nextFinalize, new BN(0));
            expectBigNumber(counter.nextRevert, new BN(0));
        });
    });

});

const createBoostedSignature = ({ a, b, nonce, booster, signer }: { a: string, b: string, nonce: number; booster: string; signer: string; }): Promise<{ r: string, s: string, v: number }> => {
    return createBoosterSignature([
        { type: "string", value: a },
        { type: "string", value: b },
    ], nonce, booster, signer);
}

const createBoosterSignature = async (params: any[], nonce: number, booster: string, signer: string): Promise<{ r: string, s: string, v: number }> => {
    params = [...params, { type: "uint64", value: nonce }, { type: "address", value: booster }];

    const encodedParameters = createBoosterPayload(params);

    const signature = fixSignature(await deployment.web3.eth.sign(Web3.utils.sha3(encodedParameters), signer));
    return toSignatureTriple(signature);
}

const createBoosterPayload = (params: any[]): string => {
    return deployment.web3.eth.abi.encodeParameters(params.map(p => p.type), params.map(p => {
        if (p.type === "uint256") {
            return p.value.toString();
        }

        if (p.type === "uint256[]") {
            return p.value.map(u => u.toString());
        }

        return p.value;
    }));
}
