// app/api/library/bulk-delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { ids = [] } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'no-ids' }, { status: 400 });
  const { data, error } = await supabase.from('library_items').delete().in('id', ids).select('id');
  if (error) return NextResponse.json({ error: 'bulk-delete-failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ deleted: data?.length || 0 });
}