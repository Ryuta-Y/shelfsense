// app/api/lookup/route.ts
import { NextResponse } from 'next/server';
import { upsertBooksShallow, saveToLibrary, type ShallowBook } from '@/lib/db';

export const runtime = 'nodejs';

/** Google Books から ISBN で検索 */
async function fetchGoogleByIsbn(isbn: string): Promise<ShallowBook[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=5`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  const json: any = await r.json();
  const items = Array.isArray(json?.items) ? json.items : [];
  return items.map((it: any) => {
    const v = it?.volumeInfo || {};
    return {
      title: v.title || '(no title)',
      authors: v.authors || [],
      isbn13: Array.isArray(v.industryIdentifiers)
        ? (v.industryIdentifiers.find((x: any) => x.type?.includes('ISBN_13'))?.identifier || null)
        : null,
      language: v.language || null,
      published_year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null,
      description: v.description || '',
      cover_url: v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '',
      source: 'google',
      source_id: it.id || null,
      metadata: {
        pageCount: v.pageCount || 0,
        categories: v.categories || [],
      },
    } as ShallowBook;
  });
}

/** Open Library から ISBN で検索（フォールバック） */
async function fetchOpenLibraryByIsbn(isbn: string): Promise<ShallowBook[]> {
  const base = `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`;
  const r = await fetch(base, { cache: 'no-store' });
  if (!r.ok) return [];
  const b: any = await r.json();
  // 著者名は別API参照が必要だが、最低限の形で返す
  return [{
    title: b.title || '(no title)',
    authors: [], // 著者名は省略（簡略）
    isbn13: isbn,
    language: Array.isArray(b.languages) ? (b.languages[0]?.key?.split('/')?.pop() || null) : null,
    published_year: b.publish_date ? Number(String(b.publish_date).slice(-4)) || null : null,
    description: typeof b.description === 'string' ? b.description : (b.description?.value || ''),
    cover_url: '', // coverは別エンドポイントだが省略（UI側の補完に任せる）
    source: 'openlibrary',
    source_id: b.key ? String(b.key) : null, // 例: "/books/OLxxxxM"
    metadata: b,
  }];
}

/** 重複除去（source, source_id 基準） */
function dedupeBooks(arr: ShallowBook[]): ShallowBook[] {
  const seen = new Set<string>();
  const out: ShallowBook[] = [];
  for (const b of arr) {
    const key = `${b.source}:${b.source_id || b.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const isbn = (searchParams.get('isbn') || '').trim();
    if (!isbn) {
      return NextResponse.json({ error: 'bad-request', detail: 'isbn is required' }, { status: 400 });
    }

    // 1) データ取得（Google → OpenLibraryフォールバック）
    const g = await fetchGoogleByIsbn(isbn);
    const o = g.length ? [] : await fetchOpenLibraryByIsbn(isbn);
    const matches = dedupeBooks([...g, ...o]);

    // 取得ゼロでも形式は返す
    if (matches.length === 0) {
      return NextResponse.json({ matches: [], saved: 0 });
    }

    // 2) DB upsert（books）
    const { data: savedRows, error: upErr } = await upsertBooksShallow(matches);
    if (upErr) {
      return NextResponse.json({ error: 'upsert-failed', detail: upErr.message }, { status: 500 });
    }

    // 3) Library にも登録（一覧表示に出すため）
    //    saveToLibrary は ShallowBook[] を受ける想定なので、savedRows をそのまま渡してOK
    const { saved } = await saveToLibrary(savedRows as any);

    return NextResponse.json({ matches: savedRows, saved });
  } catch (e: any) {
    return NextResponse.json({ error: 'lookup-failed', detail: e?.message || String(e) }, { status: 500 });
  }
}