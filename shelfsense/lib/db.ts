// lib/db.ts
// サーバー専用（API ルートなど）でのみ import してください。
// フロント（'use client'）からは絶対に import しないこと。
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[lib/db] Missing envs: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------
// 型
// ---------------------------------------------
export type ShallowBook = {
  title: string;
  authors?: string[];
  isbn13?: string | null;
  language?: string | null;
  published_year?: number | null;
  description?: string;
  cover_url?: string;
  source: 'google' | 'openlibrary' | 'manual';
  source_id?: string | null;
  metadata?: Record<string, any>;
};

// ---------------------------------------------
// 書誌の薄い upsert（(source,source_id) でユニーク）
// ---------------------------------------------
export async function upsertBooksShallow(rows: ShallowBook[]) {
  if (!rows?.length) return { data: [], error: null };

  const payload = rows.map((r) => ({
    title: r.title || '(no title)',
    authors: r.authors || [],
    isbn13: r.isbn13 || null,
    language: r.language || null,
    published_year: r.published_year ?? null,
    description: r.description || '',
    cover_url: r.cover_url || '',
    source: (r.source || 'manual') as 'google' | 'openlibrary' | 'manual',
    source_id: r.source_id || null,
    metadata: r.metadata || {},
  }));

  const { data, error } = await supabase
    .from('books')
    .upsert(payload, { onConflict: 'source,source_id' })
    .select('id, title, authors, isbn13, language, published_year, cover_url, source, source_id, metadata');

  return { data, error };
}

// 互換（古いコードが import している可能性があるため）
export const upsertBooks = upsertBooksShallow;

// ---------------------------------------------
// 与えられた items を upsert し、books.id を返す
// ---------------------------------------------
export async function ensureBookIds(items: ShallowBook[]): Promise<{ id: string; srcIndex: number }[]> {
  const { data, error } = await upsertBooksShallow(items);
  if (error) throw error;

  const out: { id: string; srcIndex: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const hit =
      data?.find(
        (d: any) =>
          (it.source_id && d.source_id && String(d.source_id) === String(it.source_id) && d.source === it.source) ||
          (!it.source_id && d.title === it.title)
      ) || null;
    if (hit?.id) out.push({ id: hit.id, srcIndex: i });
  }
  return out;
}

// ---------------------------------------------
// Library / Recommended への保存・トグル
// ---------------------------------------------
export async function saveToLibrary(items: ShallowBook[]) {
  const ids = await ensureBookIds(items);
  if (!ids.length) return { saved: 0 };
  const rows = ids.map(({ id }) => ({ book_id: id }));
  const { error } = await supabase.from('library_items').upsert(rows, { onConflict: 'book_id' });
  if (error) throw error;
  return { saved: rows.length };
}

export async function saveToRecommended(items: ShallowBook[], reasons?: (string | undefined)[]) {
  const ids = await ensureBookIds(items);
  if (!ids.length) return { saved: 0 };
  const rows = ids.map(({ id }, i) => ({ book_id: id, reason: reasons?.[i] || null as any }));
  const { error } = await supabase.from('recommended_items').upsert(rows, { onConflict: 'book_id' });
  if (error) throw error;
  return { saved: rows.length };
}

// 既存の API が参照している互換エイリアス
export async function addLibraryByBooks(items: ShallowBook[]) {
  return saveToLibrary(items);
}

export async function toggleLibrary(bookId: string) {
  // あるなら削除、なければ追加
  const { data: exists, error: selErr } = await supabase
    .from('library_items')
    .select('id')
    .eq('book_id', bookId)
    .limit(1);
  if (selErr) throw selErr;

  if (exists && exists.length > 0) {
    const { error } = await supabase.from('library_items').delete().eq('book_id', bookId);
    if (error) throw error;
    return { toggled: 'off' as const };
  } else {
    const { error } = await supabase.from('library_items').insert({ book_id: bookId });
    if (error) throw error;
    return { toggled: 'on' as const };
  }
}

export async function toggleRecommended(bookId: string, reason?: string) {
  const { data: exists, error: selErr } = await supabase
    .from('recommended_items')
    .select('id')
    .eq('book_id', bookId)
    .limit(1);
  if (selErr) throw selErr;

  if (exists && exists.length > 0) {
    const { error } = await supabase.from('recommended_items').delete().eq('book_id', bookId);
    if (error) throw error;
    return { toggled: 'off' as const };
  } else {
    const { error } = await supabase.from('recommended_items').insert({ book_id: bookId, reason: reason || null });
    if (error) throw error;
    return { toggled: 'on' as const };
  }
}

// ---------------------------------------------
// 一覧（Recommended / Library）
// ---------------------------------------------
export async function listRecommended() {
  const { data, error } = await supabase
    .from('recommended_items')
    .select(`
      id,
      reason,
      created_at,
      book:books (
        id, title, authors, isbn13, language, published_year, description, cover_url, source, source_id, metadata
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listLibrary() {
  const { data, error } = await supabase
    .from('library_items')
    .select(`
      id,
      created_at,
      book:books (
        id, title, authors, isbn13, language, published_year, description, cover_url, source, source_id, metadata
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}