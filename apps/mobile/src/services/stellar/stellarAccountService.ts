import { Horizon, StrKey } from '@stellar/stellar-sdk';
import { STELLAR_HORIZON_MAINNET_URL } from '../../constants/network';

const horizonServer = new Horizon.Server(STELLAR_HORIZON_MAINNET_URL);

export type StellarBalance = {
  assetType: string;
  assetCode: string;
  assetIssuer?: string;
  balance: string;
};

export type StellarAccountSummary = {
  publicKey: string;
  exists: boolean;
  xlmBalance: string;
  balances: StellarBalance[];
};

export type StellarPaymentSummary = {
  id: string;
  title: string;
  subtitle: string;
  amount: string;
  assetCode: string;
  direction: 'incoming' | 'outgoing';
};

export async function getStellarAccountSummary(publicKey: string): Promise<StellarAccountSummary> {
  assertValidPublicKey(publicKey);

  try {
    const account = await horizonServer.loadAccount(publicKey);
    const balances = account.balances.map(toStellarBalance);
    const xlmBalance = balances.find((balance) => balance.assetType === 'native')?.balance ?? '0';

    return {
      publicKey,
      exists: true,
      xlmBalance,
      balances,
    };
  } catch (error) {
    if (isHorizonNotFound(error)) {
      return {
        publicKey,
        exists: false,
        xlmBalance: '0',
        balances: [],
      };
    }

    throw new Error(getErrorMessage(error, 'Unable to load Stellar account.'));
  }
}

export async function getRecentStellarPayments(
  publicKey: string,
  limit = 5
): Promise<StellarPaymentSummary[]> {
  assertValidPublicKey(publicKey);

  try {
    const page = await horizonServer.payments().forAccount(publicKey).order('desc').limit(limit).call();

    return page.records
      .filter(isPaymentRecord)
      .map((record) => {
        const direction = record.to === publicKey ? 'incoming' : 'outgoing';
        const assetCode = record.asset_type === 'native' ? 'XLM' : record.asset_code ?? 'ASSET';

        return {
          id: record.id,
          title: direction === 'incoming' ? `Received ${assetCode}` : `Sent ${assetCode}`,
          subtitle: formatPaymentDate(record.created_at),
          amount: record.amount,
          assetCode,
          direction,
        };
      });
  } catch (error) {
    if (isHorizonNotFound(error)) {
      return [];
    }

    throw new Error(getErrorMessage(error, 'Unable to load Stellar payments.'));
  }
}

function toStellarBalance(balance: Horizon.HorizonApi.BalanceLine): StellarBalance {
  if (balance.asset_type === 'native') {
    return {
      assetType: balance.asset_type,
      assetCode: 'XLM',
      balance: balance.balance,
    };
  }

  if ('asset_code' in balance) {
    return {
      assetType: balance.asset_type,
      assetCode: balance.asset_code,
      assetIssuer: balance.asset_issuer,
      balance: balance.balance,
    };
  }

  return {
    assetType: balance.asset_type,
    assetCode: 'LIQUIDITY_POOL_SHARES',
    balance: balance.balance,
  };
}

function isPaymentRecord(
  record: Horizon.ServerApi.PaymentOperationRecord | Horizon.ServerApi.CreateAccountOperationRecord | Horizon.ServerApi.AccountMergeOperationRecord | Horizon.ServerApi.PathPaymentOperationRecord | Horizon.ServerApi.PathPaymentStrictSendOperationRecord | Horizon.ServerApi.InvokeHostFunctionOperationRecord
): record is Horizon.ServerApi.PaymentOperationRecord {
  return record.type === 'payment';
}

function assertValidPublicKey(publicKey: string) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('Invalid Stellar public key.');
  }
}

function isHorizonNotFound(error: unknown) {
  return getNestedStatus(error) === 404;
}

function getNestedStatus(error: unknown): number | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  const response = error.response;
  if (!isObject(response)) {
    return undefined;
  }

  return typeof response.status === 'number' ? response.status : undefined;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (isObject(error) && typeof error.message === 'string' && error.message) {
    return error.message;
  }

  return fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatPaymentDate(createdAt: string) {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }

  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

