// app/api/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { searchGoogleBooks, searchOpenLibrary } from '@/lib/books';
import { normalizeTitle } from '@/lib/ai';

export const runtime = 'nodejs';

type Seed = { title?: string; authors?: string[]; isbn?: string };

function jaccard(a: string, b: string) {
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  const inter = new Set([...A].filter(x => B.has(x))).size;
  const uni = new Set([...A, ...B]).size || 1;
  return inter / uni;
}

export async function POST(req: NextRequest) {
  try {
    const { seeds = [], language = 'ja' } = await req.json();
    if (!Array.isArray(seeds) || seeds.length === 0) {
      return NextResponse.json({ error: 'seeds required' }, { status: 400 });
    }

    const resolved: any[] = [];
    for (const s of seeds.slice(0, 10)) {
      let results: any[] = [];
      if (s.isbn) {
        const [g, o] = await Promise.all([searchGoogleBooks(`isbn:${s.isbn}`), searchOpenLibrary(s.isbn)]);
        results = [...g, ...o];
      } else if (s.title) {
        const q1 = `intitle:"${s.title}"`;
        const q2 = s.authors?.[0] ? `intitle:"${s.title}" inauthor:"${s.authors[0]}"` : '';
        const [g1, g2, o] = await Promise.all([
          searchGoogleBooks(q1, { langRestrict: language }),
          q2 ? searchGoogleBooks(q2, { langRestrict: language }) : Promise.resolve([]),
          searchOpenLibrary(s.title)
        ]);
        results = [...g1, ...g2, ...o];
      }

      // スコア（タイトル類似＋著者一致＋ISBN一致）でベストを選ぶ
      const nSeed = normalizeTitle(s.title || '');
      const authorSeed = (s.authors?.[0] || '').toLowerCase();

      results.forEach(r => {
        let score = 0;
        score += jaccard(nSeed, normalizeTitle(r.title || '')) * 0.75;
        if (authorSeed && (r.authors || [])[0]?.toLowerCase().includes(authorSeed)) score += 0.2;
        if (s.isbn && r.isbn13 && r.isbn13.includes(s.isbn)) score += 0.5;
        (r as any).__score = score;
      });
      results.sort((a, b) => ((b as any).__score ?? 0) - ((a as any).__score ?? 0));

      const best = results[0];
      if (best) resolved.push(best);
    }

    return NextResponse.json({ resolved });
  } catch (e: any) {
    return NextResponse.json({ error: 'resolve-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}