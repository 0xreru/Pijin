/**
 * register-device-key.ts
 *
 * Soroban Smart Contract Device Key Registration Script
 * ──────────────────────────────────────────────────────────
 * Invokes `set_offline_key` on the Soroban smart contract to register or rotate
 * a user's offline device signing key in contract persistent storage.
 *
 * Target Contract ID: CBYRV2FDGXHMKQILP3EWYI4ILKKQ2HW4NW4NJCFYQY6NEE7463ARLNUD
 *
 * Usage:
 *   USER_SECRET_KEY=S... DEVICE_PUBLIC_KEY=G... node --experimental-strip-types scripts/register-device-key.ts
 *   or:
 *   node --experimental-strip-types scripts/register-device-key.ts <USER_SECRET_KEY> [DEVICE_PUBLIC_KEY]
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  Address,
  Contract,
  Keypair,
  Networks,
  rpc,
  scValToNative,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 0. Load Environment Variables ───────────────────────────────────────────

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function cleanEnv(val?: string): string {
  return (val || '').trim().replace(/^['"]|['"]$/g, '');
}

// ─── 1. Configuration & Input Resolution ─────────────────────────────────────

const CONTRACT_ID =
  cleanEnv(process.env.CONTRACT_ID) ||
  'CBYRV2FDGXHMKQILP3EWYI4ILKKQ2HW4NW4NJCFYQY6NEE7463ARLNUD';

const SOROBAN_RPC_URL =
  cleanEnv(process.env.SOROBAN_RPC_URL) || 'https://soroban-testnet.stellar.org';

const NETWORK_PASSPHRASE =
  cleanEnv(process.env.STELLAR_NETWORK_PASSPHRASE) || Networks.TESTNET;

// Parse CLI arguments if provided
const args = process.argv.slice(2);
let cliUserSecret: string | undefined;
let cliDevicePublic: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--secret' || args[i] === '-s') {
    cliUserSecret = args[++i];
  } else if (args[i] === '--device' || args[i] === '-d') {
    cliDevicePublic = args[++i];
  } else if (!cliUserSecret && args[i].startsWith('S')) {
    cliUserSecret = args[i];
  } else if (!cliDevicePublic && args[i].startsWith('G')) {
    cliDevicePublic = args[i];
  }
}

const rawUserSecretKey =
  cliUserSecret || cleanEnv(process.env.USER_SECRET_KEY);

const rawDevicePublicKey =
  cliDevicePublic ||
  cleanEnv(process.env.DEVICE_PUBLIC_KEY) ||
  'GC57ICXVFPAXQ64N2J5AP762LUIYB43EIVDOW57OMTAYGDQI5FNGUHG4';

const TARGET_USER_PUBLIC_KEY = 'GCJZII6CVXDDJTCVZT36R7VGWDB7DP644JE5W7DSLA3C6RMEHA33UJRQ';

// ─── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🔑 Soroban Device Key Registration (set_offline_key)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  • Target Contract ID:   ${CONTRACT_ID}`);
  console.log(`  • Soroban RPC URL:      ${SOROBAN_RPC_URL}`);
  console.log(`  • Network Passphrase:   ${NETWORK_PASSPHRASE}`);
  console.log(`  • Device Public Key:    ${rawDevicePublicKey}`);

  // Validate User Secret Key input
  if (!rawUserSecretKey) {
    console.error('\n❌ ERROR: Missing USER_SECRET_KEY.');
    console.error('\nPlease provide the secret key for the main account (GCJZII6CVXDDJTCVZT36R7VGWDB7DP644JE5W7DSLA3C6RMEHA33UJRQ):');
    console.error('  Example:');
    console.error('    USER_SECRET_KEY="S..." DEVICE_PUBLIC_KEY="GC57..." node --experimental-strip-types scripts/register-device-key.ts');
    console.error('  Or:');
    console.error('    node --experimental-strip-types scripts/register-device-key.ts "S..." "GC57..."');
    process.exit(1);
  }

  let userKeypair: Keypair;
  try {
    userKeypair = Keypair.fromSecret(rawUserSecretKey);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ ERROR: Invalid Stellar secret key provided: ${msg}`);
    process.exit(1);
  }

  const userPublicKey = userKeypair.publicKey();
  console.log(`  • User Main Public Key: ${userPublicKey}`);

  if (userPublicKey === TARGET_USER_PUBLIC_KEY) {
    console.log('  ✅ Verified: User key matches target account GCJZII6CVXDDJTCVZT36R7VGWDB7DP644JE5W7DSLA3C6RMEHA33UJRQ.');
  } else {
    console.warn(`  ℹ️ Notice: Signing account (${userPublicKey}) differs from reference target (${TARGET_USER_PUBLIC_KEY}).`);
  }

  // Validate Device Public Key
  if (!StrKey.isValidEd25519PublicKey(rawDevicePublicKey)) {
    console.error(`\n❌ ERROR: Invalid DEVICE_PUBLIC_KEY: "${rawDevicePublicKey}". Must be a valid Stellar G... address.`);
    process.exit(1);
  }

  const rawDeviceKeyBytes = Buffer.from(StrKey.decodeEd25519PublicKey(rawDevicePublicKey));
  if (rawDeviceKeyBytes.length !== 32) {
    console.error(`\n❌ ERROR: Decoded device key length is ${rawDeviceKeyBytes.length} bytes (expected 32).`);
    process.exit(1);
  }

  const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: SOROBAN_RPC_URL.startsWith('http://') });
  const contract = new Contract(CONTRACT_ID);

  // ─── 2. Query Current On-Chain Key ──────────────────────────────────────────
  console.log('\n[1/5] Checking existing registered key in contract storage...');
  try {
    const readOp = contract.call('get_offline_key', new Address(userPublicKey).toScVal());
    const dummyAccount = await server.getAccount(userPublicKey);
    const readTx = new TransactionBuilder(dummyAccount, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(readOp)
      .setTimeout(30)
      .build();

    const simRead = await server.simulateTransaction(readTx);
    if (!rpc.Api.isSimulationError(simRead) && simRead.result?.retval) {
      const currentBuf = scValToNative(simRead.result.retval) as Buffer | null;
      if (currentBuf && currentBuf.length === 32) {
        const currentGAddr = StrKey.encodeEd25519PublicKey(currentBuf);
        console.log(`  • Current On-Chain Key: ${currentGAddr}`);
        if (currentGAddr === rawDevicePublicKey) {
          console.log('  ✅ Device key is ALREADY registered in the contract storage.');
        } else {
          console.log(`  🔄 Key rotation required (${currentGAddr} → ${rawDevicePublicKey}).`);
        }
      } else {
        console.log('  • Current On-Chain Key: None (not yet registered).');
      }
    } else {
      console.log('  • Current On-Chain Key: None or not found.');
    }
  } catch (err) {
    console.log('  • Could not query existing key (account may be fresh or RPC latency); proceeding to register.');
  }

  // ─── 3. Build set_offline_key Transaction ───────────────────────────────────
  console.log('\n[2/5] Building set_offline_key transaction...');
  const sourceAccount = await server.getAccount(userPublicKey);
  console.log(`  • Source Sequence Number: ${sourceAccount.sequenceNumber()}`);

  const setOfflineKeyOp = contract.call(
    'set_offline_key',
    new Address(userPublicKey).toScVal(),
    xdr.ScVal.scvBytes(rawDeviceKeyBytes),
  );

  const unsignedTx = new TransactionBuilder(sourceAccount, {
    fee: '1000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(setOfflineKeyOp)
    .setTimeout(300)
    .build();

  // ─── 4. Simulate Transaction ────────────────────────────────────────────────
  console.log('\n[3/5] Simulating transaction on Soroban RPC...');
  const simulation = await server.simulateTransaction(unsignedTx);

  if (rpc.Api.isSimulationError(simulation)) {
    console.error('\n❌ SIMULATION FAILED:');
    console.error(`  Error: ${simulation.error}`);
    process.exit(1);
  }

  const minResourceFee = simulation.minResourceFee ?? '0';
  const authCount = simulation.result?.auth?.length ?? 0;
  console.log(`  ✅ Simulation successful!`);
  console.log(`  • Min Resource Fee: ${minResourceFee} stroops`);
  console.log(`  • Soroban Auth Entries Generated: ${authCount}`);

  // ─── 5. Assemble, Sign & Submit ─────────────────────────────────────────────
  console.log('\n[4/5] Assembling, signing, and submitting transaction...');
  const assembledTx = rpc.assembleTransaction(unsignedTx, simulation).build();

  // Sign with the user's secret key (satisfies require_auth for sender)
  assembledTx.sign(userKeypair);

  const sendResponse = await server.sendTransaction(assembledTx);
  console.log(`  • Submission Status: ${sendResponse.status}`);
  console.log(`  • Transaction Hash:  ${sendResponse.hash}`);

  if (sendResponse.status === 'ERROR') {
    console.error('\n❌ TRANSACTION SUBMISSION REJECTED:');
    console.error(JSON.stringify(sendResponse, null, 2));
    process.exit(1);
  }

  const txHash = sendResponse.hash;

  // Poll for confirmation
  console.log('\n[5/5] Polling for on-chain confirmation...');
  let confirmed = false;
  const maxAttempts = 20;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const txResponse = await server.getTransaction(txHash);

    if (txResponse.status === 'SUCCESS') {
      console.log(`\n🎉 TRANSACTION CONFIRMED ON LEDGER!`);
      console.log(`  • Ledger Number: ${txResponse.latestLedger}`);
      console.log(`  • Transaction Hash: ${txHash}`);
      confirmed = true;
      break;
    } else if (txResponse.status === 'FAILED') {
      console.error(`\n❌ TRANSACTION FAILED ON-CHAIN:`);
      console.error(JSON.stringify(txResponse, null, 2));
      process.exit(1);
    } else {
      process.stdout.write(`  Attempt ${attempt}/${maxAttempts}: status = ${txResponse.status}\r`);
    }
  }

  if (!confirmed) {
    throw new Error('Transaction polling timed out after 30 seconds.');
  }

  // ─── 6. Verify Registration on Chain ────────────────────────────────────────
  console.log('\nVerifying on-chain storage with get_offline_key...');
  try {
    const verifySource = await server.getAccount(userPublicKey);
    const verifyTx = new TransactionBuilder(verifySource, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('get_offline_key', new Address(userPublicKey).toScVal()))
      .setTimeout(30)
      .build();

    const verifySim = await server.simulateTransaction(verifyTx);
    if (!rpc.Api.isSimulationError(verifySim) && verifySim.result?.retval) {
      const storedBuf = scValToNative(verifySim.result.retval) as Buffer;
      const storedGAddress = StrKey.encodeEd25519PublicKey(storedBuf);
      console.log(`  • Confirmed Stored Key: ${storedGAddress}`);

      if (storedGAddress === rawDevicePublicKey) {
        console.log('\n✅ VERIFICATION COMPLETE: Device key is successfully registered in Soroban contract storage!');
        console.log('   Offline payment vouchers signed by this device will now pass spend_offline verification.');
      } else {
        console.warn(`\n⚠️ Mismatch: Stored key (${storedGAddress}) does not match expected (${rawDevicePublicKey}).`);
      }
    }
  } catch (verifyErr) {
    console.warn('  ⚠️ Note: Could not perform final read verification:', verifyErr);
  }

  // ─── 7. Synchronize Backend Database (Optional Mirror) ──────────────────────
  const dbUrl = cleanEnv(process.env.DATABASE_URL);
  if (dbUrl) {
    try {
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
      await prisma.account.updateMany({
        where: { stellarPublicKey: userPublicKey },
        data: { offlineDeviceKey: rawDevicePublicKey },
      });
      console.log('  • Synced offlineDeviceKey in PostgreSQL database mirror.');
      await prisma.$disconnect();
    } catch {
      // Non-critical mirror update
    }
  }
}

main().catch((err) => {
  console.error('\n❌ UNHANDLED SCRIPT ERROR:');
  console.error(err);
  process.exit(1);
});
