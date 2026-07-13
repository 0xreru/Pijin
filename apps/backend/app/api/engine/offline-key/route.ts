import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import {
  Address,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';
import {
  contractConfig,
  pijinContract,
  sorobanRpcServer,
} from '@/lib/pijin-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authenticatedAccount(request: Request): string {
  const secret = process.env.SECRET_SEP10_JWT_SECRET;
  if (!secret) throw new Error('Server is missing SECRET_SEP10_JWT_SECRET');

  try {
    const header = request.headers.get('authorization');
    if (!header?.startsWith('Bearer ')) throw new Error('Unauthorized');
    const payload = jwt.verify(header.slice(7).trim(), secret, {
      algorithms: ['HS256'],
    });
    if (typeof payload !== 'object' || payload === null || typeof payload.sub !== 'string') {
      throw new Error('Unauthorized');
    }
    return payload.sub;
  } catch {
    throw new Error('Unauthorized');
  }
}

function validateDeviceKey(value: unknown): string {
  const publicKey = typeof value === 'string' ? value.trim() : '';
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('offlineDeviceKey must be a valid Ed25519 G-address');
  }
  return publicKey;
}

function rawDeviceKey(publicKey: string): Buffer {
  return Buffer.from(StrKey.decodeEd25519PublicKey(publicKey));
}

async function getOnChainKey(sender: string): Promise<Buffer | null> {
  const source = process.env.RELAYER_PUBLIC_KEY;
  if (!source) throw new Error('Server is missing RELAYER_PUBLIC_KEY');

  const read = await pijinContract.get_offline_key(
    { sender },
    { publicKey: source },
  );
  return read.result ? Buffer.from(read.result) : null;
}

function injectSourceAccountAuth(xdrBase64: string): string {
  const envelope = xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
  for (const op of envelope.v1().tx().operations()) {
    if (op.body().switch().name !== 'invokeHostFunction') continue;

    const invokeOp = op.body().invokeHostFunctionOp();
    const contractCall = invokeOp.hostFunction().invokeContract();
    const rootInvocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: contractCall.contractAddress(),
          functionName: contractCall.functionName(),
          args: contractCall.args(),
        }),
      ),
      subInvocations: [],
    });

    invokeOp.auth([
      new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation,
      }),
    ]);
  }
  return envelope.toXDR('base64');
}

async function buildRotationXdr(sender: string, deviceKey: Buffer): Promise<string> {
  const relayer = process.env.RELAYER_PUBLIC_KEY;
  if (!relayer) throw new Error('Server is missing RELAYER_PUBLIC_KEY');

  const assembled = await pijinContract.set_offline_key(
    { sender, pubkey: deviceKey },
    { publicKey: relayer },
  );
  if (!assembled.built) throw new Error('Soroban assembly produced no transaction');

  const withAuth = injectSourceAccountAuth(
    assembled.built.toEnvelope().toXDR('base64'),
  );
  const original = xdr.TransactionEnvelope.fromXDR(withAuth, 'base64').v1().tx();
  const senderAccount = await sorobanRpcServer.getAccount(sender);
  const rebuilt = new TransactionBuilder(senderAccount, {
    fee: original.fee().toString(),
    networkPassphrase: contractConfig.networkPassphrase,
  });

  for (const operation of original.operations()) rebuilt.addOperation(operation);
  rebuilt.setTimeout(300);

  if (assembled.simulation && 'transactionData' in assembled.simulation) {
    rebuilt.setSorobanData(assembled.simulation.transactionData.build());
  }

  return rebuilt.build().toEnvelope().toXDR('base64');
}

async function parseRequest(request: Request): Promise<{
  sender: string;
  publicKey: string;
  rawKey: Buffer;
}> {
  const sender = authenticatedAccount(request);
  const body = await request.json();
  const publicKey = validateDeviceKey(body?.offlineDeviceKey);

  const account = await prisma.account.findUnique({
    where: { stellarPublicKey: sender },
    select: { id: true },
  });
  if (!account) throw new Error('Authenticated account is not registered');

  return { sender, publicKey, rawKey: rawDeviceKey(publicKey) };
}

/** Prepare an authenticated key enrollment/rotation, or repair the DB mirror. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { sender, publicKey, rawKey } = await parseRequest(request);
    const onChainKey = await getOnChainKey(sender);

    if (onChainKey?.equals(rawKey)) {
      await prisma.account.update({
        where: { stellarPublicKey: sender },
        data: { offlineDeviceKey: publicKey },
      });
      return NextResponse.json({ status: 'synced' });
    }

    const xdrEnvelope = await buildRotationXdr(sender, rawKey);
    return NextResponse.json({ status: 'rotation_required', xdr: xdrEnvelope });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'Unauthorized' ? 401 : message.includes('valid Ed25519') ? 400 : 500;
    console.error('[OfflineKey:prepare]', message);
    return NextResponse.json({ error: message }, { status });
  }
}

/** Confirm chain state before copying the public device key into the database. */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const { sender, publicKey, rawKey } = await parseRequest(request);
    const onChainKey = await getOnChainKey(sender);
    if (!onChainKey?.equals(rawKey)) {
      return NextResponse.json(
        { error: 'The submitted device key is not confirmed on-chain' },
        { status: 409 },
      );
    }

    await prisma.account.update({
      where: { stellarPublicKey: sender },
      data: { offlineDeviceKey: publicKey },
    });
    return NextResponse.json({ status: 'synced' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'Unauthorized' ? 401 : message.includes('valid Ed25519') ? 400 : 500;
    console.error('[OfflineKey:confirm]', message);
    return NextResponse.json({ error: message }, { status });
  }
}
