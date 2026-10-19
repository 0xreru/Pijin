/**
 * fund-wallet.ts
 *
 * Pays PHPC straight from the PHPC distributor account to one or more wallets,
 * bypassing the SEP-24 top-up flow. Use it to fund the treasury / tester
 * accounts while DEPOSIT_ENABLED=false.
 *
 * Dry-run by default: nothing is submitted unless --send is passed.
 *
 * Usage (from apps/backend):
 *   Single wallet:
 *     node --experimental-strip-types scripts/fund-wallet.ts <G_ADDRESS> <AMOUNT> [--send]
 *   Batch from CSV (header optional, lines are "address,amount"):
 *     node --experimental-strip-types scripts/fund-wallet.ts --csv testers.csv [--send]
 *
 * Every destination must already exist on the ledger and hold a PHPC trustline
 * (the app creates it on onboarding / restore). Destinations that do not are
 * reported and skipped, never partially paid.
 *
 * Env (read from apps/backend/.env): PHPC_ISSUER_PUBKEY, PHPC_DISTRIBUTOR_SECRET,
 * optional HORIZON_URL.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function cleanEnv(val?: string): string {
  return (val || '').trim().replace(/^['"]|['"]$/g, '');
}

const HORIZON_URL = cleanEnv(process.env.HORIZON_URL) || 'https://horizon-testnet.stellar.org';
const horizon = new Horizon.Server(HORIZON_URL);

/** Stellar allows at most 100 operations per transaction. */
const MAX_OPS_PER_TX = 100;

interface Payout {
  destination: string;
  amount: string;
}

function normalizeAmount(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid amount: "${raw}"`);
  return n.toFixed(7);
}

function parseArgs(argv: string[]): { payouts: Payout[]; send: boolean } {
  const send = argv.includes('--send');
  const args = argv.filter((a) => a !== '--send');

  const csvIdx = args.indexOf('--csv');
  const payouts: Payout[] = [];

  if (csvIdx !== -1) {
    const file = args[csvIdx + 1];
    if (!file) throw new Error('--csv requires a file path.');
    const lines = fs.readFileSync(path.resolve(file), 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const [address, amount] = line.split(',').map((s) => s.trim());
      if (!address || address.toLowerCase() === 'address') continue;
      payouts.push({ destination: address, amount: normalizeAmount(amount ?? '') });
    }
  } else {
    const [address, amount] = args;
    if (!address || !amount) {
      throw new Error('Usage: fund-wallet.ts <G_ADDRESS> <AMOUNT> [--send] | --csv <file> [--send]');
    }
    payouts.push({ destination: address, amount: normalizeAmount(amount) });
  }

  const seen = new Set<string>();
  for (const p of payouts) {
    if (!StrKey.isValidEd25519PublicKey(p.destination)) {
      throw new Error(`Invalid Stellar public key: ${p.destination}`);
    }
    if (seen.has(p.destination)) throw new Error(`Duplicate destination: ${p.destination}`);
    seen.add(p.destination);
  }
  if (payouts.length === 0) throw new Error('No payouts to process.');

  return { payouts, send };
}

async function hasPhpcTrustline(address: string, asset: Asset): Promise<boolean | null> {
  try {
    const account = await horizon.loadAccount(address);
    return account.balances.some(
      (b) =>
        b.asset_type !== 'native' &&
        'asset_code' in b &&
        b.asset_code === asset.getCode() &&
        b.asset_issuer === asset.getIssuer(),
    );
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 404) return null;
    throw err;
  }
}

async function main() {
  const { payouts, send } = parseArgs(process.argv.slice(2));

  const issuer = cleanEnv(process.env.PHPC_ISSUER_PUBKEY);
  const distributorSecret = cleanEnv(process.env.PHPC_DISTRIBUTOR_SECRET);
  if (!issuer || !distributorSecret) {
    throw new Error('PHPC_ISSUER_PUBKEY and PHPC_DISTRIBUTOR_SECRET must be set in apps/backend/.env');
  }

  const distributor = Keypair.fromSecret(distributorSecret);
  const phpc = new Asset('PHPC', issuer);

  console.log(`Horizon:     ${HORIZON_URL}`);
  console.log(`Distributor: ${distributor.publicKey()}`);
  console.log(`Mode:        ${send ? 'SEND' : 'DRY-RUN (pass --send to submit)'}\n`);

  // Pre-flight every destination so a bad row never produces a half-paid batch.
  const payable: Payout[] = [];
  for (const p of payouts) {
    const state = await hasPhpcTrustline(p.destination, phpc);
    if (state === null) {
      console.warn(`  ✗ ${p.destination}  account not found on ledger — skipped`);
    } else if (!state) {
      console.warn(`  ✗ ${p.destination}  no PHPC trustline — skipped`);
    } else {
      console.log(`  ✓ ${p.destination}  ${p.amount} PHPC`);
      payable.push(p);
    }
  }

  const skipped = payouts.length - payable.length;
  const total = payable.reduce((sum, p) => sum + Number(p.amount), 0);
  console.log(`\n${payable.length} payable, ${skipped} skipped, total ${total.toFixed(7)} PHPC`);

  if (!send || payable.length === 0) return;

  for (let i = 0; i < payable.length; i += MAX_OPS_PER_TX) {
    const chunk = payable.slice(i, i + MAX_OPS_PER_TX);
    const source = await horizon.loadAccount(distributor.publicKey());
    const builder = new TransactionBuilder(source, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    });
    for (const p of chunk) {
      builder.addOperation(
        Operation.payment({ destination: p.destination, asset: phpc, amount: p.amount }),
      );
    }
    const tx = builder.setTimeout(180).build();
    tx.sign(distributor);
    const result = await horizon.submitTransaction(tx);
    console.log(`  ✅ Submitted ${chunk.length} payment(s). Tx: ${result.hash}`);
  }
}

main().catch((err) => {
  const codes = (err as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response
    ?.data?.extras?.result_codes;
  console.error('❌', err instanceof Error ? err.message : err);
  if (codes) console.error('Horizon result_codes:', JSON.stringify(codes));
  process.exit(1);
});
