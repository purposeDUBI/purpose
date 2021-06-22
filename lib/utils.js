"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixSignature = exports.createSignedBoostedWithdrawalMessage = exports.createSignedBoostedReleaseMessage = exports.createSignedBoostedHodlMessage = exports.createSignedBoostedBurnMessage = exports.createSignedBoostedSendMessage = exports.blockchainTimestampWithOffset = exports.toSignatureTriple = exports.signEIP712 = exports.getEIP712MessageHash = exports.getTypedMessageBytes = exports.createEIP712Domain = exports.unpackBurnAmount = exports.packMint = void 0;
const bn_js_1 = __importDefault(require("bn.js"));
const eth_sig_util_1 = require("eth-sig-util");
const types_1 = require("./types");
exports.packMint = (totalSupply, amount) => {
    // The new total supply after the mint is amountToMint + totalSupplyBeforeMint
    // Set the second 96 bits of amountToMint to the new totalSupply.
    const upperHalf = totalSupply;
    const lowerHalf = amount;
    const packed = upperHalf.shln(96).or(lowerHalf);
    console.log("Total Supply: " + upperHalf.toString());
    console.log("Actual amount to mint: " + lowerHalf.toString());
    console.log(packed.toString());
    return packed;
};
exports.unpackBurnAmount = (packedAmount) => {
    return {
        amount: packedAmount.and(new bn_js_1.default(2).pow(new bn_js_1.default(96)).sub(new bn_js_1.default(1))),
        fuelType: (packedAmount.shrn(96).and(new bn_js_1.default(7))).toNumber(),
        fuelAmount: packedAmount.shrn(99).and(new bn_js_1.default(2).pow(new bn_js_1.default(96)).sub(new bn_js_1.default(1)))
    };
};
exports.createEIP712Domain = (name, verifyingContract, chainId) => ({
    name,
    version: chainId || "1",
    // Because of a bug in ganache, the solidity opcode `chainid` always
    // returns '1' (i.e. mainnet). So we sign everything for chainId 1 even though
    // in unit tests `web3.eth.getChainId()` actually returns something different.
    // https://github.com/trufflesuite/ganache/issues/1643    
    chainId: 1,
    verifyingContract,
});
const flattenTypesAndValues = (types, typeData, data) => {
    const collectedTypes = [];
    const collectedValues = [];
    const mapField = (name, type, value) => {
        // Nested type 
        if (types[type] !== undefined) {
            const result = flattenTypesAndValues(types, types[type], data[name]);
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
    };
};
exports.getTypedMessageBytes = (web3, data) => {
    const { collectedTypes, collectedValues } = flattenTypesAndValues(data.types, data.types[data.primaryType], data.message);
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
};
exports.getEIP712MessageHash = (data) => {
    return eth_sig_util_1.TypedDataUtils.sign(data).toString("hex");
};
exports.signEIP712 = (data, { privateKey }) => {
    const signature = eth_sig_util_1.signTypedData_v4(Buffer.from(privateKey, "hex"), { data });
    return exports.toSignatureTriple(signature);
};
exports.toSignatureTriple = (signature) => {
    // 32 bytes (64 hex)
    const r = "0x" + signature.slice(2, 66);
    // 32 bytes (64 hex)
    const s = "0x" + signature.slice(66, 130);
    // 1 byte (2 hex)
    const v = parseInt(signature.slice(130, 132), 16);
    // = 65 bytes (130 hex)
    return { r, s, v };
};
exports.blockchainTimestampWithOffset = async (web3, offset) => (await web3.eth.getBlock("latest")).timestamp + offset;
exports.createSignedBoostedSendMessage = async (web3, { from, to, amount, data, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }) => {
    var _a, _b, _c, _d;
    const typedData = {
        types: {
            EIP712Domain: types_1.EIP712Domain,
            BoostedSend: types_1.BoostedSend,
            BoosterFuel: types_1.BoosterFuel,
            BoosterPayload: types_1.BoosterPayload,
        },
        domain: exports.createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedSend",
        message: {
            tag: types_1.BoostTag.Send,
            sender: from,
            recipient: to,
            amount: amount.toString(),
            data: data !== null && data !== void 0 ? data : "0x",
            fuel: {
                dubi: ((_a = fuel === null || fuel === void 0 ? void 0 : fuel.dubi) !== null && _a !== void 0 ? _a : 0).toString(),
                unlockedPrps: ((_b = fuel === null || fuel === void 0 ? void 0 : fuel.unlockedPrps) !== null && _b !== void 0 ? _b : 0).toString(),
                lockedPrps: ((_c = fuel === null || fuel === void 0 ? void 0 : fuel.lockedPrps) !== null && _c !== void 0 ? _c : 0).toString(),
                intrinsicFuel: ((_d = fuel === null || fuel === void 0 ? void 0 : fuel.lockedPrps) !== null && _d !== void 0 ? _d : 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp !== null && timestamp !== void 0 ? timestamp : await exports.blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };
    return {
        message: typedData.message,
        signature: exports.signEIP712(typedData, { privateKey }),
        messageBytes: exports.getTypedMessageBytes(web3, typedData),
        messageHash: `0x${eth_sig_util_1.TypedDataUtils.sign(typedData).toString("hex")}`,
    };
};
exports.createSignedBoostedBurnMessage = async (web3, { account, amount, data, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }) => {
    var _a, _b, _c, _d;
    const typedData = {
        types: {
            EIP712Domain: types_1.EIP712Domain,
            BoostedBurn: types_1.BoostedBurn,
            BoosterFuel: types_1.BoosterFuel,
            BoosterPayload: types_1.BoosterPayload,
        },
        domain: exports.createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedBurn",
        message: {
            tag: types_1.BoostTag.Burn,
            account,
            amount: amount.toString(),
            data: data !== null && data !== void 0 ? data : "0x",
            fuel: {
                dubi: ((_a = fuel === null || fuel === void 0 ? void 0 : fuel.dubi) !== null && _a !== void 0 ? _a : 0).toString(),
                unlockedPrps: ((_b = fuel === null || fuel === void 0 ? void 0 : fuel.unlockedPrps) !== null && _b !== void 0 ? _b : 0).toString(),
                lockedPrps: ((_c = fuel === null || fuel === void 0 ? void 0 : fuel.lockedPrps) !== null && _c !== void 0 ? _c : 0).toString(),
                intrinsicFuel: ((_d = fuel === null || fuel === void 0 ? void 0 : fuel.intrinsicFuel) !== null && _d !== void 0 ? _d : 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp !== null && timestamp !== void 0 ? timestamp : await exports.blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            },
        }
    };
    return {
        message: typedData.message,
        signature: exports.signEIP712(typedData, { privateKey }),
        messageBytes: exports.getTypedMessageBytes(web3, typedData),
        messageHash: `0x${eth_sig_util_1.TypedDataUtils.sign(typedData).toString("hex")}`,
    };
};
exports.createSignedBoostedHodlMessage = async (web3, { hodlId, creator, amountPrps, duration, dubiBeneficiary, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }) => {
    var _a, _b, _c, _d;
    const typedData = {
        types: {
            EIP712Domain: types_1.EIP712Domain,
            BoostedHodl: types_1.BoostedHodl,
            BoosterFuel: types_1.BoosterFuel,
            BoosterPayload: types_1.BoosterPayload,
        },
        domain: exports.createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedHodl",
        message: {
            tag: types_1.BoostTag.Hodl,
            hodlId,
            amountPrps: amountPrps.toString(),
            duration: duration,
            dubiBeneficiary,
            prpsBeneficiary,
            creator,
            fuel: {
                dubi: ((_a = fuel === null || fuel === void 0 ? void 0 : fuel.dubi) !== null && _a !== void 0 ? _a : 0).toString(),
                unlockedPrps: ((_b = fuel === null || fuel === void 0 ? void 0 : fuel.unlockedPrps) !== null && _b !== void 0 ? _b : 0).toString(),
                lockedPrps: ((_c = fuel === null || fuel === void 0 ? void 0 : fuel.lockedPrps) !== null && _c !== void 0 ? _c : 0).toString(),
                intrinsicFuel: ((_d = fuel === null || fuel === void 0 ? void 0 : fuel.intrinsicFuel) !== null && _d !== void 0 ? _d : 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp !== null && timestamp !== void 0 ? timestamp : await exports.blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };
    return {
        message: typedData.message,
        signature: exports.signEIP712(typedData, { privateKey }),
        messageBytes: exports.getTypedMessageBytes(web3, typedData),
        messageHash: `0x${eth_sig_util_1.TypedDataUtils.sign(typedData).toString("hex")}`,
    };
};
exports.createSignedBoostedReleaseMessage = async (web3, { creator, id, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }) => {
    var _a, _b, _c, _d;
    const typedData = {
        types: {
            EIP712Domain: types_1.EIP712Domain,
            BoostedRelease: types_1.BoostedRelease,
            BoosterFuel: types_1.BoosterFuel,
            BoosterPayload: types_1.BoosterPayload,
        },
        domain: exports.createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedRelease",
        message: {
            tag: types_1.BoostTag.Release,
            creator,
            prpsBeneficiary,
            id: id.toString(),
            fuel: {
                dubi: ((_a = fuel === null || fuel === void 0 ? void 0 : fuel.dubi) !== null && _a !== void 0 ? _a : 0).toString(),
                unlockedPrps: ((_b = fuel === null || fuel === void 0 ? void 0 : fuel.unlockedPrps) !== null && _b !== void 0 ? _b : 0).toString(),
                lockedPrps: ((_c = fuel === null || fuel === void 0 ? void 0 : fuel.lockedPrps) !== null && _c !== void 0 ? _c : 0).toString(),
                intrinsicFuel: ((_d = fuel === null || fuel === void 0 ? void 0 : fuel.intrinsicFuel) !== null && _d !== void 0 ? _d : 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp !== null && timestamp !== void 0 ? timestamp : await exports.blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };
    return {
        message: typedData.message,
        signature: exports.signEIP712(typedData, { privateKey }),
        messageBytes: exports.getTypedMessageBytes(web3, typedData),
        messageHash: `0x${eth_sig_util_1.TypedDataUtils.sign(typedData).toString("hex")}`,
    };
};
exports.createSignedBoostedWithdrawalMessage = async (web3, { creator, id, prpsBeneficiary, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }) => {
    var _a, _b, _c, _d;
    const typedData = {
        types: {
            EIP712Domain: types_1.EIP712Domain,
            BoostedWithdrawal: types_1.BoostedWithdrawal,
            BoosterFuel: types_1.BoosterFuel,
            BoosterPayload: types_1.BoosterPayload,
        },
        domain: exports.createEIP712Domain("Purpose", verifyingContract),
        primaryType: "BoostedWithdrawal",
        message: {
            tag: types_1.BoostTag.Withdrawal,
            creator,
            prpsBeneficiary,
            id: id.toString(),
            fuel: {
                dubi: ((_a = fuel === null || fuel === void 0 ? void 0 : fuel.dubi) !== null && _a !== void 0 ? _a : 0).toString(),
                unlockedPrps: ((_b = fuel === null || fuel === void 0 ? void 0 : fuel.unlockedPrps) !== null && _b !== void 0 ? _b : 0).toString(),
                lockedPrps: ((_c = fuel === null || fuel === void 0 ? void 0 : fuel.lockedPrps) !== null && _c !== void 0 ? _c : 0).toString(),
                intrinsicFuel: ((_d = fuel === null || fuel === void 0 ? void 0 : fuel.intrinsicFuel) !== null && _d !== void 0 ? _d : 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp !== null && timestamp !== void 0 ? timestamp : await exports.blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };
    return {
        message: typedData.message,
        signature: exports.signEIP712(typedData, { privateKey }),
        messageBytes: exports.getTypedMessageBytes(web3, typedData),
        messageHash: `0x${eth_sig_util_1.TypedDataUtils.sign(typedData).toString("hex")}`,
    };
};
// NOTE: doing this is important to prevent malleability. See here:
// https://github.com/OpenZeppelin/openzeppelin-contracts/pull/1622
exports.fixSignature = (signature) => {
    let v = parseInt(signature.slice(130, 132), 16);
    if (v < 27) {
        v += 27;
    }
    const vHex = v.toString(16);
    return signature.slice(0, 130) + vHex;
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsa0RBQXVCO0FBQ3ZCLCtDQUE4RTtBQUM5RSxtQ0FBcU07QUFFeEwsUUFBQSxRQUFRLEdBQUcsQ0FBQyxXQUFnQixFQUFFLE1BQVcsRUFBTyxFQUFFO0lBQzNELDhFQUE4RTtJQUM5RSxpRUFBaUU7SUFDakUsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDO0lBQzlCLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQztJQUN6QixNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUVoRCxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixHQUFHLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO0lBQ3JELE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLEdBQUcsU0FBUyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7SUFDOUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztJQUUvQixPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDLENBQUE7QUFFWSxRQUFBLGdCQUFnQixHQUFHLENBQUMsWUFBWSxFQUF3RCxFQUFFO0lBQ25HLE9BQU87UUFDSCxNQUFNLEVBQUUsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJLGVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxlQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxlQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNsRSxRQUFRLEVBQUUsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLGVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxD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R0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBRWhELElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRTtRQUNSLENBQUMsSUFBSSxFQUFFLENBQUM7S0FDWDtJQUVELE1BQU0sSUFBSSxHQUFHLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7SUFFNUIsT0FBTyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUM7QUFDMUMsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEJOIGZyb20gXCJibi5qc1wiO1xuaW1wb3J0IHsgVHlwZWRNZXNzYWdlLCBzaWduVHlwZWREYXRhX3Y0LCBUeXBlZERhdGFVdGlscyB9IGZyb20gXCJldGgtc2lnLXV0aWxcIjtcbmltcG9ydCB7IEJvb3N0ZXJQYXlsb2FkLCBCb29zdGVyRnVlbCwgRUlQNzEyU2lnbmVkTWVzc2FnZSwgQm9vc3RlZFNlbmQsIEJvb3N0ZWRIb2RsLCBCb29zdGVkUmVsZWFzZSwgQm9vc3RUYWcsIEJvb3N0ZWRCdXJuLCBCb29zdGVkV2l0aGRyYXdhbCwgRUlQNzEyRG9tYWluLCBNZXNzYWdlVHlwZXMsIEZ1ZWxUeXBlIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IHBhY2tNaW50ID0gKHRvdGFsU3VwcGx5OiBhbnksIGFtb3VudDogYW55KTogYW55ID0+IHtcbiAgICAvLyBUaGUgbmV3IHRvdGFsIHN1cHBseSBhZnRlciB0aGUgbWludCBpcyBhbW91bnRUb01pbnQgKyB0b3RhbFN1cHBseUJlZm9yZU1pbnRcbiAgICAvLyBTZXQgdGhlIHNlY29uZCA5NiBiaXRzIG9mIGFtb3VudFRvTWludCB0byB0aGUgbmV3IHRvdGFsU3VwcGx5LlxuICAgIGNvbnN0IHVwcGVySGFsZiA9IHRvdGFsU3VwcGx5O1xuICAgIGNvbnN0IGxvd2VySGFsZiA9IGFtb3VudDtcbiAgICBjb25zdCBwYWNrZWQgPSB1cHBlckhhbGYuc2hsbig5Nikub3IobG93ZXJIYWxmKTtcblxuICAgIGNvbnNvbGUubG9nKFwiVG90YWwgU3VwcGx5OiBcIiArIHVwcGVySGFsZi50b1N0cmluZygpKTtcbiAgICBjb25zb2xlLmxvZyhcIkFjdHVhbCBhbW91bnQgdG8gbWludDogXCIgKyBsb3dlckhhbGYudG9TdHJpbmcoKSk7XG4gICAgY29uc29sZS5sb2cocGFja2VkLnRvU3RyaW5nKCkpO1xuXG4gICAgcmV0dXJuIHBhY2tlZDtcbn1cblxuZXhwb3J0IGNvbnN0IHVucGFja0J1cm5BbW91bnQgPSAocGFja2VkQW1vdW50KTogeyBhbW91bnQ6IGFueSwgZnVlbFR5cGU6IEZ1ZWxUeXBlLCBmdWVsQW1vdW50OiBhbnkgfSA9PiB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgYW1vdW50OiBwYWNrZWRBbW91bnQuYW5kKG5ldyBCTigyKS5wb3cobmV3IEJOKDk2KSkuc3ViKG5ldyBCTigxKSkpLFxuICAgICAgICBmdWVsVHlwZTogKHBhY2tlZEFtb3VudC5zaHJuKDk2KS5hbmQobmV3IEJOKDcpKSkudG9OdW1iZXIoKSBhcyBGdWVsVHlwZSxcbiAgICAgICAgZnVlbEFtb3VudDogcGFja2VkQW1vdW50LnNocm4oOTkpLmFuZChuZXcgQk4oMikucG93KG5ldyBCTig5NikpLnN1YihuZXcgQk4oMSkpKVxuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IGNyZWF0ZUVJUDcxMkRvbWFpbiA9IChuYW1lOiBzdHJpbmcsIHZlcmlmeWluZ0NvbnRyYWN0OiBzdHJpbmcsIGNoYWluSWQ/OiBzdHJpbmcpID0+ICh7XG4gICAgbmFtZSxcbiAgICB2ZXJzaW9uOiBjaGFpbklkIHx8IFwiMVwiLFxuICAgIC8vIEJlY2F1c2Ugb2YgYSBidWcgaW4gZ2FuYWNoZSwgdGhlIHNvbGlkaXR5IG9wY29kZSBgY2hhaW5pZGAgYWx3YXlzXG4gICAgLy8gcmV0dXJucyAnMScgKGkuZS4gbWFpbm5ldCkuIFNvIHdlIHNpZ24gZXZlcnl0aGluZyBmb3IgY2hhaW5JZCAxIGV2ZW4gdGhvdWdoXG4gICAgLy8gaW4gdW5pdCB0ZXN0cyBgd2ViMy5ldGguZ2V0Q2hhaW5JZCgpYCBhY3R1YWxseSByZXR1cm5zIHNvbWV0aGluZyBkaWZmZXJlbnQuXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL3RydWZmbGVzdWl0ZS9nYW5hY2hlL2lzc3Vlcy8xNjQzICAgIFxuICAgIGNoYWluSWQ6IDEsXG4gICAgdmVyaWZ5aW5nQ29udHJhY3QsXG59KVxuXG5jb25zdCBmbGF0dGVuVHlwZXNBbmRWYWx1ZXMgPSAodHlwZXMsIHR5cGVEYXRhLCBkYXRhKTogeyBjb2xsZWN0ZWRUeXBlczogc3RyaW5nW10sIGNvbGxlY3RlZFZhbHVlczogYW55W10gfSA9PiB7XG4gICAgY29uc3QgY29sbGVjdGVkVHlwZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgY29sbGVjdGVkVmFsdWVzOiBhbnlbXSA9IFtdO1xuXG4gICAgY29uc3QgbWFwRmllbGQgPSAobmFtZSwgdHlwZSwgdmFsdWUpID0+IHtcbiAgICAgICAgLy8gTmVzdGVkIHR5cGUgXG4gICAgICAgIGlmICh0eXBlc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmbGF0dGVuVHlwZXNBbmRWYWx1ZXModHlwZXMsIHR5cGVzW3R5cGVdLCBkYXRhW25hbWVdKVxuICAgICAgICAgICAgcmV0dXJuIFtyZXN1bHQuY29sbGVjdGVkVHlwZXMsIHJlc3VsdC5jb2xsZWN0ZWRWYWx1ZXNdO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbWlzc2luZyB2YWx1ZSBmb3IgZmllbGQgb2YgdHlwZSAke3R5cGV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gW1t0eXBlXSwgW3ZhbHVlXV07XG4gICAgfTtcblxuICAgIGZvciAoY29uc3QgZmllbGQgb2YgdHlwZURhdGEpIHtcbiAgICAgICAgY29uc3QgW190eXBlcywgX3ZhbHVlc10gPSBtYXBGaWVsZChmaWVsZC5uYW1lLCBmaWVsZC50eXBlLCBkYXRhW2ZpZWxkLm5hbWVdKTtcbiAgICAgICAgY29sbGVjdGVkVHlwZXMucHVzaCguLi5fdHlwZXMpO1xuICAgICAgICBjb2xsZWN0ZWRWYWx1ZXMucHVzaCguLi5fdmFsdWVzKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBjb2xsZWN0ZWRUeXBlcyxcbiAgICAgICAgY29sbGVjdGVkVmFsdWVzLFxuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IGdldFR5cGVkTWVzc2FnZUJ5dGVzID0gPFQgZXh0ZW5kcyBNZXNzYWdlVHlwZXM+KHdlYjMsIGRhdGE6IFR5cGVkTWVzc2FnZTxUPik6IHN0cmluZyA9PiB7XG4gICAgY29uc3QgeyBjb2xsZWN0ZWRUeXBlcywgY29sbGVjdGVkVmFsdWVzIH0gPSBmbGF0dGVuVHlwZXNBbmRWYWx1ZXMoZGF0YS50eXBlcywgZGF0YS50eXBlc1tkYXRhLnByaW1hcnlUeXBlXSwgZGF0YS5tZXNzYWdlKVxuXG4gICAgbGV0IGVuY29kZWRQYXJhbWV0ZXJzID0gd2ViMy5ldGguYWJpLmVuY29kZVBhcmFtZXRlcnMoY29sbGVjdGVkVHlwZXMsIGNvbGxlY3RlZFZhbHVlcyk7XG5cbiAgICAvLyBOT1RFOiBTb21lIGJvb3N0ZWQgbWVzc2FnZXMgY29udGFpbiBhIFwiYnl0ZXNcIiB0eXBlIGUuZy4gQm9vc3RlZFNlbmQvQnVyblxuICAgIC8vIFN1Y2ggZHluYW1pYyB0eXBlcyBhcmUgZW5jb2RlZCBhIGJpdCBkaWZmZXJlbnRseSBhbmQgZW5jb2RlUGFyYW1ldGVycyBwcm9kdWNlcyBhbiBpbnZhbGlkXG4gICAgLy8gZW5jb2RpbmcgZm9yIHNvbWUgcmVhc29uXG5cbiAgICAvLyBUaGlzIGlzIGp1c3QgYSBoZXVyaXN0aWMgYXBwcm9hY2ggYW5kIG9ubHkgc3VwcG9ydHMgYSBzaW5nbGUgZHluYW1pYyBcImJ5dGVzXCIgdHlwZSBwZXIgbWVzc2FnZSAtIFxuICAgIC8vIHdoaWNoIGlzIGZpbmUgZm9yIHRoZSBmb3Jlc2VlYWJsZSBmdXR1cmUgZm9yIG91ciBwdXJwb3Nlc1xuICAgIGNvbnN0IGR5bmFtaWNCeXRlc1R5cGVJbmRleCA9IGNvbGxlY3RlZFR5cGVzLmluZGV4T2YoXCJieXRlc1wiKTtcbiAgICBpZiAoZHluYW1pY0J5dGVzVHlwZUluZGV4ICE9PSAtMSkge1xuICAgICAgICAvLyBJZiB3ZSBoYXZlIGEgZHluYW1pYyB0eXBlIHRoZW4gd2UgbXVzdCBwcmVwZW5kIGEgd29yZCB0aGF0IHBvaW50cyB0byB0aGUgZmlyc3QgcGFyYW1ldGVyLlxuICAgICAgICAvLyBIZXJlIGl0J3MgYWx3YXlzIDB4MjAgaS5lLiB0aGUgZmlyc3Qgd29yZCBhZnRlciB0aGUgcHJlZml4LlxuICAgICAgICAvLyBUaGlzIG1hdGNoZXMgd2l0aCB3aGF0IGBhYmkuZW5jb2RlKGJvb3N0ZWRTdHJ1Y3QpYCBwcm9kdWNlcyB3aGVuIGNhbGxlZCBpbiBhIHNtYXJ0IGNvbnRyYWN0LlxuICAgICAgICBjb25zdCBwcmVmaXggPSBcIjIwXCIucGFkU3RhcnQoNjQsIFwiMFwiKTtcbiAgICAgICAgY29uc3QgcGFyYW1zV2l0aG91dDB4ID0gZW5jb2RlZFBhcmFtZXRlcnMuc2xpY2UoMik7XG4gICAgICAgIGVuY29kZWRQYXJhbWV0ZXJzID0gYDB4JHtwcmVmaXh9JHtwYXJhbXNXaXRob3V0MHh9YDtcbiAgICAgICAgLy8gV2l0aG91dCBpdCB0aGUgY29ycmVzcG9uZGluZyBhYmkuZGVjb2RlIHJldmVydHNcbiAgICB9XG5cbiAgICByZXR1cm4gZW5jb2RlZFBhcmFtZXRlcnM7XG59XG5cbmV4cG9ydCBjb25zdCBnZXRFSVA3MTJNZXNzYWdlSGFzaCA9IDxUIGV4dGVuZHMgTWVzc2FnZVR5cGVzPihkYXRhOiBUeXBlZE1lc3NhZ2U8VD4pOiBzdHJpbmcgPT4ge1xuICAgIHJldHVybiBUeXBlZERhdGFVdGlscy5zaWduKGRhdGEpLnRvU3RyaW5nKFwiaGV4XCIpO1xufVxuXG5leHBvcnQgY29uc3Qgc2lnbkVJUDcxMiA9IDxUIGV4dGVuZHMgTWVzc2FnZVR5cGVzPihkYXRhOiBUeXBlZE1lc3NhZ2U8VD4sIHsgcHJpdmF0ZUtleSB9OiB7IHByaXZhdGVLZXk6IHN0cmluZyB9KTogeyByOiBzdHJpbmcsIHM6IHN0cmluZywgdjogbnVtYmVyIH0gPT4ge1xuICAgIGNvbnN0IHNpZ25hdHVyZSA9IHNpZ25UeXBlZERhdGFfdjQoQnVmZmVyLmZyb20ocHJpdmF0ZUtleSwgXCJoZXhcIiksIHsgZGF0YSB9KTtcbiAgICByZXR1cm4gdG9TaWduYXR1cmVUcmlwbGUoc2lnbmF0dXJlKTtcbn1cblxuZXhwb3J0IGNvbnN0IHRvU2lnbmF0dXJlVHJpcGxlID0gKHNpZ25hdHVyZTogc3RyaW5nKTogeyByOiBzdHJpbmcsIHM6IHN0cmluZywgdjogbnVtYmVyIH0gPT4ge1xuICAgIC8vIDMyIGJ5dGVzICg2NCBoZXgpXG4gICAgY29uc3QgciA9IFwiMHhcIiArIHNpZ25hdHVyZS5zbGljZSgyLCA2Nik7XG4gICAgLy8gMzIgYnl0ZXMgKDY0IGhleClcbiAgICBjb25zdCBzID0gXCIweFwiICsgc2lnbmF0dXJlLnNsaWNlKDY2LCAxMzApO1xuICAgIC8vIDEgYnl0ZSAoMiBoZXgpXG4gICAgY29uc3QgdiA9IHBhcnNlSW50KHNpZ25hdHVyZS5zbGljZSgxMzAsIDEzMiksIDE2KTtcbiAgICAvLyA9IDY1IGJ5dGVzICgxMzAgaGV4KVxuXG4gICAgcmV0dXJuIHsgciwgcywgdiB9O1xufVxuXG5leHBvcnQgY29uc3QgYmxvY2tjaGFpblRpbWVzdGFtcFdpdGhPZmZzZXQgPSBhc3luYyAod2ViMywgb2Zmc2V0KSA9PiAoYXdhaXQgd2ViMy5ldGguZ2V0QmxvY2soXCJsYXRlc3RcIikpLnRpbWVzdGFtcCBhcyBudW1iZXIgKyBvZmZzZXQ7XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVTaWduZWRCb29zdGVkU2VuZE1lc3NhZ2UgPSBhc3luYyAod2ViMywgeyBmcm9tLCB0bywgYW1vdW50LCBkYXRhLCBub25jZSwgdGltZXN0YW1wLCBmdWVsLCBib29zdGVyLCBpc0xlZ2FjeVNpZ25hdHVyZSwgdmVyaWZ5aW5nQ29udHJhY3QsIHNpZ25lcjogeyBwcml2YXRlS2V5IH0gfTogeyBmcm9tOiBzdHJpbmc7IHRvOiBzdHJpbmc7IGFtb3VudDogQk47IGRhdGE/OiBzdHJpbmc7IG5vbmNlOiBCTjsgaXNMZWdhY3lTaWduYXR1cmU/OiBib29sZWFuOyB0aW1lc3RhbXA/OiBudW1iZXIsIGZ1ZWw/OiB7IGR1Ymk/OiBCTiwgdW5sb2NrZWRQcnBzPzogQk4sIGxvY2tlZFBycHM/OiBCTiwgaW50cmluc2ljRnVlbD86IEJOIH0sIGJvb3N0ZXI6IHN0cmluZzsgdmVyaWZ5aW5nQ29udHJhY3Q6IHN0cmluZywgc2lnbmVyOiB7IHByaXZhdGVLZXk6IHN0cmluZyB9OyB9KTogUHJvbWlzZTxFSVA3MTJTaWduZWRNZXNzYWdlPiA9PiB7XG4gICAgY29uc3QgdHlwZWREYXRhID0ge1xuICAgICAgICB0eXBlczoge1xuICAgICAgICAgICAgRUlQNzEyRG9tYWluLFxuICAgICAgICAgICAgQm9vc3RlZFNlbmQsXG4gICAgICAgICAgICBCb29zdGVyRnVlbCxcbiAgICAgICAgICAgIEJvb3N0ZXJQYXlsb2FkLFxuICAgICAgICB9IGFzIGFueSxcbiAgICAgICAgZG9tYWluOiBjcmVhdGVFSVA3MTJEb21haW4oXCJQdXJwb3NlXCIsIHZlcmlmeWluZ0NvbnRyYWN0KSxcbiAgICAgICAgcHJpbWFyeVR5cGU6IFwiQm9vc3RlZFNlbmRcIixcbiAgICAgICAgbWVzc2FnZToge1xuICAgICAgICAgICAgdGFnOiBCb29zdFRhZy5TZW5kLFxuICAgICAgICAgICAgc2VuZGVyOiBmcm9tLFxuICAgICAgICAgICAgcmVjaXBpZW50OiB0byxcbiAgICAgICAgICAgIGFtb3VudDogYW1vdW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgICBkYXRhOiBkYXRhID8/IFwiMHhcIixcbiAgICAgICAgICAgIGZ1ZWw6IHtcbiAgICAgICAgICAgICAgICBkdWJpOiAoZnVlbD8uZHViaSA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIHVubG9ja2VkUHJwczogKGZ1ZWw/LnVubG9ja2VkUHJwcyA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIGxvY2tlZFBycHM6IChmdWVsPy5sb2NrZWRQcnBzID8/IDApLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaW50cmluc2ljRnVlbDogKGZ1ZWw/LmxvY2tlZFBycHMgPz8gMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib29zdGVyUGF5bG9hZDoge1xuICAgICAgICAgICAgICAgIGJvb3N0ZXIsXG4gICAgICAgICAgICAgICAgdGltZXN0YW1wOiB0aW1lc3RhbXAgPz8gYXdhaXQgYmxvY2tjaGFpblRpbWVzdGFtcFdpdGhPZmZzZXQod2ViMywgMCksXG4gICAgICAgICAgICAgICAgbm9uY2U6IG5vbmNlLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaXNMZWdhY3lTaWduYXR1cmU6IChpc0xlZ2FjeVNpZ25hdHVyZSB8fCBmYWxzZSksXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgbWVzc2FnZTogdHlwZWREYXRhLm1lc3NhZ2UsXG4gICAgICAgIHNpZ25hdHVyZTogc2lnbkVJUDcxMih0eXBlZERhdGEsIHsgcHJpdmF0ZUtleSB9KSxcbiAgICAgICAgbWVzc2FnZUJ5dGVzOiBnZXRUeXBlZE1lc3NhZ2VCeXRlcyh3ZWIzLCB0eXBlZERhdGEpLFxuICAgICAgICBtZXNzYWdlSGFzaDogYDB4JHtUeXBlZERhdGFVdGlscy5zaWduKHR5cGVkRGF0YSkudG9TdHJpbmcoXCJoZXhcIil9YCxcbiAgICB9O1xufVxuXG5leHBvcnQgY29uc3QgY3JlYXRlU2lnbmVkQm9vc3RlZEJ1cm5NZXNzYWdlID0gYXN5bmMgKHdlYjMsIHsgYWNjb3VudCwgYW1vdW50LCBkYXRhLCBub25jZSwgdGltZXN0YW1wLCBmdWVsLCBib29zdGVyLCBpc0xlZ2FjeVNpZ25hdHVyZSwgdmVyaWZ5aW5nQ29udHJhY3QsIHNpZ25lcjogeyBwcml2YXRlS2V5IH0gfTogeyBhY2NvdW50OiBzdHJpbmc7IGFtb3VudDogQk47IGlzTGVnYWN5U2lnbmF0dXJlPzogYm9vbGVhbjsgZGF0YT86IHN0cmluZzsgbm9uY2U6IEJOOyB0aW1lc3RhbXA/OiBudW1iZXIsIGZ1ZWw/OiB7IGR1Ymk/OiBCTiwgdW5sb2NrZWRQcnBzPzogQk4sIGxvY2tlZFBycHM/OiBCTiwgaW50cmluc2ljRnVlbD86IEJOIH0sIGJvb3N0ZXI6IHN0cmluZywgdmVyaWZ5aW5nQ29udHJhY3Q6IHN0cmluZywgc2lnbmVyOiB7IHByaXZhdGVLZXk6IHN0cmluZyB9OyB9KTogUHJvbWlzZTxFSVA3MTJTaWduZWRNZXNzYWdlPiA9PiB7XG4gICAgY29uc3QgdHlwZWREYXRhID0ge1xuICAgICAgICB0eXBlczoge1xuICAgICAgICAgICAgRUlQNzEyRG9tYWluLFxuICAgICAgICAgICAgQm9vc3RlZEJ1cm4sXG4gICAgICAgICAgICBCb29zdGVyRnVlbCxcbiAgICAgICAgICAgIEJvb3N0ZXJQYXlsb2FkLFxuICAgICAgICB9IGFzIGFueSxcbiAgICAgICAgZG9tYWluOiBjcmVhdGVFSVA3MTJEb21haW4oXCJQdXJwb3NlXCIsIHZlcmlmeWluZ0NvbnRyYWN0KSxcbiAgICAgICAgcHJpbWFyeVR5cGU6IFwiQm9vc3RlZEJ1cm5cIixcbiAgICAgICAgbWVzc2FnZToge1xuICAgICAgICAgICAgdGFnOiBCb29zdFRhZy5CdXJuLFxuICAgICAgICAgICAgYWNjb3VudCxcbiAgICAgICAgICAgIGFtb3VudDogYW1vdW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgICBkYXRhOiBkYXRhID8/IFwiMHhcIixcbiAgICAgICAgICAgIGZ1ZWw6IHtcbiAgICAgICAgICAgICAgICBkdWJpOiAoZnVlbD8uZHViaSA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIHVubG9ja2VkUHJwczogKGZ1ZWw/LnVubG9ja2VkUHJwcyA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIGxvY2tlZFBycHM6IChmdWVsPy5sb2NrZWRQcnBzID8/IDApLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaW50cmluc2ljRnVlbDogKGZ1ZWw/LmludHJpbnNpY0Z1ZWwgPz8gMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib29zdGVyUGF5bG9hZDoge1xuICAgICAgICAgICAgICAgIGJvb3N0ZXIsXG4gICAgICAgICAgICAgICAgdGltZXN0YW1wOiB0aW1lc3RhbXAgPz8gYXdhaXQgYmxvY2tjaGFpblRpbWVzdGFtcFdpdGhPZmZzZXQod2ViMywgMCksXG4gICAgICAgICAgICAgICAgbm9uY2U6IG5vbmNlLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaXNMZWdhY3lTaWduYXR1cmU6IChpc0xlZ2FjeVNpZ25hdHVyZSB8fCBmYWxzZSksXG4gICAgICAgICAgICB9LFxuICAgICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIG1lc3NhZ2U6IHR5cGVkRGF0YS5tZXNzYWdlLFxuICAgICAgICBzaWduYXR1cmU6IHNpZ25FSVA3MTIodHlwZWREYXRhLCB7IHByaXZhdGVLZXkgfSksXG4gICAgICAgIG1lc3NhZ2VCeXRlczogZ2V0VHlwZWRNZXNzYWdlQnl0ZXMod2ViMywgdHlwZWREYXRhKSxcbiAgICAgICAgbWVzc2FnZUhhc2g6IGAweCR7VHlwZWREYXRhVXRpbHMuc2lnbih0eXBlZERhdGEpLnRvU3RyaW5nKFwiaGV4XCIpfWAsXG4gICAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGNyZWF0ZVNpZ25lZEJvb3N0ZWRIb2RsTWVzc2FnZSA9IGFzeW5jICh3ZWIzLCB7IGhvZGxJZCwgY3JlYXRvciwgYW1vdW50UHJwcywgZHVyYXRpb24sIGR1YmlCZW5lZmljaWFyeSwgcHJwc0JlbmVmaWNpYXJ5LCBub25jZSwgdGltZXN0YW1wLCBmdWVsLCBib29zdGVyLCBpc0xlZ2FjeVNpZ25hdHVyZSwgdmVyaWZ5aW5nQ29udHJhY3QsIHNpZ25lcjogeyBwcml2YXRlS2V5IH0gfTogeyBob2RsSWQ6IG51bWJlciwgY3JlYXRvcjogc3RyaW5nLCBhbW91bnRQcnBzOiBCTiwgZHVyYXRpb246IG51bWJlcjsgZHViaUJlbmVmaWNpYXJ5OiBzdHJpbmcsIHBycHNCZW5lZmljaWFyeTogc3RyaW5nLCBpc0xlZ2FjeVNpZ25hdHVyZT86IGJvb2xlYW47IG5vbmNlOiBCTjsgdGltZXN0YW1wPzogbnVtYmVyLCBmdWVsPzogeyBkdWJpPzogQk4sIHVubG9ja2VkUHJwcz86IEJOLCBsb2NrZWRQcnBzPzogQk4sIGludHJpbnNpY0Z1ZWw/OiBCTiB9LCBib29zdGVyOiBzdHJpbmc7IHZlcmlmeWluZ0NvbnRyYWN0OiBzdHJpbmcsIHNpZ25lcjogeyBwcml2YXRlS2V5OiBzdHJpbmcgfTsgfSk6IFByb21pc2U8RUlQNzEyU2lnbmVkTWVzc2FnZT4gPT4ge1xuICAgIGNvbnN0IHR5cGVkRGF0YSA9IHtcbiAgICAgICAgdHlwZXM6IHtcbiAgICAgICAgICAgIEVJUDcxMkRvbWFpbixcbiAgICAgICAgICAgIEJvb3N0ZWRIb2RsLFxuICAgICAgICAgICAgQm9vc3RlckZ1ZWwsXG4gICAgICAgICAgICBCb29zdGVyUGF5bG9hZCxcbiAgICAgICAgfSBhcyBhbnksXG4gICAgICAgIGRvbWFpbjogY3JlYXRlRUlQNzEyRG9tYWluKFwiUHVycG9zZVwiLCB2ZXJpZnlpbmdDb250cmFjdCksXG4gICAgICAgIHByaW1hcnlUeXBlOiBcIkJvb3N0ZWRIb2RsXCIsXG4gICAgICAgIG1lc3NhZ2U6IHtcbiAgICAgICAgICAgIHRhZzogQm9vc3RUYWcuSG9kbCxcbiAgICAgICAgICAgIGhvZGxJZCxcbiAgICAgICAgICAgIGFtb3VudFBycHM6IGFtb3VudFBycHMudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIGR1cmF0aW9uOiBkdXJhdGlvbixcbiAgICAgICAgICAgIGR1YmlCZW5lZmljaWFyeSxcbiAgICAgICAgICAgIHBycHNCZW5lZmljaWFyeSxcbiAgICAgICAgICAgIGNyZWF0b3IsXG4gICAgICAgICAgICBmdWVsOiB7XG4gICAgICAgICAgICAgICAgZHViaTogKGZ1ZWw/LmR1YmkgPz8gMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICB1bmxvY2tlZFBycHM6IChmdWVsPy51bmxvY2tlZFBycHMgPz8gMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICBsb2NrZWRQcnBzOiAoZnVlbD8ubG9ja2VkUHJwcyA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIGludHJpbnNpY0Z1ZWw6IChmdWVsPy5pbnRyaW5zaWNGdWVsID8/IDApLnRvU3RyaW5nKCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYm9vc3RlclBheWxvYWQ6IHtcbiAgICAgICAgICAgICAgICBib29zdGVyLFxuICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogdGltZXN0YW1wID8/IGF3YWl0IGJsb2NrY2hhaW5UaW1lc3RhbXBXaXRoT2Zmc2V0KHdlYjMsIDApLFxuICAgICAgICAgICAgICAgIG5vbmNlOiBub25jZS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIGlzTGVnYWN5U2lnbmF0dXJlOiAoaXNMZWdhY3lTaWduYXR1cmUgfHwgZmFsc2UpLFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIG1lc3NhZ2U6IHR5cGVkRGF0YS5tZXNzYWdlLFxuICAgICAgICBzaWduYXR1cmU6IHNpZ25FSVA3MTIodHlwZWREYXRhLCB7IHByaXZhdGVLZXkgfSksXG4gICAgICAgIG1lc3NhZ2VCeXRlczogZ2V0VHlwZWRNZXNzYWdlQnl0ZXMod2ViMywgdHlwZWREYXRhKSxcbiAgICAgICAgbWVzc2FnZUhhc2g6IGAweCR7VHlwZWREYXRhVXRpbHMuc2lnbih0eXBlZERhdGEpLnRvU3RyaW5nKFwiaGV4XCIpfWAsXG4gICAgfTtcbn1cblxuXG5leHBvcnQgY29uc3QgY3JlYXRlU2lnbmVkQm9vc3RlZFJlbGVhc2VNZXNzYWdlID0gYXN5bmMgKHdlYjMsIHsgY3JlYXRvciwgaWQsIHBycHNCZW5lZmljaWFyeSwgbm9uY2UsIHRpbWVzdGFtcCwgZnVlbCwgYm9vc3RlciwgaXNMZWdhY3lTaWduYXR1cmUsIHZlcmlmeWluZ0NvbnRyYWN0LCBzaWduZXI6IHsgcHJpdmF0ZUtleSB9IH06IHsgY3JlYXRvcjogc3RyaW5nLCBpZDogQk4sIHBycHNCZW5lZmljaWFyeTogc3RyaW5nOyBub25jZTogQk47IHRpbWVzdGFtcD86IG51bWJlciwgaXNMZWdhY3lTaWduYXR1cmU/OiBib29sZWFuOyBmdWVsPzogeyBkdWJpPzogQk4sIHVubG9ja2VkUHJwcz86IEJOLCBsb2NrZWRQcnBzPzogQk4sIGludHJpbnNpY0Z1ZWw/OiBCTiB9LCBib29zdGVyOiBzdHJpbmc7IHZlcmlmeWluZ0NvbnRyYWN0OiBzdHJpbmcsIHNpZ25lcjogeyBwcml2YXRlS2V5OiBzdHJpbmcgfTsgfSk6IFByb21pc2U8RUlQNzEyU2lnbmVkTWVzc2FnZT4gPT4ge1xuICAgIGNvbnN0IHR5cGVkRGF0YSA9IHtcbiAgICAgICAgdHlwZXM6IHtcbiAgICAgICAgICAgIEVJUDcxMkRvbWFpbixcbiAgICAgICAgICAgIEJvb3N0ZWRSZWxlYXNlLFxuICAgICAgICAgICAgQm9vc3RlckZ1ZWwsXG4gICAgICAgICAgICBCb29zdGVyUGF5bG9hZCxcbiAgICAgICAgfSBhcyBhbnksXG4gICAgICAgIGRvbWFpbjogY3JlYXRlRUlQNzEyRG9tYWluKFwiUHVycG9zZVwiLCB2ZXJpZnlpbmdDb250cmFjdCksXG4gICAgICAgIHByaW1hcnlUeXBlOiBcIkJvb3N0ZWRSZWxlYXNlXCIsXG4gICAgICAgIG1lc3NhZ2U6IHtcbiAgICAgICAgICAgIHRhZzogQm9vc3RUYWcuUmVsZWFzZSxcbiAgICAgICAgICAgIGNyZWF0b3IsXG4gICAgICAgICAgICBwcnBzQmVuZWZpY2lhcnksXG4gICAgICAgICAgICBpZDogaWQudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIGZ1ZWw6IHtcbiAgICAgICAgICAgICAgICBkdWJpOiAoZnVlbD8uZHViaSA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIHVubG9ja2VkUHJwczogKGZ1ZWw/LnVubG9ja2VkUHJwcyA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIGxvY2tlZFBycHM6IChmdWVsPy5sb2NrZWRQcnBzID8/IDApLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaW50cmluc2ljRnVlbDogKGZ1ZWw/LmludHJpbnNpY0Z1ZWwgPz8gMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib29zdGVyUGF5bG9hZDoge1xuICAgICAgICAgICAgICAgIGJvb3N0ZXIsXG4gICAgICAgICAgICAgICAgdGltZXN0YW1wOiB0aW1lc3RhbXAgPz8gYXdhaXQgYmxvY2tjaGFpblRpbWVzdGFtcFdpdGhPZmZzZXQod2ViMywgMCksXG4gICAgICAgICAgICAgICAgbm9uY2U6IG5vbmNlLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaXNMZWdhY3lTaWduYXR1cmU6IChpc0xlZ2FjeVNpZ25hdHVyZSB8fCBmYWxzZSksXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgbWVzc2FnZTogdHlwZWREYXRhLm1lc3NhZ2UsXG4gICAgICAgIHNpZ25hdHVyZTogc2lnbkVJUDcxMih0eXBlZERhdGEsIHsgcHJpdmF0ZUtleSB9KSxcbiAgICAgICAgbWVzc2FnZUJ5dGVzOiBnZXRUeXBlZE1lc3NhZ2VCeXRlcyh3ZWIzLCB0eXBlZERhdGEpLFxuICAgICAgICBtZXNzYWdlSGFzaDogYDB4JHtUeXBlZERhdGFVdGlscy5zaWduKHR5cGVkRGF0YSkudG9TdHJpbmcoXCJoZXhcIil9YCxcbiAgICB9O1xufVxuXG5leHBvcnQgY29uc3QgY3JlYXRlU2lnbmVkQm9vc3RlZFdpdGhkcmF3YWxNZXNzYWdlID0gYXN5bmMgKHdlYjMsIHsgY3JlYXRvciwgaWQsIHBycHNCZW5lZmljaWFyeSwgbm9uY2UsIHRpbWVzdGFtcCwgZnVlbCwgYm9vc3RlciwgaXNMZWdhY3lTaWduYXR1cmUsIHZlcmlmeWluZ0NvbnRyYWN0LCBzaWduZXI6IHsgcHJpdmF0ZUtleSB9IH06IHsgY3JlYXRvcjogc3RyaW5nLCBpZDogQk4sIHBycHNCZW5lZmljaWFyeTogc3RyaW5nOyBub25jZTogQk47IHRpbWVzdGFtcD86IG51bWJlciwgaXNMZWdhY3lTaWduYXR1cmU/OiBib29sZWFuOyBmdWVsPzogeyBkdWJpPzogQk4sIHVubG9ja2VkUHJwcz86IEJOLCBsb2NrZWRQcnBzPzogQk4sIGludHJpbnNpY0Z1ZWw/OiBCTiB9LCBib29zdGVyOiBzdHJpbmc7IHZlcmlmeWluZ0NvbnRyYWN0OiBzdHJpbmcsIHNpZ25lcjogeyBwcml2YXRlS2V5OiBzdHJpbmcgfTsgfSk6IFByb21pc2U8RUlQNzEyU2lnbmVkTWVzc2FnZT4gPT4ge1xuICAgIGNvbnN0IHR5cGVkRGF0YSA9IHtcbiAgICAgICAgdHlwZXM6IHtcbiAgICAgICAgICAgIEVJUDcxMkRvbWFpbixcbiAgICAgICAgICAgIEJvb3N0ZWRXaXRoZHJhd2FsLFxuICAgICAgICAgICAgQm9vc3RlckZ1ZWwsXG4gICAgICAgICAgICBCb29zdGVyUGF5bG9hZCxcbiAgICAgICAgfSBhcyBhbnksXG4gICAgICAgIGRvbWFpbjogY3JlYXRlRUlQNzEyRG9tYWluKFwiUHVycG9zZVwiLCB2ZXJpZnlpbmdDb250cmFjdCksXG4gICAgICAgIHByaW1hcnlUeXBlOiBcIkJvb3N0ZWRXaXRoZHJhd2FsXCIsXG4gICAgICAgIG1lc3NhZ2U6IHtcbiAgICAgICAgICAgIHRhZzogQm9vc3RUYWcuV2l0aGRyYXdhbCxcbiAgICAgICAgICAgIGNyZWF0b3IsXG4gICAgICAgICAgICBwcnBzQmVuZWZpY2lhcnksXG4gICAgICAgICAgICBpZDogaWQudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIGZ1ZWw6IHtcbiAgICAgICAgICAgICAgICBkdWJpOiAoZnVlbD8uZHViaSA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIHVubG9ja2VkUHJwczogKGZ1ZWw/LnVubG9ja2VkUHJwcyA/PyAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIGxvY2tlZFBycHM6IChmdWVsPy5sb2NrZWRQcnBzID8/IDApLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaW50cmluc2ljRnVlbDogKGZ1ZWw/LmludHJpbnNpY0Z1ZWwgPz8gMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib29zdGVyUGF5bG9hZDoge1xuICAgICAgICAgICAgICAgIGJvb3N0ZXIsXG4gICAgICAgICAgICAgICAgdGltZXN0YW1wOiB0aW1lc3RhbXAgPz8gYXdhaXQgYmxvY2tjaGFpblRpbWVzdGFtcFdpdGhPZmZzZXQod2ViMywgMCksXG4gICAgICAgICAgICAgICAgbm9uY2U6IG5vbmNlLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgaXNMZWdhY3lTaWduYXR1cmU6IChpc0xlZ2FjeVNpZ25hdHVyZSB8fCBmYWxzZSksXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgbWVzc2FnZTogdHlwZWREYXRhLm1lc3NhZ2UsXG4gICAgICAgIHNpZ25hdHVyZTogc2lnbkVJUDcxMih0eXBlZERhdGEsIHsgcHJpdmF0ZUtleSB9KSxcbiAgICAgICAgbWVzc2FnZUJ5dGVzOiBnZXRUeXBlZE1lc3NhZ2VCeXRlcyh3ZWIzLCB0eXBlZERhdGEpLFxuICAgICAgICBtZXNzYWdlSGFzaDogYDB4JHtUeXBlZERhdGFVdGlscy5zaWduKHR5cGVkRGF0YSkudG9TdHJpbmcoXCJoZXhcIil9YCxcbiAgICB9O1xufVxuXG4vLyBOT1RFOiBkb2luZyB0aGlzIGlzIGltcG9ydGFudCB0byBwcmV2ZW50IG1hbGxlYWJpbGl0eS4gU2VlIGhlcmU6XG4vLyBodHRwczovL2dpdGh1Yi5jb20vT3BlblplcHBlbGluL29wZW56ZXBwZWxpbi1jb250cmFjdHMvcHVsbC8xNjIyXG5leHBvcnQgY29uc3QgZml4U2lnbmF0dXJlID0gKHNpZ25hdHVyZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICBsZXQgdiA9IHBhcnNlSW50KHNpZ25hdHVyZS5zbGljZSgxMzAsIDEzMiksIDE2KTtcblxuICAgIGlmICh2IDwgMjcpIHtcbiAgICAgICAgdiArPSAyNztcbiAgICB9XG5cbiAgICBjb25zdCB2SGV4ID0gdi50b1N0cmluZygxNik7XG5cbiAgICByZXR1cm4gc2lnbmF0dXJlLnNsaWNlKDAsIDEzMCkgKyB2SGV4O1xufSJdfQ==