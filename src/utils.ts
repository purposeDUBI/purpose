import BN from "bn.js";
import { TypedMessage, signTypedData_v4, TypedDataUtils } from "eth-sig-util";
import { BoosterPayload, BoosterFuel, EIP712SignedMessage, BoostedSend, BoostedHodl, BoostedRelease, BoostTag, BoostedBurn, BoostedWithdrawal, EIP712Domain, MessageTypes, FuelType } from "./types";

export const packMint = (totalSupply: any, amount: any): any => {
    const upperHalf = totalSupply;
    const lowerHalf = amount;
    const packed = upperHalf.shln(96).or(lowerHalf);

    console.log("Total Supply: " + upperHalf.toString());
    console.log("Actual amount to mint: " + lowerHalf.toString());
    console.log("Packed: " + packed.toString());

    return packed;
}

export const unpackBurnAmount = (packedAmount): { amount: any, fuelType: FuelType, fuelAmount: any } => {
    return {
        amount: packedAmount.and(new BN(2).pow(new BN(96)).sub(new BN(1))),
        fuelType: (packedAmount.shrn(96).and(new BN(7))).toNumber() as FuelType,
        fuelAmount: packedAmount.shrn(99).and(new BN(2).pow(new BN(96)).sub(new BN(1)))
    }
}

export const createEIP712Domain = (name: string, verifyingContract: string, chainId?: string) => ({
    name,
    version: chainId || "1",
    // Because of a bug in ganache, the solidity opcode `chainid` always
    // returns '1' (i.e. mainnet). So we sign everything for chainId 1 even though
    // in unit tests `web3.eth.getChainId()` actually returns something different.
    // https://github.com/trufflesuite/ganache/issues/1643    
    chainId: 1,
    verifyingContract,
})

const flattenTypesAndValues = (types, typeData, data): { collectedTypes: string[], collectedValues: any[] } => {
    const collectedTypes: string[] = [];
    const collectedValues: any[] = [];

    const mapField = (name, type, value) => {
        // Nested type 
        if (types[type] !== undefined) {
            const result = flattenTypesAndValues(types, types[type], data[name])
            return [result.collectedTypes, result.collectedValues];
        }

        if (value === undefined) {
            throw new Error(`missing value for field of type ${type}`);
        }

        return [[type], [value]];
    };

    for (const field of typeData) {
        const [_types, _values] = mapField(field.name, field.type, data[field.name]);
        collectedTypes.push(..._types);
        collectedValues.push(..._values);
    }

    return {
        collectedTypes,
        collectedValues,
    }
}

export const getTypedMessageBytes = <T extends MessageTypes>(web3, data: TypedMessage<T>): string => {
    const { collectedTypes, collectedValues } = flattenTypesAndValues(data.types, data.types[data.primaryType], data.message)

    let encodedParameters = web3.eth.abi.encodeParameters(collectedTypes, collectedValues);

    // NOTE: Some boosted messages contain a "bytes" type e.g. BoostedSend/Burn
    // Such dynamic types are encoded a bit differently and encodeParameters produces an invalid
    // encoding for some reason

    // This is just a heuristic approach and only supports a single dynamic "bytes" type per message - 
    // which is fine for the foreseeable future for our purposes
    const dynamicBytesTypeIndex = collectedTypes.indexOf("bytes");
    if (dynamicBytesTypeIndex !== -1) {
        // If we have a dynamic type then we must prepend a word that points to the first parameter.
        // Here it's always 0x20 i.e. the first word after the prefix.
        // This matches with what `abi.encode(boostedStruct)` produces when called in a smart contract.
        const prefix = "20".padStart(64, "0");
        const paramsWithout0x = encodedParameters.slice(2);
        encodedParameters = `0x${prefix}${paramsWithout0x}`;
        // Without it the corresponding abi.decode reverts
    }

    return encodedParameters;
}

export const getEIP712MessageHash = <T extends MessageTypes>(data: TypedMessage<T>): string => {
    return TypedDataUtils.sign(data).toString("hex");
}

export const signEIP712 = <T extends MessageTypes>(data: TypedMessage<T>, { privateKey }: { privateKey: string }): { r: string, s: string, v: number } => {
    const signature = signTypedData_v4(Buffer.from(privateKey, "hex"), { data });
    return toSignatureTriple(signature);
}

export const toSignatureTriple = (signature: string): { r: string, s: string, v: number } => {
    // 32 bytes (64 hex)
    const r = "0x" + signature.slice(2, 66);
    // 32 bytes (64 hex)
    const s = "0x" + signature.slice(66, 130);
    // 1 byte (2 hex)
    const v = parseInt(signature.slice(130, 132), 16);
    // = 65 bytes (130 hex)

    return { r, s, v };
}

export const blockchainTimestampWithOffset = async (web3, offset) => (await web3.eth.getBlock("latest")).timestamp as number + offset;

export const createSignedBoostedSendMessage = async (web3, { from, to, amount, data, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: { from: string; to: string; amount: BN; data?: string; nonce: BN; isLegacySignature?: boolean; timestamp?: number, fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string; verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            BoostedSend,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedSend",
        message: {
            tag: BoostTag.Send,
            sender: from,
            recipient: to,
            amount: amount.toString(),
            data: data ?? "0x",
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.lockedPrps ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}

export const createSignedBoostedBurnMessage = async (web3, { account, amount, data, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: { account: string; amount: BN; isLegacySignature?: boolean; data?: string; nonce: BN; timestamp?: number, fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string, verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            BoostedBurn,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedBurn",
        message: {
            tag: BoostTag.Burn,
            account,
            amount: amount.toString(),
            data: data ?? "0x",
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.intrinsicFuel ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            },
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}

export const createSignedBoostedHodlMessage = async (web3, { hodlId, creator, amountPrps, duration, dubiBeneficiary, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: { hodlId: number, creator: string, amountPrps: BN, duration: number; dubiBeneficiary: string, prpsBeneficiary: string, isLegacySignature?: boolean; nonce: BN; timestamp?: number, fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string; verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            BoostedHodl,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedHodl",
        message: {
            tag: BoostTag.Hodl,
            hodlId,
            amountPrps: amountPrps.toString(),
            duration: duration,
            dubiBeneficiary,
            prpsBeneficiary,
            creator,
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.intrinsicFuel ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}


export const createSignedBoostedReleaseMessage = async (web3, { creator, id, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: { creator: string, id: BN, prpsBeneficiary: string; nonce: BN; timestamp?: number, isLegacySignature?: boolean; fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string; verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            BoostedRelease,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedRelease",
        message: {
            tag: BoostTag.Release,
            creator,
            prpsBeneficiary,
            id: id.toString(),
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.intrinsicFuel ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}

export const createSignedBoostedWithdrawalMessage = async (web3, { creator, id, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: { creator: string, id: BN, prpsBeneficiary: string; nonce: BN; timestamp?: number, isLegacySignature?: boolean; fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string; verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            BoostedWithdrawal,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedWithdrawal",
        message: {
            tag: BoostTag.Withdrawal,
            creator,
            prpsBeneficiary,
            id: id.toString(),
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.intrinsicFuel ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}

// NOTE: doing this is important to prevent malleability. See here:
// https://github.com/OpenZeppelin/openzeppelin-contracts/pull/1622
export const fixSignature = (signature: string): string => {
    let v = parseInt(signature.slice(130, 132), 16);

    if (v < 27) {
        v += 27;
    }

    const vHex = v.toString(16);

    return signature.slice(0, 130) + vHex;
}