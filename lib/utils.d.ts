import BN from "bn.js";
import { TypedMessage } from "eth-sig-util";
import { EIP712SignedMessage, MessageTypes, FuelType } from "./types";
export declare const packMint: (totalSupply: any, amount: any) => any;
export declare const unpackBurnAmount: (packedAmount: any) => {
    amount: any;
    fuelType: FuelType;
    fuelAmount: any;
};
export declare const createEIP712Domain: (name: string, verifyingContract: string, chainId?: string | undefined) => {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
};
export declare const getTypedMessageBytes: <T extends MessageTypes>(web3: any, data: TypedMessage<T>) => string;
export declare const getEIP712MessageHash: <T extends MessageTypes>(data: TypedMessage<T>) => string;
export declare const signEIP712: <T extends MessageTypes>(data: TypedMessage<T>, { privateKey }: {
    privateKey: string;
}) => {
    r: string;
    s: string;
    v: number;
};
export declare const toSignatureTriple: (signature: string) => {
    r: string;
    s: string;
    v: number;
};
export declare const blockchainTimestampWithOffset: (web3: any, offset: any) => Promise<any>;
export declare const createSignedBoostedSendMessage: (web3: any, { from, to, amount, data, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: {
    from: string;
    to: string;
    amount: BN;
    data?: string | undefined;
    nonce: BN;
    isLegacySignature?: boolean | undefined;
    timestamp?: number | undefined;
    fuel?: {
        dubi?: BN | undefined;
        unlockedPrps?: BN | undefined;
        lockedPrps?: BN | undefined;
        intrinsicFuel?: BN | undefined;
    } | undefined;
    booster: string;
    verifyingContract: string;
    signer: {
        privateKey: string;
    };
}) => Promise<EIP712SignedMessage>;
export declare const createSignedBoostedBurnMessage: (web3: any, { account, amount, data, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: {
    account: string;
    amount: BN;
    isLegacySignature?: boolean | undefined;
    data?: string | undefined;
    nonce: BN;
    timestamp?: number | undefined;
    fuel?: {
        dubi?: BN | undefined;
        unlockedPrps?: BN | undefined;
        lockedPrps?: BN | undefined;
        intrinsicFuel?: BN | undefined;
    } | undefined;
    booster: string;
    verifyingContract: string;
    signer: {
        privateKey: string;
    };
}) => Promise<EIP712SignedMessage>;
export declare const createSignedBoostedHodlMessage: (web3: any, { hodlId, creator, amountPrps, duration, dubiBeneficiary, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: {
    hodlId: number;
    creator: string;
    amountPrps: BN;
    duration: number;
    dubiBeneficiary: string;
    prpsBeneficiary: string;
    isLegacySignature?: boolean | undefined;
    nonce: BN;
    timestamp?: number | undefined;
    fuel?: {
        dubi?: BN | undefined;
        unlockedPrps?: BN | undefined;
        lockedPrps?: BN | undefined;
        intrinsicFuel?: BN | undefined;
    } | undefined;
    booster: string;
    verifyingContract: string;
    signer: {
        privateKey: string;
    };
}) => Promise<EIP712SignedMessage>;
export declare const createSignedBoostedReleaseMessage: (web3: any, { creator, id, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: {
    creator: string;
    id: BN;
    prpsBeneficiary: string;
    nonce: BN;
    timestamp?: number | undefined;
    isLegacySignature?: boolean | undefined;
    fuel?: {
        dubi?: BN | undefined;
        unlockedPrps?: BN | undefined;
        lockedPrps?: BN | undefined;
        intrinsicFuel?: BN | undefined;
    } | undefined;
    booster: string;
    verifyingContract: string;
    signer: {
        privateKey: string;
    };
}) => Promise<EIP712SignedMessage>;
export declare const createSignedBoostedWithdrawalMessage: (web3: any, { creator, id, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: {
    creator: string;
    id: BN;
    prpsBeneficiary: string;
    nonce: BN;
    timestamp?: number | undefined;
    isLegacySignature?: boolean | undefined;
    fuel?: {
        dubi?: BN | undefined;
        unlockedPrps?: BN | undefined;
        lockedPrps?: BN | undefined;
        intrinsicFuel?: BN | undefined;
    } | undefined;
    booster: string;
    verifyingContract: string;
    signer: {
        privateKey: string;
    };
}) => Promise<EIP712SignedMessage>;
export declare const fixSignature: (signature: string) => string;
