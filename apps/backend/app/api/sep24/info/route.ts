/**
 * @swagger
 * /api/sep24/info:
 *   get:
 *     tags:
 *       - Anchor (SEP-24)
 *     summary: SEP-24 anchor capability advertisement
 *     description: |
 *       Returns the anchor's public capability manifest per the
 *       [SEP-24 /info spec](https://stellar.org/protocol/sep-24#info).
 *
 *       Wallets and clients **must** call this endpoint first to discover which assets
 *       are supported for deposit/withdrawal, any min/max amounts, and whether
 *       fee disclosure is enabled.
 *
 *       **This endpoint is intentionally unauthenticated** — it is a public discovery
 *       document analogous to the `stellar.toml` file but specific to SEP-24.
 *
 *       **Currently supported assets:** `PHPC`, `USDC` (both deposit and withdrawal).
 *       Fee disclosure is disabled (`fee.enabled: false`) — fees are shown inside
 *       the interactive webview.
 *     responses:
 *       '200':
 *         description: Capability manifest returned successfully.
 *         headers:
 *           Access-Control-Allow-Origin:
 *             schema: { type: string, example: '*' }
 *           Cache-Control:
 *             schema: { type: string, example: 'public, max-age=300, stale-while-revalidate=60' }
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deposit:
 *                   type: object
 *                   description: Map of asset codes to deposit configuration.
 *                   example:
 *                     PHPC: { enabled: true }
 *                     USDC: { enabled: true }
 *                 withdraw:
 *                   type: object
 *                   description: Map of asset codes to withdrawal configuration.
 *                   example:
 *                     PHPC: { enabled: true }
 *                     USDC: { enabled: true }
 *                 fee:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                       example: false
 */

/**
 * @file app/api/sep24/info/route.ts
 *
 * SEP-24: Hosted Deposit and Withdrawal — /info Endpoint
 * ───────────────────────────────────────────────────────
 * Spec: https://stellar.org/protocol/sep-24#info
 *
 * The /info endpoint is the public capability advertisement for this anchor.
 * Wallets and clients MUST call this endpoint first to discover which assets
 * are supported, what fields are required, and whether fees apply.
 *
 * This endpoint is intentionally unauthenticated — it's a public discovery
 * document, analogous to the stellar.toml file but specific to SEP-24.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  GET /api/sep24/info  →  200 OK  (SEP-24 info object)                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Supported assets
 * ────────────────
 * PHPC — Philippine Peso Coin (Pijin native stablecoin)
 * USDC — USD Coin (Circle, bridged via Stellar SAC)
 *
 * Extending this endpoint
 * ───────────────────────
 * To add a new asset, add its code to both `deposit` and `withdraw` maps.
 * To enable fee disclosure, set `fee.enabled: true` and implement
 * GET /api/sep24/fee per the spec.
 */

// ── Runtime ──────────────────────────────────────────────────────────────────
// Must be Node.js — not Edge — to ensure consistency with other SEP routes
// that use crypto/jwt dependencies unavailable in the Edge runtime.
export const runtime = 'nodejs';

// ── Imports ───────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Describes a single asset entry in the SEP-24 /info response.
 * Additional fields (min_amount, max_amount, fee_fixed, etc.) can be added
 * here as the anchor's fee/limit configuration matures.
 */
interface AssetInfo {
  /** Whether this asset is currently accepting deposits/withdrawals. */
  enabled: boolean;
  /**
   * Minimum amount the user can deposit/withdraw, in asset units.
   * Omit to signal no minimum.
   */
  min_amount?: number;
  /**
   * Maximum amount the user can deposit/withdraw, in asset units.
   * Omit to signal no maximum.
   */
  max_amount?: number;
}

/** Top-level SEP-24 /info response shape. */
interface Sep24InfoResponse {
  deposit: Record<string, AssetInfo>;
  withdraw: Record<string, AssetInfo>;
  fee: { enabled: boolean };
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/sep24/info
 *
 * Returns the anchor's SEP-24 capability manifest.
 * No authentication is required — this is a public endpoint.
 */
export async function GET(): Promise<Response> {
  const infoResponse: Sep24InfoResponse = {
    // ── Deposit capabilities ──────────────────────────────────────────────
    // Each key is an ISO 4217 or Stellar asset code the anchor accepts as a
    // deposit request.  Wallets display this list to the end user.
    deposit: {
      PHPC: {
        enabled: true,
        // min_amount: 10,     // Uncomment and configure per business rules
        // max_amount: 50000,
      },
      USDC: {
        enabled: true,
      },
    },

    // ── Withdrawal capabilities ───────────────────────────────────────────
    // Mirror of deposit — assets for which the anchor can execute withdrawals
    // (on-chain → fiat / off-chain).
    withdraw: {
      PHPC: {
        enabled: true,
      },
      USDC: {
        enabled: true,
      },
    },

    // ── Fee disclosure ────────────────────────────────────────────────────
    // Set `enabled: true` and implement GET /api/sep24/fee when the anchor
    // is ready to expose fee estimates programmatically.  Until then, fees
    // are disclosed inside the interactive webview UI.
    fee: {
      enabled: false,
    },
  };

  // SEP-24 /info must be CORS-accessible so any wallet origin can call it.
  return NextResponse.json(infoResponse, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      // Cache for 5 minutes — asset lists rarely change, reduces origin load.
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    },
  });
}
