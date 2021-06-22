import { PurposeInstance, DubiInstance, HodlInstance, OptInInstance } from "../types/contracts";
import Web3 from "web3";
export declare const SECONDS_PER_MONTH = 2628000;
export declare const ZERO: any;
export interface PurposeLibraries {
    ProtectedBoostableLib: string;
    HodlLib: string;
}
export interface PurposeDeployment {
    web3: Web3;
    booster: string;
    boostedAddresses: {
        address: string;
        privateKey: string;
    }[];
    owner: string;
    OptIn: OptInInstance;
    Purpose: PurposeInstance;
    Dubi: DubiInstance;
    Hodl: HodlInstance;
    Libraries: PurposeLibraries;
}
export interface EIP712SignedMessage {
    message: any;
    signature: {
        r: string;
        s: string;
        v: number;
    };
    messageHash: string;
    messageBytes: string;
}
export interface MessageTypeProperty {
    name: string;
    type: string;
}
export interface MessageTypes {
    EIP712Domain: MessageTypeProperty[];
    [additionalProperties: string]: MessageTypeProperty[];
}
export declare enum BoostTag {
    Send = 0,
    Burn = 1,
    Hodl = 2,
    Release = 3,
    Withdrawal = 4
}
export declare const EIP712Domain: {
    name: string;
    type: string;
}[];
export declare const BoosterPayload: {
    name: string;
    type: string;
}[];
export declare const BoosterFuel: {
    name: string;
    type: string;
}[];
export declare const BoostedSend: {
    name: string;
    type: string;
}[];
export declare const BoostedBurn: {
    name: string;
    type: string;
}[];
export declare const BoostedHodl: {
    name: string;
    type: string;
}[];
export declare const BoostedRelease: {
    name: string;
    type: string;
}[];
export declare const BoostedWithdrawal: {
    name: string;
    type: string;
}[];
export declare enum FuelType {
    NONE = 0,
    UNLOCKED_PRPS = 1,
    LOCKED_PRPS = 2,
    DUBI = 3,
    AUTO_MINTED_DUBI = 4
}
