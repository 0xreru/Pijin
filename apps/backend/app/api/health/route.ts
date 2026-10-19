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
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/rate-limit';
import { isRampEnabled, isDepositEnabled, isWithdrawEnabled } from '@/lib/ramp-config';

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        const deep = new URL(req.url).searchParams.get('deep') === '1';
        const smsConfigured = getSmsGateways().length > 0;

        // Health probes for dependencies
        let dbOk = false;
        let redisOk = false;
        let rpcOk = false;

        try {
            await prisma.$queryRaw`SELECT 1`;
            dbOk = true;
        } catch (dbErr) {
            console.error('[Health API] DB ping failed:', dbErr);
        }

        try {
            const redis = getRedis();
            const pong = await redis.ping();
            redisOk = pong === 'PONG' || Boolean(pong);
        } catch (redisErr) {
            console.error('[Health API] Redis ping failed:', redisErr);
        }

        const rpcUrl = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
        try {
            const rpcRes = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getHealth',
                }),
                signal: AbortSignal.timeout(3000),
            });
            const rpcData = await rpcRes.json();
            rpcOk = rpcData?.result?.status === 'healthy' || rpcRes.ok;
        } catch {
            // RPC ping failure
        }

        let overallStatus = 'healthy';
        if (!dbOk || !redisOk) {
            overallStatus = 'degraded';
        }

        const body: Record<string, unknown> = {
            status: overallStatus,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            checks: {
                database: dbOk ? 'ok' : 'error',
                redis: redisOk ? 'ok' : 'error',
                sorobanRpc: rpcOk ? 'ok' : 'error',
            },
            features: {
                smsOtp: smsConfigured || process.env.OTP_TEST_MODE === 'true',
                ramp: isRampEnabled(),
                deposit: isDepositEnabled(),
                withdraw: isWithdrawEnabled(),
                demo: process.env.DEMO_ENABLED === 'true',
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
