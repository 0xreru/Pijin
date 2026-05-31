import { apiRequest } from './client';

type MerchantShortIdResponse = {
  success: boolean;
  data: {
    shortId: string;
  };
};

export async function getDefaultMerchantShortId(): Promise<string> {
  const result = await apiRequest<MerchantShortIdResponse>('/api/merchants/default-short-id');
  return result.data.shortId;
}
