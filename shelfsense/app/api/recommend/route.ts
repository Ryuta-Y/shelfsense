// app/api/recommend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { embed } from '@/lib/ai';
import { searchGoogleBooks, searchOpenLibrary } from '@/lib/books';
import { upsertBooks } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { bookIds = [], n = 10, filters = {} } = await req.json();
  if (!Array.isArray(bookIds) || bookIds.length === 0) {
    return NextResponse.json({ error: 'bookIds required' }, { status: 400 });
  }

  // 入力本を取得（embedding も見る）
  const { data: books, error } = await supabase.from('books')
    .select('id,title,authors,description,language,published_year,embedding')
    .in('id', bookIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 好みベクトル
  const queryText = (books||[])
    .map(b => `${b.title} by ${(b.authors||[]).join(', ')}\n${b.description||''}`)
    .join('\n\n');
  const qvec = await embed(queryText);

  const runMatch = async () => {
    const { data, error: rpcErr } = await supabase
      .rpc('match_books', { query_embedding: qvec, match_limit: 300 });
    if (rpcErr) throw rpcErr;
    return data || [];
  };

  let recs = await runMatch();
  const exclude = new Set(bookIds);
  recs = recs.filter((r: any) => !exclude.has(r.id));

  const applyFilters = (arr: any[], f: any) => {
    let out = arr;
    if (f.language) out = out.filter((r: any) => r.language === f.language);
    if (f.yearMin) out = out.filter((r: any) => (r.published_year||0) >= f.yearMin);
    return out;
  };

  let filtered = applyFilters(recs, filters);

  // ★ 足りなければ段階的に緩める
  if (filtered.length < n) filtered = applyFilters(recs, { ...filters, yearMin: undefined });
  if (filtered.length < n) filtered = recs;

  // ★ それでも足りなければ周辺を取り込んで再検索（DBがスカスカ対策）
  if (filtered.length < n) {
    try {
      const qSeeds: string[] = [];
      for (const b of (books||[])) {
        const author = b.authors?.[0] || '';
        qSeeds.push(`${b.title} ${author}`.trim());
        if (author) qSeeds.push(`author:${author}`);
      }
      const fetched: any[] = [];
      for (const q of qSeeds.slice(0, 3)) {
        const [g, o] = await Promise.all([searchGoogleBooks(q), searchOpenLibrary(q)]);
        fetched.push(...g, ...o);
      }
      if (fetched.length) await upsertBooks(fetched.slice(0, 30));
      const recs2 = (await runMatch()).filter((r: any) => !exclude.has(r.id));
      filtered = recs2;
    } catch {}
  }

  const out = filtered.slice(0, n).map((r: any) => ({
    ...r,
    reason: `あなたの選んだ本（${(books||[]).map(b=>b.title).join(', ')}）との主題/文体/時代の近さから推定。`
  }));

  return NextResponse.json({ recs: out });
}