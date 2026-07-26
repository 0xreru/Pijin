import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { provisionDemoPool } from '../lib/demo/provisioning';

function integerArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

async function main() {
  const summary = await provisionDemoPool({
    targetPairs: integerArg('target-pairs'),
    qaPairs: integerArg('qa-pairs'),
  });
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
