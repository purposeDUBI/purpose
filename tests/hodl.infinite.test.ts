import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, expectRevert, time, ether } from "@openzeppelin/test-helpers";
import { PurposeInstance, DubiInstance, HodlInstance } from "../types/contracts"
import { expectBigNumber, expectZeroBalance, expectBigNumberApprox, deployTestnet, expectHodl, getHodl, HODL_MAX_DURATION } from "./support";
import { PurposeDeployment, SECONDS_PER_MONTH, ZERO } from "../src/types";

contract.fromArtifact("Purpose");

const [alice, bob, charlie] = accounts;

let prps: PurposeInstance;
let dubi: DubiInstance;
let hodl: HodlInstance;

let amount = ether("1000000");

let deployment: PurposeDeployment;

beforeEach(async () => {
    deployment = await deployTestnet();
    prps = deployment.Purpose;
    hodl = deployment.Hodl;
    dubi = deployment.Dubi;

    await prps.mint(alice, amount);
});

describe("Infinite Hodl", () => {
    it("should lock PRPS infinitely", async () => {
        await expectHodl(prps, hodl, 1, ether("100"), 0, alice, alice, { from: alice });

        // On inifnite lock, alice immediately gets 4%.
        expectBigNumber(await dubi.balanceOf(alice), ether("4"));

        let _hodl = await getHodl(hodl, alice, alice, 1);
        expectBigNumber(_hodl.duration, ZERO);

        await expectRevert.unspecified(hodl.release(1, alice, alice, { from: alice }));

        // After a year, release still not possible
        await time.increase(time.duration.years(1));
        await expectRevert.unspecified(hodl.release(1, alice, alice, { from: alice }));

        // Also not after 10 years
        await time.increase(time.duration.years(9));
        await expectRevert.unspecified(hodl.release(1, alice, alice, { from: alice }));
    });

    it("should lock PRPS infinitely and withdraw generated DUBI", async () => {
        await expectHodl(prps, hodl, 1, new BN("100"), 0, alice, alice, { from: alice });

        let dubiBalance = await dubi.balanceOf(alice);
        expectBigNumber(dubiBalance, new BN("4"));

        await time.increase(time.duration.seconds(1));

        // Fails to withdraw if no DUBI has been generated yet
        await expectRevert(hodl.withdraw(1, alice, alice, { from: alice }), "H-13");

        // Wait 3 months for 1% DUBI
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));
        await hodl.withdraw(1, alice, alice, { from: alice });
        dubiBalance = await dubi.balanceOf(alice);
        expectBigNumberApprox(dubiBalance, new BN("5"));

        // Wait 9 months, for another 3% (+1% = 4% total)
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));
        await hodl.withdraw(1, alice, alice, { from: alice });
        dubiBalance = await dubi.balanceOf(alice);
        expectBigNumberApprox(dubiBalance, new BN("8"));

        // Wait 120 months (10 years) for 40% (+4% = 44% total)
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));
        await hodl.withdraw(1, alice, alice, { from: alice });
        dubiBalance = await dubi.balanceOf(alice);
        expectBigNumberApprox(dubiBalance, new BN("48"));
    });

    it("should partially burn infinitely locked PRPS and auto-mint DUBI", async () => {
        await prps.mint(bob, ether("100"));

        let dubiBalance = await dubi.balanceOf(bob);
        expectZeroBalance(dubiBalance);

        await expectHodl(prps, hodl, 1, ether("100"), 0, bob, bob, { from: bob });

        dubiBalance = await dubi.balanceOf(bob);
        expectBigNumber(dubiBalance, ether("4"));

        // Wait 3 months, then burn half of the lock
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

        // Burning should now auto-mint 3 months (1%) worth of DUBI.
        // 1% of 50 PRPS => 0.5 DUBI
        await prps.burn(ether("50"), "0x0", { from: bob });
        dubiBalance = await dubi.balanceOf(bob);
        expectBigNumberApprox(dubiBalance, ether("45").div(new BN(10)));

        // Waiting another year, the lock generates another 4% of the 50 remaining PRPS.
        // Before the burn, the 50 PRPS already got 1%. In total she can withdraw another
        // 5% => 2.5 DUBI
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

        await hodl.withdraw(1, bob, bob, { from: bob });
        dubiBalance = await dubi.balanceOf(bob);

        // bob now has 4.5 + 2.5 DUBI in total
        expectBigNumberApprox(dubiBalance, ether("7"));

        // Burning the rest yields nothing, since almost no time passed since
        // the last withdrawal
        await prps.burn(ether("50"), "0x0", { from: bob });
        dubiBalance = await dubi.balanceOf(bob);
        expectBigNumberApprox(dubiBalance, ether("7"));
    });

    it("should not burn more PRPS than locked", async () => {
        await expectHodl(prps, hodl, 1, new BN(1000), 0, alice, alice, { from: alice });

        // Send unlocked PRPS to bob, so we can only burn locked PRPS
        await prps.transfer(bob, await prps.balanceOf(alice), { from: alice });

        await expectRevert(prps.burn(new BN(1001), "0x0", { from: alice }), "H-14");

        await expectRevert(prps.burn(new BN("79228162514264337593543950335"), "0x0", { from: alice }), "H-14");

        // Let bob lock some of his PRPS too
        await prps.mint(bob, amount);
        await expectHodl(prps, hodl, 2, new BN(1000), 0, bob, bob, { from: bob });

        // Now the Hodl contract has more PRPS than alice locked, but she still can't burn more
        // than she locked by herself.
        await expectRevert(prps.burn(new BN(1001), "0x0", { from: alice }), "H-14");

        await expectRevert(prps.burn(new BN("79228162514264337593543950335"), "0x0", { from: alice }), "H-14");
    });

    it("should withdraw generated DUBI to beneficiary", async () => {
        await expectHodl(prps, hodl, 1, ether("100"), 0, bob, alice, { from: alice });

        // Immediately gets 4%
        let aliceDubi = await dubi.balanceOf(alice);
        let bobDubi = await dubi.balanceOf(bob);
        expectZeroBalance(aliceDubi);
        expectBigNumber(bobDubi, ether("4"));

        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

        // Withdraw another 4% after one year
        await hodl.withdraw(1, alice, alice, { from: bob });

        aliceDubi = await dubi.balanceOf(alice);
        bobDubi = await dubi.balanceOf(bob);

        expectZeroBalance(aliceDubi);
        expectBigNumberApprox(bobDubi, ether("8"));
    });

    it("should revert if withdraw is not called by DUBI beneficiary or it's booster", async () => {
        await expectHodl(prps, hodl, 1, ether("100"), 0, bob, alice, { from: alice });

        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

        await hodl.withdraw(1, alice, alice, { from: bob });

        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));
        await hodl.withdraw(1, alice, alice, { from: deployment.booster });

        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 3));

        await expectRevert(hodl.withdraw(1, alice, alice, { from: alice }), "H-6");

        await deployment.OptIn.instantOptOut(bob, { from: deployment.booster });
        await expectRevert(hodl.withdraw(1, alice, alice, { from: deployment.booster }), "H-6");

        await hodl.withdraw(1, alice, alice, { from: bob });
    });

    it("should yield the same DUBI when locking infinitely vs. finitely over the same timeframe", async () => {
        await prps.mint(bob, amount);
        await prps.mint(charlie, amount);

        // Bob locks for 1 year
        await expectHodl(prps, hodl, 1, amount, HODL_MAX_DURATION, bob, bob, { from: bob });

        // Charlie infinitely locks
        await expectHodl(prps, hodl, 1, amount, 0, charlie, charlie, { from: charlie });

        // Both get 4% DUBI immediately
        let bobDubi = await dubi.balanceOf(bob);
        let charlieDubi: any = await dubi.balanceOf(charlie);
        expectBigNumber(bobDubi, ether("40000"));
        expectBigNumber(charlieDubi, ether("40000"));

        // Wait 12 months
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

        // Charlie can withdraw 4% since a year passed since the last withdrawal
        await hodl.withdraw(1, charlie, charlie, { from: charlie });

        // Bob can re-lock his PRPS for another 4% DUBI
        await hodl.release(1, bob, bob, { from: bob });
        await expectHodl(prps, hodl, 3, amount, HODL_MAX_DURATION, bob, bob, { from: bob });

        bobDubi = await dubi.balanceOf(bob);
        charlieDubi = await dubi.balanceOf(charlie);

        expectBigNumber(bobDubi, ether("80000"));
        // We check charlie's DUBI only approximated, since the DUBI he gets is based on the seconds
        // elapsed since the last withdrawal and it might be slightly more than 4% as
        // the withdrawal doesn't happen exactly after 31_536_000 seconds (365 days).
        expectBigNumberApprox(charlieDubi, ether("80000"), ether("1").div(new BN(10)));
    });

    it("should yield the same DUBI when withdrawing twice or once at the end over same timeframe", async () => {
        const hodlAmount = ether("1000");

        await prps.mint(bob, hodlAmount);
        await prps.mint(charlie, hodlAmount);

        // Bob and Charlie lock at the same time the same amount infinitely
        await expectHodl(prps, hodl, 1, hodlAmount, 0, bob, bob, { from: bob });
        await expectHodl(prps, hodl, 1, hodlAmount, 0, charlie, charlie, { from: charlie });

        // Initial 4% DUBI
        let bobDubi = await dubi.balanceOf(bob);
        let charlieDubi: any = await dubi.balanceOf(charlie);
        expectBigNumber(bobDubi, ether("40"));
        expectBigNumber(charlieDubi, ether("40"));

        // 6 months pass and charlie withdraws already
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 6));
        await hodl.withdraw(1, charlie, charlie, { from: charlie });

        // Bob +0%, charlie +2%
        bobDubi = await dubi.balanceOf(bob);
        charlieDubi = await dubi.balanceOf(charlie);

        expectBigNumber(bobDubi, ether("40"));
        expectBigNumber(charlieDubi, ether("60"));

        // Another 6 months pass and this time both withdraw
        await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 6));
        await hodl.withdraw(1, bob, bob, { from: bob });
        await hodl.withdraw(1, charlie, charlie, { from: charlie });

        // Bob +4%, charlie +2%
        bobDubi = await dubi.balanceOf(bob);
        charlieDubi = await dubi.balanceOf(charlie);

        expectBigNumber(bobDubi, ether("80"));
        expectBigNumber(charlieDubi, ether("80"));
    });
});
