import { SMS_SIMULATE_SECRET } from '../../constants/api';
import { apiRequest } from './client';

type SimulateResponse = {
  success: boolean;
  message: string;
  txHash?: string;
};

export async function simulateSmsSettlement(smsBody: string): Promise<SimulateResponse> {
  return apiRequest<SimulateResponse>('/api/sms/simulate', {
    method: 'POST',
    body: JSON.stringify({
      text: smsBody,
      devSecret: SMS_SIMULATE_SECRET,
    }),
  });
}
