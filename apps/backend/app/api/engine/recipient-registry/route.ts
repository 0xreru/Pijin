import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';
import { contractConfig, pijinContract } from '@/lib/pijin-contract';
import { shortIdToBuffer } from '@/lib/short-id';

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

function registrarKeypair(): Keypair {
  const secret = process.env.REGISTRAR_SECRET_KEY?.trim() || process.env.RELAYER_SECRET_KEY?.trim();
  if (!secret) throw new Error('Server is missing REGISTRAR_SECRET_KEY');

  const keypair = Keypair.fromSecret(secret);
  const configuredPublicKey = process.env.REGISTRAR_PUBLIC_KEY?.trim();
  if (configuredPublicKey && configuredPublicKey !== keypair.publicKey()) {
    throw new Error('REGISTRAR_PUBLIC_KEY does not match REGISTRAR_SECRET_KEY');
  }
  return keypair;
}

async function signWithRegistrar(
  xdr: string,
  signOpts?: { networkPassphrase?: string },
): Promise<{ signedTxXdr: string; signerAddress: string }> {
  const registrar = registrarKeypair();
  const transaction = TransactionBuilder.fromXDR(
    xdr,
    signOpts?.networkPassphrase ?? contractConfig.networkPassphrase,
  );
  transaction.sign(registrar);
  return {
    signedTxXdr: transaction.toXDR(),
    signerAddress: registrar.publicKey(),
  };
}

async function offlineConfig() {
  const gatewayPublicKey = process.env.RELAYER_PUBLIC_KEY?.trim();
  if (!gatewayPublicKey) throw new Error('Server is missing RELAYER_PUBLIC_KEY');

  const token = await prisma.token.findUnique({
    where: { symbol: process.env.OFFLINE_TOKEN_SYMBOL?.trim() || 'PHPC' },
    select: { id: true, symbol: true, contractId: true },
  });
  if (!token) throw new Error('Offline payment token is not configured');

  return {
    version: 1,
    contractId: contractConfig.contractId,
    gatewayPublicKey,
    tokenContractId: token.contractId,
    tokenDbId: String(token.id),
    tokenSymbol: token.symbol,
    networkPassphrase: contractConfig.networkPassphrase,
  };
}

/** Register the authenticated account's exact, case-sensitive short ID on-chain. */
export async function POST(request: Request): Promise<Response> {
  try {
    const stellarPublicKey = authenticatedAccount(request);
    const account = await prisma.account.findUnique({
      where: { stellarPublicKey },
      select: { shortId: true, stellarPublicKey: true },
    });
    if (!account) {
      return NextResponse.json({ error: 'Authenticated account is not registered' }, { status: 404 });
    }

    const registrar = registrarKeypair();
    const shortId = shortIdToBuffer(account.shortId);
    const configuredRegistrar = await pijinContract.get_registrar({
      publicKey: registrar.publicKey(),
    });
    if (!configuredRegistrar.result) {
      throw new Error('Contract registrar is not configured; run set_registrar after upgrading');
    }
    if (configuredRegistrar.result !== registrar.publicKey()) {
      throw new Error('Backend registrar does not match the registrar configured on-chain');
    }
    const existing = await pijinContract.get_recipient(
      { short_id: shortId },
      { publicKey: registrar.publicKey() },
    );

    if (existing.result && existing.result !== account.stellarPublicKey) {
      return NextResponse.json(
        { error: 'Short ID is already registered to a different Stellar address' },
        { status: 409 },
      );
    }

    let status = 'already_registered';
    let txHash: string | undefined;
    if (!existing.result) {
      const registration = await pijinContract.register_recipient(
        {
          registrar: registrar.publicKey(),
          short_id: shortId,
          receiver: account.stellarPublicKey,
        },
        { publicKey: registrar.publicKey() },
      );
      const submitted = await registration.signAndSend({ signTransaction: signWithRegistrar });
      txHash = submitted.sendTransactionResponse?.hash;
      status = 'registered';
    }

    return NextResponse.json({ status, txHash, offlineConfig: await offlineConfig() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'Unauthorized' ? 401 : 500;
    console.error('[RecipientRegistry]', message);
    return NextResponse.json({ error: message }, { status });
  }
}
