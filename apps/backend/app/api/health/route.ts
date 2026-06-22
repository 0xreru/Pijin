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