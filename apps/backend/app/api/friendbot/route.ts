import { StrKey } from "@stellar/stellar-sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey.trim() : "";

    if (!publicKey) {
      return NextResponse.json({ error: "publicKey is required." }, { status: 400 });
    }

    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      return NextResponse.json({ error: "Invalid Stellar public key." }, { status: 400 });
    }

    const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[Friendbot API] HTTP ${response.status} for ${publicKey}: ${detail}`);
      return NextResponse.json(
        { error: "Friendbot funding failed.", detail: detail || `HTTP ${response.status}` },
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Friendbot API] Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
