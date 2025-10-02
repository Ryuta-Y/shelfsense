
-- pgvector 拡張
create extension if not exists vector;

-- ユーザー（匿名運用/簡易）
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamp with time zone default now()
);

-- 書誌
create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  authors text[],
  isbn13 text,
  language text,
  published_year int,
  description text,
  cover_url text,
  source text check (source in ('google','openlibrary','manual')),
  source_id text,
  metadata jsonb default '{}'::jsonb,
  embedding vector(1536)
);

create index if not exists books_isbn_idx on books(isbn13);
create index if not exists books_source_idx on books(source, source_id);
create index if not exists books_embedding_idx on books using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ユーザーの棚・セッション（任意）
create table if not exists user_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  book_id uuid references books(id) on delete cascade,
  added_at timestamp with time zone default now(),
  via text check (via in ('photo','barcode','manual')),
  note text
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  created_at timestamp with time zone default now(),
  label text
);

create table if not exists session_inputs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  book_id uuid references books(id) on delete cascade
);

create table if not exists session_recs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  book_id uuid references books(id) on delete cascade,
  rank int,
  score real,
  reason text
);

-- ベクトル近傍検索RPC
create or replace function match_books(query_embedding vector, match_limit int default 20)
returns table(
  id uuid,
  title text,
  authors text[],
  score float4,
  cover_url text,
  description text,
  language text,
  published_year int
) language sql stable as $$
  select b.id, b.title, b.authors,
         1 - (b.embedding <=> query_embedding) as score,
         b.cover_url, b.description, b.language, b.published_year
  from books b
  order by b.embedding <=> query_embedding
  limit match_limit;
$$;
