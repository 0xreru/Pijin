import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone");

    if (!phone) {
      return NextResponse.json({ error: "Missing required parameter: phone" }, { status: 400 });
    }

    // Clean phone number (leave only digits)
    const cleanPhone = phone.replace(/\D/g, "");

    if (cleanPhone.length === 0) {
      return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
    }

    const account = await prisma.account.findFirst({
      where: {
        phoneNumber: cleanPhone,
      },
    });

    if (account) {
      return NextResponse.json({
        exists: true,
        stellarPublicKey: account.stellarPublicKey,
        shortId: account.shortId,
        pin: account.pin,
      }, { status: 200 });
    }

    return NextResponse.json({ exists: false }, { status: 200 });
  } catch (error) {
    console.error("[Check User API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
