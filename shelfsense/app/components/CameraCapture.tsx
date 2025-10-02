'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  onShot: (file: File) => void;
};

export default function CameraCapture({ onShot }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);

  const [hasVideoEl, setHasVideoEl] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** video 要素がマウントされたら true にする（null 参照を防止） */
  const videoRefCb = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setHasVideoEl(!!el);
  }, []);

  /** すべてのトラックを停止 */
  const stopStream = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
    } catch {}
    streamRef.current = null;
  }, []);

  /** 背面カメラを優先して起動（失敗したらフォールバック） */
  const startStream = useCallback(async () => {
    if (!hasVideoEl || !videoRef.current) return; // video がまだ貼れてない
    if (startingRef.current) return;
    startingRef.current = true;
    setErr(null);
    setReady(false);

    // iOS 実機は https 必須（Safari だけでなく iOS の Chrome も同様）
    if (typeof window !== 'undefined') {
      // localhost は OK / ローカル IP は https 推奨
      const insecure =
        !window.isSecureContext &&
        !/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname);
      if (insecure) {
        setErr('iOS 実機でカメラを使うには HTTPS が必要です。ローカルIPでの http アクセスは不可です（Chrome for iOS も同様）。Vercel 等へデプロイして https で開いてください。');
        startingRef.current = false;
        return;
      }
    }

    stopStream();

    try {
      const constraintsBase: MediaStreamConstraints = {
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };
      let stream = await navigator.mediaDevices.getUserMedia(constraintsBase);
      streamRef.current = stream;

      // video が null でないことを再確認
      if (!videoRef.current) {
        stopStream();
        startingRef.current = false;
        return;
      }
      videoRef.current.srcObject = stream;
      // iOS 再生系
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.muted = true;
      await videoRef.current.play().catch(() => { /* Safari で自動再生不可のときがある */ });

      // メタデータ済み（幅高さが取れるように）
      const v = videoRef.current;
      const onLoaded = () => setReady(true);
      v.addEventListener('loadedmetadata', onLoaded, { once: true });
      if (v.readyState >= 1) setReady(true);

    } catch (e: any) {
      // facingMode が効かない・権限失敗などのフォールバック
      console.warn('[CameraCapture] primary getUserMedia failed, fallback to generic video:true', e);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
      } catch (e2: any) {
        console.error('[CameraCapture] fallback failed', e2);
        setErr(e2?.message || String(e2));
        stopStream();
      }
    } finally {
      startingRef.current = false;
    }
  }, [facingMode, hasVideoEl, stopStream]);

  /** マウント時と video 要素が用意できたら起動 */
  useEffect(() => {
    if (!hasVideoEl) return;
    if (!('mediaDevices' in navigator)) {
      setErr('このブラウザはカメラ API をサポートしていません。最新の Chrome / Edge / Safari をお試しください。');
      return;
    }
    startStream();

    return () => {
      stopStream();
    };
  }, [hasVideoEl, startStream, stopStream]);

  /** たまに黒画面になる環境への簡易リトライ（5秒後に一度だけ） */
  useEffect(() => {
    if (!hasVideoEl) return;
    const timer = setTimeout(() => {
      const v = videoRef.current;
      if (v && (v.videoWidth === 0 || v.videoHeight === 0)) {
        // 再起動
        startStream();
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [hasVideoEl, startStream]);

  const flipCamera = async () => {
    // 反対側へ
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
    // setFacingMode 後の useEffect で startStream が呼ばれる
  };

  const takeShot = async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    c.width = w;
    c.height = h;

    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);

    // toBlob のフォールバック
    const blob: Blob | null = await new Promise((resolve) => {
      try {
        c.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
      } catch {
        resolve(null);
      }
    });

    let file: File | null = null;

    if (blob) {
      file = new File([blob], 'camera.jpg', { type: 'image/jpeg' });
    } else if ('convertToBlob' in c) {
      // OffscreenCanvas 互換 API がある場合
      // @ts-ignore
      const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
      file = new File([b], 'camera.jpg', { type: 'image/jpeg' });
    } else {
      // さらにフォールバック: dataURL から Blob 生成
      const dataUrl = c.toDataURL('image/jpeg', 0.92);
      const b = dataURLtoBlob(dataUrl);
      file = new File([b], 'camera.jpg', { type: 'image/jpeg' });
    }

    if (file) onShot(file);
  };

  function dataURLtoBlob(dataurl: string): Blob {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
  }

  return (
    <div className="space-y-2">
      <div className="relative w-full aspect-video bg-black/70 rounded-2xl overflow-hidden">
        <video
          ref={videoRefCb}
          className="absolute inset-0 w-full h-full object-contain"
          autoPlay
          playsInline
          muted
        />
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn px-3 py-2 border rounded"
          onClick={takeShot}
          disabled={!ready || !!err}
          title={ready ? '現在のプレビューを撮影して画像として送ります' : 'カメラ準備中…'}
        >
          📸 撮影して推薦
        </button>
        <button
          type="button"
          className="btn px-3 py-2 border rounded"
          onClick={flipCamera}
          disabled={!!err}
          title="前面/背面を切替"
        >
          🔄 カメラ切替
        </button>
        <button
          type="button"
          className="btn px-3 py-2 border rounded"
          onClick={() => { stopStream(); startStream(); }}
          disabled={!!err}
          title="ストリームを再起動（黒画面対策）"
        >
          ♻️ 再起動
        </button>
        {!ready && !err && <span className="text-xs text-gray-500">カメラ初期化中…</span>}
      </div>

      {err && (
        <div className="text-xs text-red-600 whitespace-pre-wrap">
          カメラ起動エラー: {err}
          {'\n'}
          <span className="text-gray-600">
            ・Mac の場合は Chrome/Edge/Safari で「カメラの使用を許可」してください。
            {'\n'}・iPhone 実機は https のみ許可されます（Vercel 等で https で開いてください）。
            {'\n'}・黒画面のときは「再起動」を試してください。
          </span>
        </div>
      )}
    </div>
  );
}