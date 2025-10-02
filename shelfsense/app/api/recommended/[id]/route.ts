// app/api/recommended/[id]/route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, context: any) {
  const id = context?.params?.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'bad-request', detail: 'missing id' }, { status: 400 });

  const { data, error } = await supabase.from('recommended_items').delete().eq('id', id).select('id');
  if (error) return NextResponse.json({ error: 'delete-failed', detail: error.message }, { status: 500 });

  return NextResponse.json({ deleted: data?.length || 0 });
}