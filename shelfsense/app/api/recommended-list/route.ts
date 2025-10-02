// app/api/recommended-list/route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // recommended_items → books をJOIN（理由も返す）
    const { data, error } = await supabase
      .from('recommended_items')
      .select('created_at, reason, book:books(*)')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'fetch-failed', detail: error.message }, { status: 500 });
    }

    const items = (data || [])
      .map((r: any) => ({ book: r.book, reason: r.reason || '' }))
      .filter((r: any) => !!r.book);

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: 'fetch-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}