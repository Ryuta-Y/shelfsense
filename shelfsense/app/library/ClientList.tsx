// app/library/ClientList.tsx
'use client';

import { useMemo, useState } from 'react';

type Row = {
  id: string;
  created_at: string;
  is_favorite: boolean;
  cover: string | null;
  href: string | null;
  book: {
    id: string;
    title: string;
    authors?: string[];
    isbn13?: string;
    description?: string;
    source?: string;
    source_id?: string;
    cover_url?: string;
    metadata?: any;
  };
};

export default function ClientList({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const allChecked = useMemo(() => rows.length > 0 && rows.every(r => selected[r.id]), [rows, selected]);

  async function toggleFavorite(id: string, value: boolean) {
    await fetch('/api/library/favorite', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ id, value }),
    });
    setRows(rs => rs.map(r => r.id === id ? { ...r, is_favorite: value } : r));
  }

  async function removeOne(id: string) {
    await fetch(`/api/library/${id}`, { method: 'DELETE' });
    setRows(rs => rs.filter(r => r.id !== id));
  }

  async function bulkDelete() {
    const ids = rows.filter(r => selected[r.id]).map(r => r.id);
    if (!ids.length) return;
    await fetch('/api/library/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ ids }),
    });
    setRows(rs => rs.filter(r => !ids.includes(r.id)));
    setSelected({});
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(e) => {
              const v = e.target.checked;
              const m: Record<string, boolean> = {};
              rows.forEach(r => { m[r.id] = v; });
              setSelected(m);
            }}
          />
          全選択
        </label>
        <button
          className="px-3 py-1 border rounded text-sm"
          onClick={bulkDelete}
          disabled={Object.values(selected).every(v => !v)}
        >
          選択を削除
        </button>
      </div>

      {!rows.length ? (
        <p className="text-sm text-gray-500">まだ本がありません。バーコード追加やおすすめ生成から保存してみてください。</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="p-3 border rounded-xl bg-white flex gap-3 items-start">
              {r.cover ? (
                <img src={r.cover} alt={r.book.title} className="w-16 h-24 object-cover rounded" />
              ) : (
                <div className="w-16 h-24 bg-gray-200 rounded flex items-center justify-center text-xs">No image</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold break-words">
                  <a href={r.href || '#'} target="_blank" rel="noreferrer" className="hover:underline">
                    {r.book.title}
                  </a>
                </div>
                <div className="text-sm text-gray-600">{(r.book.authors || []).join(', ')}</div>
                <div className="text-xs text-gray-500">{r.book.isbn13 || ''}</div>
                {r.book.description ? (
                  <p className="text-xs text-gray-700 mt-1 line-clamp-3">{r.book.description}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    className="px-2 py-1 border rounded text-sm"
                    onClick={() => toggleFavorite(r.id, !r.is_favorite)}
                    title="お気に入り"
                  >
                    {r.is_favorite ? '★ お気に入り' : '☆ お気に入り'}
                  </button>
                  <button
                    className="px-2 py-1 border rounded text-sm text-red-700"
                    onClick={() => removeOne(r.id)}
                  >
                    削除
                  </button>
                </div>
              </div>
              <div className="pt-1">
                <input
                  type="checkbox"
                  checked={!!selected[r.id]}
                  onChange={(e) => setSelected(s => ({ ...s, [r.id]: e.target.checked }))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}