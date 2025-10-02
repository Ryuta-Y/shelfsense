// app/api/scan/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { extractBooksFromImage } from '@/lib/ai';
import { searchGoogleBooks, searchOpenLibrary } from '@/lib/books';
import { upsertBooks } from '@/lib/db';
import sharp from 'sharp';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('image') as File | null;
    if (!file) return NextResponse.json({ error: 'image required' }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 });
    }

    // HEIC 等 → JPEG + autorotate + 最低幅補正
    let buf = Buffer.from(await file.arrayBuffer());
    let img = sharp(buf).rotate();
    const meta = await img.metadata();
    if ((meta.width || 0) < 1200) img = img.resize({ width: 1600, withoutEnlargement: false });
    const processedU8 = new Uint8Array(await img.jpeg({ quality: 85 }).toBuffer());
    // そのままバイナリを渡せる関数なら processedU8 を渡す
    // もし base64 データURLが必要なら：
    const base64 = `data:image/jpeg;base64,${Buffer.from(processedU8).toString('base64')}`;


    // ★ Responses API ベースの抽出
    const candidates = await extractBooksFromImage(base64);

    // タイトル/著者で突合
    const results: any[] = [];
    for (const c of candidates.slice(0, 10)) {
      const q = `${c.title || ''} ${Array.isArray(c.authors) ? c.authors[0] || '' : ''}`.trim();
      if (!q) continue;
      const [g, o] = await Promise.all([searchGoogleBooks(q), searchOpenLibrary(q)]);
      const matches = [...g, ...o].slice(0, 3);
      results.push({ candidate: c, matches });
    }

    const best = results.map(r => r.matches?.[0]).filter(Boolean);
    if (best.length) await upsertBooks(best);

    return NextResponse.json({ candidates, results });
  } catch (e: any) {
    console.error('[scan] fatal:', e);
    return NextResponse.json({ error: 'scan-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}