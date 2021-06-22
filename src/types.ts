import { PurposeInstance, DubiInstance, HodlInstance, OptInInstance } from "../types/contracts";
import Web3 from "web3";
import BN from "bn.js";

export const SECONDS_PER_MONTH = 2_628_000;
export const ZERO: any = new BN(0);

export interface PurposeLibraries {
    ProtectedBoostableLib: string;
    HodlLib: string;
}

export interface PurposeDeployment {
    web3: Web3,
    booster: string;
    boostedAddresses: { address: string, privateKey: string }[],
    owner: string,
    OptIn: OptInInstance,
    Purpose: PurposeInstance,
    Dubi: DubiInstance,
    Hodl: HodlInstance,
    Libraries: PurposeLibraries,
}

// EIP712

export interface EIP712SignedMessage {
    message: any,
    signature: { r: string, s: string, v: number },
    messageHash: string,
    messageBytes: string,
}

export interface MessageTypeProperty {
    name: string;
    type: string;
}

export interface MessageTypes {
    EIP712Domain: MessageTypeProperty[];
    [additionalProperties: string]: MessageTypeProperty[];
}

export enum BoostTag {
    Send,
    Burn,
    Hodl,
    Release,
    Withdrawal,
}

export const EIP712Domain = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
]


export const BoosterPayload = [
    { name: "booster", type: "address" },
    { name: "timestamp", type: "uint64" },
    { name: "nonce", type: "uint64" },
    { name: "isLegacySignature", type: "bool" },
]

export const BoosterFuel = [
    { name: "dubi", type: "uint96" },
    { name: "unlockedPrps", type: "uint96" },
    { name: "lockedPrps", type: "uint96" },
    { name: "intrinsicFuel", type: "uint96" },
]

export const BoostedSend = [
    { name: "tag", type: "uint8" },
    { name: "sender", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" }
]

export const BoostedBurn = [
    { name: "tag", type: "uint8" },
    { name: "account", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" },
]

export const BoostedHodl = [
    { name: "tag", type: "uint8" },
    { name: "hodlId", type: "uint24" },
    { name: "amountPrps", type: "uint96" },
    { name: "duration", type: "uint16" },
    { name: "dubiBeneficiary", type: "address" },
    { name: "prpsBeneficiary", type: "address" },
    { name: "creator", type: "address" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" }
]

export const BoostedRelease = [
    { name: "tag", type: "uint8" },
    { name: "id", type: "uint24" },
    { name: "creator", type: "address" },
    { name: "prpsBeneficiary", type: "address" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" }
]

export const BoostedWithdrawal = [
    { name: "tag", type: "uint8" },
    { name: "id", type: "uint24" },
    { name: "creator", type: "address" },
    { name: "prpsBeneficiary", type: "address" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" }
]

export enum FuelType { NONE, UNLOCKED_PRPS, LOCKED_PRPS, DUBI, AUTO_MINTED_DUBI }
