
# ShelfSense — 本棚写真からおすすめを返すWebアプリ（スターター）

## 1) これは何？
- 写真（表紙／背表紙）、バーコード、手入力のいずれかで本を追加し、複数冊の“組み合わせ文脈”から理由つきおすすめを返します。

## 2) セットアップ（Mac）
```bash
pnpm i
cp .env.example .env.local   # 値を埋める
# SupabaseのSQLは supabase/migrations/0001_init.sql をプロジェクトのSQL Editorで実行
pnpm dev
# → http://localhost:3000
```

## 3) どこに何を置く？
- **データベーススキーマ**: `supabase/migrations/0001_init.sql`  
  Supabaseの**SQL Editor**にコピペして実行。拡張(vector)とテーブル・RPC（`match_books`）が作成されます。
- **API**: `app/api/*/route.ts`（Next.js App Router）
- **UI**: `app/page.tsx`, `app/recommend/page.tsx`, `app/components/*`
- **外部APIラッパ**: `lib/books.ts`（Google Books / Open Library）
- **OpenAI周り**: `lib/ai.ts`（Vision / Embeddings）
- **DB接続**: `lib/db.ts`

## 4) 使い方（簡単）
1. トップページで写真をアップロード（背表紙でもOK）。候補がJSONで返り、コンソールに表示されます（UIは最小）。
2. バーコード読み取り（Chrome推奨）でISBNが読めます。
3. 別タブで `/api/recommend` を `curl` でたたいて結果を確認できます（README下部のAPI例）。

## 5) API 例
### 画像→候補抽出
```bash
curl -X POST http://localhost:3000/api/scan   -F "image=@/path/to/bookshelf.jpg"
```

### 手入力で保存
```bash
curl -X POST http://localhost:3000/api/books   -H "Content-Type: application/json"   -d '{"title":"深層学習入門","authors":["佐藤 太郎"],"language":"ja","source":"manual"}'
```

### おすすめ生成
```bash
curl -X POST http://localhost:3000/api/recommend   -H "Content-Type: application/json"   -d '{"bookIds":["UUID1","UUID2"],"n":8,"filters":{"language":"ja","yearMin":2018}}'
```

## 6) 注意
- SupabaseのService Role Keyは**サーバ側**でのみ利用します（クライアントに出さない）。
- カメラのバーコード読み取りはSafariで不安定な場合があるためChrome推奨。
