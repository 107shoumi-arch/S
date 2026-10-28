import { NextRequest, NextResponse } from 'next/server';
import { getMarket } from '@/lib/market';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? request.nextUrl.searchParams.get('symbol') ?? '';
  if (query.length > 100) return NextResponse.json({ error: '搜尋文字過長。' }, { status: 400 });
  try {
    const result = await getMarket(query);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ quotes: [], index: null, fetchedAt: new Date().toISOString(), errors: ['行情服務暫時無法使用。請稍後重試或匯入行情 CSV。'], cached: false }, { status: 503 });
  }
}
