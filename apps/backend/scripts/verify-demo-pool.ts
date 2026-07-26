import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { verifyAllDemoPairs } from '../lib/demo/provisioning';

async function main() {
  const summary = await verifyAllDemoPairs();
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0 || summary.provisioning > 0) {
    process.exitCode = 1;
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
