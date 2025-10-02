'use client';
import Link from 'next/link';
import BarcodeScanner from '@/app/components/BarcodeScanner';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">写真（表紙/背表紙）やバーコード、手入力で本を追加し、おすすめを生成します。</h1>

      {/* 旧「1) 写真をアップロード」は削除 */}

      <section className="grid md:grid-cols-2 gap-6">
        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold mb-2">バーコードで追加（Chrome推奨）</h2>
          <BarcodeScanner />
          <p className="text-xs text-gray-500 mt-2">
            ISBN/EAN を読み取ってタイトルを特定します。保存されると Library で見られます。
          </p>
        </div>

        <div className="p-4 border rounded-2xl bg-white space-y-3">
          <h2 className="font-semibold">おすすめへ</h2>
          <p className="text-sm text-gray-600">
            タイトルを入力するか、画像1枚（背表紙OK）から直接おすすめを生成できます。
          </p>
          <div className="flex gap-2">
            <Link href="/recommend" className="btn px-4 py-2 border rounded-xl">おすすめを見る</Link>
            <Link href="/library" className="btn px-4 py-2 border rounded-xl">Library を開く</Link>
          </div>
        </div>
      </section>
    </div>
  );
}