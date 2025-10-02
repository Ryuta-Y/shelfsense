// app/api/recommend-from-image/route.ts
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { searchGoogleBooks, searchOpenLibrary } from '@/lib/books';
import { openai } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';

const Extraction = z.object({
  items: z.array(z.object({
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    isbn: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).optional()
});

const Rec = z.object({
  title: z.string(),
  authors: z.array(z.string()).optional(),
  reason: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  relatedTo: z.array(z.string()).optional(),
  source: z.object({
    api: z.enum(['google','openlibrary']).optional(),
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
  recommendations: z.array(Rec),
});

const nrm = (s: string) =>
  (s || '').toLowerCase()
    .replace(/[【】［］\[\]()（）,:：;・\-–—'’"“”!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('image') as File | null;
    const n = Number(form.get('n') || 5);
    const language = String(form.get('language') || 'ja');
    const hardness = String(form.get('hardness') || 'auto');
    if (!file) return NextResponse.json({ error: 'image required' }, { status: 400 });

    // HEIC等はJPEGへ正規化（安全）
    let buf = Buffer.from(await file.arrayBuffer());
    let img = sharp(buf).rotate().normalize();
    const meta = await img.metadata();
    if ((meta.width || 0) < 1200) img = img.resize({ width: 1600, withoutEnlargement: false });
    const processedU8 = new Uint8Array(await img.jpeg({ quality: 85 }).toBuffer());
    const base64 = `data:image/jpeg;base64,${Buffer.from(processedU8).toString('base64')}`;
    

    // 1) Vision 抽出（失敗したらテキスト型にフォールバック）
    async function runVision() {
      const { object } = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: Extraction,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text:
              '画像は本棚の背表紙です。書名・著者・ISBNを可能な範囲で抽出して items[] に格納。誤読ありうるので confidence(0〜1) を入れ、無いキーは省略可。' },
            { type: 'image', image: base64 },
          ]
        }]
      });
      return object?.items || [];
    }

    let seeds: any[] = [];
    try {
      seeds = await runVision();
    } catch {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '画像は本棚の背表紙です。タイトル/著者/ISBN を箇条書きでできるだけ列挙してください。' },
            { type: 'image', image: base64 },
          ]
        }]
      });
      seeds = text.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12).map(t => ({ title: t }));
    }

    // 2) 実在突合（Google/OpenLibrary; JSON以外は空配列で回避済み）
    const resolved: any[] = [];
    for (const s of seeds.slice(0, 10)) {
      let res: any[] = [];
      try {
        if (s.isbn) {
          const [g, o] = await Promise.all([searchGoogleBooks(`isbn:${s.isbn}`, { maxResults: 6 }), searchOpenLibrary(s.isbn, { maxResults: 6 })]);
          res = [...g, ...o];
        } else if (s.title) {
          const q1 = `intitle:"${s.title}"`;
          const q2 = s.authors?.[0] ? `intitle:"${s.title}" inauthor:"${s.authors[0]}"` : '';
          const [g1, g2, o] = await Promise.all([
            searchGoogleBooks(q1, { langRestrict: language, maxResults: 6 }),
            q2 ? searchGoogleBooks(q2, { langRestrict: language, maxResults: 6 }) : Promise.resolve([]),
            searchOpenLibrary(s.title, { maxResults: 6 }),
          ]);
          res = [...g1, ...g2, ...o];
        }
      } catch {
        res = [];
      }

      const tSeed = nrm(s.title || ''), aSeed = (s.authors?.[0] || '').toLowerCase();
      let best: any = null, bestScore = -1;
      for (const r of res) {
        let score = 0;
        score += tSeed && r.title ? (nrm(r.title) === tSeed ? 1 : (nrm(r.title).includes(tSeed) ? 0.6 : 0)) : 0;
        if (aSeed && (r.authors || [])[0]) score += ((r.authors[0].toLowerCase().includes(aSeed)) ? 0.3 : 0);
        if (s.isbn && r.isbn13 && r.isbn13.includes(s.isbn)) score += 0.8;
        if (score > bestScore) { bestScore = score; best = r; }
      }
      if (best) resolved.push(best);
    }

    // 3) 候補プール（安全化）
    const queries = new Set<string>();
    for (const s of resolved.slice(0, 6)) {
      if (s.title) {
        queries.add(`intitle:"${s.title}"`);
        const head = s.title.split(/[：:\-\s]/)[0]?.slice(0, 12) || s.title.slice(0, 12);
        queries.add(head);
      }
      if (s.authors?.[0]) queries.add(`inauthor:"${s.authors[0]}"`);
    }
    if (queries.size === 0) queries.add('programming');

    const pool: any[] = [];
    for (const q of Array.from(queries).slice(0, 8)) {
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
    }).slice(0, 80);

    // 4) LLM推薦（構造化 → テキストfallback）
    const seedTitles = resolved.map((s: any) => s.title).filter(Boolean);
    const seedText = resolved.map((s: any) =>
      `- ${s.title}${s.authors?.length ? ` / ${s.authors.join(', ')}` : ''}${s.published_year ? ` (${s.published_year})` : ''}`
    ).join('\n');
    const listText = candidates.map((b, i) =>
      `${i+1}. ${b.title} / ${(b.authors||[]).join(', ')}${b.published_year ? ` (${b.published_year})` : ''}\n` +
      `${b.description ? `   ${b.description.slice(0, 160)}…\n` : ''}`
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
            { type: 'text', text: `【参考本（画像から確定）】\n${seedText || '(empty)'}` },
            { type: 'text', text: `【候補リスト】\n${listText || '(empty)'}` },
          ]
        }]
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

    const seedTitleSet = new Set(resolved.map((s: any) => nrm(s.title || '')));
    const seedIsbnSet  = new Set(resolved.map((s: any) => s.isbn13).filter(Boolean));

    // 5) source付与 & 同一排除
    let recs = (object?.recommendations || []).map((r: any) => {
      const hit = candidates.find(c =>
        nrm(c.title) === nrm(r.title) ||
        (r.authors?.[0] && (c.authors||[])[0] && (c.authors[0].toLowerCase() === r.authors[0].toLowerCase()))
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

    // 6) 多参考本優先スコア + 偏り抑制
    const seedSet = new Set(seedTitles.map(nrm));
    recs = recs.map((r: any) => {
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

    for (const r of recs) {
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
      extractedSeeds: seeds,
      resolved,
      recommendations: picked.slice(0, n).map(({ __score, __related, ...rest }: any) => rest),
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'recommend-from-image-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}