import { Client, networks, rpc } from "@/lib/omnifi-sdk";

const sorobanRpcUrl =
  process.env.SOROBAN_RPC_URL ?? "https://rpc.lightsail.network";

const contractId = process.env.CONTRACT_ID ?? networks.unknown.contractId;

export const abotPeraContract = new Client({
  ...networks.unknown,
  contractId,
  rpcUrl: sorobanRpcUrl,
  publicKey: process.env.RELAYER_PUBLIC_KEY,
});

export const sorobanRpcServer = new rpc.Server(sorobanRpcUrl, {
  allowHttp: sorobanRpcUrl.startsWith("http://"),
});

export const contractConfig = {
  contractId,
  tokenId: process.env.TOKEN_ID ?? "",
  rpcUrl: sorobanRpcUrl,
  expiryBufferLedgers: Number.parseInt(
    process.env.OFFLINE_EXPIRY_LEDGERS ?? "300",
    10
  ),
};
