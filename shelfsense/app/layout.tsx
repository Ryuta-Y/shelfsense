// app/layout.tsx
import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'ShelfSense',
  description: 'Photo → Books → Recommendations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <header className="border-b bg-white">
          <nav className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4 text-sm">
            <span className="font-semibold">📚 ShelfSense</span>
            <Link className="hover:underline" href="/">Home</Link>
            <Link className="hover:underline" href="/recommend">Recommend</Link>
            <Link className="hover:underline" href="/library">Library</Link>
            <Link className="hover:underline" href="/recommended-library">Recommended Library</Link>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}