import { contract, web3 } from "@openzeppelin/test-environment";
import { BN, singletons, ether } from "@openzeppelin/test-helpers";
import { PurposeDeployment, ZERO } from "../src/types";
import { OptInInstance, PurposeInstance, DubiInstance, HodlInstance } from "../types/contracts";
import { encode } from "rlp";
import { expect } from "chai";
import { createSignedBoostedWithdrawalMessage, createSignedBoostedReleaseMessage, createSignedBoostedHodlMessage, createSignedBoostedSendMessage, createSignedBoostedBurnMessage } from "../src/utils";

export const deployTestnet = async (): Promise<PurposeDeployment> => {
    try {
        const admin: any = (await web3.eth.getAccounts())[0];

        await singletons.ERC1820Registry(admin);

        const OptIn = contract.fromArtifact("OptIn");
        const Purpose = contract.fromArtifact("Purpose");
        const Dubi = contract.fromArtifact("Dubi");
        const Hodl = contract.fromArtifact("Hodl");

        // Necessary to make the linking work
        await Purpose.detectNetwork()
        await Dubi.detectNetwork()
        await Hodl.detectNetwork()

        // Link libraries
        const ProtectedBoostableLib = contract.fromArtifact("ProtectedBoostableLib");
        const protectedBoostableLib = await ProtectedBoostableLib.new();
        Purpose.link("ProtectedBoostableLib", protectedBoostableLib.address);
        Dubi.link("ProtectedBoostableLib", protectedBoostableLib.address);
        Hodl.link("ProtectedBoostableLib", protectedBoostableLib.address);

        const HodlLib = contract.fromArtifact("HodlLib");
        const hodlLib = await HodlLib.new();
        Hodl.link("HodlLib", hodlLib.address);

        // Calculate contract addresses
        const contractAddresses = await calculateContractAddresses(admin);

        // Pick 10th account for default booster
        const booster = (await web3.eth.getAccounts())[9];
        const optIn: OptInInstance = await OptIn.new(booster);

        const prps: PurposeInstance = await Purpose.new(ether("1000000"),
            contractAddresses.optIn,
            contractAddresses.dubi,
            contractAddresses.hodl,
            contractAddresses.externalAddress1,
            contractAddresses.externalAddress2,
            contractAddresses.externalAddress3,
        );

        const dubi: DubiInstance = await Dubi.new(ether("0"),
            contractAddresses.optIn,
            contractAddresses.purpose,
            contractAddresses.hodl,
            contractAddresses.externalAddress1,
            contractAddresses.externalAddress2,
            contractAddresses.externalAddress3,
        );

        const hodl: HodlInstance = await Hodl.new(
            contractAddresses.optIn,
            contractAddresses.purpose,
            contractAddresses.dubi,
            contractAddresses.externalAddress1,
            contractAddresses.externalAddress2,
        );

        // Assert that the addresses got deployed to the pre-calculated ones
        assertDeployAddresses([
            { name: "OPTIN", instance: optIn, target: contractAddresses.optIn },
            { name: "PRPS", instance: prps, target: contractAddresses.purpose },
            { name: "DUBI", instance: dubi, target: contractAddresses.dubi },
            { name: "HODL", instance: hodl, target: contractAddresses.hodl },
        ]);

        return {
            web3: web3,
            booster,
            boostedAddresses: await createBoostedAddresses(admin),
            owner: admin,
            OptIn: optIn,
            Purpose: prps,
            Dubi: dubi,
            Hodl: hodl,
            Libraries: {
                HodlLib: hodlLib.address,
                ProtectedBoostableLib: protectedBoostableLib.address,
            },
        };
    } catch (ex) {
        console.log(ex.stack);
        throw ex;
    }
}

const calculateContractAddresses = async (deployAddress: string): Promise<Record<string, any>> => {
    const nonce = await web3.eth.getTransactionCount(deployAddress, 'pending');

    return {
        optIn: calculateContractAddress(deployAddress, nonce),
        purpose: calculateContractAddress(deployAddress, nonce + 1),
        dubi: calculateContractAddress(deployAddress, nonce + 2),
        hodl: calculateContractAddress(deployAddress, nonce + 3),
        externalAddress1: calculateContractAddress(deployAddress, nonce + 4),
        externalAddress2: calculateContractAddress(deployAddress, nonce + 5),
        externalAddress3: calculateContractAddress(deployAddress, nonce + 6),
    };
}

const createBoostedAddresses = async (owner: string): Promise<{ address: string, privateKey: string }[]> => {
    // To sign EIP712 messages we need access to the private key.
    // But there's no obvious way to obtain it from the non-deterministically
    // generated accounts that ganache seeds on start.
    // So create 5 dedicated accounts for use with booster.
    const boostedAddresses: { address: string, privateKey: string }[] = [];
    for (let i = 0; i < 5; i++) {
        const password = i.toString();
        const privateKey = web3.utils.sha3(password);

        const boostedAddress = web3.utils.toChecksumAddress(await web3.eth.personal.importRawKey(privateKey, password));
        expect(await web3.eth.personal.unlockAccount(boostedAddress, password, 9999999)).to.be.true;

        // Send some ETH
        await web3.eth.sendTransaction({ value: ether("100"), from: owner, to: boostedAddress });

        boostedAddresses.push({
            address: boostedAddress,
            privateKey: privateKey.slice(2), // remove `0x` prefix
        });
    }

    return boostedAddresses;
}

const calculateContractAddress = (sender: string, nonce: number): string => {
    const encoded = encode([sender, nonce]) as any;
    const nonceHash = web3.utils.sha3(encoded);

    return web3.utils.toChecksumAddress(`0x${nonceHash.substring(26)}`);
}


const assertDeployAddresses = (deploys: { name: string, instance: { address: string }, target: string }[]) => {
    for (const { instance: expected, target: actual, name } of deploys) {
        if (expected.address !== actual) {
            throw new Error(`${name}: ${expected.address} !== ${actual}`)
        }
    }
}

export const expectZeroBalance = (actual: any): void => {
    ((expect(actual).to.be) as any).bignumber.equal(ZERO);
}

export const expectBigNumber = (actual: any, expected: any): void => {
    ((expect(actual).to.be) as any).bignumber.equal(expected);
}

export const expectBigNumberApprox = (actual: any, expected: any, epsilon?): void => {
    epsilon = epsilon ?? ether("1").div(new BN(1_000_000));

    // This is for comparing small differences due to e.g. minted DUBI that just amounts
    // to some dust. (i.e. <= 0.00001 DUBI)
    const diff = actual.sub(expected).abs();
    const isLessThanEqual = diff.lte(epsilon);
    if (!isLessThanEqual) {
        console.log(`${actual} ${expected} ${diff}`);
    }

    expect(isLessThanEqual).to.be.true;
}

export const mockBoosterSignaturesAndMessages = async (deployment: PurposeDeployment, amount, bob) => {
    const boostedAlice = deployment.boostedAddresses[0];


    return Promise.all([
        createSignedBoostedSendMessage(deployment.web3, {
            to: bob,
            from: boostedAlice.address,
            amount,
            nonce: new BN(1),
            signer: boostedAlice,
            verifyingContract: deployment.Purpose.address, // <- must be well-known contract
            booster: deployment.booster,
            fuel: {},
        }),
        createSignedBoostedBurnMessage(deployment.web3, {
            account: boostedAlice.address,
            amount,
            nonce: new BN(1),
            signer: boostedAlice,
            verifyingContract: deployment.Purpose.address, // <- must be well-known contract
            booster: deployment.booster,
            fuel: {},
        }),
        createSignedBoostedHodlMessage(deployment.web3, {
            hodlId: 1,
            creator: boostedAlice.address,
            amountPrps: amount,
            duration: 0,
            dubiBeneficiary: boostedAlice.address,
            prpsBeneficiary: boostedAlice.address,
            nonce: new BN(1),
            signer: boostedAlice,
            verifyingContract: deployment.Hodl.address, // <- must be well-known contract
            booster: deployment.booster,
            fuel: {},
        }),
        createSignedBoostedReleaseMessage(deployment.web3, {
            creator: boostedAlice.address,
            prpsBeneficiary: boostedAlice.address,
            id: new BN(1),
            nonce: new BN(2),
            signer: boostedAlice,
            verifyingContract: deployment.Hodl.address, // <- must be well-known contract
            booster: deployment.booster,
            fuel: {},
        }),
        createSignedBoostedWithdrawalMessage(deployment.web3, {
            creator: boostedAlice.address,
            prpsBeneficiary: boostedAlice.address,
            id: new BN(1),
            nonce: new BN(2),
            signer: boostedAlice,
            verifyingContract: deployment.Hodl.address, // <- must be well-known contract
            booster: deployment.booster,
            fuel: {},
        })
    ]);
}

export const HODL_MAX_DURATION = 365;
// 91.25 days rounded up to 92 days for ~1%
export const HODL_1_MONTH = 365 / 12;

export const hodlDurationMonthsToDays = (n: number) => {
    return Math.floor(HODL_1_MONTH * n);
}

export const getHodl = async (hodl: HodlInstance, creator: string, prpsBeneficiary, id: any): Promise<HodlItem> => {
    const _hodl = await hodl.getHodl(id, prpsBeneficiary, creator);
    return {
        id: _hodl.id as any,
        duration: _hodl.duration as any,
        lockedSince: _hodl.lastWithdrawal as any,
        lastWithdrawal: _hodl.lastWithdrawal as any,
        creator: _hodl.creator as any,
        dubiBeneficiary: _hodl.dubiBeneficiary as any,
        prpsBeneficiary: prpsBeneficiary,
        lockedPrps: _hodl.lockedPrps as any,
        burnedLockedPrps: _hodl.burnedLockedPrps as any,
        pendingLockedPrps: _hodl.pendingLockedPrps as any,
        hasDifferentCreator: _hodl.flags.hasDifferentCreator,
        hasDifferentDubiBeneficiary: _hodl.flags.hasDifferentDubiBeneficiary,
        hasDependentHodlOp: _hodl.flags.hasDependentHodlOp,
        hasPendingLockedPrps: _hodl.flags.hasPendingLockedPrps,
    }
}

export const expectHodl = async (prps: PurposeInstance, hodl: HodlInstance, hodlId: number, amount: any, duration: any, dubiBeneficiary: string, prpsBeneficiary: string, details: Truffle.TransactionDetails): Promise<HodlItem> => {
    const prpsBefore = await prps.balanceOf(details.from!)
    const receipt = await hodl.hodl(hodlId, amount, duration, dubiBeneficiary, prpsBeneficiary, details);
    const prpsAfter = await prps.balanceOf(details.from!)

    expectBigNumber(prpsAfter, (prpsBefore as any).sub(amount));

    // console.log("HODL: " + receipt.receipt.gasUsed);

    const _hodl = await getHodl(hodl, details.from!, prpsBeneficiary, hodlId);
    expect(_hodl.hasDifferentCreator).to.eq(prpsBeneficiary !== details.from!);
    expect(_hodl.hasDifferentDubiBeneficiary).to.eq(dubiBeneficiary !== prpsBeneficiary);
    expect(_hodl.hasDependentHodlOp).to.be.false;
    expect(_hodl.hasPendingLockedPrps).to.be.false;
    expectBigNumber(_hodl.duration, new BN(duration));
    expectBigNumber(_hodl.lockedPrps, amount);
    expect(_hodl.creator).to.eq(details.from);
    expect(_hodl.prpsBeneficiary).to.eq(prpsBeneficiary);
    expect(_hodl.dubiBeneficiary).to.eq(dubiBeneficiary);

    return _hodl;
}


export interface HodlItem {
    id: BN;
    duration: BN;
    lockedSince: BN;
    lastWithdrawal: BN;
    creator: string;
    dubiBeneficiary: string;
    prpsBeneficiary: string;
    lockedPrps: BN;
    burnedLockedPrps: BN;
    pendingLockedPrps: BN;
    hasDifferentCreator: boolean;
    hasDependentHodlOp: boolean;
    hasDifferentDubiBeneficiary: boolean;
    hasPendingLockedPrps: boolean;
}
