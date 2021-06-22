import { accounts, contract, defaultSender } from "@openzeppelin/test-environment";
import { BN, expectRevert, constants } from "@openzeppelin/test-helpers";
import { DubiInstance, OptInInstance } from "../types/contracts"
import { expect } from "chai";
import { expectBigNumber, deployTestnet } from "./support";
import { PurposeDeployment, ZERO } from "../src/types";

const [alice, bob, carl] = accounts;

const Dubi = contract.fromArtifact("Dubi");
Dubi.detectNetwork()

let deployment: PurposeDeployment;
let dubi: DubiInstance;
let optIn: OptInInstance;
let amount = new BN(1_000_000);

beforeEach(async () => {
    deployment = await deployTestnet();
    dubi = deployment.Dubi;
    optIn = deployment.OptIn;
});

describe("Dubi", () => {
    it("should create DUBI", async () => {
        expect(await dubi.symbol()).to.equal("DUBI");
        expect(await dubi.name()).to.equal("Decentralized Universal Basic Income");
        expectBigNumber(await dubi.totalSupply(), ZERO);
    });

    it("should instantiate DUBI with an owner", async () => {
        expect(await dubi.owner()).to.equal(defaultSender);
    });

    it("should mint DUBI when owner", async () => {
        expectBigNumber(await dubi.balanceOf(alice), new BN(0));

        await dubi.mint(alice, amount);

        expectBigNumber(await dubi.balanceOf(alice), amount);
    });

    it("should not mint DUBI when not owner", async () => {
        await expectRevert(dubi.mint(alice, amount, {
            from: alice,
        }), "Ownable: caller is not the owner");
    });

    it("should mint DUBI when called by PRPS or HODL", async () => {
        const bobAsPrps = bob;
        const carlAsHodl = carl;

        await Dubi.detectNetwork();
        await Dubi.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
        const dubi2 = await Dubi.new(ZERO, deployment.OptIn.address,
            bob,
            carl,
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS,
        );

        expectBigNumber(await dubi2.balanceOf(alice), new BN(0));

        await dubi2.hodlMint(alice, new BN("1"), {
            from: carlAsHodl,
        });

        await dubi2.purposeMint(alice, new BN("1"), {
            from: bobAsPrps,
        });

        expectBigNumber(await dubi2.balanceOf(alice), new BN(2));
    });


    it("should not mint DUBI when not called by PRPS or HODL", async () => {
        await expectRevert(dubi.hodlMint(alice, new BN("1"), {
            from: carl,
        }), "DUBI-2");

        await expectRevert(dubi.purposeMint(alice, new BN("1"), {
            from: carl,
        }), "DUBI-3");

        await expectRevert(dubi.hodlMint(alice, new BN("1"), {
            from: deployment.owner,
        }), "DUBI-2");

        await expectRevert(dubi.purposeMint(alice, new BN("1"), {
            from: deployment.owner,
        }), "DUBI-3");
    });

    it("should set initial supply", async () => {
        expectBigNumber(await dubi.balanceOf(alice), new BN(0));

        await Dubi.detectNetwork();
        await Dubi.link("ProtectedBoostableLib", deployment.Libraries.ProtectedBoostableLib);
        const dubi2: DubiInstance = await Dubi.new(new BN(14), deployment.OptIn.address, deployment.Hodl.address, deployment.Purpose.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);

        expectBigNumber(await dubi2.totalSupply(), new BN(14));
    });

    it("should burn DUBI of sender", async () => {
        await dubi.mint(alice, amount);
        await dubi.burn(amount, "0x", { from: alice });

        expectBigNumber(await dubi.balanceOf(alice), new BN(0));

        // Cannot burn when balance 0
        await expectRevert(dubi.burn(new BN(1), "0x", { from: alice }), "ERC20-9");
    });
});
