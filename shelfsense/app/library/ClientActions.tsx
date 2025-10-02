// app/library/ClientActions.tsx
'use client';

import { useState } from 'react';

export function LibraryStarButton({ bookId, initialOn }: { bookId: string; initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-yellow-500"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch('/api/toggle-library', {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ bookId })
          });
          await res.json();
          setOn(o => !o);
        } finally {
          setBusy(false);
        }
      }}
      title={on ? 'Library から外す' : 'Library に入れる'}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

export function RecommendedStarButton({ bookId, initialOn }: { bookId: string; initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-pink-500"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch('/api/toggle-recommended', {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ bookId })
          });
          await res.json();
          setOn(o => !o);
        } finally {
          setBusy(false);
        }
      }}
      title={on ? 'おすすめから外す' : 'おすすめに入れる'}
    >
      {on ? '★' : '☆'}
    </button>
  );
}