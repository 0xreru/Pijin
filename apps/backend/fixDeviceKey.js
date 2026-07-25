"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var stellar_sdk_1 = require("@stellar/stellar-sdk");
var prisma_1 = require("./lib/prisma");
var dotenv_1 = __importDefault(require("dotenv"));
var path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '.env') });
var _a = require('@stellar/stellar-sdk'), rpc = _a.rpc, xdr = _a.xdr, Contract = _a.Contract, Address = _a.Address, StrKey = _a.StrKey;
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var secretKey, kp, publicKey, account, server, horizonServer, sourceAccount, contractId, tokenId, contract, pubkeyRaw, pubkeyScVal, tx, simulation, sendRes, isConfirmed, i, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    secretKey = process.env.NEXT_PUBLIC_DEMO_SECRET_KEY;
                    if (!secretKey)
                        throw new Error("No NEXT_PUBLIC_DEMO_SECRET_KEY found in .env");
                    kp = stellar_sdk_1.Keypair.fromSecret(secretKey);
                    publicKey = kp.publicKey();
                    console.log("Fixing device key for account:", publicKey);
                    return [4 /*yield*/, prisma_1.prisma.account.findUnique({ where: { stellarPublicKey: publicKey } })];
                case 1:
                    account = _a.sent();
                    if (!account)
                        throw new Error("Account not found in DB");
                    // 1. Update Soroban Contract
                    console.log("Updating Soroban contract...");
                    server = new rpc.Server("https://soroban-testnet.stellar.org", { allowHttp: true });
                    horizonServer = new stellar_sdk_1.Horizon.Server("https://horizon-testnet.stellar.org");
                    return [4 /*yield*/, horizonServer.loadAccount(publicKey)];
                case 2:
                    sourceAccount = _a.sent();
                    contractId = process.env.CONTRACT_ID || "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
                    tokenId = process.env.TOKEN_ID || "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
                    contract = new Contract(contractId);
                    pubkeyRaw = StrKey.decodeEd25519PublicKey(publicKey);
                    pubkeyScVal = xdr.ScVal.scvBytes(Buffer.from(pubkeyRaw));
                    tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, { fee: "1000", networkPassphrase: stellar_sdk_1.Networks.TESTNET })
                        .addOperation(contract.call('set_offline_key', new Address(publicKey).toScVal(), new Address(tokenId).toScVal(), pubkeyScVal))
                        .setTimeout(180)
                        .build();
                    return [4 /*yield*/, server.simulateTransaction(tx)];
                case 3:
                    simulation = _a.sent();
                    if (rpc.Api.isSimulationError(simulation))
                        throw new Error("Simulation failed: ".concat(simulation.error));
                    tx = rpc.assembleTransaction(tx, simulation).build();
                    tx.sign(kp);
                    return [4 /*yield*/, server.sendTransaction(tx)];
                case 4:
                    sendRes = _a.sent();
                    if (sendRes.status === 'ERROR')
                        throw new Error("Transaction rejected by network.");
                    console.log("Waiting for ledger confirmation...");
                    isConfirmed = false;
                    i = 0;
                    _a.label = 5;
                case 5:
                    if (!(i < 15)) return [3 /*break*/, 9];
                    return [4 /*yield*/, server.getTransaction(sendRes.hash)];
                case 6:
                    response = _a.sent();
                    if (response.status === 'SUCCESS') {
                        isConfirmed = true;
                        return [3 /*break*/, 9];
                    }
                    return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 2000); })];
                case 7:
                    _a.sent();
                    _a.label = 8;
                case 8:
                    i++;
                    return [3 /*break*/, 5];
                case 9:
                    if (!isConfirmed)
                        throw new Error("Transaction timed out on ledger.");
                    // 2. Update DB
                    console.log("Updating DB...");
                    return [4 /*yield*/, prisma_1.prisma.account.update({
                            where: { stellarPublicKey: publicKey },
                            data: { offlineDeviceKey: publicKey }
                        })];
                case 10:
                    _a.sent();
                    console.log("Successfully fixed device key! The web simulator can now sign offline transfers.");
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(console.error).finally(function () { return process.exit(0); });
