// app/api/save/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import crypto from 'crypto';

export const runtime = 'nodejs';

/** 許可される source 値のみを返す（それ以外は 'manual'） */
function normalizeSource(raw: any): 'google' | 'openlibrary' | 'manual' {
  const s =
    (typeof raw === 'string' ? raw : raw?.api) ||
    (typeof raw?.source === 'string' ? raw.source : undefined);
  if (s === 'google') return 'google';
  if (s === 'openlibrary') return 'openlibrary';
  return 'manual';
}

/** authors は必ず string[] にする */
function toAuthors(a: any): string[] {
  if (!a) return [];
  if (Array.isArray(a)) return a.map(String).filter(Boolean);
  return [String(a)];
}

/** manual 用の安定 ID（タイトル/著者/ISBN からハッシュ生成） */
function makeManualSourceId(item: any): string {
  const key = [
    item?.isbn13 || '',
    (item?.title || '').toString(),
    (toAuthors(item?.authors) || []).join(','),
  ].join('|');
  return 'm_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** 推薦アイテム or 書誌オブジェクトを books 行に正規化 */
function toBookRow(raw: any) {
  // UI から来る形が {book: {...}} の場合もあるので寄せる
  const item = raw?.book ? raw.book : raw;

  const source = normalizeSource(item?.source ?? item?.source_api);
  let source_id: string | null =
    (typeof item?.source?.id === 'string' ? item.source.id : null) ??
    (typeof item?.source_id === 'string' ? item.source_id : null) ??
    (typeof item?.isbn13 === 'string' ? item.isbn13 : null);

  if (!source_id) {
    // (source,source_id) がユニークなので manual の場合は安定IDを作る
    source_id = source === 'manual' ? makeManualSourceId(item) : null;
  }

  const row = {
    title: String(item?.title || '').trim(),
    authors: toAuthors(item?.authors),
    isbn13: item?.isbn13 ? String(item.isbn13) : null,
    language: item?.language ? String(item.language) : null,
    published_year:
      typeof item?.published_year === 'number'
        ? item.published_year
        : undefined,
    description: String(item?.description || ''),
    cover_url: item?.cover_url ? String(item.cover_url) : '',
    source,
    source_id,
    metadata: ((): any => {
      const m: any = item?.metadata || {};
      // 代表的な infoLink / info_url をメタに入れておく
      const info =
        item?.source?.info_url ||
        item?.metadata?.info_url ||
        item?.metadata?.infoLink ||
        null;
      if (info) m.info_url = info;
      return m;
    })(),
  };

  return row;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const list = String(body?.list || '').trim(); // 'library' | 'recommended'
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!items.length) {
      return NextResponse.json(
        { error: 'no-items', detail: 'items is empty' },
        { status: 400 },
      );
    }
    if (list !== 'library' && list !== 'recommended') {
      return NextResponse.json(
        { error: 'bad-list', detail: "list must be 'library' or 'recommended'" },
        { status: 400 },
      );
    }

    // 1) books へ upsert（source チェック制約に必ず通るよう正規化）
    const rows = items
      .map(toBookRow)
      .filter((r) => r.title && r.source && ['google', 'openlibrary', 'manual'].includes(r.source));

    if (!rows.length) {
      return NextResponse.json(
        { error: 'no-valid-rows', detail: 'no valid book rows' },
        { status: 400 },
      );
    }

    const { data: upserted, error: upsertErr } = await supabase
      .from('books')
      .upsert(rows, { onConflict: 'source,source_id' })
      .select('id, title, source, source_id');

    if (upsertErr) {
      return NextResponse.json(
        { error: 'save-failed', detail: upsertErr.message },
        { status: 500 },
      );
    }

    // 2) ひも付け（library / recommended）
    const bookIds: string[] = Array.isArray(upserted)
      ? upserted.map((r: any) => r.id)
      : [];

    if (!bookIds.length) {
      return NextResponse.json(
        { error: 'link-failed', detail: 'no book ids returned from upsert' },
        { status: 500 },
      );
    }

    if (list === 'library') {
      // Library は単に book_id を保存（ユニークに）
      const linkRows = bookIds.map((id) => ({ book_id: id }));
      const { error: linkErr } = await supabase
        .from('library_items')
        .upsert(linkRows, { onConflict: 'book_id' })
        .select('id');

      if (linkErr) {
        return NextResponse.json(
          { error: 'link-failed', detail: linkErr.message },
          { status: 500 },
        );
      }
      return NextResponse.json({ saved: bookIds.length, list: 'library' });
    } else {
      // Recommended は理由が来ていれば保存
      const reasonMap = new Map<string, string>();
      // rows と upserted を対応付けるため (source,source_id) をキーにする
      const key = (s: string | null, id: string | null) => `${s ?? ''}::${id ?? ''}`;

      for (const raw of items) {
        const itm = raw?.book ? raw.book : raw;
        const s = normalizeSource(itm?.source ?? itm?.source_api);
        const sid =
          (typeof itm?.source?.id === 'string' ? itm.source.id : null) ??
          (typeof itm?.source_id === 'string' ? itm.source_id : null) ??
          (typeof itm?.isbn13 === 'string' ? itm.isbn13 : null) ??
          (s === 'manual' ? makeManualSourceId(itm) : null);

        const k = key(s, sid);
        if (raw?.reason) reasonMap.set(k, String(raw.reason));
      }

      // upserted に対して reason を結合
      const linkRows = (upserted || []).map((b: any) => {
        const k = key(b.source ?? null, b.source_id ?? null);
        return {
          book_id: b.id,
          reason: reasonMap.get(k) || '',
        };
      });

      const { error: linkErr } = await supabase
        .from('recommended_items')
        .upsert(linkRows, { onConflict: 'book_id' })
        .select('id');

      if (linkErr) {
        return NextResponse.json(
          { error: 'link-failed', detail: linkErr.message },
          { status: 500 },
        );
      }
      return NextResponse.json({ saved: bookIds.length, list: 'recommended' });
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: 'save-failed', detail: e?.message || String(e) },
      { status: 500 },
    );
  }
}