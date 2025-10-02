'use client';

import { useEffect, useRef, useState } from 'react';
import Quagga from '@ericblade/quagga2';

export default function BarcodeScanner() {
  const mountRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const handlerRef = useRef<((data: any) => void) | null>(null);

  const [code, setCode] = useState<string | null>(null);
  const [lookup, setLookup] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 型に無いAPI(reset等)を安全に呼べるよう any に寄せる
  const Q: any = Quagga as any;

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (!mountRef.current || startedRef.current) return;
      setError(null);

      // iOS / デスクトップ両対応の制約（背面カメラ優先）
      const constraints: MediaTrackConstraints = {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      };

      Quagga.init(
        {
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: mountRef.current,
            constraints,
          },
          decoder: {
            readers: ['ean_reader', 'ean_8_reader', 'upc_reader'],
          },
          locate: true,
          numOfWorkers:
            typeof navigator !== 'undefined' && (navigator as any).hardwareConcurrency
              ? Math.min(4, (navigator as any).hardwareConcurrency)
              : 2,
        },
        (err) => {
          if (cancelled) return;
          if (err) {
            setError(err.message || String(err));
            return;
          }

          Quagga.start();
          startedRef.current = true;

          // 既存のハンドラを外す（多重登録防止）
          try {
            if (handlerRef.current) Quagga.offDetected(handlerRef.current as any);
          } catch {}

          handlerRef.current = async (data: any) => {
            const c = data?.codeResult?.code as string | undefined;
            if (!c || busy) return;

            setBusy(true);
            setCode(c);
            setLookup(null);

            // 一旦停止（フリーズ対策：stop → reset? を「存在チェック」で呼ぶ）
            try {
              Quagga.stop();
            } catch {}
            try {
              // 型定義に無いが実装されている場合があるため any 経由で安全に呼ぶ
              if (typeof Q.reset === 'function') Q.reset();
            } catch {}
            startedRef.current = false;

            // ISBN（日本の書籍バーコード：上段 978/979 がISBN、下段 192…は価格コード）
            const isbn = c.startsWith('978') || c.startsWith('979') ? c : c;

            try {
              const res = await fetch(`/api/lookup?isbn=${encodeURIComponent(isbn)}`, {
                cache: 'no-store',
              });
              if (!res.ok) {
                const t = await res.text().catch(() => '');
                throw new Error(`lookup failed (${res.status}): ${t}`);
              }
              const json = await res.json();
              setLookup(json);
            } catch (e: any) {
              setError(e?.message || String(e));
            } finally {
              setBusy(false);
            }
          };

          Quagga.onDetected(handlerRef.current as any);
        },
      );
    };

    start();

    return () => {
      cancelled = true;
      try {
        if (handlerRef.current) Quagga.offDetected(handlerRef.current as any);
      } catch {}
      try {
        Quagga.stop();
      } catch {}
      try {
        if (typeof Q.reset === 'function') Q.reset();
      } catch {}
      startedRef.current = false;
    };
  }, []);

  const restart = async () => {
    setCode(null);
    setLookup(null);
    setError(null);
    setBusy(false);

    // 再起動：既存インスタンスを確実に停止・解放してから
    try {
      Quagga.stop();
    } catch {}
    try {
      if (typeof (Quagga as any).reset === 'function') (Quagga as any).reset();
    } catch {}
    startedRef.current = false;

    // 少し待ってから再初期化（カメラデバイスの再確保待ち）
    setTimeout(() => {
      // 再マウントと同等の効果を狙って単純にページをリロード
      // もしリロードしたくなければ、useEffect の start() を分離して明示呼び出ししてもOK
      if (typeof window !== 'undefined') window.location.reload();
    }, 150);
  };

  return (
    <div className="space-y-3">
      <div ref={mountRef} className="w-full aspect-video bg-black/60 rounded-2xl" />
      <div className="text-sm text-gray-600">
        検出コード: <span className="font-mono">{code || '-'}</span>
      </div>

      {busy && <div className="text-xs text-gray-500">照合中…</div>}
      {error && <div className="text-xs text-red-500">エラー: {error}</div>}

      {lookup && (
        <pre className="text-xs whitespace-pre-wrap max-h-56 overflow-auto border rounded p-2">
          {JSON.stringify(lookup, null, 2)}
        </pre>
      )}

      <div>
        <button
          className="px-3 py-1 rounded border hover:bg-gray-50 dark:hover:bg-gray-800"
          onClick={restart}
          disabled={busy}
        >
          もう一度スキャン
        </button>
      </div>
    </div>
  );
}