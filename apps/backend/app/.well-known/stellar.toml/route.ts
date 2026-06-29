/**
 * @file app/.well-known/stellar.toml/route.ts
 *
 * Stellar TOML (stellar.toml) Endpoint
 * ─────────────────────────────────────
 * Serves the anchor's machine-readable configuration file as defined by
 * SEP-1 (Stellar Info File): https://stellar.org/protocol/sep-1
 *
 * This file is the public "identity card" of the anchor.  Wallets, clients,
 * and SEP-compliant services fetch it from:
 *
 *   https://<your-domain>/.well-known/stellar.toml
 *
 * It MUST be served over HTTPS with the correct Content-Type and CORS headers
 * so that browser-based wallets (Freighter, etc.) can fetch it cross-origin.
 *
 * SEP-10 fields exposed
 * ─────────────────────
 * WEB_AUTH_ENDPOINT  — Full URL of the GET/POST auth challenge endpoint.
 * SIGNING_KEY        — The anchor's SEP-10 *public* signing key (G…).
 *                      Never expose the secret seed here.
 *
 * Environment variables used
 * ──────────────────────────
 * SECRET_SEP10_SIGNING_SEED   Anchor's SEP-10 signing keypair seed (S…).
 *                             The PUBLIC key is derived on-the-fly; the seed
 *                             is never written into this response.
 * NEXT_PUBLIC_APP_URL         Canonical origin of this deployment
 *                             e.g. "https://pijin-api.vercel.app"
 */

// ── Runtime ──────────────────────────────────────────────────────────────────
// Edge runtime cannot load the full Stellar SDK crypto dependencies; use Node.
export const runtime = 'nodejs';

// ── Imports ───────────────────────────────────────────────────────────────────
import { Keypair, StrKey } from '@stellar/stellar-sdk';

// ── Environment Helpers ───────────────────────────────────────────────────────

/**
 * Reads a required environment variable and throws a descriptive Error if it
 * is not set.  Failing fast prevents serving a malformed TOML that could
 * silently break SEP-10 for all clients.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[stellar.toml] Missing required environment variable: ${name}`,
    );
  }
  return value;
}

// The Demo Wallet is a browser app. It sends an OPTIONS request first.
// Without this, Next.js blocks it before the GET request can even be read!
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

// ── GET /.well-known/stellar.toml ─────────────────────────────────────────────
//
// Returns a TOML-formatted document.  We build the TOML as a template literal
// rather than pulling in a TOML serialisation library to keep this dependency-
// free and easy to extend with additional SEP fields in the future.

export async function GET(): Promise<Response> {
  try {
    // ── 1. Derive the SEP-10 public signing key ─────────────────────────────
    //
    // We only need the *public key* for the TOML document.  Deriving it here
    // at request-time guarantees the TOML always reflects the active signing
    // keypair, even after a key rotation (rotate env var → redeploy).
    const signingKeypair = Keypair.fromSecret(
      requireEnv('SECRET_SEP10_SIGNING_SEED'),
    );
    const signingPublicKey: string = signingKeypair.publicKey();

    // Sanity-check: ensure the derived key is a valid Ed25519 public key.
    // This can catch a misconfigured seed early.
    if (!StrKey.isValidEd25519PublicKey(signingPublicKey)) {
      throw new Error(
        'Derived SIGNING_KEY is not a valid Ed25519 public key. ' +
          'Check SECRET_SEP10_SIGNING_SEED.',
      );
    }

    // ── 2. Construct the canonical WEB_AUTH_ENDPOINT URL ───────────────────
    //
    // The value of NEXT_PUBLIC_APP_URL must NOT have a trailing slash.
    // Example: "https://pijin-api.vercel.app"
    const appUrl = requireEnv('NEXT_PUBLIC_APP_URL').replace(/\/$/, '');
    const webAuthEndpoint = `${appUrl}/api/auth`;

    // ── 3. Compose the TOML document ───────────────────────────────────────
    //
    // Extend this template with additional SEP fields as the anchor grows:
    //   - ACCOUNTS  (issuer / distribution addresses)
    //   - CURRENCIES (for SEP-38 / SEP-31 asset descriptions)
    //   - PRINCIPALS (contact information for regulatory compliance)
    //   - DOCUMENTATION (KYC / AML policy links)
    //
    // TOML spec: https://toml.io/en/
    // Fetch the Asset Issuers (Fallback to empty string if missing so the server doesn't crash, 
    // but the wallet requires them to be populated in the .env)
    const phpcIssuer = process.env.PHPC_ISSUER_PUBKEY || "";
    const usdcIssuer = process.env.USDC_ISSUER_PUBKEY || "";

    // ── 3. Compose the TOML document ───────────────────────────────────────
    // 🔥 ARCHITECT FIX 2: Added the 'issuer' property to [[CURRENCIES]]
    const toml = `# Pijin Anchor — Stellar Info File (SEP-1)
# Generated dynamically. Do not edit manually.
# See: https://stellar.org/protocol/sep-1

# ── Network ──────────────────────────────────────────────────────────────────
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# ── SEP-10: Stellar Web Authentication ───────────────────────────────────────
WEB_AUTH_ENDPOINT="${webAuthEndpoint}"
SIGNING_KEY="${signingPublicKey}"

# ── SEP-24: Interactive Anchor (Deposit & Withdraw) ──────────────────────────
TRANSFER_SERVER_SEP0024="${appUrl}/api/sep24"

# ── Supported Assets ─────────────────────────────────────────────────────────
[[CURRENCIES]]
code="PHPC"
issuer="${phpcIssuer}"
status="testnet"
is_asset_anchored=true
anchor_asset_type="fiat"

[[CURRENCIES]]
code="USDC"
issuer="${usdcIssuer}"
status="testnet"
is_asset_anchored=true
anchor_asset_type="fiat"

# ── Horizon ───────────────────────────────────────────────────────────────────
HORIZON_URL="https://horizon-testnet.stellar.org"
`;

    // ── 4. Return the response with the correct headers ─────────────────────
    //
    // Content-Type: text/plain — TOML is plain text; some older clients expect
    //   this over "application/toml".
    //
    // Access-Control-Allow-Origin: * — MUST be wildcard per SEP-1 so that
    //   browser wallets (any origin) can fetch the file cross-origin.
    //
    // Cache-Control: public, max-age=3600 — Cache for 1 hour to reduce origin
    //   load, but ensure key rotations propagate within a reasonable window.
    return new Response(toml, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
      },
    });

  } catch (err: unknown) {
    // Any error here is a server-side misconfiguration (missing env var, bad seed).
    const message = err instanceof Error ? err.message : String(err);
    console.error('[stellar.toml] Failed to generate TOML:', message);

    // Return a plain-text error consistent with the endpoint's Content-Type
    // contract, so clients receive a readable failure message.
    return new Response(
      `# Error generating stellar.toml\n# ${message}\n`,
      {
        status: 500,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}
