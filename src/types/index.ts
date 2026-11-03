export interface Bookmark {
  page: number;
  label: string;
  createdAt: number;
}

export interface Highlight {
  id: string;
  page: number;
  text: string;
  color: 'yellow' | 'green' | 'pink';
  createdAt: number;
}

export interface PageNote {
  id: string;
  page: number;
  text: string;
  createdAt: number;
}

export interface LibraryDocument {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  lastPage: number;
  lastOpened: number;
  addedAt: number;
  blob: Blob;
  bookmarks: Bookmark[];
  highlights: Highlight[];
  notes: PageNote[];
}

export type ReaderTheme = 'paper' | 'sepia' | 'dark';
