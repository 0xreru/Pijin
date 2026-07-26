export type DemoWithdrawRequest = {
  senderPublicKey: string;
  tokenAddress: string;
  amountStroops: string;
};

export function createDemoWithdrawRequest(
  senderPublicKey: string,
  tokenAddress: string,
  amountStroops: bigint,
): DemoWithdrawRequest {
  return {
    senderPublicKey,
    tokenAddress,
    amountStroops: amountStroops.toString(),
  };
}

export function demoWithdrawCanonicalMessage(
  request: DemoWithdrawRequest,
): string {
  return `withdraw:${request.senderPublicKey}:${request.amountStroops}`;
}
