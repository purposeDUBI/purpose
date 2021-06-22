import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, constants, ether, expectRevert, expectEvent, time } from "@openzeppelin/test-helpers";
import { PurposeInstance, DubiInstance, OptInInstance, BitPackingERC20Instance } from "../types/contracts"
import { deployTestnet, expectBigNumber, expectZeroBalance, mockBoosterSignaturesAndMessages } from "./support";
import { PurposeDeployment, SECONDS_PER_MONTH, ZERO } from "../src/types";
import { expect } from "chai";
import { ZERO_ADDRESS } from "@openzeppelin/test-helpers/src/constants";
import { createSignedBoostedBurnMessage, createSignedBoostedSendMessage } from "../src/utils";

const Purpose = contract.fromArtifact("Purpose");

const [alice, bob, carl] = accounts;

let prps: PurposeInstance;
let dubi: DubiInstance;
let optIn: OptInInstance;
let amount;

let deployment: PurposeDeployment;

beforeEach(async () => {
    deployment = await deployTestnet();
    prps = deployment.Purpose;
    dubi = deployment.Dubi;
    optIn = deployment.OptIn;
    amount = ether("1000000");
});

describe("Purpose", () => {

    it("should create PRPS", async () => {
        expect(await prps.symbol()).to.equal("PRPS");
        expect(await prps.name()).to.equal("Purpose");
        expectBigNumber(await prps.totalSupply(), amount);
    });

    it("should mint PRPS and update total supply if provided", async () => {
        const totalSupplyBeforeMint: any = await prps.totalSupply();
        const aliceBalanceBefore: any = await prps.balanceOf(alice);
        const amountToMint = ether("200");

        // The new total supply after the mint is amountToMint + totalSupplyBeforeMint
        // Set the second 96 bits of amountToMint to the new totalSupply.
        const upperHalf = totalSupplyBeforeMint
            .add(amountToMint);
        const lowerHalf = amountToMint;
        const amountIncludingTotalSupply = upperHalf.shln(96).or(lowerHalf);

        let receipt = await prps.mint(alice, amountIncludingTotalSupply);
        await expectEvent(receipt, "Transfer", {
            from: ZERO_ADDRESS,
            to: alice,
            // We included the totalSupply when calling mint, but it correctly only
            // logs the actual minted amount.
            value: amountToMint.toString(),
        });

        // Total supply updated
        expectBigNumber(await prps.totalSupply(), totalSupplyBeforeMint.add(amountToMint));
        expectBigNumber(await prps.balanceOf(alice), aliceBalanceBefore.add(amountToMint));
    });

    it("should mint when called by owner", async () => {
        await expectRevert(prps.mint(alice, ether("200"), { from: alice }), "Ownable: caller is not the owner");
        await prps.mint(alice, ether("200"), { from: deployment.owner });
    });

    it("should mint PRPS and not update total supply if not provided", async () => {
        const totalSupplyBeforeMint = await prps.totalSupply();
        const aliceBalanceBefore: any = await prps.balanceOf(alice);

        const amountToMint = ether("200");
        const receipt = await prps.mint(alice, amountToMint);

        await expectEvent(receipt, "Transfer", {
            from: ZERO_ADDRESS,
            to: alice,
            // We included the totalSupply when calling mint, but it correctly only
            // logs the actual minted amount.
            value: amountToMint.toString(),
        });

        // Total supply didn't change
        expectBigNumber(await prps.totalSupply(), totalSupplyBeforeMint);
        expectBigNumber(await prps.balanceOf(alice), aliceBalanceBefore.add(amountToMint));
    });

    it("should not transfer if sender is recipient", async () => {
        await prps.mint(alice, amount);

        await expectRevert(prps.transfer(alice, amount, { from: alice }), "ERC20-19");
    });

    it("should transfer PRPS without auto-minting DUBI for the sender", async () => {
        const expectNoDubi = async () => {
            expectZeroBalance(await dubi.balanceOf(alice));
            expectZeroBalance(await dubi.balanceOf(prps.address));
            expectZeroBalance(await dubi.balanceOf(dubi.address));
        }

        // Mint PRPS for alice so she can transfer it
        await prps.mint(alice, amount);
        await expectNoDubi();

        await prps.transfer(bob, amount, { from: alice });
        await expectNoDubi();

        expectBigNumber(await prps.balanceOf(alice), ZERO);
        expectBigNumber(await prps.balanceOf(bob), amount);

        await prps.transfer(alice, amount, { from: bob });
        await expectNoDubi();

        expectBigNumber(await prps.balanceOf(bob), ZERO);
        expectBigNumber(await prps.balanceOf(alice), amount);
    });

    it("should burn PRPS and auto-mint 4% DUBI for the sender", async () => {
        expectZeroBalance(await dubi.balanceOf(alice));

        await prps.mint(alice, amount);
        await prps.burn(amount, "0x0", { from: alice });

        expectBigNumber(await prps.balanceOf(alice), new BN(0));
        expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
    });

    it("should revert if caller is not Hodl", async () => {
        await expectRevert(prps.createNewOpHandleShared(await optIn.getOptInStatus(bob), bob, 1, { from: deployment.booster }), "PRPS-1");
        await expectRevert(prps.deleteOpHandleShared(bob, { opId: 1, opType: 1 }, { from: deployment.booster }), "PRPS-1");
        await expectRevert(prps.assertFinalizeFIFOShared(bob, 1, { from: deployment.booster }), "PRPS-1");
        await expectRevert(prps.assertRevertLIFOShared(bob, 1, { from: deployment.booster }), "PRPS-1");
        await expectRevert(prps.hodlTransfer(bob, 1, { from: deployment.booster }), "PRPS-1");
        await expectRevert(prps.increaseHodlBalance(bob, alice, 1, { from: deployment.booster }), "PRPS-1");
        await expectRevert(prps.decreaseHodlBalance(bob, 1, 1, { from: deployment.booster }), "PRPS-1");
        await expectRevert(prps.revertHodlBalance(bob, alice, 1, { from: deployment.booster }), "PRPS-1");

        // Need to instantiate PRPS with a non-contract address for Hodl to directly make the contract calls
        const bobAsHodl = bob;

        await Purpose.detectNetwork();
        await Purpose.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
        const prps2: PurposeInstance = await Purpose.new(ether("1000000"), deployment.OptIn.address, deployment.Dubi.address, bobAsHodl, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);

        await prps2.mint(alice, ether("100"));
        await prps2.mint(bob, ether("100"));

        await prps2.createNewOpHandleShared(await optIn.getOptInStatus(bob), bob, 1, { from: bobAsHodl });
        await prps2.assertFinalizeFIFOShared(bob, 1, { from: bobAsHodl });
        await prps2.assertRevertLIFOShared(bob, 1, { from: bobAsHodl });
        await prps2.deleteOpHandleShared(bob, { opId: 1, opType: 1 }, { from: bobAsHodl });
        await prps2.hodlTransfer(alice, 1, { from: bobAsHodl });
        await prps2.increaseHodlBalance(bob, alice, 1, { from: bobAsHodl });
        await prps2.decreaseHodlBalance(alice, 1, 1, { from: bobAsHodl });
        await prps2.increaseHodlBalance(bob, alice, 1, { from: bobAsHodl });
        await prps2.revertHodlBalance(bob, alice, 1, { from: bobAsHodl });

        // Correctly reverts for Hodl (bob) when called out of order
        await expectRevert(prps2.assertFinalizeFIFOShared(bob, 2, { from: bobAsHodl }), "PB-9");
        await expectRevert(prps2.assertRevertLIFOShared(bob, 2, { from: bobAsHodl }), "PB-10");
    });

});

describe("Purpose - OptedIn", () => {

    describe("Unboosted", () => {

        it("should transfer and finalize", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });
            amount = ether("10");
            await prps.mint(alice, amount);

            let receipt = await prps.transfer(carl, amount, { from: alice });
            await expectEvent(receipt, "PendingOp", {
                from: alice,
                opId: '1',
                opType: '0',
            });

            // Sent `amount` went to the PRPS contract
            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), amount);

            // Alice cannot finalize yet, since she's still opted-in to booster
            await expectRevert(prps.finalizePendingOp(alice, { opType: 0, opId: 1 }, { from: alice }), "PB-4");

            // Original booster can finalize
            receipt = await prps.finalizePendingOp(alice, { opType: 0, opId: 1 }, { from: deployment.booster });

            // Now `amount` got sent to carl
            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);
            expectBigNumber(await prps.balanceOf(carl), amount);

            await expectEvent(receipt, "Transfer", {
                from: alice,
                to: carl,
                value: amount,
            });

            // Trying to finalize again reverts
            await expectRevert(prps.finalizePendingOp(alice, { opType: 0, opId: 1 }, { from: deployment.booster }), "PB-1");
        });

        it("should transferFrom", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });
            amount = ether("10");
            await prps.mint(alice, amount);

            // Bob cannot use transferFrom when alice is opted-in, even if he got thre approval
            await expectRevert(prps.transferFrom(alice, carl, amount, { from: bob }), "ERC20-7");

            await prps.approve(bob, amount, { from: alice });
            // Bob cannot use transferFrom when alice is opted-in, even if he got thre approval
            await expectRevert(prps.transferFrom(alice, carl, amount, { from: bob }), "ERC20-7");

            // But alice can do it just fine
            let receipt = await prps.transferFrom(alice, carl, amount, { from: alice });
            await expectEvent(receipt, "PendingOp", {
                from: alice,
                opId: '1',
                opType: '0',
            });

            // Sent `amount` went to the PRPS contract
            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(bob), ZERO);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), amount);

            // Call finalize with booster
            receipt = await prps.finalizePendingOp(alice, { opType: 0, opId: 1 }, { from: deployment.booster });

            // Now `amount` got sent to carl
            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(bob), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);
            expectBigNumber(await prps.balanceOf(carl), amount);

            await expectEvent(receipt, "Transfer", {
                from: alice,
                to: carl,
                value: amount,
            });

            // Trying to finalize again reverts
            await expectRevert(prps.finalizePendingOp(alice, { opType: 0, opId: 1 }, { from: deployment.booster }), "PB-1");
        });

        it("should burn and finalize", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });
            amount = ether("100");
            await prps.mint(alice, amount);

            const prpsSupplyBefore: any = await prps.totalSupply();

            expectBigNumber(await prps.balanceOf(alice), amount);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);
            expectBigNumber(await prps.totalSupply(), prpsSupplyBefore);

            let receipt = await prps.burn(amount, "0xdead", { from: alice });
            await expectEvent(receipt, "PendingOp", {
                from: alice,
                opId: '1',
                opType: '1', // burn
            });

            // Burnt `amount` went to the PRPS contract
            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), amount);
            expectBigNumber(await prps.totalSupply(), prpsSupplyBefore);

            // And no DUBI has been minted yet for Alice
            expectBigNumber(await dubi.balanceOf(alice), ZERO);
            expectBigNumber(await dubi.balanceOf(prps.address), ZERO);
            expectBigNumber(await dubi.balanceOf(carl), ZERO);

            // Alice cannot finalize yet, since she's still opted-in to booster
            await expectRevert(prps.finalizePendingOp(alice, { opType: 1, opId: 1 }, { from: alice }), "PB-4");

            // Original booster can finalize
            receipt = await prps.finalizePendingOp(alice, { opType: 1, opId: 1 }, { from: deployment.booster });

            await expectEvent(receipt, "FinalizedOp", {
                from: alice,
                opId: '1',
                opType: '1', // burn
            });

            // Now `amount` got actually burnt
            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);
            expectBigNumber(await prps.balanceOf(carl), ZERO);

            expectBigNumber(await dubi.balanceOf(alice), ether("4"));
            expectBigNumber(await dubi.balanceOf(prps.address), ZERO);
            expectBigNumber(await dubi.balanceOf(carl), ZERO);

            // Alice also got her DUBI

            await expectEvent(receipt, "Transfer", {
                from: alice,
                to: constants.ZERO_ADDRESS,
                value: amount,
            });

            //  emit Burned(data);
            await expectEvent(receipt, "Burned", {
                data: "0xdead",
            });

            // Supply has not been reduced!
            expectBigNumber(await prps.totalSupply(), prpsSupplyBefore);

            // Trying to finalize again reverts
            await expectRevert(prps.finalizePendingOp(alice, { opType: 1, opId: 1 }, { from: deployment.booster }), "PB-1");
            await expectRevert(prps.revertPendingOp(alice, { opType: 1, opId: 1 }, "0x", { r: "0x", s: "0x", v: 1 }, { from: deployment.booster }), "PB-1");
        });

        it("should burn and revert while pending", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });
            amount = ether("10");

            await prps.mint(boostedAlice.address, amount);

            expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);

            let receipt = await prps.burn(amount, "0xdead", { from: boostedAlice.address });
            await expectEvent(receipt, "PendingOp", {
                from: boostedAlice.address,
                opId: '1',
                opType: '1',
            });

            // Sent `amount` went to the PRPS contract
            expectBigNumber(await prps.balanceOf(boostedAlice.address), ZERO);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), amount);

            // Prepare a signed booster message from boostedAlice
            let { signature, messageBytes } = await createSignedBoostedBurnMessage(deployment.web3, {
                account: boostedAlice.address,
                amount,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            });

            // Alice cannot finalize yet, since she's still opted-in to booster
            await expectRevert(prps.finalizePendingOp(boostedAlice.address, { opType: 1, opId: 1 }, { from: boostedAlice.address }), "PB-4");
            // Alice also cannot revert it herself, because she can't be opted-in to herself
            await expectRevert(prps.revertPendingOp(boostedAlice.address, { opType: 1, opId: 1 }, messageBytes, signature, { from: boostedAlice.address }), "PB-6");

            // Booster can revert the pending op while it's not expired with the boosted message
            receipt = await prps.revertPendingOp(boostedAlice.address, { opType: 1, opId: 1 }, messageBytes, signature, { from: deployment.booster });

            // `amount` has been sent back to alice
            expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);
            expectBigNumber(await prps.balanceOf(carl), ZERO);

            await expectEvent(receipt, "Transfer", {
                from: deployment.Purpose.address,
                to: boostedAlice.address,
                value: amount,
            });

            await expectEvent(receipt, "RevertedOp", {
                from: boostedAlice.address,
                opId: '1',
                opType: '1',
            });

            // Op no longer exists
            await expectRevert(prps.finalizePendingOp(boostedAlice.address, { opType: 1, opId: 1 }, { from: deployment.booster }), "PB-1");
            await expectRevert(prps.revertPendingOp(boostedAlice.address, { opType: 1, opId: 1 }, messageBytes, signature, { from: deployment.booster }), "PB-1");
        });

        it("should revert with any valid boosted message", async () => {
            const [boostedAlice] = deployment.boostedAddresses;

            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });
            amount = ether("100");

            await prps.mint(boostedAlice.address, amount);

            expectBigNumber(await prps.balanceOf(boostedAlice.address), amount);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);

            await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

            // Get all signatures and boosted messages for reverting pending ops
            const messagesAndSignatures = await mockBoosterSignaturesAndMessages(deployment, amount, bob);

            // Take snapshot of balances
            const snapshot = {
                [boostedAlice.address]: await prps.balanceOf(boostedAlice.address),
                [prps.address]: await prps.balanceOf(prps.address),
                [bob]: await prps.balanceOf(bob),
                [carl]: await prps.balanceOf(carl),
            }

            // Use each message/signature to revert pending transactions from alice
            let opCounter = 0;
            for (const { signature, messageBytes } of messagesAndSignatures) {

                // Create ops and revert them all with the given signature/messageBytes
                const ops: { opId: number, opType: number }[] = [];
                const expectOp = async (opType: number, promise: Promise<any>) => {
                    const receipt = await promise;

                    opCounter++;
                    const opId = opCounter;

                    await expectEvent(receipt, "PendingOp", {
                        from: boostedAlice.address,
                        opId: opId.toString(),
                        opType: opType.toString(),
                    });

                    ops.push({ opId, opType });
                }

                await prps.approve(boostedAlice.address, ether("5"), { from: boostedAlice.address });

                await expectOp(0, prps.transfer(bob, ether("5"), { from: boostedAlice.address }));
                await expectOp(0, prps.transferFrom(boostedAlice.address, bob, ether("5"), { from: boostedAlice.address }));
                await expectOp(1, prps.burn(ether("5"), "0xdead", { from: boostedAlice.address }));

                // Reverting ops must happen LIFO i.e. backwards
                ops.reverse();

                for (const { opId, opType } of ops) {
                    let receipt = await prps.revertPendingOp(boostedAlice.address, { opType, opId }, messageBytes, signature, { from: deployment.booster });

                    await expectEvent(receipt, "RevertedOp", {
                        from: boostedAlice.address,
                        opId: opId.toString(),
                        opType: opType.toString(),
                    });

                    // Op no longer exists
                    await expectRevert(prps.finalizePendingOp(boostedAlice.address, { opType, opId }, { from: deployment.booster }), "PB-1");
                    await expectRevert(prps.revertPendingOp(boostedAlice.address, { opType, opId }, messageBytes, signature, { from: deployment.booster }), "PB-1");
                }

                // Assert that balances after all reverts is equal to taken snapshot
                for (const [address, balance] of Object.entries(snapshot)) {
                    expectBigNumber(balance, await prps.balanceOf(address));
                }
            }
        });

        it("should boostedTransferFrom", async () => {
            await prps.mint(alice, amount);

            expectBigNumber(await prps.balanceOf(alice), amount);
            expectBigNumber(await prps.balanceOf(bob), ZERO);
            expectBigNumber(await prps.balanceOf(carl), ZERO);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);

            // Can only be called from deploy-time known contracts
            await expectRevert(prps.boostedTransferFrom(alice, carl, amount, "0x", { from: alice }), "ERC20-17");
            await expectRevert(prps.boostedTransferFrom(alice, carl, amount, "0x", { from: carl }), "ERC20-17");
            await expectRevert(prps.boostedTransferFrom(alice, carl, amount, "0x", { from: bob }), "ERC20-17");

            // Also doesn't work with approval
            await prps.approve(alice, amount, { from: alice });
            await prps.approve(bob, amount, { from: alice });
            await prps.approve(carl, amount, { from: alice });

            await expectRevert(prps.boostedTransferFrom(alice, carl, amount, "0x", { from: alice }), "ERC20-17");
            await expectRevert(prps.boostedTransferFrom(alice, carl, amount, "0x", { from: carl }), "ERC20-17");
            await expectRevert(prps.boostedTransferFrom(alice, carl, amount, "0x", { from: bob }), "ERC20-17");

            // Deploy PRPS again, with bob and carl as deploy-time known contracts
            const dubiex = carl;

            await Purpose.detectNetwork();
            await Purpose.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
            const prps2: PurposeInstance = await Purpose.new(ether("1000000"), deployment.OptIn.address, deployment.Dubi.address, bob, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, dubiex /* dubiex is more restrictive  */);

            await prps2.mint(alice, ether("100"));
            await prps2.mint(bob, ether("100"));
            await prps2.mint(carl, ether("100"));

            // Bob and carl can move
            await prps2.boostedTransferFrom(alice, carl, ether("10"), "0x", { from: bob });
            await prps2.boostedTransferFrom(alice, bob, ether("10"), "0x", { from: carl });

            expectBigNumber(await prps2.balanceOf(alice), ether("80"));
            expectBigNumber(await prps2.balanceOf(bob), ether("110"));
            expectBigNumber(await prps2.balanceOf(carl), ether("110"));

            // Activating permaboost
            await optIn.activateAndRenounceOwnership({ from: deployment.owner });

            // Now only bob can still move
            await prps2.boostedTransferFrom(alice, carl, ether("10"), "0x", { from: bob });
            // Carl reverts, since alice is opted-in and dubiex didn't tell PRPS that this is a boosted transaction ('data' is zero)
            await expectRevert(prps2.boostedTransferFrom(alice, bob, ether("10"), "0x00", { from: carl }), "ERC20-17");

            // Send data with the `isBoosted` flag = 1 works fine
            await prps2.boostedTransferFrom(alice, carl, ether("10"), "0x01", { from: carl });

            // Works fine either way if alice opts-out
            await optIn.instantOptOut(alice, { from: deployment.booster });
            await prps2.boostedTransferFrom(alice, carl, ether("10"), "0x01", { from: carl });
            await prps2.boostedTransferFrom(alice, carl, ether("10"), "0x00", { from: carl });
        });

        it("should receive funds while opted-in", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });
            amount = ether("100");

            await prps.mint(bob, amount);

            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(bob), amount);
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);

            // Send half to alice
            await prps.transfer(alice, ether("50"), { from: bob });

            expectBigNumber(await prps.balanceOf(alice), ZERO);
            expectBigNumber(await prps.balanceOf(bob), ether("50"));
            expectBigNumber(await prps.balanceOf(prps.address), ether("50"));

            // Wait so it can be finalized without booster
            await expectRevert(prps.finalizePendingOp(bob, { opId: '1', opType: '0' }, { from: bob }), "PB-4");
            await time.increase(time.duration.seconds(SECONDS_PER_MONTH));
            await prps.finalizePendingOp(bob, { opId: '1', opType: '0' }, { from: bob });

            expectBigNumber(await prps.balanceOf(alice), ether("50"));
            expectBigNumber(await prps.balanceOf(bob), ether("50"));
            expectBigNumber(await prps.balanceOf(prps.address), ZERO);
        });
    });

    describe("Boosted", () => {
        it("should send funds", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });

            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            const { message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                amount,
                from: boostedAlice.address,
                to: carl,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            });

            const receipt = await prps.boostedSend(message, signature, { from: deployment.booster });
            await expectEvent(receipt, "Transfer", {
                from: boostedAlice.address,
                to: carl,
                value: amount,
            });

            expectBigNumber(await prps.balanceOf(carl), amount);
        });

        it("should burn funds and auto-mint DUBI", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });

            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            const { message, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount,
                account: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            });

            const receipt = await prps.boostedBurn(message, signature, { from: deployment.booster });
            await expectEvent(receipt, "Burned");

            expectBigNumber(await dubi.balanceOf(boostedAlice.address), ether("40000"));
            expectBigNumber(await dubi.balanceOf(deployment.booster), ZERO);
        });

        it("should correctly increase nonce", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            let nonce = new BN(1);
            expectBigNumber(await prps.getNonce(boostedAlice.address), nonce.sub(new BN(1)));

            // Send a boosted burn
            let { message, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount: ether("1000"),
                account: boostedAlice.address,
                nonce,
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            });

            let receipt = await prps.boostedBurn(message, signature, { from: deployment.booster });
            await expectEvent(receipt, "Burned");

            // Nonce incremented to 2
            nonce = new BN(2);
            expectBigNumber(await prps.getNonce(boostedAlice.address), nonce.sub(new BN(1)));

            await expectRevert(prps.boostedBurn(message, signature, { from: deployment.booster }), "ERC20-5");

            // Send a boosted transfer
            ({ message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                amount: ether("1000"),
                from: boostedAlice.address,
                to: bob,
                nonce,
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            }));

            receipt = await prps.boostedSend(message, signature, { from: deployment.booster });
            await expectEvent(receipt, "Transfer");

            // Nonce incremented to 3
            nonce = new BN(3);
            expectBigNumber(await prps.getNonce(boostedAlice.address), nonce.sub(new BN(1)));

            await expectRevert(prps.boostedSend(message, signature, { from: deployment.booster }), "ERC20-5");
        });

        it("should fail if not opted-in", async () => {
            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            let { message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                amount,
                from: boostedAlice.address,
                to: carl,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            });

            await optIn.instantOptOut(boostedAlice.address, { from: deployment.booster });
            await expectRevert(prps.boostedSend(message, signature, { from: deployment.booster }), "AB-3");

            ({ message, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                amount,
                account: boostedAlice.address,
                nonce: new BN(1),
                signer: boostedAlice,
                verifyingContract: deployment.Purpose.address,
                booster: deployment.booster,
                fuel: {},
            }));

            await expectRevert(prps.boostedBurn(message, signature, { from: deployment.booster }), "AB-3");
        });
    })

    describe("Boosted - Batch", () => {

        it("should batch send funds", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });

            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            // Send carl 5 times 10 eth from alice
            const messages: any[] = [];
            const signatures: any[] = [];

            for (let i = 0; i < 5; i++) {
                const { message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                    amount: ether("10"),
                    from: boostedAlice.address,
                    to: carl,
                    nonce: new BN(i + 1),
                    signer: boostedAlice,
                    verifyingContract: deployment.Purpose.address,
                    booster: deployment.booster,
                    fuel: {},
                });

                messages.push(message);
                signatures.push(signature);
            }

            await prps.boostedSendBatch(messages, signatures, { from: deployment.booster, gas: 350_000 });
            expectBigNumber(await prps.balanceOf(carl), ether("10").mul(new BN(5)));
            expectBigNumber(await prps.balanceOf(boostedAlice.address), amount.sub(ether("50")));
        });

        it("should batch burn funds", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });

            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            // Burn 5 times 10 eth from alice
            const messages: any[] = [];
            const signatures: any[] = [];

            for (let i = 0; i < 5; i++) {
                const { message, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
                    account: boostedAlice.address,
                    amount: ether("10"),
                    nonce: new BN(i + 1),
                    signer: boostedAlice,
                    verifyingContract: deployment.Purpose.address,
                    booster: deployment.booster,
                    fuel: {},
                });

                messages.push(message);
                signatures.push(signature);
            }

            await prps.boostedBurnBatch(messages, signatures, { from: deployment.booster, gas: 600_000 });
            expectBigNumber(await prps.balanceOf(boostedAlice.address), amount.sub(ether("50")));
            // Alice got 4% of 50 PRPS worth of DUBI
            expectBigNumber(await deployment.Dubi.balanceOf(boostedAlice.address), ether("2"));
        });

        it("should batch send funds different signers", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });

            const [boostedAlice, boostedBob] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);
            await prps.mint(boostedBob.address, amount);

            // Send carl 2 times 10 eth from alice
            // Send carl 2 times 10 eth from bob

            const messages: any[] = [];
            const signatures: any[] = [];

            for (let i = 0; i < 2; i++) {
                // Alice
                let { message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                    amount: ether("10"),
                    from: boostedAlice.address,
                    to: carl,
                    nonce: new BN(i + 1),
                    signer: boostedAlice,
                    verifyingContract: deployment.Purpose.address,
                    booster: deployment.booster,
                    fuel: {},
                });

                messages.push(message);
                signatures.push(signature);

                // Bob
                ({ message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                    amount: ether("10"),
                    from: boostedBob.address,
                    to: carl,
                    nonce: new BN(i + 1),
                    signer: boostedBob,
                    verifyingContract: deployment.Purpose.address,
                    booster: deployment.booster,
                    fuel: {},
                }));

                messages.push(message);
                signatures.push(signature);
            }

            await prps.boostedSendBatch(messages, signatures, { from: deployment.booster, gas: 400_000 });
            expectBigNumber(await prps.balanceOf(carl), ether("40"));
            expectBigNumber(await prps.balanceOf(boostedAlice.address), amount.sub(ether("20")));
            expectBigNumber(await prps.balanceOf(boostedBob.address), amount.sub(ether("20")));
        });

        it("should revert if input lengths are invalid", async () => {
            await prps.mint(alice, amount);

            await expectRevert(prps.boostedSendBatch([], [], { from: deployment.booster }), "ERC20-6");
            await expectRevert(prps.boostedSendBatch([], [], { from: deployment.booster }), "ERC20-6");
            await expectRevert(prps.boostedBurnBatch([], [], { from: deployment.booster }), "ERC20-6");
            await expectRevert(prps.boostedBurnBatch([], [], { from: deployment.booster }), "ERC20-6");
        });

        it("should revert to batch send funds if any fails ", async () => {
            await deployment.OptIn.activateAndRenounceOwnership({ from: deployment.owner });

            const [boostedAlice] = deployment.boostedAddresses;
            await prps.mint(boostedAlice.address, amount);

            const messages: any[] = [];
            const signatures: any[] = [];
            const operatorData: string[] = [];

            for (let i = 0; i < 5; i++) {
                const { message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
                    amount: ether("10"),
                    from: boostedAlice.address,
                    to: carl,
                    // Add some invalid nonce
                    nonce: new BN(i === 2 ? 99 : i + 1),
                    signer: boostedAlice,
                    verifyingContract: deployment.Purpose.address,
                    booster: deployment.booster,
                });

                messages.push(message);
                signatures.push(signature);
                operatorData.push("0x");
            }

            await expectRevert(prps.boostedSendBatch(messages, signatures, { from: deployment.booster, gas: 300_000 }), "ERC20-5");
        });

    });
});

describe("BitpackingERC20", () => {

    it("should be ok", async () => {
        const BitPackingERC20 = contract.fromArtifact("BitPackingERC20");
        await BitPackingERC20.detectNetwork();
        BitPackingERC20.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);

        const bitpackingERC20: BitPackingERC20Instance = await BitPackingERC20.new();
        await bitpackingERC20.testPackUnpackedData();
        await bitpackingERC20.testUnpackPackedData();
    });

})