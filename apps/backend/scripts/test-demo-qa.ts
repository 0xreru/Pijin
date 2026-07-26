import 'dotenv/config';
import assert from 'node:assert/strict';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { DemoPairPurpose, DemoPairStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decryptDemoSecret } from '../lib/demo/secret-box';
import { burnPHPC } from '../app/demo/actions';
import { generateOfflineSmsPayload } from '../app/demo/utils/crypto';
import { processOfflineSettlement } from '../lib/settlement';

const horizon = new Horizon.Server(
  process.env.STELLAR_HORIZON_TESTNET_URL?.trim() ||
    'https://horizon-testnet.stellar.org',
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const pair = await prisma.demoAccountPair.findFirstOrThrow({
    where: {
      purpose: DemoPairPurpose.QA,
      status: DemoPairStatus.READY,
    },
    include: {
      senderAccount: true,
      receiverAccount: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const senderWallet = Keypair.fromSecret(
    decryptDemoSecret(pair.encryptedSenderWalletSecret),
  );
  const senderDeviceSecret = decryptDemoSecret(
    pair.encryptedSenderDeviceSecret,
  );
  const issuer = requiredEnv('PHPC_ISSUER_PUBKEY');
  const asset = new Asset('PHPC', issuer);

  const source = await horizon.loadAccount(senderWallet.publicKey());
  const onlineTransaction = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: pair.receiverAccount.stellarPublicKey,
        asset,
        amount: '0.01',
      }),
    )
    .setTimeout(180)
    .build();
  onlineTransaction.sign(senderWallet);
  const onlineResult = await horizon.submitTransaction(onlineTransaction);
  assert.equal(onlineResult.successful, true);

  const deposit = await burnPHPC(
    pair.senderAccount.stellarPublicKey,
    '5',
    senderWallet.secret(),
    pair.senderAccount.offlineDeviceKey ?? '',
  );
  assert.equal(deposit.success, true, deposit.error);

  const token = await prisma.token.findUniqueOrThrow({
    where: { symbol: 'PHPC' },
  });
  const voucher = await generateOfflineSmsPayload({
    senderSecretKey: senderDeviceSecret,
    senderShortId: pair.senderAccount.shortId,
    receiverShortId: pair.receiverAccount.shortId,
    amountStroops: 10_000_000n,
    gatewayPubKey: requiredEnv('RELAYER_PUBLIC_KEY'),
    tokenContractId: token.contractId,
    tokenSymbol: token.symbol,
    tokenIdStr: token.id.toString(),
  });
  const offlineResult = await processOfflineSettlement({
    smsContent: voucher.smsPayload,
  });
  assert.equal(offlineResult.ok, true, offlineResult.ok ? undefined : offlineResult.error);

  console.log(
    JSON.stringify(
      {
        qaPairId: pair.id,
        onlineTransfer: {
          successful: true,
          hash: onlineResult.hash,
        },
        offlineDeposit: {
          successful: true,
          hash: deposit.hash,
        },
        offlineSettlement: {
          successful: true,
          hash: offlineResult.ok ? offlineResult.txHash : undefined,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
