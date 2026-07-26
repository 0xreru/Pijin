import { DemoPairPurpose, DemoPairStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { demoPoolConfig } from './config';
import {
  decryptDemoSecret,
  hashDemoSessionId,
  validateDemoSessionId,
} from './secret-box';

const pairWithAccounts = Prisma.validator<Prisma.DemoAccountPairDefaultArgs>()({
  include: {
    senderAccount: true,
    receiverAccount: true,
  },
});

type PairWithAccounts = Prisma.DemoAccountPairGetPayload<typeof pairWithAccounts>;

export type DemoSessionAccount = {
  publicKey: string;
  shortId: string;
  walletSecret: string;
  deviceSecret: string;
  devicePublicKey: string;
};

export type DemoSessionPayload = {
  sessionId: string;
  pairId: string;
  expiresAt: string;
  sender: DemoSessionAccount;
  receiver: DemoSessionAccount;
};

function sessionPayload(
  sessionId: string,
  pair: PairWithAccounts,
): DemoSessionPayload {
  if (!pair.expiresAt) throw new Error('Leased demo pair has no expiration time');

  return {
    sessionId,
    pairId: pair.id,
    expiresAt: pair.expiresAt.toISOString(),
    sender: {
      publicKey: pair.senderAccount.stellarPublicKey,
      shortId: pair.senderAccount.shortId,
      walletSecret: decryptDemoSecret(pair.encryptedSenderWalletSecret),
      deviceSecret: decryptDemoSecret(pair.encryptedSenderDeviceSecret),
      devicePublicKey: pair.senderAccount.offlineDeviceKey ?? '',
    },
    receiver: {
      publicKey: pair.receiverAccount.stellarPublicKey,
      shortId: pair.receiverAccount.shortId,
      walletSecret: decryptDemoSecret(pair.encryptedReceiverWalletSecret),
      deviceSecret: decryptDemoSecret(pair.encryptedReceiverDeviceSecret),
      devicePublicKey: pair.receiverAccount.offlineDeviceKey ?? '',
    },
  };
}

export async function claimDemoPair(rawSessionId: unknown): Promise<DemoSessionPayload> {
  const sessionId = validateDemoSessionId(rawSessionId);
  const claimedByHash = hashDemoSessionId(sessionId);
  const expiresAt = new Date(
    Date.now() + demoPoolConfig().sessionTtlHours * 60 * 60 * 1000,
  );

  const pair = await prisma.$transaction(async (tx) => {
    // Serialize duplicate requests for the same browser session while allowing
    // unrelated judges to lease different rows concurrently.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${claimedByHash}))
    `;

    const existing = await tx.demoAccountPair.findUnique({
      where: { claimedByHash },
      ...pairWithAccounts,
    });
    if (existing) return existing;

    const available = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "demo_account_pair"
      WHERE "purpose" = CAST(${DemoPairPurpose.JUDGE} AS "DemoPairPurpose")
        AND "status" = CAST(${DemoPairStatus.READY} AS "DemoPairStatus")
      ORDER BY "created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const selected = available[0];
    if (!selected) throw new DemoPoolExhaustedError();

    return tx.demoAccountPair.update({
      where: { id: selected.id },
      data: {
        status: DemoPairStatus.LEASED,
        claimedByHash,
        claimedAt: new Date(),
        expiresAt,
      },
      ...pairWithAccounts,
    });
  });

  return sessionPayload(sessionId, pair);
}

export async function getClaimedDemoPair(
  rawSessionId: unknown,
): Promise<DemoSessionPayload> {
  const sessionId = validateDemoSessionId(rawSessionId);
  const claimedByHash = hashDemoSessionId(sessionId);
  const pair = await prisma.demoAccountPair.findUnique({
    where: { claimedByHash },
    ...pairWithAccounts,
  });
  if (
    !pair ||
    pair.status !== DemoPairStatus.LEASED ||
    !pair.expiresAt ||
    pair.expiresAt.getTime() <= Date.now()
  ) {
    throw new Error('Demo session is missing or expired');
  }
  return sessionPayload(sessionId, pair);
}

export async function retireDemoPair(rawSessionId: unknown): Promise<void> {
  const sessionId = validateDemoSessionId(rawSessionId);
  const claimedByHash = hashDemoSessionId(sessionId);

  await prisma.demoAccountPair.updateMany({
    where: {
      claimedByHash,
      status: DemoPairStatus.LEASED,
    },
    data: {
      status: DemoPairStatus.RETIRED,
      expiresAt: new Date(),
    },
  });
}

export class DemoPoolExhaustedError extends Error {
  constructor() {
    super('All demo sessions are currently in use');
    this.name = 'DemoPoolExhaustedError';
  }
}
