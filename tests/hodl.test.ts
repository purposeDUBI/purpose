import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, expectRevert, expectEvent, time, ether } from "@openzeppelin/test-helpers";
import { PurposeInstance, DubiInstance, HodlInstance, OptInInstance, BitPackingHodlInstance } from "../types/contracts"
import { expect } from "chai";
import { expectBigNumber, expectZeroBalance, expectBigNumberApprox, deployTestnet, expectHodl, getHodl } from "./support";
import { FuelType, PurposeDeployment, SECONDS_PER_MONTH, ZERO } from "../src/types";
import { blockchainTimestampWithOffset, unpackBurnAmount } from "../src/utils";

contract.fromArtifact("Purpose");

const [alice, bob, charlie] = accounts;

let prps: PurposeInstance;
let dubi: DubiInstance;
let hodl: HodlInstance;
let optIn: OptInInstance;

let amount = ether("1000000");

let deployment: PurposeDeployment;

// NOTE: all hodl tests (hodl.test.ts, hodl.infinite.test.ts, hodl.boost.test.ts) does not work properly,
// because the blockchain timestamp eventually overflows if they all run in sequence. Best is to run them
// completely isolated i.e. invoke mocha once per file.

beforeEach(async () => {
    deployment = await deployTestnet();
    prps = deployment.Purpose;
    hodl = deployment.Hodl;
    dubi = deployment.Dubi;
    optIn = deployment.OptIn;

    await prps.mint(alice, amount);
});

describe("Hodl", () => {

    it("should lock PRPS of sender and mint DUBI (4%)", async () => {
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, alice, alice, { from: alice });

        expectZeroBalance(await prps.balanceOf(alice));
        expectBigNumber(await prps.hodlBalanceOf(alice), amount);
        expectBigNumber(await prps.balanceOf(hodl.address), ZERO);

        // Minted 4% of 1_000_000 => 40_000 DUBI
        expectBigNumber(await dubi.balanceOf(alice), ether("40000"));
    });

    it("should not Hodl if id is bigger than 2**20", async () => {
        await expectRevert(hodl.hodl(2 ** 20, amount, HODL_MAX_DURATION, alice, alice, { from: alice }), "H-17");
        await expectRevert(hodl.hodl(2 ** 20 + 1, amount, HODL_MAX_DURATION, alice, alice, { from: alice }), "H-17");
        await expectRevert(hodl.hodl(0, amount, HODL_MAX_DURATION, alice, alice, { from: alice }), "H-17");

        await expectHodl(prps, hodl, 2 ** 20 - 1, amount, HODL_MAX_DURATION, alice, alice, { from: alice });
    });

    it("should revert if sender is not PRPS contract", async () => {
        await expectRevert(hodl.burnLockedPrps(alice, amount, new Date().getTime(), false, { from: alice }), "H-1");
        await expectRevert(hodl.setLockedPrpsToPending(alice, amount, { from: alice }), "H-1");
        await expectRevert(hodl.revertLockedPrpsSetToPending(alice, amount, { from: alice }), "H-1");
    });

    it("should burn locked PRPS of sender and auto-mint pro-rated DUBI", async () => {
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, alice, alice, { from: alice });

        // Alice mints her entire unlocked PRPS => burns will go to hodl balance

        // Minted 4% of 1_000_000 => 40_000 DUBI
        expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
        expectZeroBalance(await prps.balanceOf(alice));
        expectBigNumber(await prps.hodlBalanceOf(alice), amount);
        expectBigNumber(await dubi.balanceOf(alice), ether("40000"));

        // Advance 3 months, now Alice decides to burn and is eligible for an extra 1%
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

        const dubiAliceBeforeBurn: any = await dubi.balanceOf(alice);

        let _hodl = await getHodl(hodl, alice, alice, 1);

        // Locked PRPS
        expectBigNumber(_hodl.lockedPrps, amount);
        // Amout of the locked PRPS that got burned
        expectBigNumber(_hodl.burnedLockedPrps, ZERO);

        // This burns all of alice's locked PRPS
        await prps.burn(amount, "0x0", { from: alice, gas: 3000000 });

        // The burned locked PRPS is removed from the hodl balance
        expectBigNumber(await prps.hodlBalanceOf(alice), ZERO);
        expectBigNumber(await prps.balanceOf(hodl.address), ZERO);
        expectZeroBalance(await prps.balanceOf(alice));
        expectZeroBalance(await dubi.balanceOf(hodl.address));

        const dubiAliceAfterBurn: any = await dubi.balanceOf(alice);

        // Previous 4% plus 1% since lock
        expectBigNumberApprox(dubiAliceAfterBurn, dubiAliceBeforeBurn.add(ether("10000")));

        // Hodl has been deleted
        _hodl = await getHodl(hodl, alice, alice, 1);
        expectBigNumber(_hodl.id, ZERO);
    });

    it("should burn locked PRPS of sender when burned PRPS > unlocked PRPS in single lock", async () => {
        await prps.mint(bob, ether("60"));

        // First burn reduces unlocked PRPS from 60 to 45.
        await prps.burn(ether("15"), "0x0", { from: bob, gas: 2000000 });

        // Lock 20 out of 45 unlocked PRPS
        await expectHodl(prps, hodl, 1, ether("20"), 365, bob, bob, { from: bob });

        expectBigNumber(await prps.balanceOf(bob), ether("25"));
        expectBigNumber(await prps.hodlBalanceOf(bob), ether("20"));
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(hodl.address));

        // First burn reduces unlocked PRPS from 25 to 10.
        await prps.burn(ether("15"), "0x0", { from: bob, gas: 2000000 });

        expectBigNumber(await prps.balanceOf(bob), ether("10"));
        expectBigNumber(await prps.hodlBalanceOf(bob), ether("20"));
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));

        // Second burn reduces unlocked PRPS from 10 to 0 and the locked PRPS from 20 to 15.
        await prps.burn(ether("15"), "0x0", { from: bob, gas: 2000000 });

        expectBigNumber(await prps.balanceOf(bob), ether("0"));
        expectBigNumber(await prps.hodlBalanceOf(bob), ether("15"));
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));

        // Burn the remaining locked PRPS
        await prps.burn(ether("15"), "0x0", { from: bob, gas: 2000000 });

        // All PRPS gone
        expectZeroBalance(await prps.balanceOf(bob));
        expectZeroBalance(await prps.hodlBalanceOf(bob));
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(hodl.address));
        expectZeroBalance(await prps.balanceOf(bob));

        const _hodl = await getHodl(hodl, bob, bob, 1);
        expectBigNumber(_hodl.id, ZERO);
    });

    it("should burn all locked PRPS", async () => {
        await expectHodl(prps, hodl, 1, ether("1000"), HODL_MAX_DURATION, alice, alice, { from: alice });

        let lockedPrps = await prps.hodlBalanceOf(alice);
        let unlockedPrps = await prps.balanceOf(alice);
        let aliceDubi = await dubi.balanceOf(alice);

        expectBigNumber(unlockedPrps, amount.sub(ether("1000")));
        expectBigNumber(lockedPrps, ether("1000"))
        expectBigNumber(aliceDubi, ether("40"));

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, unlockedPrps, { from: alice });

        // Burn all of Alice's locked PRPS in one transaction
        await prps.burn(ether("1000"), "0x0", { from: alice });

        // Locked and unlocked PRPS now all gone
        lockedPrps = await prps.hodlBalanceOf(alice);
        unlockedPrps = await prps.balanceOf(alice);


        const _hodl = await getHodl(hodl, alice, alice, 1);
        expectBigNumber(_hodl.id, ZERO);

        // Burned locked PRPS is removed from alice's hodl balance
        expectZeroBalance(lockedPrps);
        expectZeroBalance(unlockedPrps);
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(bob));
    });

    it("should be ok to burn all but 1 WEI", async () => {
        await expectHodl(prps, hodl, 1, ether("1000"), HODL_MAX_DURATION, alice, alice, { from: alice });

        let lockedPrps = await prps.hodlBalanceOf(alice);
        let unlockedPrps = await prps.balanceOf(alice);
        let aliceDubi = await dubi.balanceOf(alice);

        expectBigNumber(unlockedPrps, amount.sub(ether("1000")));
        expectBigNumber(lockedPrps, ether("1000"))
        expectBigNumber(aliceDubi, ether("40"));

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, unlockedPrps, { from: alice });

        // Burn all of Alice's locked PRPS in one transaction
        await expectRevert(prps.burn(ether("1000").add(new BN(1)), "0x0", { from: alice }), "H-14");

        await prps.burn(ether("1000").sub(new BN(1)), "0x0", { from: alice });

        // Locked and unlocked PRPS now all gone
        lockedPrps = await prps.hodlBalanceOf(alice);
        unlockedPrps = await prps.balanceOf(alice);

        let _hodl = await getHodl(hodl, alice, alice, 1);
        expectBigNumber(_hodl.id, new BN(1));

        expectBigNumber(lockedPrps, new BN(1));
        expectZeroBalance(unlockedPrps);
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(bob));

        await expectRevert(prps.burn(new BN(2), "0x0", { from: alice }), "H-14");
        await prps.burn(new BN(1), "0x0", { from: alice });

        lockedPrps = await prps.hodlBalanceOf(alice);
        unlockedPrps = await prps.balanceOf(alice);

        _hodl = await getHodl(hodl, alice, alice, 1);
        expectBigNumber(_hodl.id, ZERO);

        expectZeroBalance(lockedPrps);
        expectZeroBalance(unlockedPrps);
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(bob));
    });

    it("should release out of order", async () => {
        for (let i = 0; i < 10; i++) {
            await expectHodl(prps, hodl, i + 1, ether("1000"), HODL_MAX_DURATION, alice, alice, { from: alice });
        }

        let lockedPrps = await prps.hodlBalanceOf(alice);
        let unlockedPrps = await prps.balanceOf(alice);
        let aliceDubi = await dubi.balanceOf(alice);

        expectBigNumber(unlockedPrps, amount.sub(ether("10000")));
        expectBigNumber(lockedPrps, ether("10000"))
        expectBigNumber(aliceDubi, ether("400"));

        // Fast-forward 1 year
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, unlockedPrps, { from: alice });

        // Release them in a way that provokes swap-and-pop
        // 1,2,3,4,5,6,7,8,9,10
        await hodl.release(5, alice, alice, { from: alice });
        // 1,2,3,4,10,6,7,8,9
        await hodl.release(10, alice, alice, { from: alice });
        // 1,2,3,4,9,6,7,8
        await hodl.release(9, alice, alice, { from: alice });
        // 8,2,3,4,9,6,7
        await hodl.release(1, alice, alice, { from: alice });
        // 8,2,3,4,9,6
        await hodl.release(7, alice, alice, { from: alice });
        // 8,2,6,4,9
        await hodl.release(3, alice, alice, { from: alice });

        // Burn 2k locked PRPS to delete 8, 2
        await prps.burn(ether("2000"), "0x", { from: alice });

        let _hodl = await getHodl(hodl, alice, alice, 8);
        expectBigNumber(_hodl.id, ZERO);
        _hodl = await getHodl(hodl, alice, alice, 2);
        expectBigNumber(_hodl.id, ZERO);


        // Release remaining locks
        // 6,4,9
        await hodl.release(6, alice, alice, { from: alice });
        // 4,9
        await hodl.release(9, alice, alice, { from: alice });
        // 4
        await hodl.release(4, alice, alice, { from: alice });

        // Now alice released all her PRPS minus the 2k that got burned
        lockedPrps = await prps.hodlBalanceOf(alice);
        unlockedPrps = await prps.balanceOf(alice);
        aliceDubi = await dubi.balanceOf(alice);

        expectBigNumber(unlockedPrps, amount.sub(ether("8000")));
        expectBigNumber(lockedPrps, ZERO)

        // Approx. 80 DUBI for the 2k burned PRPS after 1 year
        expectBigNumberApprox(aliceDubi, ether("480"));

    });

    it("should emit Transfer event and exclude burned locked PRPS", async () => {
        const expectBurnAmount = (receipt, burnAmount) => {
            const packed = receipt.logs[0].args.amountAndFuel;
            const unpacked = unpackBurnAmount(packed);
            expectBigNumber(unpacked.amount, burnAmount);
            expectBigNumber(unpacked.fuelAmount, ZERO);
            expect(unpacked.fuelType).to.eq(FuelType.NONE);

            expectEvent(receipt, "Transfer", {
                value: ZERO,
            });
        }

        await expectHodl(prps, hodl, 1, ether("1000"), HODL_MAX_DURATION, alice, alice, { from: alice });

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, await prps.balanceOf(alice), { from: alice });

        expectBigNumber(await prps.hodlBalanceOf(alice), ether("1000"));
        expectZeroBalance(await prps.balanceOf(alice));

        let receipt = await prps.burn(ether("100"), "0x0", { from: alice });
        expectBurnAmount(receipt, ether("100"));

        expectBigNumber(await prps.hodlBalanceOf(alice), ether("900"));
        expectZeroBalance(await prps.balanceOf(alice));

        receipt = await prps.burn(ether("300"), "0x0", { from: alice });
        expectBurnAmount(receipt, ether("300"));

        expectBigNumber(await prps.hodlBalanceOf(alice), ether("600"));
        expectZeroBalance(await prps.balanceOf(alice));

        receipt = await prps.burn(ether("600"), "0x0", { from: alice });
        expectBurnAmount(receipt, ether("600"));

        expectZeroBalance(await prps.hodlBalanceOf(alice));
        expectZeroBalance(await prps.balanceOf(alice));
    });

    it("should burn locked PRPS of sender and auto-mint (multiple locks)", async () => {
        // Create 100 locks, each with increasingly more PRPS
        for (let i = 0; i < 100; i++) {
            await expectHodl(prps, hodl, i + 1, ether(`${(i + 1) * 100}`), HODL_MAX_DURATION, alice, alice, { from: alice });
        }

        let lockedPrps = await prps.hodlBalanceOf(alice);
        let unlockedPrps = await prps.balanceOf(alice);
        let aliceDubi = await dubi.balanceOf(alice);

        expectBigNumber(unlockedPrps, ether("495000"))
        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, unlockedPrps, { from: alice });

        expectBigNumber(lockedPrps, ether("505000"))
        // 4% of 505000
        expectBigNumber(aliceDubi, ether("20200"));

        // Now burn all of Alice's locked PRPS in even chunks
        const chunks = 10;
        const chunk = ether("505000").div(new BN(10));
        for (let i = 0; i < chunks; i++) {
            await prps.burn(chunk, "0x0", { from: alice });
        }

        // Locked and unlocked PRPS now all gone
        lockedPrps = await prps.hodlBalanceOf(alice);
        unlockedPrps = await prps.balanceOf(alice);

        // Burned locked PRPS is removed from alice's hodl balance
        expectZeroBalance(lockedPrps);
        expectZeroBalance(unlockedPrps);
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(bob));

        expectBigNumber(await prps.balanceOf(bob), ether("495000"));

        // Alice burned all her PRPS right after she locked.
        // So the auto-minted DUBI is very little, due the all burns not happening
        // instantly.
        const aliceDubiAfter = await dubi.balanceOf(alice);
        //
        // Due to slow unit tests etc. the number of seconds passed increase the DUBI:
        // 20200.000000000000000000
        // 20200.011040334855403468
        //     0.011040334855403468 
        expectBigNumberApprox(aliceDubi, aliceDubiAfter, ether("1").div(new BN("10")));

        // All 100 locks should now be deleted
        for (let i = 0; i < 100; i++) {
            const _hodl = await getHodl(hodl, alice, alice, i + 1);
            expectBigNumber(_hodl.id, ZERO);
        }
    });

    it("should partially burn locked PRPS", async () => {
        await expectHodl(prps, hodl, 1, ether("100"), HODL_MAX_DURATION, alice, alice, { from: alice });
        await expectHodl(prps, hodl, 2, ether("200"), HODL_MAX_DURATION, alice, alice, { from: alice });

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, await prps.balanceOf(alice), { from: alice });

        // Burn 220 PRPS, thus deleting one lock and partially burning the remaining one.
        await prps.burn(ether("220"), "0x0", { from: alice });

        // 300 PRPS got locked in total and 220 PRPS has been removed from the hodl balance
        const lockedPrps = await prps.hodlBalanceOf(alice);
        expectBigNumber(lockedPrps, ether("80"));

        // The order in which locks are burned is not deterministic,
        // so we have two cases:
        // - lock 1 gets burned first (=0) and removing the remaining 120 from the second lock (=80)
        // - lock 2 gets burned first (=0) and removing the remaining 20 from the first lock (=80)
        const hodl1 = await getHodl(hodl, alice, alice, 1);
        const hodl2 = await getHodl(hodl, alice, alice, 2);

        if (hodl1.id === ZERO) { // Hodl 1 got burned completely
            expectBigNumber(hodl1.lockedPrps, ZERO); // deleted
            expectBigNumber(hodl1.burnedLockedPrps, ZERO); // deleted
            expectBigNumber(hodl2.id, new BN(2));
            expectBigNumber(hodl2.burnedLockedPrps, ether("120"));
        } else {
            expectBigNumber(hodl2.id, ZERO);
            expectBigNumber(hodl2.lockedPrps, ZERO); // deleted
            expectBigNumber(hodl2.burnedLockedPrps, ZERO); // deleted
            expectBigNumber(hodl1.burnedLockedPrps, ether("20"));
        }
    });

    it("should mint DUBI and release PRPS for respective beneficiary", async () => {
        // The minted DUBI goes to Bob, while the released PRPS goes to Charlie
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, bob, charlie, { from: alice });

        expectZeroBalance(await dubi.balanceOf(alice));
        expectZeroBalance(await dubi.balanceOf(charlie));

        // Nobody has unlocked PRPS anymore
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await prps.balanceOf(alice));
        expectZeroBalance(await prps.balanceOf(bob));
        expectZeroBalance(await prps.balanceOf(charlie));

        // Alice is the creator, but Charlie the PRPS beneficiary. So the
        // hodl balance is updated on his address.
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));
        expectZeroBalance(await prps.hodlBalanceOf(alice));
        expectZeroBalance(await prps.hodlBalanceOf(bob));
        expectBigNumber(await prps.hodlBalanceOf(charlie), amount);

        // 4% DUBI for Bob
        expectBigNumber(await dubi.balanceOf(bob), ether("40000"));
        expectZeroBalance(await dubi.balanceOf(alice));
        expectZeroBalance(await dubi.balanceOf(charlie));
        expectZeroBalance(await dubi.balanceOf(hodl.address));

        // Fast-forward 1 year
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

        // Release PRPS
        await hodl.release(1, charlie, alice, { from: alice });

        expectZeroBalance(await prps.balanceOf(alice));
        expectZeroBalance(await prps.balanceOf(bob));
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await prps.hodlBalanceOf(alice));
        expectZeroBalance(await prps.hodlBalanceOf(charlie));
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));

        // Charlie got alice's initially locked PRPS
        expectBigNumber(await prps.balanceOf(charlie), amount);
    });

    it("should still release PRPS if expired for 10 years", async () => {
        // The minted DUBI goes to Bob, while the released PRPS goes to Charlie
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, bob, charlie, { from: alice });

        expectZeroBalance(await dubi.balanceOf(alice));
        expectZeroBalance(await dubi.balanceOf(charlie));

        // 4%
        expectBigNumber(await dubi.balanceOf(bob), ether("40000"));

        // Fast-forward 10 years
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 120));

        // Release PRPS
        await hodl.release(1, charlie, alice, { from: alice });

        expectZeroBalance(await prps.balanceOf(alice));
        expectZeroBalance(await prps.balanceOf(bob));
        expectZeroBalance(await prps.balanceOf(hodl.address));

        // Charlie got alice's initially locked PRPS
        expectBigNumber(await prps.balanceOf(charlie), amount);
    });

    it("should not release PRPS if all got burned", async () => {
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, alice, alice, { from: alice });

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, await prps.balanceOf(alice), { from: alice });

        await prps.burn(amount, "0x0", { from: alice });

        // Fast-forward to expiry of the initial lock
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

        // However, the lock got already deleted and can't be released anymore
        await expectRevert(hodl.release(1, alice, alice, { from: alice }), "H-21");
    });

    it("should release remaining PRPS if only some got burned", async () => {
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, alice, alice, { from: alice });

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, await prps.balanceOf(alice), { from: alice });

        await prps.burn(amount.div(new BN(2)), "0x0", { from: alice });

        // Fast-forward to expiry of the initial lock
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

        // The remaining 50% of the PRPS is released
        await hodl.release(1, alice, alice, { from: alice });
        expectBigNumber(await prps.balanceOf(alice), amount.div(new BN(2)));
        const hodl1 = await getHodl(hodl, alice, alice, 1);
        expectBigNumber(hodl1.id, ZERO);

        // But releasing more fails, because lock got deleted
        await expectRevert(hodl.release(1, alice, alice, { from: alice }), "H-21");
    });

    it("should yield same amount of DUBI when burning locked PRPS for <12 months", async () => {
        // Send bob all but 200 ether
        await prps.transfer(bob, amount.sub(ether("100")), { from: alice });

        expectZeroBalance(await dubi.balanceOf(alice));
        // 1% DUBI for holding 3 months
        await expectHodl(prps, hodl, 1, ether("100"), hodlDurationMonthsToDays(3), alice, alice, { from: alice });
        expectBigNumberApprox(await dubi.balanceOf(alice), ether("1"), ether("1").div(new BN("100")));

        // Immediately burn the locked PRPS, and receive another 3% DUBI
        await prps.burn(ether("100"), "0x0", { from: alice });
        expectBigNumberApprox(await dubi.balanceOf(alice), ether("4"), ether("1").div(new BN("100")));
    });

    it("should auto-mint when the PRPS contract itself calls burn", async () => {
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, alice, alice, { from: alice });
        expectBigNumber(await dubi.balanceOf(alice), ether("40000"));

        expectBigNumber(await prps.hodlBalanceOf(alice), amount);
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));

        expectZeroBalance(await prps.balanceOf(alice));
        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(hodl.address));

        // send remaining unlocked PRPS to bob, so we can burn all the locked PRPS
        await prps.transfer(bob, await prps.balanceOf(alice), { from: alice });

        await prps.burn(amount, "0x0", { from: alice });

        expectZeroBalance(await prps.balanceOf(hodl.address));
        expectZeroBalance(await dubi.balanceOf(hodl.address));
        expectZeroBalance(await prps.balanceOf(alice));

        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));
        expectZeroBalance(await prps.hodlBalanceOf(hodl.address));
    });

    it("should not withdraw DUBI from a finite lock", async () => {
        await expectHodl(prps, hodl, 1, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: alice });

        let dubiBalance = await dubi.balanceOf(alice);
        expectBigNumber(dubiBalance, new BN("4"));

        // Reverts on finite lock
        await expectRevert(hodl.withdraw(1, alice, alice, { from: alice }), "H-9");

        // Also reverts if it expired
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));
        await expectRevert(hodl.withdraw(1, alice, alice, { from: alice }), "H-9");

        // Reverts after release because hodl doesn't exist anymore
        await hodl.release(1, alice, alice);

        await expectRevert(hodl.withdraw(1, alice, alice, { from: alice }), "H-21");
    });
})

describe("Misc", () => {
    it("should get hodl", async () => {
        const _hodl = await expectHodl(prps, hodl, 1, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: alice });
        expectBigNumber(_hodl.id, new BN(1));
    });

    it("should return empty hodl if non-existent", async () => {
        expectBigNumber((await getHodl(hodl, alice, alice, new BN(999))).id, ZERO);
        expectBigNumber((await getHodl(hodl, alice, bob, ZERO)).id, ZERO);
    });

    it("should return empty hodl after release", async () => {
        const _hodl = await expectHodl(prps, hodl, 1, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: alice });
        expectBigNumber(_hodl.id, new BN(1));

        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));
        await hodl.release(1, alice, alice);

        expectBigNumber((await getHodl(hodl, alice, alice, new BN(1))).id, ZERO);
    });

    it("should revert if beneficiary has too many foreign hodls", async () => {
        await prps.mint(bob, ether("100000"));
        await prps.mint(charlie, ether("100000"));

        // Create 50 hodls with bob with alice being the PRPS beneficiary
        for (let i = 0; i < 50; i++) {
            // 1st hodl => 139304 GAS including first storage write, etc.
            await expectHodl(prps, hodl, i + 1, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: bob });
            // 50th hodl => 250081 GAS
        }

        // Creating the 51th one will fail, since she can only have 50 foreign hodls (not created by her)
        await expectRevert(expectHodl(prps, hodl, 51, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: bob }), "H-29");
        await expectRevert(expectHodl(prps, hodl, 1, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: charlie }), "H-29");

        // Alice can still hodl for herself as often as she likes
        for (let i = 0; i < 20; i++) {
            // 51th hodl => 227219 GAS
            await expectHodl(prps, hodl, i + 1, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: alice });
            // 70th hodl => 265561 GAS
        }

        // Release one of bob locks
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));
        await hodl.release(15, alice, bob);
        // => Releasing hodl at position 1 => 46498 GAS
        // => Releasing hodl at position 15 => 85964 GAS

        // Now someone else can hodl again
        await expectHodl(prps, hodl, 1, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: charlie });
        // 71th hodl => 290488 GAS

        // Then it fails again
        await expectRevert(expectHodl(prps, hodl, 51, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: bob }), "H-29");
        await expectRevert(expectHodl(prps, hodl, 2, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: charlie }), "H-29");

        // Alice can still hodl fine
        await expectHodl(prps, hodl, 21, new BN("100"), HODL_MAX_DURATION, alice, alice, { from: alice });
        // 72th hodl => 267579 GAS

        // Send all of alice's PRPS to bob
        await prps.transfer(bob, await prps.balanceOf(alice), { from: alice });

        // Extreme scenario which wipes 50 hodls
        await prps.burn(new BN("100").mul(new BN(50)), "0x", { from: alice });
        // => 448216 GAS
        // Bob paid way more gas spamming the hodls than Alice had to pay to burn them
    });
});

describe("Hodl - Migration", () => {
    const owner = () => deployment.owner;

    // For reference, this is how old hodls look like:
    // 
    //   struct Item {
    //     uint256 id;
    //     address beneficiary;
    //     uint256 value;
    //     uint256 releaseTime;
    //     bool fulfilled;
    //   }
    //

    it("should create hodl without minting DUBI", async () => {
        const dubiBefore = await dubi.balanceOf(bob);

        const receipt = await hodl.migrateHodls(
            [1],
            [bob], [
            ether("100").toString()],
            [hodlDurationMonthsToDays(3) * 2], // 6 month lock
            [await blockchainTimestampWithOffset(deployment.web3, -SECONDS_PER_MONTH)], // created 1 month ago
        );

        console.log(receipt.receipt.gasUsed);

        const dubiAfter = await dubi.balanceOf(bob);
        expectBigNumber(dubiAfter, dubiBefore);

        // Bob now has a lock, which gets released in 5 months
        await expectRevert(hodl.release(1, bob, bob, { from: bob }), "H-8");

        // Wait 5 months
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 5));

        // Now bob can unlock his PRPS again
        const prpsBefore = await prps.balanceOf(bob);
        await hodl.release(1, bob, bob, { from: bob });
        const prpsAfter = await prps.balanceOf(bob);

        expectBigNumber(prpsBefore, ZERO);
        expectBigNumber(prpsAfter, ether("100"));
    });

    it("should create many hodls", async () => {
        const dubiBefore = await dubi.balanceOf(bob);

        expectBigNumber(await prps.hodlBalanceOf(bob), ZERO)

        const hodlIds: any[] = [];
        const creators: any[] = [];
        const hodlBalances: any[] = [];
        const durations: any[] = [];
        const createdAts: any[] = [];

        for (let i = 0; i < 50; i++) {
            hodlIds.push(i + 1);
            creators.push(bob);
            hodlBalances.push(ether("100").toString());
            durations.push(hodlDurationMonthsToDays(3) * 2); // 6 month lock
            createdAts.push(await blockchainTimestampWithOffset(deployment.web3, -SECONDS_PER_MONTH)); // created 1 month ago
        }

        const receipt = await hodl.migrateHodls(
            hodlIds,
            creators,
            hodlBalances,
            durations,
            createdAts,
            { gas: 10_000_000 },
        );

        // = 4_315_673 GAS for 50 hodls per tx
        console.log(receipt.receipt.gasUsed);

        // HODL balance of bob = 50 * 100
        expectBigNumber(await prps.hodlBalanceOf(bob), ether("5000"))

        const dubiAfter = await dubi.balanceOf(bob);
        expectBigNumber(dubiAfter, dubiBefore);

        // Bob now has a lock, which gets released in 5 months
        await expectRevert(hodl.release(1, bob, bob, { from: bob }), "H-8");

        // Wait 5 months
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 5));

        // Now bob can unlock his PRPS again
        const prpsBefore = await prps.balanceOf(bob);
        await hodl.release(1, bob, bob, { from: bob });
        const prpsAfter = await prps.balanceOf(bob);

        expectBigNumber(prpsBefore, ZERO);
        expectBigNumber(prpsAfter, ether("100"));
        expectBigNumber(await prps.hodlBalanceOf(bob), ether("4900"))
    });

    it("should create expired hodl without minting DUBI", async () => {
        const dubiBefore = await dubi.balanceOf(bob);

        await hodl.migrateHodls(
            [1],
            [bob], [
            ether("100").toString()],
            [hodlDurationMonthsToDays(3) * 2], // 6 month lock
            [await blockchainTimestampWithOffset(deployment.web3, -(SECONDS_PER_MONTH * 6))], // created 1 month ago
        );

        const dubiAfter = await dubi.balanceOf(bob);
        expectBigNumber(dubiAfter, dubiBefore);

        // Bob now has a lock that can be released immediately, since it's already expired
        const prpsBefore = await prps.balanceOf(bob);
        await hodl.release(1, bob, bob, { from: bob });
        const _hodl = await getHodl(hodl, bob, bob, 1);
        expectBigNumber(_hodl.id, ZERO);

        const prpsAfter = await prps.balanceOf(bob);

        expectBigNumber(prpsBefore, ZERO);
        expectBigNumber(prpsAfter, ether("100"));
    });

    it("should fail if owner renounced ownership", async () => {
        await hodl.migrateHodls(
            [1],
            [bob], [
            ether("100").toString()],
            [hodlDurationMonthsToDays(3) * 2], // 6 month lock
            [await blockchainTimestampWithOffset(deployment.web3, -SECONDS_PER_MONTH)], // created 1 month ago
        );

        await hodl.renounceOwnership({ from: deployment.owner });

        await expectRevert(hodl.migrateHodls(
            [1],
            [bob], [
            ether("100").toString()],
            [hodlDurationMonthsToDays(3) * 2], // 6 month lock
            [await blockchainTimestampWithOffset(deployment.web3, -SECONDS_PER_MONTH)], // created 1 month ago
        ), "Ownable: caller is not the owner");
    });

});

describe("BitpackingHodl", () => {

    it("should be ok", async () => {
        const BitPackingHodl = contract.fromArtifact("BitPackingHodl");

        const bitpackingHodl: BitPackingHodlInstance = await BitPackingHodl.new();
        await bitpackingHodl.testPackUnpackedData();
        await bitpackingHodl.testUnpackPackedData();
    });

})

// 1 year = 4%
const HODL_MAX_DURATION = 365;
// 91.25 days rounded up to 92 days for ~1%
const HODL_1_MONTH = 365 / 12;

const hodlDurationMonthsToDays = (n: number) => {
    return Math.floor(HODL_1_MONTH * n);
}
