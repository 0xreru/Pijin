import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * Generates a random 4-character uppercase hex string (e.g. "8A92")
 */
function generateHexId(): string {
  return crypto.randomBytes(2).toString("hex").toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    // 1. Parse JSON body
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { role, stellarPublicKey, merchantPin, merchantPhone, offlineDeviceKey } = body;

    // 2. Validate input fields
    if (!role || !stellarPublicKey) {
      return NextResponse.json(
        { error: "Missing required fields: role and stellarPublicKey" },
        { status: 400 }
      );
    }

    const uppercaseRole = role.toUpperCase();
    if (uppercaseRole !== "CUSTOMER" && uppercaseRole !== "MERCHANT") {
      return NextResponse.json(
        { error: "Role must be either 'CUSTOMER' or 'MERCHANT'" },
        { status: 400 }
      );
    }

    // Basic validation for Stellar Public Key
    // Stellar Ed25519 public keys always start with 'G' and are 56 characters long
    const cleanKey = stellarPublicKey.trim();
    if (!/^G[A-Z2-7]{55}$/.test(cleanKey)) {
      return NextResponse.json(
        { error: "Invalid Stellar Public Key format" },
        { status: 400 }
      );
    }

    // Additional validation if MERCHANT
    let cleanPin: string | null = null;
    let cleanPhone: string | null = null;
    let cleanOfflineDeviceKey: string | null = null;
    if (uppercaseRole === "MERCHANT") {
      if (!merchantPin) {
        return NextResponse.json(
          { error: "merchantPin is required for merchant role" },
          { status: 400 }
        );
      }
      if (!merchantPhone) {
        return NextResponse.json(
          { error: "merchantPhone is required for merchant role" },
          { status: 400 }
        );
      }
      cleanPin = String(merchantPin).trim();
      if (!/^\d{4}$/.test(cleanPin)) {
        return NextResponse.json(
          { error: "merchantPin must be a 4-digit numeric string" },
          { status: 400 }
        );
      }
      cleanPhone = String(merchantPhone).trim();
      if (!cleanPhone) {
        return NextResponse.json(
          { error: "merchantPhone must be a non-empty string" },
          { status: 400 }
        );
      }
    }

    if (offlineDeviceKey !== undefined && offlineDeviceKey !== null) {
      const trimmed = String(offlineDeviceKey).trim();
      cleanOfflineDeviceKey = trimmed.length > 0 ? trimmed : null;
    }

    // 3. Check if Stellar Public Key is already registered
    const existingAccount = await prisma.account.findUnique({
      where: { stellarPublicKey: cleanKey },
    });

    if (existingAccount) {
      // If the wallet exists, DO NOT THROW AN ERROR. 
      // Update the row with the new phone's offlineDeviceKey so they aren't locked out!
      const updatedAccount = await prisma.account.update({
        where: { stellarPublicKey: cleanKey },
        data: { 
          offlineDeviceKey: body.offlineDeviceKey, 
          merchantPin: cleanPin || existingAccount.merchantPin,
          role: uppercaseRole // In case they are upgrading to a Merchant
        }
      });
      
      console.log(`[Register] Restored & Updated existing account: ${updatedAccount.shortId}`);
      return NextResponse.json({
        success: true,
        data: updatedAccount,
      });
    }

    // 4. Generate Short ID
    let shortId = "";
    if (uppercaseRole === "MERCHANT") {
      shortId = "M-DEMO";
      // Monkeypatch for demo:
      // const hex = generateHexId();
      // shortId = `M-${hex}`;
    } else {
      const prefix = "C";
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 15;

      while (!isUnique && attempts < maxAttempts) {
        const hex = generateHexId();
        shortId = `${prefix}-${hex}`;
        
        // Check database if it exists
        const existingAccount = await prisma.account.findUnique({
          where: { shortId },
        });
        
        if (!existingAccount) {
          isUnique = true;
        }
        attempts++;
      }

      if (!isUnique) {
        return NextResponse.json(
          { error: "Failed to generate a unique short ID. Please try again." },
          { status: 500 }
        );
      }
    }

    // 5. Save the account to database
    const newAccount = await prisma.account.create({
      data: {
        shortId,
        role: uppercaseRole,
        stellarPublicKey: cleanKey,
        offlineDeviceKey: cleanOfflineDeviceKey,
        merchantPin: cleanPin,
        merchantPhone: cleanPhone,
      },
    });

    console.log(`[Register] Created account: ${shortId} for key ${cleanKey}`);

    return NextResponse.json({
      success: true,
      data: newAccount,
    });

  } catch (error: any) {
    console.error("[Register API Error]:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
