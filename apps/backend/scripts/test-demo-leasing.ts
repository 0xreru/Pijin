import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DemoPairStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { claimDemoPair } from '../lib/demo/pool';

const CONCURRENT_JUDGES = 10;

async function main() {
  const sessionIds = Array.from(
    { length: CONCURRENT_JUDGES },
    () => randomUUID(),
  );
  const claimedPairIds: string[] = [];

  try {
    const sessions = await Promise.all(sessionIds.map(claimDemoPair));
    claimedPairIds.push(...sessions.map((session) => session.pairId));

    assert.equal(new Set(claimedPairIds).size, CONCURRENT_JUDGES);
    assert.equal(
      new Set(
        sessions.flatMap((session) => [
          session.sender.publicKey,
          session.receiver.publicKey,
        ]),
      ).size,
      CONCURRENT_JUDGES * 2,
    );

    const repeated = await claimDemoPair(sessionIds[0]);
    assert.equal(repeated.pairId, sessions[0].pairId);

    console.log(
      JSON.stringify(
        {
          concurrentJudges: CONCURRENT_JUDGES,
          uniquePairs: new Set(claimedPairIds).size,
          uniqueAccounts: new Set(
            sessions.flatMap((session) => [
              session.sender.publicKey,
              session.receiver.publicKey,
            ]),
          ).size,
          idempotentRetry: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (claimedPairIds.length > 0) {
      await prisma.demoAccountPair.updateMany({
        where: {
          id: { in: claimedPairIds },
          status: DemoPairStatus.LEASED,
        },
        data: {
          status: DemoPairStatus.READY,
          claimedByHash: null,
          claimedAt: null,
          expiresAt: null,
        },
      });
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
