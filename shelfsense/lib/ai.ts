// lib/ai.ts
// 画像→候補抽出 は OpenAI Responses API を直叩き（json_schema指定）
// 埋め込みは text-embedding-3-small（1536次元）

type Candidate = {
  title?: string;
  authors?: string[];
  isbn?: string;
  confidence?: number;
};

function assertEnv(name: string, val?: string) {
  if (!val) throw new Error(`${name} is missing`);
  return val;
}

export async function extractBooksFromImage(imageDataUrl: string): Promise<Candidate[]> {
  const apiKey = assertEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY);

  // JSON Schema（トップレベルは object → items: Candidate[]）
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            authors: { type: 'array', items: { type: 'string' } },
            isbn: { type: 'string' },
            confidence: { type: 'number' }
          }
        }
      }
    },
    required: ['items']
  };

  const payload = {
    model: 'gpt-4o',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              '画像内の本（背表紙/表紙）から候補を抽出してください。' +
              '各要素は {title, authors[], isbn?, confidence(0-1)}。' +
              '無い項目は省略してよいが、必ず JSON Schema に厳密に従ってください。' +
              '日本語の縦書き・背表紙にも対応して。'
          },
          { type: 'input_image', image_url: { url: imageDataUrl } }
        ]
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'Extraction',
        schema,
        strict: true
      }
    }
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  // 取り出し（output_text か、output[].content[].text どちらか）
  const text =
    data?.output_text ??
    data?.output?.[0]?.content?.[0]?.text ??
    null;

  if (!text) {
    // モデルが別形式を返したときの保険
    return Array.isArray(data?.items) ? data.items : [];
  }

  try {
    const obj = JSON.parse(text);
    return Array.isArray(obj?.items) ? obj.items : [];
  } catch {
    // JSONが壊れても落とさない
    return [];
  }
}

export async function embed(text: string): Promise<number[]> {
  const apiKey = assertEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text })
  });
  const j = await r.json();
  return j?.data?.[0]?.embedding ?? [];
}

// lib/ai.ts の末尾などに追記
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

const SpineCandidate = z.object({
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  isbn: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
const SpineExtraction = z.object({ items: z.array(SpineCandidate) });

/** OCR文字列から、書名/著者/ISBNの候補を厳格JSONで抽出 */
export async function extractCandidatesFromText(text: string) {
  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: SpineExtraction,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text:
`以下は本の背表紙/表紙からOCRで拾った文字列です。ノイズや縦書きの崩れ、順不同が含まれます。
ここから「妥当な書名・著者・ISBN」を最大10件、{title, authors[], isbn?, confidence(0-1)} の配列にして返してください。
シリーズ名や帯コピーは除外、著者が複数なら配列に。日本語/英語混在可。必ず厳格JSONで。`
        },
        { type: 'text', text }
      ]
    }]
  });
  return object?.items ?? [];
}

/** タイトル正規化用（突合時に使う） */
export function normalizeTitle(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/[【】［］\[\]()（）,:：;・\-–—'’"“”!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}