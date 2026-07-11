/**
 * @swagger
 * /api/users/lookup:
 *   get:
 *     tags:
 *       - Users & Accounts
 *     summary: Look up a user by Short ID or phone number
 *     description: |
 *       Resolves a Pijin `shortId` (or phone number) to the account's real
 *       `stellarPublicKey`, `offlineDeviceKey`, and display name.
 *       Used by the mobile app's Send Money flow to obtain the **canonical**
 *       receiver public key before constructing the Soroban XDR tuple —
 *       ensuring the signature the app produces matches what the backend verifies.
 *     parameters:
 *       - in: query
 *         name: shortId
 *         required: false
 *         schema:
 *           type: string
 *         description: The 6-character Base62 short ID to resolve.
 *         example: "PVAPqf"
 *       - in: query
 *         name: phone
 *         required: false
 *         schema:
 *           type: string
 *         description: Phone number (digits only after sanitisation).
 *         example: "09171234567"
 *     responses:
 *       '200':
 *         description: User found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 found:
 *                   type: boolean
 *                   example: true
 *                 shortId:
 *                   type: string
 *                   example: "PVAPqf"
 *                 stellarPublicKey:
 *                   type: string
 *                 offlineDeviceKey:
 *                   type: string
 *                   nullable: true
 *                 displayName:
 *                   type: string
 *                   example: "Juan dela Cruz"
 *       '400':
 *         description: Neither shortId nor phone provided.
 *       '404':
 *         description: No account matches the query.
 *       '500':
 *         description: Internal server error.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shortId = searchParams.get('shortId')?.trim();
    const phone = searchParams.get('phone')?.trim();

    if (!shortId && !phone) {
      return NextResponse.json(
        { error: 'Provide at least one query parameter: shortId or phone' },
        { status: 400 },
      );
    }

    let account: {
      shortId: string;
      stellarPublicKey: string;
      offlineDeviceKey: string | null;
      firstName: string | null;
      lastName: string | null;
    } | null = null;

    if (shortId) {
      account = await prisma.account.findUnique({
        where: { shortId },
        select: {
          shortId: true,
          stellarPublicKey: true,
          offlineDeviceKey: true,
          firstName: true,
          lastName: true,
        },
      });
    } else if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      account = await prisma.account.findFirst({
        where: { phoneNumber: cleanPhone },
        select: {
          shortId: true,
          stellarPublicKey: true,
          offlineDeviceKey: true,
          firstName: true,
          lastName: true,
        },
      });
    }

    if (!account) {
      return NextResponse.json({ found: false }, { status: 404 });
    }

    const firstName = account.firstName ?? '';
    const lastName = account.lastName ?? '';
    const displayName =
      [firstName, lastName].filter(Boolean).join(' ') || account.shortId;

    return NextResponse.json({
      found: true,
      shortId: account.shortId,
      stellarPublicKey: account.stellarPublicKey,
      offlineDeviceKey: account.offlineDeviceKey ?? null,
      displayName,
    });
  } catch (error) {
    console.error('[Lookup API]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
