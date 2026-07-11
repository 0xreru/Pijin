/**
 * @swagger
 * /api/anchor/simulate-payment:
 *   post:
 *     tags:
 *       - Anchor (SEP-24)
 *     summary: Execute anchor Stellar payment (SEP-24 settlement step)
 *     description: |
 *       Called by the interactive deposit webview after the user confirms their fiat
 *       (GCash) payment. This is the anchor's **"central bank" transfer step**:
 *
 *       1. Validates `transaction_id` and `amount`.
 *       2. Loads the `AnchorTransaction` from Prisma (must exist and not already be `completed`).
 *       3. Resolves the correct **distributor keypair** for the asset (PHPC/USDC) from env vars.
 *       4. Builds a Stellar `Payment` operation using the **issuer public key** for the asset
 *          (required so Horizon can validate the trustline — issuer ≠ distributor).
 *       5. Signs with the distributor secret and submits to Horizon Testnet.
 *       6. Updates the DB record to `completed` with `amountIn` / `amountOut`.
 *
 *       On Stellar submission failure (bad trustline, insufficient funds, etc.) the DB
 *       record is updated to `error` and a `422 Unprocessable Entity` is returned with
 *       the Horizon `result_codes` for debugging.
 *
 *       **⚠️ Not protected by SEP-10 auth** — called from the server-rendered webview which
 *       has already validated the short-lived SEP-24 interactive JWT. Add CSRF/rate-limit
 *       protection before mainnet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction_id, amount]
 *             properties:
 *               transaction_id:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the AnchorTransaction created by the deposit initiation step.
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               amount:
 *                 type: string
 *                 description: Amount to send in human-readable decimal form (e.g. "100.00"). Normalised to 7 decimal places internally.
 *                 example: "100.00"
 *     responses:
 *       '200':
 *         description: Stellar transaction submitted and DB updated to `completed`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 stellar_tx_hash:
 *                   type: string
 *                   description: The confirmed Stellar transaction hash.
 *                   example: "a1b2c3d4..."
 *                 amount:
 *                   type: string
 *                   example: "100.0000000"
 *                 asset_code:
 *                   type: string
 *                   example: "PHPC"
 *                 destination:
 *                   type: string
 *                   description: Recipient Stellar public key (the user's wallet).
 *       '400':
 *         description: Missing or invalid `transaction_id` or `amount`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       '404':
 *         description: AnchorTransaction not found for the given `transaction_id`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       '409':
 *         description: Transaction has already been settled (status is already `completed`).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "This transaction has already been settled."
 *       '422':
 *         description: Stellar submission failed (bad trustline, insufficient distributor funds, Testnet congestion).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 detail:
 *                   type: string
 *                   description: Horizon result_codes JSON string for debugging.
 *       '500':
 *         description: Internal server error (missing env var, DB error, or unexpected failure).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */

/**
 * @file app/api/anchor/simulate-payment/route.ts
 *
 * SEP-24: Settlement Engine — "Central Bank" Transfer
 * ────────────────────────────────────────────────────
 * Called by the interactive deposit webview after the user "confirms" their
 * fiat GCash payment.  This route is the anchor's settlement step:
 *
 *   1. Validate the request body (transaction_id, amount).
 *   2. Load the AnchorTransaction from Prisma.
 *   3. Pick the correct distributor keypair for the asset (PHPC / USDC).
 *   4. Build, sign, and submit a Stellar Payment operation to Testnet Horizon.
 *   5. On success, mark the DB record `completed` and return 200.
 *
 * This route is intentionally NOT protected by SEP-10 auth — it is called from
 * the same server-rendered webview that has already validated the short-lived
 * SEP-24 interactive JWT.  Add rate-limiting / CSRF protection before mainnet.
 *
 * Environment variables required
 * ──────────────────────────────
 *   PHPC_DISTRIBUTOR_SECRET   — Stellar secret key of the PHPC distributor (sends payments)
 *   PHPC_ISSUER_PUBKEY        — Stellar public key of the PHPC issuer (trustline anchor)
 *   USDC_DISTRIBUTOR_SECRET   — Stellar secret key of the USDC distributor (sends payments)
 *   USDC_ISSUER_PUBKEY        — Stellar public key of the USDC issuer (trustline anchor)
 *
 * Stellar Testnet Horizon
 * ───────────────────────
 *   https://horizon-testnet.stellar.org
 *
 * IMPORTANT — Issuer vs. Distributor:
 *   The asset MUST be constructed with the Issuer's public key, because that is
 *   the key the user's wallet trusted when it created the trustline.  The
 *   Distributor holds the supply and signs/sends the payment, but is NOT the issuer.
 */

// ── Runtime ───────────────────────────────────────────────────────────────────
// Must be Node.js: stellar-sdk uses crypto APIs unavailable in the Edge runtime.
export const runtime = 'nodejs';

// ── Imports ───────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import * as StellarSdk from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';

// ── Constants ─────────────────────────────────────────────────────────────────

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

/**
 * Maximum time (seconds) a built transaction will remain valid.
 * 3 minutes is generous enough for Testnet latency without being a security risk.
 */
const TX_TIMEOUT_SECONDS = 180;

/**
 * A slightly elevated fee (500 stroops) to give the Testnet transaction
 * priority during periods of high load.  Adjust as needed.
 */
const TX_FEE = '500';

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[SimulatePayment] Missing required env var: ${name}`);
  return value;
}

/**
 * Returns the distributor keypair for a given asset code.
 * The distributor holds the token supply and signs/sends payments.
 * Throws a descriptive error if the asset is unsupported or the env var is missing.
 */
function getDistributorKeypair(assetCode: string): StellarSdk.Keypair {
  switch (assetCode.toUpperCase()) {
    case 'PHPC': {
      const secret = requireEnv('PHPC_DISTRIBUTOR_SECRET');
      return StellarSdk.Keypair.fromSecret(secret);
    }
    case 'USDC': {
      const secret = requireEnv('USDC_DISTRIBUTOR_SECRET');
      return StellarSdk.Keypair.fromSecret(secret);
    }
    default:
      throw new Error(`Unsupported asset code: "${assetCode}". Expected PHPC or USDC.`);
  }
}

/**
 * Returns the Issuer public key for a given asset code.
 *
 * The Issuer is the account that CREATED the asset and against which all
 * trustlines are established.  This is distinct from the Distributor, which
 * merely holds the supply.  The StellarSdk.Asset MUST be constructed with
 * the Issuer public key — otherwise Horizon rejects the payment with op_no_trust.
 *
 * Env vars consumed:
 *   PHPC_ISSUER_PUBKEY — public key of the PHPC issuer
 *   USDC_ISSUER_PUBKEY — public key of the USDC issuer
 */
function getIssuerPubKey(assetCode: string): string {
  switch (assetCode.toUpperCase()) {
    case 'PHPC':
      return requireEnv('PHPC_ISSUER_PUBKEY');
    case 'USDC':
      return requireEnv('USDC_ISSUER_PUBKEY');
    default:
      throw new Error(`Unsupported asset code: "${assetCode}". Expected PHPC or USDC.`);
  }
}

// ── Request / Response Types ──────────────────────────────────────────────────

interface SimulatePaymentBody {
  transaction_id?: string;
  amount?: string | number;
}

interface SimulatePaymentSuccessResponse {
  success: true;
  stellar_tx_hash: string;
  amount: string;
  asset_code: string;
  destination: string;
}

interface SimulatePaymentErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

// ── POST Handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/anchor/simulate-payment
 *
 * Body (application/json):
 *   { "transaction_id": "<uuid>", "amount": "100.00" }
 *
 * Returns:
 *   200 — Stellar tx submitted and DB updated to `completed`
 *   400 — Validation error
 *   404 — Transaction not found
 *   422 — Stellar submission error (trustline missing, insufficient funds, etc.)
 *   500 — Unexpected server error
 */
export async function POST(
  request: Request,
): Promise<NextResponse<SimulatePaymentSuccessResponse | SimulatePaymentErrorResponse>> {
  // ── 1. Parse & validate the request body ──────────────────────────────────
  let body: SimulatePaymentBody;

  try {
    body = (await request.json()) as SimulatePaymentBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const { transaction_id, amount: rawAmount } = body;

  if (!transaction_id || typeof transaction_id !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Missing required field: transaction_id' },
      { status: 400 },
    );
  }

  if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
    return NextResponse.json(
      { success: false, error: 'Missing required field: amount' },
      { status: 400 },
    );
  }

  // Normalise amount to a string with up to 7 decimal places (Stellar precision)
  const amount = parseFloat(String(rawAmount)).toFixed(7);
  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json(
      { success: false, error: 'Amount must be a positive number.' },
      { status: 400 },
    );
  }

  // ── 2. Fetch the AnchorTransaction from the database ─────────────────────
  let anchorTx;

  try {
    anchorTx = await prisma.anchorTransaction.findUnique({
      where: { id: transaction_id },
    });
  } catch (dbErr: unknown) {
    const detail = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[SimulatePayment] DB read error for tx=${transaction_id}: ${detail}`);
    return NextResponse.json(
      { success: false, error: 'Database error while fetching transaction.', detail },
      { status: 500 },
    );
  }

  if (!anchorTx) {
    return NextResponse.json(
      { success: false, error: `Transaction not found: ${transaction_id}` },
      { status: 404 },
    );
  }

  if (anchorTx.status === 'completed') {
    return NextResponse.json(
      { success: false, error: 'This transaction has already been settled.' },
      { status: 409 },
    );
  }

  // ── 3. Resolve the distributor keypair ────────────────────────────────────
  let distributorKeypair: StellarSdk.Keypair;

  try {
    distributorKeypair = getDistributorKeypair(anchorTx.assetCode);
  } catch (keypairErr: unknown) {
    const detail = keypairErr instanceof Error ? keypairErr.message : String(keypairErr);
    console.error(`[SimulatePayment] Keypair resolution failed: ${detail}`);
    return NextResponse.json(
      { success: false, error: 'Unsupported asset or missing distributor secret.', detail },
      { status: 500 },
    );
  }

  // ── 4. Build & submit the Stellar Payment transaction ────────────────────
  const horizon = new StellarSdk.Horizon.Server(HORIZON_TESTNET_URL);

  // Resolve the ISSUER public key — this is the account the user's wallet
  // trusted when it opened the trustline.  It is NOT the distributor.
  let issuerPubKey: string;
  try {
    issuerPubKey = getIssuerPubKey(anchorTx.assetCode);
  } catch (issuerErr: unknown) {
    const detail = issuerErr instanceof Error ? issuerErr.message : String(issuerErr);
    console.error(`[SimulatePayment] Issuer pubkey resolution failed: ${detail}`);
    return NextResponse.json(
      { success: false, error: 'Unsupported asset or missing issuer public key.', detail },
      { status: 500 },
    );
  }

  // Construct the asset with the ISSUER key so Horizon can validate the trustline.
  const asset = new StellarSdk.Asset(
    anchorTx.assetCode.toUpperCase(),
    issuerPubKey,
  );

  let stellarTxHash: string;

  try {
    // 4a. Load the distributor's current sequence number from Horizon.
    //     This call can timeout on a slow Testnet — the outer try/catch handles it.
    const distributorAccount = await horizon.loadAccount(distributorKeypair.publicKey());

    // 4b. Build the payment transaction.
    const transaction = new StellarSdk.TransactionBuilder(distributorAccount, {
      fee: TX_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: anchorTx.stellarAccount,
          asset,
          amount,
        }),
      )
      .addMemo(StellarSdk.Memo.text(`SEP24-DEP:${anchorTx.id.slice(0, 16)}`))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    // 4c. Sign with the distributor's secret key.
    transaction.sign(distributorKeypair);

    // 4d. Submit to Testnet Horizon.
    //     horizon.submitTransaction handles the HTTP call; errors surface as
    //     HorizonError with an `extras.result_codes` detail object.
    const response = await horizon.submitTransaction(transaction);

    stellarTxHash = response.hash;

    console.info(
      `[SimulatePayment] Stellar tx submitted | hash=${stellarTxHash} | ` +
        `amount=${amount} ${anchorTx.assetCode} → ${anchorTx.stellarAccount}`,
    );
  } catch (stellarErr: unknown) {
    // Horizon returns detailed error info in the response body.
    // Extract it so callers get actionable messages.
    let detail = 'Stellar network error.';

    if (
      stellarErr !== null &&
      typeof stellarErr === 'object' &&
      'response' in stellarErr
    ) {
      const horizonError = stellarErr as {
        response?: { data?: { extras?: { result_codes?: unknown } } };
        message?: string;
      };
      const resultCodes = horizonError.response?.data?.extras?.result_codes;
      detail = resultCodes
        ? JSON.stringify(resultCodes)
        : (horizonError.message ?? detail);
    } else if (stellarErr instanceof Error) {
      detail = stellarErr.message;
    }

    console.error(`[SimulatePayment] Stellar submission failed for tx=${transaction_id}: ${detail}`);

    // Mark the DB record as error so the wallet polling loop sees the failure.
    try {
      await prisma.anchorTransaction.update({
        where: { id: transaction_id },
        data: { status: 'error' },
      });
    } catch (updateErr: unknown) {
      console.error('[SimulatePayment] Failed to set status=error in DB:', updateErr);
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Stellar transaction failed. The Testnet may be slow or the asset trustline may be missing.',
        detail,
      },
      { status: 422 },
    );
  }

  // ── 5. Update the database to `completed` ────────────────────────────────
  try {
    await prisma.anchorTransaction.update({
      where: { id: transaction_id },
      data: {
        status: 'completed',
        amountIn: amount,
        amountOut: amount,
        // amountFee: '0'  — extend here if you add a fee model
      },
    });

    console.info(
      `[SimulatePayment] DB updated to completed | tx=${transaction_id} | hash=${stellarTxHash}`,
    );
  } catch (dbUpdateErr: unknown) {
    const detail = dbUpdateErr instanceof Error ? dbUpdateErr.message : String(dbUpdateErr);
    // The Stellar tx already went through.  Log heavily but don't return an
    // error to the client — the payment succeeded; only the DB housekeeping failed.
    console.error(
      `[SimulatePayment] CRITICAL: Stellar tx succeeded (${stellarTxHash}) but DB update ` +
        `failed for tx=${transaction_id}: ${detail}`,
    );
    // Still return success so the UI shows the checkmark; operators should
    // reconcile the DB record manually using the logged hash.
  }

  // ── 6. Return success ─────────────────────────────────────────────────────
  return NextResponse.json(
    {
      success: true,
      stellar_tx_hash: stellarTxHash,
      amount,
      asset_code: anchorTx.assetCode,
      destination: anchorTx.stellarAccount,
    },
    { status: 200 },
  );
}
