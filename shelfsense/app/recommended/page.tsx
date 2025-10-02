// app/recommended/page.tsx
import Link from 'next/link';
import { listRecommended } from '@/lib/db';

// 画像URLの補完（Google / OpenLibrary のIDから取得）
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

export default async function RecommendedPage() {
  // ← 引数なしで呼ぶ（listRecommended()）
  const rows = await listRecommended();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Recommended（おすすめ保存）</h2>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← ホームへ</Link>
      </div>

      {!rows?.length && (
        <p className="text-sm text-gray-600">まだ保存されたおすすめはありません。</p>
      )}

      <ul className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {rows?.map((r: any) => {
          const img = coverUrlFromBook(r.book);
          return (
            <li key={r.id} className="p-3 border rounded-xl bg-white">
              <div className="flex gap-3">
                {img ? (
                  <img src={img} alt={r.book?.title || 'cover'} className="w-16 h-24 object-cover rounded" />
                ) : (
                  <div className="w-16 h-24 bg-gray-200 rounded flex items-center justify-center text-xs">
                    No image
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{r.book?.title}</div>
                  <div className="text-xs text-gray-600">{(r.book?.authors || []).join(', ')}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{r.book?.isbn13 || ''}</div>
                  <div className="text-[10px] text-gray-500 mt-2 line-clamp-3">{r.reason || ''}</div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}