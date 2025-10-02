// app/api/recommend-llm/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { searchGoogleBooks, searchOpenLibrary } from '@/lib/books';
import { openai } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';

const Rec = z.object({
  title: z.string(),
  authors: z.array(z.string()).optional(),
  reason: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  relatedTo: z.array(z.string()).optional(),
  source: z.object({
    api: z.enum(['google', 'openlibrary']).optional(),
    id: z.string().optional(),
    info_url: z.string().url().optional(),
  }).optional(),
  isbn13: z.string().optional(),
  cover_url: z.string().optional(),
  description: z.string().optional(),
  language: z.string().optional(),
  published_year: z.number().optional(),
});

const Result = z.object({
  extractedSeeds: z.array(z.object({
    title: z.string(),
    authors: z.array(z.string()).optional(),
    year: z.number().optional(),
    description: z.string().optional(),
  })).optional(),
  recommendations: z.array(Rec),
});

const nrm = (s: string) =>
  (s || '').toLowerCase()
    .replace(/[【】［］\[\]()（）,:：;・\-–—'’"“”!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function enrichByTitle(title: string, lang = 'ja') {
  try {
    const g = await searchGoogleBooks(`intitle:"${title}"`, { orderBy: 'relevance', langRestrict: lang, maxResults: 5 });
    if (g.length) return g[0];
    const o = await searchOpenLibrary(title, { maxResults: 5 });
    return o[0];
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { titles = [], n = 5, language = 'ja', hardness = 'auto' } = body || {};
    if (!Array.isArray(titles) || !titles.length) {
      return NextResponse.json({ error: 'titles required' }, { status: 400 });
    }

    // 1) 参考本を解決
    const seeds: any[] = [];
    const resolved: any[] = [];
    for (const t of titles) {
      const e = await enrichByTitle(String(t), language).catch(() => null);
      if (e?.title) {
        seeds.push({ title: e.title, authors: e.authors || [], year: e.published_year || undefined, description: e.description || '' });
        resolved.push(e);
      } else {
        seeds.push({ title: String(t) });
      }
    }

    // 2) 候補プール（安全化）
    const queries = new Set<string>();
    for (const s of seeds) {
      if (s.title) {
        queries.add(`intitle:"${s.title}"`);
        const head = s.title.split(/[：:\-\s]/)[0]?.slice(0, 12) || s.title.slice(0, 12);
        queries.add(head);
      }
      if (s.authors?.[0]) queries.add(`inauthor:"${s.authors[0]}"`);
    }
    const pool: any[] = [];
    for (const q of Array.from(queries).slice(0, 6)) {
      const [g, o] = await Promise.all([
        searchGoogleBooks(q, { orderBy: q.length < 5 ? 'newest' : 'relevance', langRestrict: language, maxResults: 8 }),
        searchOpenLibrary(q, { maxResults: 8 }),
      ]);
      pool.push(...g, ...o);
    }
    const seenPool = new Set<string>();
    const candidates = pool.filter((b) => {
      const key = `${b.source}:${b.source_id || b.isbn13 || b.title}`;
      if (seenPool.has(key)) return false;
      seenPool.add(key);
      return true;
    }).slice(0, 60);

    // 3) LLM 生成（構造化 → 失敗時テキスト → JSON.parse も try/catch）
    const seedTitles = seeds.map((s: any) => s.title).filter(Boolean);
    const seedText = seeds.map(s => `- ${s.title}${s.authors?.length ? ` / ${s.authors.join(', ')}` : ''}${s.year ? ` (${s.year})` : ''}`).join('\n');
    const listText = candidates.map((b, i) =>
      `${i + 1}. ${b.title} / ${(b.authors || []).join(', ')}${b.published_year ? ` (${b.published_year})` : ''}\n` +
      `${b.description ? `   ${b.description.slice(0, 180)}…\n` : ''}`
    ).join('\n');

    const ATTENTION =
      '注意：参考本と同一の書籍（タイトル一致・ISBN一致）は推薦に含めない。' +
      '優先：複数の参考本と関連する候補を上位に。単一参考本のみ強く関連する候補は順位を下げ、多様性を確保。' +
      '各推薦は3〜5文、reasonは80〜200文字。relatedTo は参考本のタイトルを複数含める。';

    async function runStructured() {
      const { object } = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: Result,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `以下の参考本を手がかりに候補から${n}冊推薦。難易度:${hardness} 言語:${language}。 ${ATTENTION}` },
            { type: 'text', text: `【参考本】\n${seedText || '(empty)'}` },
            { type: 'text', text: `【候補】\n${listText || '(empty)'}` },
          ]
        }],
      });
      return object;
    }

    let object: any = null;
    try {
      object = await runStructured();
    } catch {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `JSONのみ（コードブロック禁止）。{ "recommendations": Array<{ "title": string, "authors"?: string[], "reason": string, "confidence"?: number, "relatedTo"?: string[] }> } で出力。 ${ATTENTION}` },
            { type: 'text', text: `【参考本】\n${seedText || '(empty)'}` },
            { type: 'text', text: `【候補】\n${listText || '(empty)'}` },
          ]
        }]
      });
      try { object = JSON.parse(text); } catch { object = { recommendations: [] }; }
    }

    const seedTitleSet = new Set(seeds.map((s:any)=>nrm(s.title||'')));
    const seedIsbnSet  = new Set(resolved.map((s:any)=>s.isbn13).filter(Boolean));

    // 4) source付与 & 同一排除
    let out = (object?.recommendations || []).map((r: any) => {
      const hit = candidates.find(c =>
        nrm(c.title) === nrm(r.title) ||
        (r.authors?.[0] && (c.authors || [])[0]?.toLowerCase() === r.authors[0].toLowerCase())
      );
      if (hit) {
        r.isbn13 = hit.isbn13 || r.isbn13;
        r.cover_url = hit.cover_url || r.cover_url;
        r.description = hit.description || r.description;
        r.language = hit.language || r.language;
        r.published_year = hit.published_year || r.published_year;
        r.source = {
          api: hit.source,
          id: hit.source_id || hit.isbn13 || '',
          info_url:
            hit.metadata?.infoLink
            || (hit.source === 'google' && hit.source_id ? `https://books.google.com/books?id=${encodeURIComponent(hit.source_id)}` : undefined)
            || (hit.metadata?.info_url || undefined),
        };
      } else {
        delete r.source;
      }
      return r;
    }).filter((r: any) => {
      const t = nrm(r.title || '');
      if (seedTitleSet.has(t)) return false;
      const hit = candidates.find(c => nrm(c.title) === t);
      if (hit?.isbn13 && seedIsbnSet.has(hit.isbn13)) return false;
      return true;
    });

    // 5) 多参考本優先スコア + 偏り抑制
    const seedSet = new Set(seedTitles.map(nrm));
    out = out.map((r: any) => {
      const related = (r.relatedTo || []).map((t: string) => nrm(t)).filter((t: string) => seedSet.has(t));
      const relatedCount = related.length;
      const base = typeof r.confidence === 'number' ? r.confidence : 0.5;
      const penalty = relatedCount === 1 ? 0.15 : 0;
      const score = base + 0.22 * relatedCount - penalty;
      return { ...r, __score: score, __related: related };
    }).sort((a: any, b: any) => (b.__score - a.__score));

    const cap = Math.ceil(n / 2);
    const perSeed: Record<string, number> = {};
    const picked: any[] = [];
    const rest: any[] = [];

    for (const r of out) {
      const main = r.__related?.[0] || '';
      if (main) {
        perSeed[main] = perSeed[main] || 0;
        if (perSeed[main] < cap) { perSeed[main]++; picked.push(r); }
        else { rest.push(r); }
      } else { rest.push(r); }
      if (picked.length >= n) break;
    }
    for (const r of rest) {
      if (picked.length >= n) break;
      picked.push(r);
    }

    return NextResponse.json({
      resolved,
      extractedSeeds: object?.extractedSeeds || [],
      recommendations: picked.slice(0, n).map(({ __score, __related, ...rest }: any) => rest),
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'recommend-llm-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}