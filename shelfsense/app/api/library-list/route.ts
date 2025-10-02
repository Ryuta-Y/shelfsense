// app/api/library-list/route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // library_items → books をJOIN
    const { data, error } = await supabase
      .from('library_items')
      .select('created_at, book:books(*)')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'fetch-failed', detail: error.message }, { status: 500 });
    }

    const items = (data || [])
      .map((r: any) => r.book)
      .filter(Boolean);

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: 'fetch-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}