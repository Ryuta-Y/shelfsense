// app/library/page.tsx
import Link from 'next/link';
import { supabase } from '@/lib/db';
import ClientList from './ClientList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function coverUrlFromBook(b: any): string | null {
  if (b?.cover_url) return b.cover_url;
  if (b?.source === 'google' && b?.source_id) {
    return `https://books.google.com/books/content?id=${encodeURIComponent(b.source_id)}&printsec=frontcover&img=1&zoom=1`;
  }
  if (b?.source === 'openlibrary' && b?.source_id) {
    const olid = String(b.source_id).replace(/^OLID:/i, '');
    return `https://covers.openlibrary.org/b/olid/${encodeURIComponent(olid)}-M.jpg`;
  }
  return null;
}

function infoLinkFromBook(b: any): string | null {
  const info = b?.metadata?.infoLink || b?.metadata?.info_url;
  if (info) return info as string;
  if (b?.source === 'google' && b?.source_id) {
    return `https://books.google.com/books?id=${encodeURIComponent(b.source_id)}`;
  }
  if (b?.source === 'openlibrary') {
    const key = String(b?.metadata?.key || b?.source_id || '').replace(/^OLID:/i, '');
    if (key) {
      if (key.startsWith('/works/')) return `https://openlibrary.org${key}`;
      return `https://openlibrary.org/books/${encodeURIComponent(key)}`;
    }
  }
  const q = [b?.title, (b?.authors || [])[0]].filter(Boolean).join(' ');
  if (q) return `https://www.google.com/search?tbm=bks&q=${encodeURIComponent(q)}`;
  return null;
}

export default async function LibraryPage() {
  const { data, error } = await supabase
    .from('library_items')
    .select('id, created_at, is_favorite, books(*)')
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Library</h2>
        <p className="text-red-600 text-sm">読み込みエラー: {error.message}</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← ホームへ</Link>
      </div>
    );
  }

  const rowsRaw = (data || []).map((r: any) => ({
    id: r.id,
    created_at: r.created_at,
    is_favorite: !!r.is_favorite,
    book: r.books,
    cover: coverUrlFromBook(r.books),
    href: infoLinkFromBook(r.books),
  }));

  // 念のため重複 book.id を排除
  const seen = new Set<string>();
  const rows = rowsRaw.filter((r) => {
    const bid = r.book?.id as string | undefined;
    if (!bid) return true;
    if (seen.has(bid)) return false;
    seen.add(bid);
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Library</h2>
        <div className="flex gap-3">
          <Link href="/recommended-library" className="text-sm text-blue-600 hover:underline">
            Recommended Library
          </Link>
          <Link href="/recommend" className="text-sm text-blue-600 hover:underline">
            おすすめ生成へ
          </Link>
          <Link href="/" className="text-sm text-blue-600 hover:underline">← ホームへ</Link>
        </div>
      </div>

      <ClientList initialRows={rows} />
    </div>
  );
}