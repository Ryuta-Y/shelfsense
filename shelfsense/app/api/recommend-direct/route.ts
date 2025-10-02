// app/api/recommend-direct/route.ts
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';

const Rec = z.object({
  title: z.string(),
  authors: z.array(z.string()).optional(),
  reason: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});
const Result = z.object({
  extracted: z.array(z.object({
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    isbn: z.string().optional(),
  })),
  recommendations: z.array(Rec)
});

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('image') as File | null;
    const n = Number(form.get('n') || 8);
    const lang = String(form.get('language') || 'ja');
    const hardness = String(form.get('hardness') || 'auto'); // 難易度（任意）

    if (!file) return NextResponse.json({ error: 'image required' }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 });
    }

    // 受け取り & HEIC→JPEG, autorotate, 軽いアップサンプリング
    let buf = Buffer.from(await file.arrayBuffer());
    let img = sharp(buf).rotate();
    const meta = await img.metadata();
    if ((meta.width || 0) < 1200) img = img.resize({ width: 1600, withoutEnlargement: false });
    // JPEG化 → Uint8Array に寄せる（Bufferの型差異を回避）
    const processedU8 = new Uint8Array(await img.jpeg({ quality: 85 }).toBuffer());

    // base64 文字列へ（Buffer.from(Uint8Array) は型ブレなし）
    const base64 = `data:image/jpeg;base64,${Buffer.from(processedU8).toString('base64')}`;

    // LLMに「抽出→推薦」を丸ごと依頼（厳格JSON）
    const { object } = await generateObject({
      model: openai('gpt-4o'),
      schema: Result,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text:
            [
              'この画像に写っている本の背表紙/表紙から、判別できる書名・著者・ISBNを可能な範囲で抽出し、',
              'それらを好みの手がかりとして、新しく読むべきおすすめ本を', String(n), '冊、',
              `言語は優先的に「${lang}」で、難易度は「${hardness}」の希望を考慮して提案してください。`,
              '各おすすめは {title, authors[], reason, confidence(0-1)} で出力してください。',
              '抽出に自信がない場合でも推測で構いません（誤っていてもOK）。',
              'ただし最終出力は必ずスキーマ通りの厳格JSONにしてください。'
            ].join(' ')
          },
          { type: 'image', image: base64, mediaType: 'image/jpeg' }
        ]
      }],
      providerOptions: { openai: { imageDetail: 'high' } }
    });

    return NextResponse.json(object);
  } catch (e: any) {
    return NextResponse.json({ error: 'recommend-direct-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}