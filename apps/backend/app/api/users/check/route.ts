/**
 * @swagger
 * /api/users/check:
 *   get:
 *     tags:
 *       - Users & Accounts
 *     summary: Check if a phone number is registered
 *     description: |
 *       Looks up an `Account` record by the provided `phone` number (digits-only after
 *       sanitisation). Used by the onboarding flow to determine whether to route the
 *       user to login or new account registration.
 *
 *       If the account exists, the response includes the `stellarPublicKey` and `shortId`
 *       so the client can initialise the Stellar SDK session without an additional round-trip.
 *     parameters:
 *       - in: query
 *         name: phone
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number to check. Non-digit characters are stripped before querying.
 *         example: "09171234567"
 *     responses:
 *       '200':
 *         description: Lookup completed (account found or not found — both return 200).
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   description: Account found.
 *                   properties:
 *                     exists:
 *                       type: boolean
 *                       example: true
 *                     stellarPublicKey:
 *                       type: string
 *                       example: "GABC1234..."
 *                     shortId:
 *                       type: string
 *                       example: "aB3x9Q"
 *                 - type: object
 *                   description: Account not found.
 *                   properties:
 *                     exists:
 *                       type: boolean
 *                       example: false
 *       '400':
 *         description: Missing or empty `phone` parameter.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               examples:
 *                 missing: { value: { error: "Missing required parameter: phone" } }
 *                 invalid: { value: { error: "Invalid phone number format" } }
 *       '500':
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
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
