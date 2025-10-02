'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteBookButton({ id }: { id: string }) {
  const [p, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className="text-xs text-red-600 hover:underline"
      disabled={p}
      onClick={() => start(async () => {
        await fetch(`/api/library/${id}`, { method: 'DELETE' });
        router.refresh();
      })}
    >
      {p ? '削除中…' : '削除'}
    </button>
  );
}

export function DeleteRecButton({ id }: { id: string }) {
  const [p, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className="text-xs text-red-600 hover:underline"
      disabled={p}
      onClick={() => start(async () => {
        await fetch(`/api/recommended/${id}`, { method: 'DELETE' });
        router.refresh();
      })}
    >
      {p ? '削除中…' : '削除'}
    </button>
  );
}