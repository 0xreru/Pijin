/**
 * @deprecated V1 string-signing has been removed.
 *
 * All offline payment signing now goes through the canonical V2 XDR pipeline:
 *   buildOfflineSmsVoucher  (services/offline/buildSmsPayload.ts)
 *     → generateOfflineSmsPayload  (utils/crypto.ts)
 *
 * This file is kept as a thin re-export barrel so any legacy import paths
 * continue to resolve without build errors.
 */
export { generateOfflineSmsPayload } from '../../utils/crypto';
