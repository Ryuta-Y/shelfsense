// app/api/toggle-library/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { toggleLibrary } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { bookId } = await req.json().catch(() => ({}));
  if (!bookId) return NextResponse.json({ error: 'bookId required' }, { status: 400 });
  try {
    const r = await toggleLibrary(bookId);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: 'toggle-library-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}