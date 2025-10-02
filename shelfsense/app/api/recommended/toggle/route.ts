// app/api/recommended/toggle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { toggleRecommended } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { bookId } = await req.json();
    if (!bookId) return NextResponse.json({ error: 'bookId required' }, { status: 400 });
    const res = await toggleRecommended(bookId);
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: 'toggle-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}