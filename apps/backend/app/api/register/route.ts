import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * Pijin Architecture: Generates a 6-character Base62 ID.
 * Max Combinations: 62^6 = 56,800,235,584
 * e.g., "aB3x9Q"
 */
function generateBase62Id(length = 6): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  const randomBytes = crypto.randomBytes(length); 
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % 62];
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { role, stellarPublicKey, pin, phoneNumber, offlineDeviceKey, firstName, lastName, email } = body;

    if (!role || !stellarPublicKey) {
      return NextResponse.json({ error: "Missing required fields: role and stellarPublicKey" }, { status: 400 });
    }

    const uppercaseRole = role.toUpperCase();
    if (uppercaseRole !== "USER" && uppercaseRole !== "ADMIN") {
      return NextResponse.json({ error: "Role must be either 'USER' or 'ADMIN'" }, { status: 400 });
    }

    if (!/^G[A-Z2-7]{55}$/.test(stellarPublicKey)) {
      return NextResponse.json({ error: "Invalid Stellar Public Key format" }, { status: 400 });
    }

    const cleanKey = stellarPublicKey.trim();
    const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, "") : null;
    const cleanPin = pin ? pin.trim() : null;
    const cleanOfflineDeviceKey = offlineDeviceKey ? offlineDeviceKey.trim() : null;
    const cleanFirstName = firstName ? firstName.trim() : null;
    const cleanLastName = lastName ? lastName.trim() : null;
    const cleanEmail = email ? email.trim() : null;

    const existingKey = await prisma.account.findUnique({
      where: { stellarPublicKey: cleanKey },
    });

    if (existingKey) {
      return NextResponse.json({ error: "Stellar Public Key is already registered." }, { status: 409 });
    }

    let shortId = "";
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 15;

    while (!isUnique && attempts < maxAttempts) {
      shortId = generateBase62Id(); 
      
      const existingAccount = await prisma.account.findUnique({
        where: { shortId },
      });
      if (!existingAccount) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return NextResponse.json({ error: "Failed to generate a unique short ID. Please try again." }, { status: 500 });
    }
    
    const newAccount = await prisma.account.create({
      data: {
        shortId,
        role: uppercaseRole,
        stellarPublicKey: cleanKey,
        offlineDeviceKey: cleanOfflineDeviceKey,
        pin: cleanPin,
        phoneNumber: cleanPhone,
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
      },
    });

    return NextResponse.json({ success: true, data: newAccount }, { status: 201 });

  } catch (error) {
    console.error("[Register API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}