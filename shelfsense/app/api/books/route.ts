
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, authors = [], language, isbn13, description, cover_url } = body || {};
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const row = {
    title, authors, language, isbn13, description, cover_url,
    source: 'manual' as const, metadata: {}
  };

  const { data, error } = await supabase.from('books').insert(row).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
