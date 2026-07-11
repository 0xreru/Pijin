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
import { NextResponse } from 'next/server';

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        return NextResponse.json({
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        }, { status: 200 });
    } catch (error) {
        return NextResponse.json({
            status: 'error',
        }, { status: 500 });
    }
}