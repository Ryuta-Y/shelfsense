'use client';

import { useEffect, useRef, useState } from 'react';
import CameraCapture from '@/app/components/CameraCapture';

/* ========= ローカルストレージ鍵 ========= */
const LS_KEYS = {
  llm: 'shelfsense:recommend:llm',       // { titles, n, resp }
  image: 'shelfsense:recommend:image',   // { n, resp, lastShotName }
};

/* ========= 共通ヘルパ ========= */

/** どの形のオブジェクトでも妥当な書誌リンクを作る */
function bookLink(b: any): string | null {
  // 形状1: 推薦アイテム { source: { api, id, info_url } }
  if (b?.source && typeof b.source === 'object') {
    if (b.source.info_url) return b.source.info_url;
    if (b.source.api === 'google' && b.source.id) {
      return `https://books.google.com/books?id=${encodeURIComponent(b.source.id)}`;
    }
    if (b.source.api === 'openlibrary' && b.source.id) {
      const id = String(b.source.id).replace(/^OLID:/i, '').replace(/^\/works\//, '');
      return `https://openlibrary.org/${id}`;
    }
  }

  // 形状2: 解決済み実在本 { source: 'google'|'openlibrary'|'manual', source_id, metadata.infoLink/info_url }
  if (typeof b?.source === 'string') {
    if (b?.metadata?.infoLink) return b.metadata.infoLink;
    if (b?.metadata?.info_url) return b.metadata.info_url;
    if (b.source === 'google' && b.source_id) {
      return `https://books.google.com/books?id=${encodeURIComponent(b.source_id)}`;
    }
    if (b.source === 'openlibrary' && b.source_id) {
      const id = String(b.source_id).replace(/^OLID:/i, '').replace(/^\/works\//, '');
      return `https://openlibrary.org/${id}`;
    }
  }

  // どちらも無ければ汎用検索
  if (b?.title) {
    return `https://www.google.com/search?q=${encodeURIComponent(b.title)}+book`;
  }
  return null;
}

/** 保存用に形を薄く正規化（/api/save が期待するキー） */
function normalizeForSave(x: any) {
  const src =
    typeof x?.source === 'string'
      ? x.source
      : (x?.source?.api as 'google' | 'openlibrary' | 'manual' | undefined) || 'manual';
  const srcId =
    (typeof x?.source === 'string' ? x?.source_id : x?.source?.id) ||
    x?.metadata?.key ||
    x?.isbn13 ||
    '';
  const infoUrl = x?.source?.info_url || x?.metadata?.infoLink || x?.metadata?.info_url || bookLink(x) || undefined;
  return {
    title: x.title || '',
    authors: x.authors || [],
    isbn13: x.isbn13 || null,
    language: x.language || null,
    published_year: x.published_year || null,
    description: x.description || '',
    cover_url: x.cover_url || '',
    source: src,
    source_id: srcId || null,
    metadata: { ...(x.metadata || {}), info_url: infoUrl },
  };
}

/** Recommended Library に1冊保存 */
async function saveOneRecommended(item: any, setMsg: (s: string) => void) {
  try {
    const payload = normalizeForSave(item);
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'recommended', items: [payload] }),
    });
    const json = await res.json();
    if (json?.saved != null) setMsg(`Recommended Library に 1 件保存しました（合計: ${json.saved}）。`);
    else setMsg('保存レスポンス: ' + JSON.stringify(json));
  } catch (e: any) {
    setMsg('保存エラー: ' + (e?.message || String(e)));
  }
}

/** Library に1冊保存（解決した参考本などに使用） */
async function saveOneLibrary(item: any, setMsg: (s: string) => void) {
  try {
    const payload = normalizeForSave(item);
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'library', items: [payload] }),
    });
    const json = await res.json();
    if (json?.saved != null) setMsg(`Library に 1 件保存しました（合計: ${json.saved}）。`);
    else setMsg('保存レスポンス: ' + JSON.stringify(json));
  } catch (e: any) {
    setMsg('保存エラー: ' + (e?.message || String(e)));
  }
}

/* ========= ライブラリからタイトルを流し込むピッカー ========= */

type BookRow = { id: string; title: string; authors?: string[] };

function SeedPicker({ onAddTitles }: { onAddTitles: (titles: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [loadingLib, setLoadingLib] = useState(false);
  const [loadingRec, setLoadingRec] = useState(false);
  const [lib, setLib] = useState<BookRow[]>([]);
  const [rec, setRec] = useState<BookRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const fetchLib = async () => {
    setLoadingLib(true);
    try {
      const r = await fetch('/api/library-list');
      const j = await r.json();
      const items: any[] = j?.items || [];
      setLib(items.map((b: any) => ({ id: b.id, title: b.title, authors: b.authors || [] })));
    } finally {
      setLoadingLib(false);
    }
  };
  const fetchRec = async () => {
    setLoadingRec(true);
    try {
      const r = await fetch('/api/recommended-list');
      const j = await r.json();
      const items: any[] = j?.items || [];
      setRec(items.map((x: any) => ({ id: x.book.id, title: x.book.title, authors: x.book.authors || [] })));
    } finally {
      setLoadingRec(false);
    }
  };

  useEffect(() => {
    if (open) {
      if (lib.length === 0) fetchLib();
      if (rec.length === 0) fetchRec();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) => setSelected((m) => ({ ...m, [id]: !m[id] }));

  const add = () => {
    const titles = [
      ...lib.filter((b) => selected[b.id]).map((b) => b.title),
      ...rec.filter((b) => selected[b.id]).map((b) => b.title),
    ];
    const uniq = Array.from(new Set(titles)).filter(Boolean);
    if (uniq.length) onAddTitles(uniq);
  };

  return (
    <div className="border rounded-xl">
      <button className="w-full text-left p-3 font-semibold" onClick={() => setOpen(!open)}>
        📚 ライブラリから選ぶ（Library / Recommended Library）
      </button>
      {open && (
        <div className="p-3 space-y-4">
          <div>
            <div className="font-semibold mb-1">Library</div>
            {loadingLib ? (
              <div className="text-sm text-gray-500">読み込み中…</div>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-auto text-sm">
                {lib.map((b) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!selected[b.id]} onChange={() => toggle(b.id)} />
                    <span>{b.title}{b.authors?.length ? ` / ${b.authors.join(', ')}` : ''}</span>
                  </li>
                ))}
                {!lib.length && <li className="text-xs text-gray-500">（空）</li>}
              </ul>
            )}
          </div>
          <div>
            <div className="font-semibold mb-1">Recommended Library</div>
            {loadingRec ? (
              <div className="text-sm text-gray-500">読み込み中…</div>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-auto text-sm">
                {rec.map((b) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!selected[b.id]} onChange={() => toggle(b.id)} />
                    <span>{b.title}{b.authors?.length ? ` / ${b.authors.join(', ')}` : ''}</span>
                  </li>
                ))}
                {!rec.length && <li className="text-xs text-gray-500">（空）</li>}
              </ul>
            )}
          </div>
          <div>
            <button className="btn px-3 py-2 border rounded" onClick={add}>選んだ本のタイトルを追加</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========= タイトル入力 → 推薦（ローカル保存/復元つき） ========= */

function RecommendLLM() {
  const [titles, setTitles] = useState('');
  const [n, setN] = useState(5);
  const [resp, setResp] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saveInfo, setSaveInfo] = useState<string>('');
  const [saveInfoSeeds, setSaveInfoSeeds] = useState<string>('');

  // --- 復元 ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEYS.llm);
      if (raw) {
        const obj = JSON.parse(raw);
        if (typeof obj?.titles === 'string') setTitles(obj.titles);
        if (typeof obj?.n === 'number') setN(obj.n);
        if (obj?.resp) setResp(obj.resp);
      }
    } catch {}
  }, []);

  // --- 自動保存（タイトル/冊数/結果） ---
  useEffect(() => {
    try {
      const payload = JSON.stringify({ titles, n, resp });
      localStorage.setItem(LS_KEYS.llm, payload);
    } catch {}
  }, [titles, n, resp]);

  const onSubmit = async (e: any) => {
    e.preventDefault();
    setResp(null);
    setSaveInfo('');
    setSaveInfoSeeds('');
    setLoading(true);
    try {
      const arr = titles.split('\n').map(s => s.trim()).filter(Boolean);
      const r = await fetch('/api/recommend-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titles: arr,
          n,
          language: 'ja',
          hardness: 'auto',
        }),
      });
      const json = await r.json();
      setResp(json);
    } catch (e: any) {
      setResp({ error: 'client', detail: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const addTitles = (add: string[]) => {
    const cur = titles.split('\n').map(s => s.trim()).filter(Boolean);
    const next = Array.from(new Set([...cur, ...add]));
    setTitles(next.join('\n'));
  };

  return (
    <div className="space-y-4 p-4 border rounded-2xl">
      <h3 className="font-semibold text-lg">LLM+Web 推薦（タイトル入力）</h3>

      {/* ライブラリからの流し込み */}
      <SeedPicker onAddTitles={addTitles} />

      <form onSubmit={onSubmit} className="space-y-3">
        <textarea
          className="w-full p-2 rounded-xl border border-gray-300 dark:border-gray-700"
          rows={4}
          placeholder={`1行に1冊のタイトルを入力\n例:\n競技プログラミングの鉄則\nやさしいC++`}
          value={titles}
          onChange={(e) => setTitles(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <label className="text-sm">冊数</label>
          <input
            type="number"
            min={1}
            max={20}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            className="w-24 p-2 rounded-xl border border-gray-300 dark:border-gray-700"
          />
          <span className="text-xs text-gray-500">(既定: 5)</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn px-4 py-2 border rounded" disabled={loading}>
            {loading ? '生成中…' : '生成（LLM+Web）'}
          </button>
          <button
            type="button"
            className="btn px-3 py-2 border rounded"
            onClick={() => { setResp(null); setSaveInfo(''); setSaveInfoSeeds(''); }}
            title="表示中の結果だけクリア（入力は残します）"
          >
            結果をクリア
          </button>
        </div>
      </form>

      {/* 解決した参考本（リンク＋Library追加） */}
      {resp?.resolved?.length ? (
        <div className="mt-3 space-y-2">
          <div className="font-semibold">解決した参考本（実在突合結果）</div>
          <ul className="space-y-2 text-sm">
            {resp.resolved.map((b: any, i: number) => {
              const href = bookLink(b);
              return (
                <li key={i} className="p-2 border rounded-md">
                  <div className="font-semibold">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                        {b.title}
                      </a>
                    ) : (
                      b.title
                    )}
                  </div>
                  <div className="text-gray-600">
                    {(b.authors || []).join(', ')}{b.published_year ? ` (${b.published_year})` : ''}
                  </div>
                  <div className="mt-2">
                    <button
                      className="btn px-2 py-1 border rounded"
                      onClick={() => saveOneLibrary(b, setSaveInfoSeeds)}
                    >
                      ＋ Library に追加（この1冊）
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {saveInfoSeeds ? <div className="text-xs text-green-700">{saveInfoSeeds}</div> : null}
        </div>
      ) : null}

      {resp?.error ? (
        <div className="text-sm text-red-600">
          エラー: {resp.error} / {resp.detail || ''}
        </div>
      ) : null}

      {/* おすすめ（リンク＋Recommended保存のみ） */}
      {resp?.recommendations?.length ? (
        <div className="space-y-2">
          <div className="font-semibold mt-2">おすすめ</div>
          <ul className="space-y-2 text-sm">
            {resp.recommendations.map((r: any, i: number) => {
              const href = bookLink(r);
              return (
                <li key={i} className="p-2 border rounded-md">
                  <div className="font-semibold">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}
                  </div>
                  <div className="text-gray-600">{(r.authors || []).join(', ')}</div>
                  {r.relatedTo?.length ? (
                    <div className="text-[11px] text-gray-500 mt-1">関連: {r.relatedTo.join(', ')}</div>
                  ) : null}
                  <div className="text-xs mt-1 whitespace-pre-wrap">{r.reason}</div>
                  <div className="mt-2">
                    <button
                      className="btn px-2 py-1 border rounded"
                      onClick={() => saveOneRecommended(r, setSaveInfo)}
                    >
                      ★ Recommended Library に追加（この1冊）
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {saveInfo ? <div className="text-xs text-green-700">{saveInfo}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ========= 画像1枚 or カメラ撮影 → 推薦（ローカル保存/復元つき） ========= */

function RecommendFromImage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [n, setN] = useState(5);
  const [resp, setResp] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saveInfo, setSaveInfo] = useState<string>('');
  const [saveInfoSeeds, setSaveInfoSeeds] = useState<string>('');
  const [lastShotName, setLastShotName] = useState<string>('');

  // --- 復元 ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEYS.image);
      if (raw) {
        const obj = JSON.parse(raw);
        if (typeof obj?.n === 'number') setN(obj.n);
        if (typeof obj?.lastShotName === 'string') setLastShotName(obj.lastShotName);
        if (obj?.resp) setResp(obj.resp);
      }
    } catch {}
  }, []);

  // --- 自動保存（冊数/結果/撮影名） ---
  useEffect(() => {
    try {
      const payload = JSON.stringify({ n, resp, lastShotName });
      localStorage.setItem(LS_KEYS.image, payload);
    } catch {}
  }, [n, resp, lastShotName]);

  const runWithFile = async (file: File) => {
    setResp(null);
    setSaveInfo('');
    setSaveInfoSeeds('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('n', String(n));
      fd.append('language', 'ja');
      fd.append('hardness', 'auto');

      const r = await fetch('/api/recommend-from-image', { method: 'POST', body: fd });
      const json = await r.json();
      setResp(json);
    } catch (e: any) {
      setResp({ error: 'client', detail: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const onUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setLastShotName(f.name);
    await runWithFile(f);
  };

  const onShot = async (file: File) => {
    setLastShotName('カメラ撮影.jpg');
    await runWithFile(file);
  };

  return (
    <div className="space-y-4 p-4 border rounded-2xl">
      <h3 className="font-semibold text-lg">画像から即推薦（背表紙OK）</h3>

      {/* A) ファイルアップロード */}
      <form onSubmit={onUpload} className="space-y-3">
        <input ref={fileRef} type="file" accept="image/*" className="block w-full text-sm" />
        <div className="flex items-center gap-3">
          <label className="text-sm">冊数</label>
          <input
            type="number"
            min={1}
            max={20}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            className="w-24 p-2 rounded-xl border border-gray-300 dark:border-gray-700"
          />
          <span className="text-xs text-gray-500">(既定: 5)</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn px-4 py-2 border rounded" disabled={loading}>
            {loading ? '生成中…' : '画像から生成'}
          </button>
          <button
            type="button"
            className="btn px-3 py-2 border rounded"
            onClick={() => { setResp(null); setSaveInfo(''); setSaveInfoSeeds(''); setLastShotName(''); }}
            title="表示中の結果をクリア"
          >
            結果をクリア
          </button>
        </div>
      </form>

      {/* B) リアルタイムでカメラ撮影 */}
      <div className="space-y-2">
        <div className="font-semibold">または：カメラで撮影して生成</div>
        <CameraCapture onShot={onShot} />
      </div>

      {lastShotName && <div className="text-xs text-gray-500">入力画像: {lastShotName}</div>}

      {/* 画像から解決された参考本（リンク＋Library追加） */}
      {resp?.resolved?.length ? (
        <div className="mt-3 space-y-2">
          <div className="font-semibold">画像から解決された参考本</div>
          <ul className="space-y-2 text-sm">
            {resp.resolved.map((b: any, i: number) => {
              const href = bookLink(b);
              return (
                <li key={i} className="p-2 border rounded-md">
                  <div className="font-semibold">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                        {b.title}
                      </a>
                    ) : (
                      b.title
                    )}
                  </div>
                  <div className="text-gray-600">
                    {(b.authors || []).join(', ')}{b.published_year ? ` (${b.published_year})` : ''}
                  </div>
                  <div className="mt-2">
                    <button
                      className="btn px-2 py-1 border rounded"
                      onClick={() => saveOneLibrary(b, setSaveInfoSeeds)}
                    >
                      ＋ Library に追加（この1冊）
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {saveInfoSeeds ? <div className="text-xs text-green-700">{saveInfoSeeds}</div> : null}
        </div>
      ) : null}

      {resp?.error ? (
        <div className="text-sm text-red-600">
          エラー: {resp.error} / {resp.detail || ''}
        </div>
      ) : null}

      {/* おすすめ（リンク＋Recommended保存のみ） */}
      {resp?.recommendations?.length ? (
        <div className="space-y-2">
          <div className="font-semibold mt-2">おすすめ</div>
          <ul className="space-y-2 text-sm">
            {resp.recommendations.map((r: any, i: number) => {
              const href = bookLink(r);
              return (
                <li key={i} className="p-2 border rounded-md">
                  <div className="font-semibold">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}
                  </div>
                  <div className="text-gray-600">{(r.authors || []).join(', ')}</div>
                  {r.relatedTo?.length ? (
                    <div className="text-[11px] text-gray-500 mt-1">関連: {r.relatedTo.join(', ')}</div>
                  ) : null}
                  <div className="text-xs mt-1 whitespace-pre-wrap">{r.reason}</div>
                  <div className="mt-2">
                    <button
                      className="btn px-2 py-1 border rounded"
                      onClick={() => saveOneRecommended(r, setSaveInfo)}
                    >
                      ★ Recommended Library に追加（この1冊）
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {saveInfo ? <div className="text-xs text-green-700">{saveInfo}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ========= ページ本体 ========= */

export default function RecommendPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">おすすめ生成</h2>
      <RecommendLLM />
      <RecommendFromImage />
    </div>
  );
}