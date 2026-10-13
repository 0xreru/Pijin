/**
 * @swagger
 * /api/health:
 *   get:
 *     tags:
 *       - System
 *     summary: Service health check
 *     description: |
 *       Returns the current health status of the Next.js backend process along
 *       with the Node.js process uptime (seconds since start) and a server-side
 *       ISO 8601 timestamp. Use this endpoint for liveness probes in your
 *       deployment infrastructure (Vercel, Docker, Render).
 *
 *       `features.smsOtp` tells the mobile app whether OTP delivery is available.
 *       With `?deep=1` the response adds `sms`: TextBee device state per role
 *       (`online`, `offline`, `disabled`, `unknown`, `unconfigured`), cached 30s.
 *       `status` becomes `degraded` when every configured device is offline or disabled.
 *     parameters:
 *       - in: query
 *         name: deep
 *         required: false
 *         schema:
 *           type: string
 *           enum: ["1"]
 *         description: Include TextBee device status.
 *     responses:
 *       '200':
 *         description: Service is healthy.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 uptime:
 *                   type: number
 *                   description: Node.js process uptime in seconds.
 *                   example: 3824.51
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2026-07-11T05:30:00.000Z"
 *       '500':
 *         description: Internal error during health check.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSmsGateways } from '@/lib/sms';
import { getTextbeeStatus } from '@/lib/sms-health';

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        const deep = new URL(req.url).searchParams.get('deep') === '1';
        const smsConfigured = getSmsGateways().length > 0;

        const body: Record<string, unknown> = {
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            features: {
                smsOtp: smsConfigured || process.env.OTP_TEST_MODE === 'true',
            },
        };

        if (deep) {
            // Device ids stay server-side; only the role and state are exposed.
            const devices = await getTextbeeStatus();
            body.sms = devices.map(({ role, status, lastHeartbeat, detail }) => ({ role, status, lastHeartbeat, detail }));
            const anyOnline = devices.some((d) => d.status === 'online');
            if (smsConfigured && !anyOnline && devices.some((d) => d.status !== 'unconfigured' && d.status !== 'unknown')) {
                body.status = 'degraded';
            }
        }

        return NextResponse.json(body, { status: 200 });
    } catch (error) {
        console.error('[Health API]', error);
        return NextResponse.json({
            status: 'error',
        }, { status: 500 });
    }
}
