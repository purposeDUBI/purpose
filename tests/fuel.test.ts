
import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, constants, ether, expectRevert, expectEvent, time } from "@openzeppelin/test-helpers";
import { PurposeInstance, DubiInstance, OptInInstance } from "../types/contracts"
import { deployTestnet, expectBigNumber, expectBigNumberApprox } from "./support";
import { FuelType, PurposeDeployment, SECONDS_PER_MONTH, ZERO } from "../src/types";
import { ZERO_ADDRESS } from "@openzeppelin/test-helpers/src/constants";
import { expect } from "chai";
import { createSignedBoostedBurnMessage, createSignedBoostedHodlMessage, createSignedBoostedReleaseMessage, createSignedBoostedSendMessage, createSignedBoostedWithdrawalMessage, unpackBurnAmount } from "../src/utils";

const Purpose = contract.fromArtifact("Purpose");
const Dubi = contract.fromArtifact("Dubi");

const [alice, bob, carl] = accounts;

let prps: PurposeInstance;
let dubi: DubiInstance;
let optIn: OptInInstance;

let deployment: PurposeDeployment;

beforeEach(async () => {
    deployment = await deployTestnet();

    prps = deployment.Purpose;
    dubi = deployment.Dubi;
    optIn = deployment.OptIn;
});

const getBalances = async (from: string): Promise<{ dubi: any, unlockedPrps: any, lockedPrps: any }> => {
    return {
        dubi: await dubi.balanceOf(from),
        unlockedPrps: await prps.balanceOf(from),
        lockedPrps: await prps.hodlBalanceOf(from),
    };
}

describe("Fuel", () => {
    describe("Purpose", () => {
        describe("burnFuel", () => {
            it("should revert if fuel alias is invalid", async () => {
                await Purpose.detectNetwork();
                await Purpose.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
                const prps2: PurposeInstance = await Purpose.new(ether("0"), deployment.OptIn.address, carl, bob, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);

                await prps2.mint(alice, ether("100"));

                // burnFuel only understands fuel alias for DUBI (2)
                await expectRevert(prps2.burnFuel(alice, { tokenAlias: 2, amount: ether("10").toString() }, { from: carl }), "PRPS-12");
                await expectRevert(prps2.burnFuel(alice, { tokenAlias: 3, amount: ether("10").toString() }, { from: carl }), "PRPS-12");
                await expectRevert(prps2.burnFuel(alice, { tokenAlias: 4, amount: ether("10").toString() }, { from: carl }), "PRPS-12");
            });

            it("should revert if invalid caller", async () => {
                await prps.mint(alice, ether("200"));

                await expectRevert(prps.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0 }, { from: deployment.booster }), "PRPS-2");
                await expectRevert(prps.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0 }, { from: bob }), "PRPS-2");
                await expectRevert(prps.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0 }, { from: alice }), "PRPS-2");

                const bobAsHodl = bob;
                const carlAsDubi = carl;

                await Purpose.detectNetwork();
                await Purpose.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
                const prps2: PurposeInstance = await Purpose.new(ether("1000000"), deployment.OptIn.address, carlAsDubi, bobAsHodl, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);
                await prps2.mint(alice, ether("100"));

                // Works fine
                await prps2.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0 }, { from: bobAsHodl });
                await prps2.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0 }, { from: carlAsDubi });

                await expectRevert(prps2.burnFuel(alice, { amount: ether("11").toString(), tokenAlias: 0 }, { from: carlAsDubi }), "PRPS-10");

                // Reverts if token is unknown
                await expectRevert(prps2.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 999 }, { from: carlAsDubi }), "PRPS-12");
            });
        })

        describe("boostedSend", () => {
            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("30"));

                // Can use DUBI as fuel
                await expectBoostedSendFuel(prps, boostedAlice, bob, ether("5"), { dubi: ether("5") }, 1);

                // Can use unlocked PRPS as fuel
                await expectBoostedSendFuel(prps, boostedAlice, bob, ether("5"), { unlockedPrps: ether("5") }, 2);

                // Can use locked PRPS as fuel
                await deployment.Hodl.hodl(1, ether("10"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice 5 PRPS left
                await expectBoostedSendFuel(prps, boostedAlice, bob, ether("1"), { lockedPrps: ether("5") }, 3);

                // Hodl half eaten
                let _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).burnedLockedPrps, ether("5"));

                await expectBoostedSendFuel(prps, boostedAlice, bob, ether("1"), { lockedPrps: ether("5") }, 4);

                // Deleted
                _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).id, ZERO);
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await prps.mint(boostedAlice.address, ether("20"));

                // The booster might also waive the fuel
                await expectBoostedSendFuel(prps, boostedAlice, bob, ether("20"), {}, 1);
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("2"));
                await prps.mint(boostedAlice.address, ether("20"));

                // Alice only has 2 DUBI, but she needs 5
                await expectRevert(expectBoostedSendFuel(prps, boostedAlice, bob, ether("20"), { dubi: ether("5") }, 1), "DUBI-7");

                // Alice only has 20 unlocked PRPS, but she needs 25
                await expectRevert(expectBoostedSendFuel(prps, boostedAlice, bob, ether("20"), { unlockedPrps: ether("5") }, 1), "ERC20-10");
                // 16 + 5
                await expectRevert(expectBoostedSendFuel(prps, boostedAlice, bob, ether("16"), { unlockedPrps: ether("5") }, 1), "ERC20-10");

                // Hodl 1 PRPS
                await deployment.Hodl.hodl(1, ether("1"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice only has 1 locked PRPS, but she needs 2 (unlocked PRPS is ignored)
                await expectRevert(expectBoostedSendFuel(prps, boostedAlice, bob, ether("20"), { lockedPrps: ether("2") }, 1), "H-14");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("2"));

                await expectRevert(expectBoostedSendFuel(prps, boostedAlice, bob, ether("20"), { dubi: ether("11") }, 1), "DUBI-5");
                await expectRevert(expectBoostedSendFuel(prps, boostedAlice, bob, ether("20"), { unlockedPrps: ether("11") }, 1), "PRPS-10");
                await expectRevert(expectBoostedSendFuel(prps, boostedAlice, bob, ether("20"), { lockedPrps: ether("11") }, 1), "PRPS-10");
            });
        });

        describe("boostedBurn", () => {
            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("30"));

                // Can use DUBI as fuel
                let autoMintedDubiFromPrpsBurn = ether("2").div(new BN(10)); // 4% of 5 PRPS = 0.2 DUBI
                await expectBoostedBurnFuelERC20(prps, boostedAlice, ether("5"), { dubi: ether("5") }, 1, autoMintedDubiFromPrpsBurn);

                // Can use unlocked PRPS as fuel
                await expectBoostedBurnFuelERC20(prps, boostedAlice, ether("5"), { unlockedPrps: ether("5") }, 2, autoMintedDubiFromPrpsBurn);

                // Can use locked PRPS as fuel
                await deployment.Hodl.hodl(1, ether("10"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice 5 PRPS left
                autoMintedDubiFromPrpsBurn = ether("4").div(new BN(100)); // 4% of 1 PRPS = 0.04 DUBI
                await expectBoostedBurnFuelERC20(prps, boostedAlice, ether("1"), { lockedPrps: ether("5") }, 3, autoMintedDubiFromPrpsBurn);

                // Hodl half eaten
                const _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).burnedLockedPrps, ether("5"));

                // Burning 10 unlocked PRPS, auto-mints 0.4 DUBI which is used as intrinsic fuel                
                autoMintedDubiFromPrpsBurn = ether("4").div(new BN(10));
                await prps.mint(boostedAlice.address, ether("10"));
                await expectBoostedBurnFuelERC20(prps, boostedAlice, ether("10"), { intrinsicFuel: autoMintedDubiFromPrpsBurn }, 4, autoMintedDubiFromPrpsBurn);
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await prps.mint(boostedAlice.address, ether("20"));

                // The booster might also waive the fuel
                const autoMintedDubiFromPrpsBurn = ether("8").div(new BN(10)); // 4% of 20 PRPS = 0.8 DUBI
                await expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), {}, 1, autoMintedDubiFromPrpsBurn);
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("2"));
                await prps.mint(boostedAlice.address, ether("20"));

                // Alice only has 2 DUBI, but she needs 5
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { dubi: ether("5") }, 1), "DUBI-7");

                // Alice only has 20 unlocked PRPS, but she needs 25.
                // The fuel is burned first, so 15 PRPS unlocked remaining PRPS means the contract tries to
                // burn 5 locked PRPS - which then causes Hodl to revert.
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { unlockedPrps: ether("5") }, 1), "H-14");
                // 16 + 5
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("16"), { unlockedPrps: ether("5") }, 1), "H-14");

                // Hodl 1 PRPS
                await deployment.Hodl.hodl(1, ether("1"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice only has 1 locked PRPS, but she needs 2 (unlocked PRPS is ignored)
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { lockedPrps: ether("2") }, 1), "PRPS-7");
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { intrinsicFuel: ether("2") }, 1), "PRPS-7");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("2"));

                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { dubi: ether("11") }, 1), "DUBI-5");
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { unlockedPrps: ether("11") }, 1), "PRPS-10");
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { lockedPrps: ether("11") }, 1), "PRPS-10");
                await expectRevert(expectBoostedBurnFuelERC20(prps, boostedAlice, ether("20"), { intrinsicFuel: ether("11") }, 1), "PRPS-10");
            });
        });
    });

    describe("Dubi", () => {

        describe("burnFuel", () => {
            it("should revert if fuel alias is invalid", async () => {
                await Dubi.detectNetwork();
                await Dubi.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
                const dubi2: DubiInstance = await Dubi.new(ether("0"), deployment.OptIn.address, carl, bob, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);

                await dubi2.mint(alice, ether("100"));

                // burnFuel only understands fuel alias for DUBI (2)
                await expectRevert(dubi2.burnFuel(alice, { tokenAlias: 3, amount: ether("10").toString() }, { from: carl }), "DUBI-8");
                await expectRevert(dubi2.burnFuel(alice, { tokenAlias: 1, amount: ether("10").toString() }, { from: carl }), "DUBI-8");
                await expectRevert(dubi2.burnFuel(alice, { tokenAlias: 0, amount: ether("10").toString() }, { from: carl }), "DUBI-8");
            });

            it("should revert if invalid caller", async () => {
                await dubi.mint(alice, ether("200"));

                await expectRevert(dubi.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0, }, { from: deployment.booster }), "DUBI-1");
                await expectRevert(dubi.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0, }, { from: bob }), "DUBI-1");
                await expectRevert(dubi.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 0, }, { from: alice }), "DUBI-1");

                const bobAsPurpose = bob;
                const carlAsHodl = carl;

                await Dubi.detectNetwork();
                await Dubi.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
                const dubi2: DubiInstance = await Dubi.new(ether("0"), deployment.OptIn.address, carlAsHodl, bobAsPurpose, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);

                await dubi2.mint(alice, ether("100"));

                await dubi2.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 2 }, { from: carlAsHodl });
                await dubi2.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 2 }, { from: bobAsPurpose });

                await expectRevert(dubi2.burnFuel(alice, { amount: ether("11").toString(), tokenAlias: 2 }, { from: carlAsHodl }), "DUBI-5");

                // Reverts if token is unknown
                await expectRevert(dubi2.burnFuel(alice, { amount: ether("1").toString(), tokenAlias: 999 }, { from: carlAsHodl }), "DUBI-8");
            });
        })

        describe("boostedSend", () => {

            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("30"));

                // Can use DUBI as fuel
                await expectBoostedSendFuel(dubi, boostedAlice, bob, ether("5"), { dubi: ether("5") }, 1);

                // Can use unlocked PRPS as fuel
                await expectBoostedSendFuel(dubi, boostedAlice, bob, ether("5"), { unlockedPrps: ether("5") }, 2);

                // Can use locked PRPS as fuel
                await deployment.Hodl.hodl(1, ether("10"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice 15 PRPS left
                await expectBoostedSendFuel(dubi, boostedAlice, bob, ether("1"), { lockedPrps: ether("5") }, 3);

                // Hodl half eaten
                let _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).burnedLockedPrps, ether("5"));

                await expectBoostedSendFuel(dubi, boostedAlice, bob, ether("1"), { lockedPrps: ether("5") }, 4);

                // Deleted
                _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).id, ZERO);
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));

                // The booster might also waive the fuel
                await expectBoostedSendFuel(dubi, boostedAlice, bob, ether("20"), {}, 1);
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("2"));

                // Alice only has 20 DUBI, but she needs 20 + 5
                await expectRevert(expectBoostedSendFuel(dubi, boostedAlice, bob, ether("20"), { dubi: ether("5") }, 1), "ERC20-10");
                // 16 + 5
                await expectRevert(expectBoostedSendFuel(dubi, boostedAlice, bob, ether("16"), { dubi: ether("5") }, 1), "ERC20-10");

                // Alice only has 2 unlocked PRPS, but she needs 5
                await expectRevert(expectBoostedSendFuel(dubi, boostedAlice, bob, ether("20"), { unlockedPrps: ether("5") }, 1), "PRPS-7");

                // Hodl 1 PRPS
                await deployment.Hodl.hodl(1, ether("1"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice only has 1 locked PRPS, but she needs 2 (unlocked PRPS is ignored)
                await expectRevert(expectBoostedSendFuel(dubi, boostedAlice, bob, ether("20"), { lockedPrps: ether("2") }, 1), "PRPS-7");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("2"));

                await expectRevert(expectBoostedSendFuel(dubi, boostedAlice, bob, ether("20"), { dubi: ether("11") }, 1), "DUBI-5");
                await expectRevert(expectBoostedSendFuel(dubi, boostedAlice, bob, ether("20"), { unlockedPrps: ether("11") }, 1), "PRPS-10");
                await expectRevert(expectBoostedSendFuel(dubi, boostedAlice, bob, ether("20"), { lockedPrps: ether("11") }, 1), "PRPS-10");
            });
        });

        describe("boostedBurn", () => {

            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("30"));

                await expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("5"), { dubi: ether("5") }, 1);
                await expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("5"), { unlockedPrps: ether("5") }, 2);

                await deployment.Hodl.hodl(1, ether("5"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                await expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("5"), { lockedPrps: ether("5") }, 3);

                // DUBI doesn't understand autoMintedDubi
                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("5"), { intrinsicFuel: ether("5") }, 4), "DUBI-8");
            });

            it("should burn without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));

                // The booster might also waive the fuel
                await expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("20"), {}, 1);
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("2"));

                // Alice only has 20 DUBI, but she needs 20 + 5
                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("20"), { dubi: ether("5") }, 1), "ERC20-9");
                // 16 + 5
                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("16"), { dubi: ether("5") }, 1), "ERC20-9");

                // Alice only has 2 unlocked PRPS, but she needs 5
                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("20"), { unlockedPrps: ether("5") }, 1), "PRPS-7");

                // Hodl 1 PRPS
                await deployment.Hodl.hodl(1, ether("1"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice only has 1 locked PRPS, but she needs 2 (unlocked PRPS is ignored)
                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("20"), { lockedPrps: ether("2") }, 1), "PRPS-7");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("2"));

                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("20"), { dubi: ether("11") }, 1), "DUBI-5");
                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("20"), { unlockedPrps: ether("11") }, 1), "PRPS-10");
                await expectRevert(expectBoostedBurnFuelERC20(dubi, boostedAlice, ether("20"), { lockedPrps: ether("11") }, 1), "PRPS-10");
            });
        });
    });

    describe("Hodl", () => {
        describe("boostedHodl", () => {

            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("50"));

                // Hodls 5 PRPS for 365 days => 4% of 5 DUBI => 0.2 DUBI minted
                // The Dubi fuel is taken from the already existing balance
                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, { dubi: ether("5") }, ether("2").div(new BN(10)));

                // The PRPS fuel is taken from already locked PRPS
                await expectBoostedHodlFuel(boostedAlice, 2, ether("5"), 365, { lockedPrps: ether("5") }, ether("2").div(new BN(10)));

                // The hodl got deleted since it had exactly 5 PRPS that was used to as fuel
                const _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).id, ZERO);

                // The PPRPS fuel is taken from the PRPS that gets hodled, so only (10- 5) * 0.04 = 0.2 DUBI is minted
                await expectBoostedHodlFuel(boostedAlice, 3, ether("10"), 365, { unlockedPrps: ether("5") }, ether("2").div(new BN(10)));

                // The intrinsic fuel is taken from the DUBI that gets minted as part of the hodl. So alice gains only 0.1 DUBI
                await expectBoostedHodlFuel(boostedAlice, 4, ether("5"), 365, { intrinsicFuel: ether("1").div(new BN(10)) }, ether("2").div(new BN(10)));
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await prps.mint(boostedAlice.address, ether("20"));

                // The booster might also waive the fuel
                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, {}, ether("2").div(new BN(10)));
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("2"));
                await prps.mint(boostedAlice.address, ether("15"));

                // Alice only has 2 DUBI, but she needs 5
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, { dubi: ether("5") }, ether("2").div(new BN(10))), "DUBI-7");

                // Alice locks 4 PRPS, but the fuel is 5
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("4"), 365, { unlockedPrps: ether("5") }, ether("16").div(new BN(100))), "H-4-1");

                // Alice locks 10 PRPS for 1 year and mints 0.4 DUBI, but the fuel is 1 DUBI
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("10"), 365, { intrinsicFuel: ether("1") }, ether("4").div(new BN(10))), "H-4-2");

                // Alice locks 10 PRPS for 1 year and mints 0.4 DUBI, but the fuel is 1 DUBI
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("10"), 365, { intrinsicFuel: ether("1") }, ether("4").div(new BN(10))), "H-4-2");

                // Lock 5 PRPS
                await deployment.Hodl.hodl(1, ether("5"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice has 5 locked PRPS, but the fuel is 6 locked PRPS
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 2, ether("5"), 365, { lockedPrps: ether("6") }, ether("2").div(new BN(10))), "PRPS-5");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, { dubi: ether("11") }, ether("2").div(new BN(10))), "DUBI-5");
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, { unlockedPrps: ether("11") }, ether("2").div(new BN(10))), "H-16");
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("10"), 365, { intrinsicFuel: ether("11") }, ether("4").div(new BN(10))), "H-16");
                await expectRevert(expectBoostedHodlFuel(boostedAlice, 1, ether("10"), 365, { lockedPrps: ether("11") }, ether("4").div(new BN(10))), "H-16");
            });
        });

        describe("boostedRelease", () => {

            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("1000"));

                await expectBoostedHodlFuel(boostedAlice, 1, ether("10"), 365, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 2, ether("10"), 365, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 3, ether("10"), 365, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 4, ether("10"), 365, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 5, ether("10"), 365, {}, ether("4").div(new BN(10)));

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                // Release hodl 1 using 5 DUBI
                await expectBoostedReleaseFuel(boostedAlice, 1, ether("10"), { dubi: ether("5") });

                // Release hodl 2 using 5 unlocked PRPS
                await expectBoostedReleaseFuel(boostedAlice, 2, ether("10"), { unlockedPrps: ether("5") });

                // Release hodl 3 using 5 locked PRPS - here Hodl 3 is the last in the hodl list on the contract
                // (because of swap-and-pop deletion). This means the released PRPS is lower when using locked PRPS.
                await expectBoostedReleaseFuel(boostedAlice, 3, ether("10"), { lockedPrps: ether("5") }, true);

                // Release hodl 4 using 5 PRPS from the released amount
                await expectBoostedReleaseFuel(boostedAlice, 4, ether("10"), { intrinsicFuel: ether("5") });

                // Only 10 locked PRPS in total left since 4 out of 5 have been released.

                // Release hodl 5 using 10 fuel equal to released amount
                expectBigNumber(await deployment.Purpose.hodlBalanceOf(boostedAlice.address), ether("10"));

                await expectBoostedReleaseFuel(boostedAlice, 5, ether("10"), { intrinsicFuel: ether("10") });

                // Nothing left
                expectBigNumber(await deployment.Purpose.hodlBalanceOf(boostedAlice.address), ZERO);
                // Started with 1000 PRPS, but 5 + 5 + 5 + 10 PRPS were burned as fuel
                expectBigNumber(await deployment.Purpose.balanceOf(boostedAlice.address), ether("975"));
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await prps.mint(boostedAlice.address, ether("20"));

                // The booster might also waive the fuel
                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, {}, ether("2").div(new BN(10)));

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                await expectBoostedReleaseFuel(boostedAlice, 1, ether("5"), {});

            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("2"));
                await prps.mint(boostedAlice.address, ether("10"));

                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, {}, ether("2").div(new BN(10)));
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                // Alice only has 2 DUBI, but she needs 5
                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("10"), { dubi: ether("10") }), "DUBI-7");

                // Alice releases 5 PRPS, but the fuel is 6
                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("5"), { intrinsicFuel: ether("6") }), "H-4-3");

                // Alice still has 5 unlocked PRPS, but the fuel is 6
                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("5"), { unlockedPrps: ether("6") }), "PRPS-7");

                // Alice has 5 locked PRPS, but the fuel is 6
                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("5"), { lockedPrps: ether("6") }), "PRPS-5");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await prps.mint(boostedAlice.address, ether("100"));
                await dubi.mint(boostedAlice.address, ether("100"));

                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 365, {}, ether("2").div(new BN(10)));
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("10"), { dubi: ether("11") }), "DUBI-5");
                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("5"), { intrinsicFuel: ether("11") }), "H-16");
                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("5"), { unlockedPrps: ether("11") }), "H-16");
                await expectRevert(expectBoostedReleaseFuel(boostedAlice, 1, ether("5"), { lockedPrps: ether("11") }), "H-16");
            });
        });

        describe("boostedWithdrawal", () => {
            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("1000"));

                await expectBoostedHodlFuel(boostedAlice, 1, ether("10"), 0, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 2, ether("10"), 0, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 3, ether("10"), 0, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 4, ether("10"), 0, {}, ether("4").div(new BN(10)));
                await expectBoostedHodlFuel(boostedAlice, 5, ether("10"), 0, {}, ether("4").div(new BN(10)));

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                // Withdraw 0.4 DUBI from hodl1 and use (non-minted) DUBI
                await expectBoostedWithdrawalFuel(boostedAlice, 1, ether("4").div(new BN(10)), { dubi: ether("5") });

                // Withdraw 0.4 DUBI from hodl2 and use unlocked PRPS
                await expectBoostedWithdrawalFuel(boostedAlice, 2, ether("4").div(new BN(10)), { unlockedPrps: ether("5") });

                // Withdraw 0.4 DUBI from hodl3 and use locked PRPS
                await expectBoostedWithdrawalFuel(boostedAlice, 3, ether("4").div(new BN(10)), { lockedPrps: ether("5") }, true);

                // Withdraw 0.4 DUBI from hodl4 and use the minted DUBI (0.2 DUBI fuel)
                await expectBoostedWithdrawalFuel(boostedAlice, 4, ether("4").div(new BN(10)), { intrinsicFuel: ether("2").div(new BN(10)) });
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await prps.mint(boostedAlice.address, ether("20"));

                // The booster might also waive the fuel
                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 0, {}, ether("2").div(new BN(10)));

                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                await expectBoostedWithdrawalFuel(boostedAlice, 1, ether("4").div(new BN(10)), {});
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("2"));
                await prps.mint(boostedAlice.address, ether("10"));

                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 0, {}, ether("2").div(new BN(10)));
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                // Alice only has 2 DUBI, but she needs 5
                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("10"), { dubi: ether("10") }), "DUBI-7");

                // Alice releases 5 PRPS, but the fuel is 6
                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("5"), { intrinsicFuel: ether("6") }), "H-4-4");

                // Alice still has 5 unlocked PRPS, but the fuel is 6
                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("5"), { unlockedPrps: ether("6") }), "PRPS-7");

                // Alice has 5 locked PRPS, but the fuel is 6
                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("5"), { lockedPrps: ether("6") }), "PRPS-5");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await prps.mint(boostedAlice.address, ether("100"));
                await dubi.mint(boostedAlice.address, ether("100"));

                await expectBoostedHodlFuel(boostedAlice, 1, ether("5"), 0, {}, ether("2").div(new BN(10)));
                await time.increase(time.duration.seconds(SECONDS_PER_MONTH * 12));

                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("10"), { dubi: ether("11") }), "DUBI-5");
                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("5"), { intrinsicFuel: ether("11") }), "H-16");
                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("5"), { unlockedPrps: ether("11") }), "H-16");
                await expectRevert(expectBoostedWithdrawalFuel(boostedAlice, 1, ether("5"), { lockedPrps: ether("11") }), "H-16");
            });
        });

    });

});

const expectBoostedSendFuel = async (instance, signer, to: string, amount: BN, fuel, nonce) => {
    const balancesFromBefore = await getBalances(signer.address);
    const balancesToBefore = await getBalances(to);

    const { message, signature } = await createSignedBoostedSendMessage(deployment.web3, {
        amount,
        from: signer.address,
        to: bob,
        nonce: new BN(nonce),
        signer,
        verifyingContract: instance.address,
        fuel,
        booster: deployment.booster,
    });

    const receipt = await instance.boostedSend(message, signature, { from: deployment.booster });
    await expectEvent(receipt, "Transfer", {
        from: signer.address,
        to: to,
        // Fuel is not included in transfer event
        value: amount,
    });

    const balancesFromAfter = await getBalances(signer.address);
    const balancesToAfter = await getBalances(to);

    // To's balance increased by `amount`
    if (instance.address === dubi.address) {
        expectBigNumber(balancesToAfter.dubi, balancesToBefore.dubi.add(amount))
        expectBigNumber(balancesToAfter.unlockedPrps, balancesToBefore.unlockedPrps)
    } else if (instance.address === prps.address) {
        expectBigNumber(balancesToAfter.unlockedPrps, balancesToBefore.unlockedPrps.add(amount))
        expectBigNumber(balancesToAfter.dubi, balancesToBefore.dubi)
    }

    expectBigNumber(balancesToAfter.lockedPrps, balancesToBefore.lockedPrps)

    if (fuel.dubi) {

        if (instance.address === dubi.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(amount).sub(fuel.dubi));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps)
        } else if (instance.address === prps.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(fuel.dubi));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(amount));
        }

        // Unchanged
        expectBigNumber(balancesFromAfter.lockedPrps, balancesFromBefore.lockedPrps)
    }

    if (fuel.unlockedPrps) {

        if (instance.address === dubi.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(amount));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(fuel.unlockedPrps))
        } else if (instance.address === prps.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi);
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(amount).sub(fuel.unlockedPrps));
        }

        // Unchanged
        expectBigNumber(balancesFromAfter.lockedPrps, balancesFromBefore.lockedPrps)
    }

    if (fuel.lockedPrps) {

        if (instance.address === dubi.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(amount));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps)
        } else if (instance.address === prps.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi);
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(amount));
        }

        expectBigNumber(balancesFromAfter.lockedPrps, balancesFromBefore.lockedPrps.sub(fuel.lockedPrps));
    }
}

const expectBoostedBurnFuelERC20 = async (instance, signer, amount: BN, fuel, nonce, expectedAutoMintedDubi?) => {
    const balancesFromBefore = await getBalances(signer.address);

    // Send 5 DUBI to bob and use 5 DUBI as fuel
    const { message, signature } = await createSignedBoostedBurnMessage(deployment.web3, {
        amount,
        account: signer.address,
        nonce: new BN(nonce),
        signer,
        verifyingContract: instance.address,
        fuel,
        booster: deployment.booster,
    });

    const receipt = await instance.boostedBurn(message, signature, { from: deployment.booster });
    await expectEvent(receipt, "Transfer", {
        from: signer.address,
        to: ZERO_ADDRESS,
        // Fuel is not included in transfer event
        value: amount,
    });

    // The 'Burned' event emits a single packed uint256 for amount + type of fuel + fuel amount
    // Reconstruct the expected uint256 and compare it against the emitted one.
    let fuelType = FuelType.NONE;
    let fuelAmount = 0;
    if (fuel.dubi) {
        fuelType = FuelType.DUBI;
        fuelAmount = fuel.dubi;
    } else if (fuel.unlockedPrps) {
        fuelType = FuelType.UNLOCKED_PRPS;
        fuelAmount = fuel.unlockedPrps;
    } else if (fuel.lockedPrps) {
        fuelType = FuelType.LOCKED_PRPS;
        fuelAmount = fuel.lockedPrps;
    } else if (fuel.intrinsicFuel) {
        fuelType = FuelType.AUTO_MINTED_DUBI;
        fuelAmount = fuel.intrinsicFuel;
    }

    const amountAndFuel = new BN(0);
    // 96 bits amount
    amountAndFuel.ior(new BN(amount))
    // Followed by 3 bits fuel type
    amountAndFuel.ior(new BN(fuelType).shln(96))
    // Followed by 96 bits fuel amount
    amountAndFuel.ior(new BN(fuelAmount).shln(96 + 3));

    await expectEvent(receipt, "Burned", {
        amountAndFuel
    });

    let asserted;
    for (const log of receipt.logs) {
        if (log.event === "Burned") {
            const packed = log.args.amountAndFuel;
            const unpacked = unpackBurnAmount(packed);
            expectBigNumber(unpacked.amount, amount);
            expectBigNumber(unpacked.fuelAmount, new BN(fuelAmount));
            expect(unpacked.fuelType).to.eq(fuelType);
            asserted = true;
            break;
        }
    }

    expect(asserted).to.be.true;

    const balancesFromAfter = await getBalances(signer.address);

    if (fuel.dubi) {

        if (instance.address === dubi.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(amount).sub(fuel.dubi));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps)
        } else if (instance.address === prps.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(fuel.dubi).add(expectedAutoMintedDubi || ZERO));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(amount));
        }

        // Unchanged
        expectBigNumber(balancesFromAfter.lockedPrps, balancesFromBefore.lockedPrps)
    } else if (fuel.unlockedPrps) {

        if (instance.address === dubi.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(amount));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(fuel.unlockedPrps))
        } else if (instance.address === prps.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.add(expectedAutoMintedDubi || ZERO));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(amount).sub(fuel.unlockedPrps));
        }

        // Unchanged
        expectBigNumber(balancesFromAfter.lockedPrps, balancesFromBefore.lockedPrps)
    } else if (fuel.lockedPrps) {

        if (instance.address === dubi.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(amount));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps)
        } else if (instance.address === prps.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.add(expectedAutoMintedDubi || ZERO));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(amount));
        }

        expectBigNumber(balancesFromAfter.lockedPrps, balancesFromBefore.lockedPrps.sub(fuel.lockedPrps));
    } else if (fuel.intrinsicFuel) {

        if (instance.address === dubi.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.sub(amount));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps)
        } else if (instance.address === prps.address) {
            expectBigNumber(balancesFromAfter.dubi, balancesFromBefore.dubi.add(expectedAutoMintedDubi || ZERO).sub(fuel.intrinsicFuel));
            expectBigNumber(balancesFromAfter.unlockedPrps, balancesFromBefore.unlockedPrps.sub(amount));
        }

        expectBigNumber(balancesFromAfter.lockedPrps, balancesFromBefore.lockedPrps);
    }
}

const expectBoostedHodlFuel = async (signer, hodlId, amount: BN, duration, fuel, expectedMintedDubi) => {
    const balancesCreatorBefore = await getBalances(signer.address);
    const balancesHodlBefore = await getBalances(deployment.Hodl.address);

    const { message, signature } = await createSignedBoostedHodlMessage(deployment.web3, {
        amountPrps: amount,
        creator: signer.address,
        dubiBeneficiary: signer.address,
        prpsBeneficiary: signer.address,
        hodlId,
        duration,
        nonce: ZERO,
        signer,
        verifyingContract: deployment.Hodl.address,
        fuel,
        booster: deployment.booster,
    });

    const receipt = await deployment.Hodl.boostedHodl(message, signature, { from: deployment.booster });
    console.log(receipt.receipt.gasUsed);

    const balancesCreatorAfter = await getBalances(signer.address);
    const balancesHodlAfter = await getBalances(deployment.Hodl.address);

    expectBigNumber(balancesHodlAfter.dubi, balancesHodlBefore.dubi);
    expectBigNumber(balancesHodlAfter.lockedPrps, balancesHodlBefore.lockedPrps);
    expectBigNumber(balancesHodlAfter.unlockedPrps, balancesHodlBefore.unlockedPrps);

    if (fuel.dubi) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.add(expectedMintedDubi || ZERO).sub(fuel.dubi));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.sub(amount));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.add(amount));
    }

    if (fuel.unlockedPrps) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.add(expectedMintedDubi || ZERO));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.sub(amount.sub(fuel.unlockedPrps)));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.add(amount.sub(fuel.unlockedPrps)));
    }

    if (fuel.lockedPrps) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.add(expectedMintedDubi || ZERO));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.sub(amount));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.add(amount).sub(fuel.lockedPrps));
    }

    if (fuel.intrinsicFuel) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.add(expectedMintedDubi || ZERO).sub(fuel.intrinsicFuel));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.sub(amount));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.add(amount));
    }
}

const expectBoostedReleaseFuel = async (signer, hodlId, expectedReleaseAmount, fuel, willBeBurnedFromSameLock?) => {
    const balancesCreatorBefore = await getBalances(signer.address);
    const balancesHodlBefore = await getBalances(deployment.Hodl.address);

    const { message, signature } = await createSignedBoostedReleaseMessage(deployment.web3, {
        id: hodlId,
        creator: signer.address,
        prpsBeneficiary: signer.address,
        nonce: ZERO,
        signer,
        verifyingContract: deployment.Hodl.address,
        fuel,
        booster: deployment.booster,
    });

    const receipt = await deployment.Hodl.boostedRelease(message, signature, { from: deployment.booster });
    console.log(receipt.receipt.gasUsed);

    const balancesCreatorAfter = await getBalances(signer.address);
    const balancesHodlAfter = await getBalances(deployment.Hodl.address);

    expectBigNumber(balancesHodlAfter.dubi, balancesHodlBefore.dubi);
    expectBigNumber(balancesHodlAfter.lockedPrps, balancesHodlBefore.lockedPrps);
    expectBigNumber(balancesHodlAfter.unlockedPrps, balancesHodlBefore.unlockedPrps);

    if (fuel.dubi) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.sub(fuel.dubi));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.add(expectedReleaseAmount));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.sub(expectedReleaseAmount));
    }

    if (fuel.unlockedPrps) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi);
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.add(expectedReleaseAmount.sub(fuel.unlockedPrps)));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.sub(expectedReleaseAmount));
    }

    if (fuel.lockedPrps) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi);

        if (willBeBurnedFromSameLock) {
            // If the fuel used is locked PRPS and the hodl item that got released happened to be the last in the hodl list on the contract
            // then the locked PRPS got burned from it, which means the unlocked PRPS is releaseAmount - fuel.
            expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.add(expectedReleaseAmount).sub(fuel.lockedPrps));
            expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.sub(expectedReleaseAmount));
        } else {
            expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.add(expectedReleaseAmount));
            expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.sub(expectedReleaseAmount).sub(fuel.lockedPrps));
        }
    }

    if (fuel.intrinsicFuel) {
        expectBigNumber(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi);
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.add(expectedReleaseAmount.sub(fuel.intrinsicFuel)));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.sub(expectedReleaseAmount));
    }
}

const expectBoostedWithdrawalFuel = async (signer, hodlId, expectedWithdrawAmount, fuel, willBeBurnedFromSameLock?) => {
    const balancesCreatorBefore = await getBalances(signer.address);
    const balancesHodlBefore = await getBalances(deployment.Hodl.address);

    const { message, signature } = await createSignedBoostedWithdrawalMessage(deployment.web3, {
        id: hodlId,
        creator: signer.address,
        prpsBeneficiary: signer.address,
        nonce: ZERO,
        signer,
        verifyingContract: deployment.Hodl.address,
        fuel,
        booster: deployment.booster,
    });

    const receipt = await deployment.Hodl.boostedWithdraw(message, signature, { from: deployment.booster });
    console.log(receipt.receipt.gasUsed);

    const balancesCreatorAfter = await getBalances(signer.address);
    const balancesHodlAfter = await getBalances(deployment.Hodl.address);

    expectBigNumber(balancesHodlAfter.dubi, balancesHodlBefore.dubi);
    expectBigNumber(balancesHodlAfter.lockedPrps, balancesHodlBefore.lockedPrps);
    expectBigNumber(balancesHodlAfter.unlockedPrps, balancesHodlBefore.unlockedPrps);

    if (fuel.dubi) {
        expectBigNumberApprox(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.sub(fuel.dubi).add(expectedWithdrawAmount));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps);
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps);
    }

    if (fuel.unlockedPrps) {
        expectBigNumberApprox(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.add(expectedWithdrawAmount));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps.sub(fuel.unlockedPrps));
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps);
    }

    if (fuel.lockedPrps) {
        expectBigNumberApprox(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.add(expectedWithdrawAmount));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps);
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps.sub(fuel.lockedPrps));
    }

    if (fuel.intrinsicFuel) {
        expectBigNumberApprox(balancesCreatorAfter.dubi, balancesCreatorBefore.dubi.add(expectedWithdrawAmount.sub(fuel.intrinsicFuel)));
        expectBigNumber(balancesCreatorAfter.unlockedPrps, balancesCreatorBefore.unlockedPrps);
        expectBigNumber(balancesCreatorAfter.lockedPrps, balancesCreatorBefore.lockedPrps);
    }
}
