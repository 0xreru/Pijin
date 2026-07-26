import {
  DemoPairPurpose,
  DemoPairStatus,
  Prisma,
  type DemoAccountPair,
} from '@prisma/client';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';
import {
  contractConfig,
  pijinContract,
} from '@/lib/pijin-contract';
import { generateBase62Id, shortIdToBuffer } from '@/lib/short-id';
import { assertDemoTestnet, demoPoolConfig } from './config';
import {
  decryptDemoSecret,
  encryptDemoSecret,
  encryptionKeyFromEnv,
} from './secret-box';

const HORIZON_TESTNET_URL =
  process.env.STELLAR_HORIZON_TESTNET_URL?.trim() ||
  'https://horizon-testnet.stellar.org';
const horizon = new Horizon.Server(HORIZON_TESTNET_URL);
const BASE_FEE = '100';
const TX_TIMEOUT_SECONDS = 180;

type PairSecrets = {
  senderWallet: Keypair;
  receiverWallet: Keypair;
  senderDevice: Keypair;
  receiverDevice: Keypair;
};

type VerificationAccount = {
  publicKey: string;
  shortId: string;
  offlineDeviceKey: string;
};

export type DemoPoolSummary = {
  total: number;
  readyJudge: number;
  readyQa: number;
  leased: number;
  failed: number;
  provisioning: number;
  retired: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    error.response.status === 404
  );
}

async function loadAccountOrNull(publicKey: string) {
  try {
    return await horizon.loadAccount(publicKey);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function ensureFunded(keypair: Keypair): Promise<void> {
  if (await loadAccountOrNull(keypair.publicKey())) return;

  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(keypair.publicKey())}`,
    { cache: 'no-store' },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Friendbot funding failed (${response.status}): ${detail}`);
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await loadAccountOrNull(keypair.publicKey())) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Funded account ${keypair.publicKey()} was not visible in Horizon`);
}

function phpcAsset(): Asset {
  return new Asset('PHPC', requiredEnv('PHPC_ISSUER_PUBKEY'));
}

function findPhpcBalance(
  account: Awaited<ReturnType<typeof horizon.loadAccount>>,
): string | null {
  const issuer = requiredEnv('PHPC_ISSUER_PUBKEY');
  const balance = account.balances.find(
    (entry) =>
      entry.asset_type !== 'native' &&
      'asset_code' in entry &&
      entry.asset_code === 'PHPC' &&
      entry.asset_issuer === issuer,
  );
  return balance?.balance ?? null;
}

async function ensureTrustline(keypair: Keypair): Promise<void> {
  const account = await horizon.loadAccount(keypair.publicKey());
  if (findPhpcBalance(account) !== null) return;

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: phpcAsset() }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
  transaction.sign(keypair);
  await horizon.submitTransaction(transaction);
}

async function signWith(
  keypair: Keypair,
  xdr: string,
  options?: { networkPassphrase?: string },
): Promise<{ signedTxXdr: string; signerAddress: string }> {
  const transaction = TransactionBuilder.fromXDR(
    xdr,
    options?.networkPassphrase ?? contractConfig.networkPassphrase,
  );
  transaction.sign(keypair);
  return {
    signedTxXdr: transaction.toXDR(),
    signerAddress: keypair.publicKey(),
  };
}

async function ensureRecipientRegistered(
  shortId: string,
  publicKey: string,
): Promise<void> {
  const registrar = Keypair.fromSecret(requiredEnv('REGISTRAR_SECRET_KEY'));
  const expectedRegistrar = process.env.REGISTRAR_PUBLIC_KEY?.trim();
  if (expectedRegistrar && expectedRegistrar !== registrar.publicKey()) {
    throw new Error('REGISTRAR_PUBLIC_KEY does not match REGISTRAR_SECRET_KEY');
  }

  const configuredRegistrar = await pijinContract.get_registrar({
    publicKey: registrar.publicKey(),
  });
  if (configuredRegistrar.result !== registrar.publicKey()) {
    throw new Error('Configured Soroban registrar does not match the backend registrar');
  }

  const shortIdBytes = shortIdToBuffer(shortId);
  const existing = await pijinContract.get_recipient(
    { short_id: shortIdBytes },
    { publicKey: registrar.publicKey() },
  );
  if (existing.result === publicKey) return;
  if (existing.result) {
    throw new Error(`Short ID ${shortId} is registered to another Stellar account`);
  }

  const registration = await pijinContract.register_recipient(
    {
      registrar: registrar.publicKey(),
      short_id: shortIdBytes,
      receiver: publicKey,
    },
    { publicKey: registrar.publicKey() },
  );
  await registration.signAndSend({
    signTransaction: (xdr, options) => signWith(registrar, xdr, options),
  });
}

async function ensureOfflineKey(
  wallet: Keypair,
  device: Keypair,
): Promise<void> {
  const existing = await pijinContract.get_offline_key(
    { sender: wallet.publicKey() },
    { publicKey: wallet.publicKey() },
  );
  const rawDeviceKey = Buffer.from(
    StrKey.decodeEd25519PublicKey(device.publicKey()),
  );
  if (existing.result && Buffer.from(existing.result).equals(rawDeviceKey)) return;

  const rotation = await pijinContract.set_offline_key(
    {
      sender: wallet.publicKey(),
      pubkey: rawDeviceKey,
    },
    { publicKey: wallet.publicKey() },
  );
  await rotation.signAndSend({
    signTransaction: (xdr, options) => signWith(wallet, xdr, options),
  });
}

function newPairSecrets(): PairSecrets {
  return {
    senderWallet: Keypair.random(),
    receiverWallet: Keypair.random(),
    senderDevice: Keypair.random(),
    receiverDevice: Keypair.random(),
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function createPairRecord(
  purpose: DemoPairPurpose,
  secrets: PairSecrets,
): Promise<DemoAccountPair> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const senderAccount = await tx.account.create({
          data: {
            shortId: generateBase62Id(),
            role: 'USER',
            stellarPublicKey: secrets.senderWallet.publicKey(),
            offlineDeviceKey: secrets.senderDevice.publicKey(),
          },
        });
        const receiverAccount = await tx.account.create({
          data: {
            shortId: generateBase62Id(),
            role: 'USER',
            stellarPublicKey: secrets.receiverWallet.publicKey(),
            offlineDeviceKey: secrets.receiverDevice.publicKey(),
          },
        });

        return tx.demoAccountPair.create({
          data: {
            senderAccountId: senderAccount.id,
            receiverAccountId: receiverAccount.id,
            encryptedSenderWalletSecret: encryptDemoSecret(
              secrets.senderWallet.secret(),
            ),
            encryptedReceiverWalletSecret: encryptDemoSecret(
              secrets.receiverWallet.secret(),
            ),
            encryptedSenderDeviceSecret: encryptDemoSecret(
              secrets.senderDevice.secret(),
            ),
            encryptedReceiverDeviceSecret: encryptDemoSecret(
              secrets.receiverDevice.secret(),
            ),
            purpose,
            status: DemoPairStatus.PROVISIONING,
          },
        });
      });
    } catch (error) {
      if (!isUniqueConstraint(error) || attempt === 14) throw error;
    }
  }
  throw new Error('Could not allocate unique demo account identifiers');
}

function decryptPairSecrets(pair: DemoAccountPair): PairSecrets {
  return {
    senderWallet: Keypair.fromSecret(
      decryptDemoSecret(pair.encryptedSenderWalletSecret),
    ),
    receiverWallet: Keypair.fromSecret(
      decryptDemoSecret(pair.encryptedReceiverWalletSecret),
    ),
    senderDevice: Keypair.fromSecret(
      decryptDemoSecret(pair.encryptedSenderDeviceSecret),
    ),
    receiverDevice: Keypair.fromSecret(
      decryptDemoSecret(pair.encryptedReceiverDeviceSecret),
    ),
  };
}

async function verifyAccount(input: VerificationAccount): Promise<void> {
  const account = await horizon.loadAccount(input.publicKey);
  if (findPhpcBalance(account) === null) {
    throw new Error(`${input.publicKey} is missing the PHPC trustline`);
  }

  const recipient = await pijinContract.get_recipient(
    { short_id: shortIdToBuffer(input.shortId) },
    { publicKey: requiredEnv('RELAYER_PUBLIC_KEY') },
  );
  if (recipient.result !== input.publicKey) {
    throw new Error(`Recipient registry mismatch for ${input.shortId}`);
  }

  const offlineKey = await pijinContract.get_offline_key(
    { sender: input.publicKey },
    { publicKey: requiredEnv('RELAYER_PUBLIC_KEY') },
  );
  const expected = Buffer.from(
    StrKey.decodeEd25519PublicKey(input.offlineDeviceKey),
  );
  if (!offlineKey.result || !Buffer.from(offlineKey.result).equals(expected)) {
    throw new Error(`Offline key mismatch for ${input.shortId}`);
  }
}

export async function verifyDemoPair(pairId: string): Promise<void> {
  const pair = await prisma.demoAccountPair.findUnique({
    where: { id: pairId },
    include: { senderAccount: true, receiverAccount: true },
  });
  if (!pair) throw new Error(`Demo pair ${pairId} was not found`);

  const secrets = decryptPairSecrets(pair);
  if (secrets.senderWallet.publicKey() !== pair.senderAccount.stellarPublicKey) {
    throw new Error(`Sender secret does not match demo pair ${pairId}`);
  }
  if (secrets.receiverWallet.publicKey() !== pair.receiverAccount.stellarPublicKey) {
    throw new Error(`Receiver secret does not match demo pair ${pairId}`);
  }
  if (secrets.senderDevice.publicKey() !== pair.senderAccount.offlineDeviceKey) {
    throw new Error(`Sender device secret does not match demo pair ${pairId}`);
  }
  if (secrets.receiverDevice.publicKey() !== pair.receiverAccount.offlineDeviceKey) {
    throw new Error(`Receiver device secret does not match demo pair ${pairId}`);
  }

  await verifyAccount({
    publicKey: pair.senderAccount.stellarPublicKey,
    shortId: pair.senderAccount.shortId,
    offlineDeviceKey: pair.senderAccount.offlineDeviceKey ?? '',
  });
  await verifyAccount({
    publicKey: pair.receiverAccount.stellarPublicKey,
    shortId: pair.receiverAccount.shortId,
    offlineDeviceKey: pair.receiverAccount.offlineDeviceKey ?? '',
  });
}

async function provisionPair(pair: DemoAccountPair): Promise<void> {
  console.info(`[DemoPool] Provisioning ${pair.purpose.toLowerCase()} pair ${pair.id}`);
  const secrets = decryptPairSecrets(pair);
  const accounts = await prisma.demoAccountPair.findUniqueOrThrow({
    where: { id: pair.id },
    include: { senderAccount: true, receiverAccount: true },
  });

  await prisma.demoAccountPair.update({
    where: { id: pair.id },
    data: {
      status: DemoPairStatus.PROVISIONING,
      lastError: null,
    },
  });

  try {
    for (const wallet of [secrets.senderWallet, secrets.receiverWallet]) {
      await ensureFunded(wallet);
      await ensureTrustline(wallet);
    }

    await ensureRecipientRegistered(
      accounts.senderAccount.shortId,
      accounts.senderAccount.stellarPublicKey,
    );
    await ensureRecipientRegistered(
      accounts.receiverAccount.shortId,
      accounts.receiverAccount.stellarPublicKey,
    );
    await ensureOfflineKey(secrets.senderWallet, secrets.senderDevice);
    await ensureOfflineKey(secrets.receiverWallet, secrets.receiverDevice);

    await verifyDemoPair(pair.id);

    await prisma.demoAccountPair.update({
      where: { id: pair.id },
      data: {
        status: DemoPairStatus.READY,
        lastVerifiedAt: new Date(),
        lastError: null,
      },
    });
    console.info(`[DemoPool] Pair ${pair.id} is ready`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.demoAccountPair.update({
      where: { id: pair.id },
      data: {
        status: DemoPairStatus.FAILED,
        lastError: message.slice(0, 2_000),
      },
    });
    console.error(`[DemoPool] Pair ${pair.id} failed: ${message}`);
    throw error;
  }
}

async function ensurePurposeCount(
  purpose: DemoPairPurpose,
  target: number,
): Promise<void> {
  const repairable = await prisma.demoAccountPair.findMany({
    where: {
      purpose,
      status: {
        in: [DemoPairStatus.PROVISIONING, DemoPairStatus.FAILED],
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  for (const pair of repairable) {
    console.info(`[DemoPool] Resuming ${pair.status.toLowerCase()} pair ${pair.id}`);
    await provisionPair(pair);
  }

  const existing = await prisma.demoAccountPair.count({
    where: {
      purpose,
      status: { not: DemoPairStatus.RETIRED },
    },
  });
  for (let index = existing; index < target; index += 1) {
    console.info(
      `[DemoPool] Creating ${purpose.toLowerCase()} pair ${index + 1} of ${target}`,
    );
    const pair = await createPairRecord(purpose, newPairSecrets());
    await provisionPair(pair);
  }
}

export async function provisionDemoPool(options?: {
  targetPairs?: number;
  qaPairs?: number;
}): Promise<DemoPoolSummary> {
  assertDemoTestnet();
  encryptionKeyFromEnv();

  const defaults = demoPoolConfig();
  const targetPairs = options?.targetPairs ?? defaults.targetPairs;
  const qaPairs = options?.qaPairs ?? Math.min(defaults.qaPairs, targetPairs);
  if (!Number.isSafeInteger(targetPairs) || targetPairs <= 0) {
    throw new Error('targetPairs must be a positive integer');
  }
  if (!Number.isSafeInteger(qaPairs) || qaPairs < 0 || qaPairs > targetPairs) {
    throw new Error('qaPairs must be between zero and targetPairs');
  }

  await ensurePurposeCount(DemoPairPurpose.JUDGE, targetPairs - qaPairs);
  await ensurePurposeCount(DemoPairPurpose.QA, qaPairs);
  return demoPoolSummary();
}

export async function verifyAllDemoPairs(): Promise<DemoPoolSummary> {
  assertDemoTestnet();
  encryptionKeyFromEnv();

  const pairs = await prisma.demoAccountPair.findMany({
    where: { status: { not: DemoPairStatus.RETIRED } },
    orderBy: { createdAt: 'asc' },
  });

  for (const pair of pairs) {
    try {
      await verifyDemoPair(pair.id);
      await prisma.demoAccountPair.update({
        where: { id: pair.id },
        data: {
          status:
            pair.status === DemoPairStatus.LEASED
              ? DemoPairStatus.LEASED
              : DemoPairStatus.READY,
          lastVerifiedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.demoAccountPair.update({
        where: { id: pair.id },
        data: {
          status: DemoPairStatus.FAILED,
          lastError: message.slice(0, 2_000),
        },
      });
    }
  }
  return demoPoolSummary();
}

export async function demoPoolSummary(): Promise<DemoPoolSummary> {
  const grouped = await prisma.demoAccountPair.groupBy({
    by: ['purpose', 'status'],
    _count: { _all: true },
  });
  const count = (purpose: DemoPairPurpose | null, status: DemoPairStatus) =>
    grouped
      .filter((entry) => (!purpose || entry.purpose === purpose) && entry.status === status)
      .reduce((sum, entry) => sum + entry._count._all, 0);

  return {
    total: grouped.reduce((sum, entry) => sum + entry._count._all, 0),
    readyJudge: count(DemoPairPurpose.JUDGE, DemoPairStatus.READY),
    readyQa: count(DemoPairPurpose.QA, DemoPairStatus.READY),
    leased: count(null, DemoPairStatus.LEASED),
    failed: count(null, DemoPairStatus.FAILED),
    provisioning: count(null, DemoPairStatus.PROVISIONING),
    retired: count(null, DemoPairStatus.RETIRED),
  };
}
