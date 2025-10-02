
'use client';
import { useState } from 'react';

export default function UploadDropzone() {
  const [resp, setResp] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const onFile = async (file: File) => {
  const fd = new FormData();
  fd.append('image', file);
  setLoading(true);
  try {
    const res = await fetch('/api/scan', { method: 'POST', body: fd });
    const txt = await res.text();
    try {
      const json = JSON.parse(txt);
      setResp(json);
    } catch {
      setResp({ error: 'invalid-json', body: txt.slice(0, 500) });
    }
  } catch (e: any) {
    setResp({ error: 'network-failed', detail: e?.message || String(e) });
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="space-y-3">
      <input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0]; if(f) onFile(f);}} />
      {loading && <p className="text-sm">解析中...</p>}
      {resp && <pre className="text-xs max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(resp, null, 2)}</pre>}
    </div>
  );
}
