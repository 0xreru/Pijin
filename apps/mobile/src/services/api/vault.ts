import { apiRequest } from './client';

type VaultBalanceResponse = {
  success: boolean;
  stellarPublicKey: string;
  shortId: string | null;
  balanceStroops: string;
  balancePHP: number;
  offlineBalancePHP?: number;
};

export async function getVaultBalance(params: {
  shortId?: string;
  stellarPublicKey?: string;
}): Promise<VaultBalanceResponse> {
  const query = new URLSearchParams();
  if (params.shortId) {
    query.set('shortId', params.shortId);
  } else if (params.stellarPublicKey) {
    query.set('stellarPublicKey', params.stellarPublicKey);
  } else {
    throw new Error('shortId or stellarPublicKey is required');
  }

  return apiRequest<VaultBalanceResponse>(`/api/vault-balance?${query.toString()}`);
}
