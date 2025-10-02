// app/api/recommend-curated/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { searchGoogleBooks, searchOpenLibrary } from '@/lib/books';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';

const Rec = z.object({
  title: z.string(),
  authors: z.array(z.string()).optional(),
  reason: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.object({
    api: z.enum(['google','openlibrary']).optional(),
    id: z.string().optional(),
    info_url: z.string().url().optional(),
  }).optional(),
});
const Result = z.object({ recommendations: z.array(Rec) });

export async function POST(req: NextRequest) {
  try {
    const { seeds = [], n = 8, language = 'ja', hardness = 'auto' } = await req.json();
    if (!Array.isArray(seeds) || seeds.length === 0) {
      return NextResponse.json({ error: 'seeds required' }, { status: 400 });
    }

    // 1) Webから候補プールを収集（作者・タイトル先頭語など）
    const queries = new Set<string>();
    for (const s of seeds.slice(0, 6)) {
      if (s.title) {
        queries.add(`intitle:"${s.title}"`);
        const head = s.title.split(/[：:\-\s]/)[0]?.slice(0, 12) || s.title.slice(0, 12);
        queries.add(head);
      }
      if (s.authors?.[0]) queries.add(`inauthor:"${s.authors[0]}"`);
    }

    const pool: any[] = [];
    for (const q of Array.from(queries).slice(0, 8)) {
      const [g, o] = await Promise.all([
        searchGoogleBooks(q, { orderBy: q.length < 5 ? 'newest' : 'relevance', langRestrict: language }),
        searchOpenLibrary(q),
      ]);
      pool.push(...g, ...o);
    }
    const seen = new Set<string>();
    const candidates = pool.filter((b) => {
      const key = `${b.source}:${b.source_id || b.isbn13 || b.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 80);

    // 2) LLMに「上位n冊＋理由」を厳格JSONで選ばせる
    const seedText = seeds.map((s: any) =>
      `- ${s.title}${s.authors?.length ? ` / ${s.authors.join(', ')}` : ''}${s.published_year ? ` (${s.published_year})` : ''}`
    ).join('\n');
    const listText = candidates.map((b, i) =>
      `${i+1}. ${b.title} / ${(b.authors||[]).join(', ')}${b.published_year ? ` (${b.published_year})` : ''}\n` +
      `${b.description ? `   ${b.description.slice(0, 160)}…\n` : ''}`
    ).join('\n');

    const { object } = await generateObject({
      model: openai('gpt-4o'),
      schema: Result,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text:
            `以下の参考本を好みの手がかりに、候補リストから${n}冊、日本語で推薦してください。
             難易度:${hardness} / 言語優先:${language}。各推薦に1〜2文の理由を。必ず厳格JSON。`
          },
          { type: 'text', text: `【参考本】\n${seedText}` },
          { type: 'text', text: `【候補リスト】\n${listText}` },
        ]
      }]
    });

    // 3) 可能なら候補の source 情報を付加
    const out = object?.recommendations?.map((r: any) => {
      const hit = candidates.find(c =>
        c.title?.toLowerCase() === r.title?.toLowerCase() ||
        (r.authors?.[0] && (c.authors||[])[0]?.toLowerCase() === r.authors[0]?.toLowerCase())
      );
      if (hit) {
        r.source = {
          api: hit.source,
          id: hit.source_id || hit.isbn13 || '',
          info_url: hit.source === 'google'
            ? (hit.metadata?.infoLink || (hit.source_id ? `https://books.google.com/books?id=${encodeURIComponent(hit.source_id)}` : undefined))
            : (hit.metadata?.info_url || ''),
        };
      }
      return r;
    }) || [];

    return NextResponse.json({ recommendations: out.slice(0, n) });
  } catch (e: any) {
    return NextResponse.json({ error: 'recommend-curated-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}