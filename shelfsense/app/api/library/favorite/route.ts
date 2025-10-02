// app/api/library/favorite/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { id, value } = await req.json().catch(() => ({}));
  if (!id || typeof value !== 'boolean') return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const { error } = await supabase.from('library_items').update({ is_favorite: value }).eq('id', id);
  if (error) return NextResponse.json({ error: 'toggle-fav-failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}