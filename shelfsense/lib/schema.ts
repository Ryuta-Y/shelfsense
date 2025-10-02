
export type Book = {
  id?: string;
  title: string;
  authors: string[];
  isbn13?: string;
  language?: string;
  published_year?: number;
  description?: string;
  cover_url?: string;
  source: 'google'|'openlibrary'|'manual';
  source_id?: string;
  metadata?: any;
};
