export type BookFormat = 'pdf' | 'epub' | 'mobi' | 'txt' | 'md' | 'docx' | 'html' | 'rtf' | 'fb2' | 'odt' | 'paste';

/** What a parser returns. Plain text only; paragraphs inside a section are separated by a blank line ("\n\n"). */
export interface ParsedSection {
  title: string;
  text: string;
}
export interface ParsedBook {
  title: string;
  author?: string;
  cover?: Blob; // image blob if the format has one
  sections: ParsedSection[]; // at least one; chapters where the format has them
  /**
   * Real pages of the source file (PDF): word index (in `tokenize(sections)` space) where each page begins,
   * one entry per page, ascending; pages without text repeat the next page's start. Absent = no real pages.
   */
  pageStarts?: number[];
}

/** Library record (small; listed often). */
export interface Book {
  id: string; // crypto.randomUUID()
  title: string;
  author: string; // '' if unknown
  format: BookFormat;
  fileName: string;
  fileSize: number;
  wordCount: number;
  position: number; // index of the next word to show, 0..wordCount
  addedAt: number; // epoch ms
  lastOpenedAt: number | null;
  finishedAt: number | null;
  favorite: boolean;
  tags: string[]; // user collections/shelves
  cover?: Blob;
  /** Real page starts (see ParsedBook.pageStarts). Absent for formats without pages and for books imported before pages existed. */
  pageStarts?: number[];
}

/** Heavy record, loaded only when reading. */
export interface BookContent {
  bookId: string;
  sections: ParsedSection[];
}

export interface Bookmark {
  id: string;
  bookId: string;
  position: number;
  excerpt: string;
  note: string;
  createdAt: number;
}

/** One continuous stretch of reading, written by the reader when playback stops. */
export interface ReadingSession {
  id: string;
  bookId: string;
  startedAt: number;
  durationMs: number;
  wordsRead: number;
  avgWpm: number;
}

/** Tokenized book as the reader consumes it. */
export interface TokenizedBook {
  words: string[]; // display tokens in order
  paragraphStarts: number[]; // sorted word indexes where a paragraph begins (first is 0)
  chapters: { title: string; wordIndex: number }[]; // one per section, sorted
}
