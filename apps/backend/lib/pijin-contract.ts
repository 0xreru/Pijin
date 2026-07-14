import * as PijinClient from "pijin_core";
import { rpc } from "@stellar/stellar-sdk";

const sorobanRpcUrl =
  process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

const contractId = process.env.CONTRACT_ID?.trim();
if (!contractId) {
  throw new Error(
    "Missing CONTRACT_ID. Refusing to fall back to an arbitrary deployed contract.",
  );
}

const networkPassphrase =
  process.env.STELLAR_NETWORK_PASSPHRASE ??
  PijinClient.networks.testnet.networkPassphrase;

export const pijinContract = new PijinClient.Client({
  contractId,
  networkPassphrase,
  rpcUrl: sorobanRpcUrl,
  publicKey: process.env.RELAYER_PUBLIC_KEY,
});

export const sorobanRpcServer = new rpc.Server(sorobanRpcUrl, {
  allowHttp: sorobanRpcUrl.startsWith("http://"),
});

export const contractConfig = {
  contractId,
  networkPassphrase,
  tokenId: process.env.TOKEN_ID ?? "",
  rpcUrl: sorobanRpcUrl,
  expiryBufferLedgers: Number.parseInt(
    process.env.OFFLINE_EXPIRY_LEDGERS ?? "300",
    10
  ),
};
