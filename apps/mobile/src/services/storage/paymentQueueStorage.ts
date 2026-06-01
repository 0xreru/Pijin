import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflinePaymentPayload } from '../../types/payment';

const STORAGE_KEY = 'abotpera.offline_payments_queue';

/**
 * Loads the current offline payments queue from persistent storage.
 */
export async function loadOfflinePaymentsQueue(): Promise<OfflinePaymentPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as OfflinePaymentPayload[];
  } catch (error) {
    console.error('[payment-queue-storage] failed to load queue:', error);
    return [];
  }
}

/**
 * Overwrites the entire offline payments queue in persistent storage.
 */
export async function saveOfflinePaymentsQueue(queue: OfflinePaymentPayload[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('[payment-queue-storage] failed to save queue:', error);
  }
}

/**
 * Appends a new offline payment payload to the front of the queue persistently.
 */
export async function appendToOfflinePaymentsQueue(
  payload: OfflinePaymentPayload
): Promise<OfflinePaymentPayload[]> {
  try {
    const queue = await loadOfflinePaymentsQueue();
    const updated = [payload, ...queue];
    await saveOfflinePaymentsQueue(updated);
    return updated;
  } catch (error) {
    console.error('[payment-queue-storage] failed to append to queue:', error);
    return [];
  }
}

/**
 * Clears the offline payments queue from persistent storage.
 */
export async function clearOfflinePaymentsQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[payment-queue-storage] failed to clear queue:', error);
  }
}
