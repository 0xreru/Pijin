import { prisma } from '@/lib/prisma';

async function main() {
  const settlements = await prisma.settlement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(settlements, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
