// lib/books.ts
const GOOGLE_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const OPENLIB_SEARCH = 'https://openlibrary.org/search.json';

type SearchOpts = {
  orderBy?: 'relevance' | 'newest';
  langRestrict?: string;
  maxResults?: number;
  timeoutMs?: number;
};

function toYear(s?: string): number | undefined {
  if (!s) return;
  const m = String(s).match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

function readIsbn13(ids?: Array<{ type?: string; identifier?: string }> | any[]): string | undefined {
  if (!Array.isArray(ids)) return;
  const hit = ids.find((x: any) => x?.type?.toUpperCase?.() === 'ISBN_13' || x?.type === 'ISBN_13');
  return hit?.identifier || undefined;
}

async function safeJson(resp: Response): Promise<any | null> {
  try {
    const ctype = resp.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function safeFetch(url: string, init?: RequestInit & { timeoutMs?: number }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), init?.timeoutMs ?? 12000);
  try {
    const resp = await fetch(url, {
      ...init,
      headers: { 'Accept': 'application/json', ...(init?.headers || {}) },
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(t);
  }
}

export async function searchGoogleBooks(q: string, opts: SearchOpts = {}) {
  try {
    const params = new URLSearchParams();
    params.set('q', q);
    params.set('maxResults', String(opts.maxResults ?? 10));
    if (opts.orderBy) params.set('orderBy', opts.orderBy);
    if (opts.langRestrict) params.set('langRestrict', opts.langRestrict);
    const key = process.env.GOOGLE_BOOKS_API_KEY;
    if (key) params.set('key', key);

    const url = `${GOOGLE_ENDPOINT}?${params.toString()}`;
    const resp = await safeFetch(url, { timeoutMs: opts.timeoutMs ?? 12000 });
    if (!resp || !resp.ok) return [];
    const json = await safeJson(resp);
    if (!json || !Array.isArray(json.items)) return [];

    const out = json.items.map((it: any) => {
      const v = it?.volumeInfo || {};
      return {
        id: crypto.randomUUID?.() ?? `${it.id || ''}`,
        title: v.title || '',
        authors: v.authors || [],
        description: v.description || '',
        language: v.language || '',
        published_year: toYear(v.publishedDate),
        cover_url: v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '',
        source: 'google',
        source_id: it.id || '',
        isbn13: readIsbn13(v.industryIdentifiers),
        metadata: {
          infoLink: v.infoLink,
          categories: v.categories || [],
          pageCount: v.pageCount || 0,
        },
      };
    });

    // 重複排除
    const seen = new Set<string>();
    return out.filter((b: any) => {
      const key = `${b.source}:${b.source_id || b.isbn13 || b.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

export async function searchOpenLibrary(q: string, opts: SearchOpts = {}) {
  try {
    const params = new URLSearchParams();
    params.set('q', q);
    params.set('limit', String(opts.maxResults ?? 10));

    const url = `${OPENLIB_SEARCH}?${params.toString()}`;
    const resp = await safeFetch(url, { timeoutMs: opts.timeoutMs ?? 12000 });
    if (!resp || !resp.ok) return [];
    const json = await safeJson(resp);
    if (!json || !Array.isArray(json.docs)) return [];

    const out = json.docs.map((d: any) => {
      const isbn13 = Array.isArray(d.isbn) ? d.isbn.find((s: string) => s && s.length === 13) : undefined;
      const cover_i = d.cover_i;
      const cover_url = cover_i ? `https://covers.openlibrary.org/b/id/${cover_i}-M.jpg` : '';

      return {
        id: crypto.randomUUID?.() ?? `${d.key || d.title}`,
        title: d.title || '',
        authors: d.author_name || [],
        description: '',
        language: (d.language && d.language[0]) || '',
        published_year: d.first_publish_year || undefined,
        cover_url,
        source: 'openlibrary',
        source_id: d.key || '', // e.g. /works/OLxxxxW
        isbn13,
        metadata: {
          key: d.key,
          info_url: d.key ? `https://openlibrary.org${d.key}` : undefined,
          subject: d.subject || [],
        },
      };
    });

    // 重複排除
    const seen = new Set<string>();
    return out.filter((b: any) => {
      const key = `${b.source}:${b.source_id || b.isbn13 || b.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}