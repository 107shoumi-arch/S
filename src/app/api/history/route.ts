import { NextRequest, NextResponse } from 'next/server';
import { getHistory } from '@/lib/market';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol') ?? '';
  const market = request.nextUrl.searchParams.get('market') ?? 'TWSE';
  if (!/^\d{4,6}[A-Z]?$/.test(symbol) || !['TWSE', 'TPEx'].includes(market)) {
    return NextResponse.json({ candles: [], source: '', asOf: null, errors: ['請提供正確的股票代號及市場。'] }, { status: 400 });
  }
  const result = await getHistory(symbol, market as 'TWSE' | 'TPEx');
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
