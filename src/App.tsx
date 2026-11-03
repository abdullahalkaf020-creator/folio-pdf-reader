import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePlus2,
  FileText,
  Fullscreen,
  Highlighter,
  Library,
  ListTree,
  Maximize2,
  Minus,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Sun,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import BookReader, { type BookReaderHandle } from './components/BookReader';
import { flattenOutline, formatBytes, openPdf, readPdfMetadata, type PDFDocumentProxy } from './lib/pdf';
import { getAllDocuments, getDocument, makeDocumentId, removeDocument, saveDocument } from './lib/storage';
import type { Bookmark as PdfBookmark, Highlight, LibraryDocument, PageNote, ReaderTheme } from './types';

interface SearchHit { page: number; excerpt: string }
interface OutlineEntry { title: string; dest: unknown; depth: number; page?: number }

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(timestamp);
}

function App() {
  const [library, setLibrary] = useState<LibraryDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<LibraryDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [theme, setTheme] = useState<ReaderTheme>('paper');
  const [zoom, setZoom] = useState(100);
  const [brightness, setBrightness] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [singlePage, setSinglePage] = useState(false);
  const [filter, setFilter] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [selectedPage, setSelectedPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(!localStorage.getItem('folio-tutorial-seen'));
  const [pageInput, setPageInput] = useState('1');
  const [brightnessOpen, setBrightnessOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activeDocumentRef = useRef<LibraryDocument | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<BookReaderHandle | null>(null);
  const toastTimeout = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimeout.current);
    toastTimeout.current = window.setTimeout(() => setToast(''), 2800);
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await getAllDocuments());
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Gagal memuat koleksi.');
    }
  }, [notify]);

  useEffect(() => {
    void refreshLibrary();
    return () => window.clearTimeout(toastTimeout.current);
  }, [refreshLibrary]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  const importFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    setBusy(true);
    let added = 0;
    const failures: string[] = [];
    for (const file of selected) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        failures.push(`${file.name}: bukan file PDF`);
        continue;
      }
      try {
        const id = makeDocumentId(file);
        const existing = await getDocument(id);
        const metadata = await readPdfMetadata(file);
        const item: LibraryDocument = {
          id,
          name: file.name,
          size: file.size,
          pageCount: metadata.pageCount,
          lastPage: existing?.lastPage ?? 1,
          lastOpened: existing?.lastOpened ?? 0,
          addedAt: existing?.addedAt ?? Date.now(),
          blob: file,
          bookmarks: existing?.bookmarks ?? [],
          highlights: existing?.highlights ?? [],
          notes: existing?.notes ?? [],
        };
        await saveDocument(item);
        added += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'gagal dibaca'}`);
      }
    }
    await refreshLibrary();
    setBusy(false);
    if (added) notify(`${added} dokumen berhasil ditambahkan ke koleksi.`);
    if (failures.length) notify(`${failures.length} file gagal diimpor. Periksa format atau kondisi PDF.`);
  };

  const openDocument = async (id: string) => {
    setBusy(true);
    try {
      const documentRecord = await getDocument(id);
      if (!documentRecord) throw new Error('Dokumen tidak tersedia di penyimpanan.');
      const openedPdf = await openPdf(documentRecord.blob);
      const updated = { ...documentRecord, lastOpened: Date.now() };
      await saveDocument(updated);
      activeDocumentRef.current = updated;
      setActiveDocument(updated);
      setPdf(openedPdf);
      setPage(Math.min(Math.max(1, updated.lastPage || 1), openedPdf.numPages));
      setZoom(100);
      setRotation(0);
      setSearchHits([]);
      setSearchQuery('');
      setSelectedText('');
      setOutlineOpen(false);
      setNotesOpen(false);
      setTheme('paper');
      const rawOutline = await openedPdf.getOutline().catch(() => null);
      const flattened = flattenOutline(rawOutline ?? []);
      const resolved: OutlineEntry[] = [];
      for (const item of flattened) {
        let targetPage: number | undefined;
        try {
          if (item.dest) {
            const destination = typeof item.dest === 'string' ? await openedPdf.getDestination(item.dest) : item.dest as unknown[];
            const ref = destination?.[0];
            if (ref) targetPage = (await openedPdf.getPageIndex(ref as never)) + 1;
          }
        } catch {
          targetPage = undefined;
        }
        resolved.push({ ...item, page: targetPage });
      }
      setOutline(resolved);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'PDF tidak dapat dibuka.');
    } finally {
      setBusy(false);
    }
  };

  const closeReader = async () => {
    if (pdf) await pdf.destroy().catch(() => undefined);
    setPdf(null);
    activeDocumentRef.current = null;
    setActiveDocument(null);
    setSelectedText('');
    setSearchOpen(false);
    setOutlineOpen(false);
    setNotesOpen(false);
    await refreshLibrary();
  };

  const updateActiveDocument = async (patch: Partial<LibraryDocument>) => {
    if (!activeDocument) return;
    const updated = { ...activeDocument, ...patch };
    activeDocumentRef.current = updated;
    setActiveDocument(updated);
    try {
      await saveDocument(updated);
      void refreshLibrary();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Perubahan tidak dapat disimpan.');
    }
  };

  const handlePageChange = (pageNumber: number) => {
    setPage(pageNumber);
    const current = activeDocumentRef.current;
    if (current) {
      const updated = { ...current, lastPage: pageNumber, lastOpened: Date.now() };
      activeDocumentRef.current = updated;
      setActiveDocument(updated);
      void saveDocument(updated).catch(() => notify('Posisi membaca belum berhasil disimpan.'));
    }
  };

  const currentBookmark = useMemo(
    () => Boolean(activeDocument?.bookmarks.some((bookmark) => bookmark.page === page)),
    [activeDocument, page],
  );

  const toggleBookmark = async () => {
    if (!activeDocument) return;
    const exists = activeDocument.bookmarks.some((bookmark) => bookmark.page === page);
    const bookmarks: PdfBookmark[] = exists
      ? activeDocument.bookmarks.filter((bookmark) => bookmark.page !== page)
      : [...activeDocument.bookmarks, { page, label: `Halaman ${page}`, createdAt: Date.now() }].sort((a, b) => a.page - b.page);
    await updateActiveDocument({ bookmarks });
    notify(exists ? 'Bookmark dihapus.' : `Halaman ${page} ditandai.`);
  };

  const addHighlight = async (color: Highlight['color'] = 'yellow') => {
    if (!activeDocument || !selectedText) return;
    const highlight: Highlight = { id: newId(), page: selectedPage, text: selectedText, color, createdAt: Date.now() };
    await updateActiveDocument({ highlights: [...activeDocument.highlights, highlight] });
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
    notify('Sorotan disimpan.');
  };

  const addNote = async () => {
    if (!activeDocument) return;
    const initial = selectedText ? `Kutipan: “${selectedText}”\n\nCatatan: ` : '';
    const noteText = window.prompt(`Catatan untuk halaman ${selectedText ? selectedPage : page}`, initial);
    if (!noteText?.trim()) return;
    const note: PageNote = { id: newId(), page: selectedText ? selectedPage : page, text: noteText.trim(), createdAt: Date.now() };
    await updateActiveDocument({ notes: [...activeDocument.notes, note] });
    setSelectedText('');
    notify('Catatan disimpan.');
  };

  const removeHighlight = async (id: string) => {
    if (!activeDocument) return;
    await updateActiveDocument({ highlights: activeDocument.highlights.filter((item) => item.id !== id) });
  };

  const removeNote = async (id: string) => {
    if (!activeDocument) return;
    await updateActiveDocument({ notes: activeDocument.notes.filter((item) => item.id !== id) });
  };

  const searchPdf = async () => {
    if (!pdf || !searchQuery.trim()) return;
    setSearchBusy(true);
    setSearchHits([]);
    const hits: SearchHit[] = [];
    const term = searchQuery.trim().toLocaleLowerCase();
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pageProxy = await pdf.getPage(pageNumber);
        const text = await pageProxy.getTextContent();
        const line = text.items.filter((item) => 'str' in item).map((item) => (item as { str: string }).str).join(' ');
        const index = line.toLocaleLowerCase().indexOf(term);
        if (index >= 0) {
          const excerpt = line.slice(Math.max(0, index - 58), Math.min(line.length, index + term.length + 92)).replace(/\s+/g, ' ').trim();
          hits.push({ page: pageNumber, excerpt });
          setSearchHits([...hits]);
        }
        if (pageNumber % 12 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (!hits.length) notify('Teks tidak ditemukan di dokumen ini.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Pencarian teks gagal.');
    } finally {
      setSearchBusy(false);
    }
  };

  const navigateOutline = (entry: OutlineEntry) => {
    if (entry.page) readerRef.current?.goTo(entry.page);
    setOutlineOpen(false);
  };

  const navigatePageInput = () => {
    const number = Number(pageInput);
    if (!Number.isInteger(number) || !pdf || number < 1 || number > pdf.numPages) {
      setPageInput(String(page));
      return;
    }
    readerRef.current?.goTo(number);
  };

  const toggleFullscreen = async () => {
    const target = document.querySelector<HTMLElement>('.reader-page');
    try {
      if (!document.fullscreenElement) await target?.requestFullscreen?.();
      else await document.exitFullscreen();
    } catch {
      notify('Mode layar penuh tidak didukung oleh browser ini.');
    }
  };

  const deleteDocument = async (item: LibraryDocument) => {
    if (!window.confirm(`Hapus “${item.name}” dari koleksi Folio?`)) return;
    await removeDocument(item.id);
    await refreshLibrary();
    notify('Dokumen dihapus dari perangkat.');
  };

  const filteredLibrary = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase();
    return library.filter((item) => !term || item.name.toLocaleLowerCase().includes(term));
  }, [library, filter]);

  const recentDocuments = filteredLibrary.slice(0, 4);
  const totalPages = library.reduce((sum, item) => sum + item.pageCount, 0);

  if (pdf && activeDocument) {
    return (
      <main className={`app reader-page theme-${theme}`}>
        <header className="reader-topbar">
          <button className="icon-button back-button" onClick={() => void closeReader()} aria-label="Kembali ke koleksi"><ArrowLeft size={20} /></button>
          <div className="reader-document-title">
            <span className="eyebrow">SEDANG DIBACA</span>
            <strong title={activeDocument.name}>{activeDocument.name}</strong>
          </div>
          <div className="reader-top-actions">
            <button className="icon-button" onClick={() => setSearchOpen((value) => !value)} aria-label="Cari dalam PDF" title="Cari teks"><Search size={19} /></button>
            <button className={`icon-button ${currentBookmark ? 'is-active' : ''}`} onClick={() => void toggleBookmark()} aria-label="Bookmark halaman" title="Bookmark"><Bookmark size={19} /></button>
            <button className={`icon-button ${outlineOpen ? 'is-active' : ''}`} onClick={() => setOutlineOpen((value) => !value)} aria-label="Daftar isi" title="Daftar isi"><ListTree size={19} /></button>
            <button className="icon-button" onClick={() => setNotesOpen((value) => !value)} aria-label="Catatan dan sorotan" title="Catatan"><NotebookPen size={19} /></button>
            <button className="icon-button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Pengaturan baca" title="Pengaturan"><Settings2 size={19} /></button>
          </div>
        </header>

        <div className="reader-toolbar">
          <div className="toolbar-group nav-group">
            <button className="round-tool" onClick={() => readerRef.current?.previous()} disabled={page <= 1} aria-label="Halaman sebelumnya"><ChevronLeft size={19} /></button>
            <div className="page-counter">
              <input aria-label="Nomor halaman" value={pageInput} inputMode="numeric" onChange={(event) => setPageInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') navigatePageInput(); }} onBlur={navigatePageInput} />
              <span>/ {pdf.numPages}</span>
            </div>
            <button className="round-tool" onClick={() => readerRef.current?.next()} disabled={page >= pdf.numPages} aria-label="Halaman berikutnya"><ChevronRight size={19} /></button>
          </div>
          <span className="toolbar-divider" />
          <div className="toolbar-group">
            <button className="plain-tool" onClick={() => setZoom((value) => Math.max(65, value - 10))} aria-label="Perkecil"><ZoomOut size={17} /></button>
            <span className="zoom-label">{zoom}%</span>
            <button className="plain-tool" onClick={() => setZoom((value) => Math.min(160, value + 10))} aria-label="Perbesar"><ZoomIn size={17} /></button>
          </div>
          <span className="toolbar-divider optional-divider" />
          <div className="toolbar-group optional-tools">
            <button className={`plain-tool ${singlePage ? 'selected' : ''}`} onClick={() => setSinglePage((value) => !value)} title="Ganti mode halaman"><BookOpen size={17} /><span>{singlePage ? 'Satu' : 'Dua'}</span></button>
            <button className="plain-tool" onClick={() => setRotation((value) => (value + 90) % 360)} title="Putar halaman"><RotateCw size={17} /></button>
            <button className="plain-tool" onClick={() => setBrightnessOpen((value) => !value)} title="Kecerahan"><Sun size={17} /></button>
            <button className="plain-tool" onClick={() => setTheme((value) => value === 'paper' ? 'sepia' : value === 'sepia' ? 'dark' : 'paper')} title="Mode tampilan">{theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}</button>
            <button className="plain-tool" onClick={() => void toggleFullscreen()} title="Layar penuh"><Fullscreen size={17} /></button>
          </div>
        </div>

        {brightnessOpen && (
          <div className="brightness-panel">
            <Sun size={15} />
            <input type="range" min="65" max="125" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} aria-label="Kecerahan halaman" />
            <span>{brightness}%</span>
          </div>
        )}

        {searchOpen && (
          <section className="floating-panel search-panel">
            <div className="panel-heading"><strong>Cari di dalam PDF</strong><button className="icon-button compact" onClick={() => setSearchOpen(false)} aria-label="Tutup pencarian"><X size={17} /></button></div>
            <div className="search-form"><input autoFocus placeholder="Masukkan kata atau frasa…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchPdf(); }} /><button className="dark-button" onClick={() => void searchPdf()} disabled={searchBusy || !searchQuery.trim()}>{searchBusy ? 'Mencari…' : 'Cari'}</button></div>
            <div className="search-results">
              {searchHits.map((hit, index) => <button key={`${hit.page}-${index}`} className="result-row" onClick={() => readerRef.current?.goTo(hit.page)}><span>Hal. {hit.page}</span><small>{hit.excerpt}</small></button>)}
              {!searchHits.length && <p className="muted small">{searchBusy ? 'Memindai teks dokumen…' : 'Hasil pencarian akan muncul di sini.'}</p>}
            </div>
          </section>
        )}

        <section className="reading-area">
          <BookReader
            key={activeDocument.id}
            ref={readerRef}
            pdf={pdf}
            initialPage={Math.max(0, page - 1)}
            singlePage={singlePage}
            zoom={zoom}
            brightness={brightness}
            rotation={rotation}
            highlights={activeDocument.highlights}
            onPageChange={handlePageChange}
            onSelection={(pageNumber, text) => { setSelectedPage(pageNumber); setSelectedText(text); }}
            onLoadPageCount={() => undefined}
          />
          <div className="reading-hint"><span className="hint-dot" /> Geser halaman atau tarik sudut kanan/kiri untuk membalik kertas</div>
        </section>

        {selectedText && (
          <div className="selection-actions">
            <span>Hal. {selectedPage}</span>
            <button onClick={() => void addHighlight('yellow')}><Highlighter size={15} /> Sorot</button>
            <button onClick={() => void addNote()}><NotebookPen size={15} /> Catat</button>
            <button onClick={() => { void navigator.clipboard?.writeText(selectedText); setSelectedText(''); notify('Teks disalin.'); }}><Check size={15} /> Salin</button>
            <button className="icon-button compact" onClick={() => setSelectedText('')} aria-label="Tutup pilihan"><X size={15} /></button>
          </div>
        )}

        <footer className="reader-footer">
          <div className="footer-meta"><span>{Math.round((page / pdf.numPages) * 100)}% selesai</span><span>{activeDocument.bookmarks.length} bookmark · {activeDocument.notes.length} catatan</span></div>
          <input className="reading-progress" type="range" min="1" max={pdf.numPages} value={page} onChange={(event) => readerRef.current?.goTo(Number(event.target.value))} aria-label="Posisi membaca" />
        </footer>

        {outlineOpen && (
          <aside className="side-panel outline-panel">
            <div className="panel-heading"><strong>Daftar isi</strong><button className="icon-button compact" onClick={() => setOutlineOpen(false)} aria-label="Tutup daftar isi"><X size={17} /></button></div>
            {outline.length ? outline.map((entry, index) => <button key={`${entry.title}-${index}`} className="outline-row" style={{ paddingLeft: `${14 + entry.depth * 15}px` }} onClick={() => navigateOutline(entry)}><span>{entry.title}</span><small>{entry.page ? ` ${entry.page}` : ''}</small></button>) : <p className="muted small">Dokumen ini tidak memiliki daftar isi/bookmark bawaan.</p>}
          </aside>
        )}

        {notesOpen && (
          <aside className="side-panel notes-panel">
            <div className="panel-heading"><strong>Catatan & sorotan</strong><button className="icon-button compact" onClick={() => setNotesOpen(false)} aria-label="Tutup catatan"><X size={17} /></button></div>
            <button className="outline-action" onClick={() => void addNote()}><Plus size={15} /> Catatan halaman {page}</button>
            <div className="annotation-list">
              {activeDocument.highlights.map((item) => <article className="annotation-card" key={item.id}><div className="annotation-top"><span className="annotation-kind"><Highlighter size={13} /> Sorotan · hal. {item.page}</span><button className="icon-button compact" onClick={() => void removeHighlight(item.id)} aria-label="Hapus sorotan"><Trash2 size={14} /></button></div><p>{item.text}</p><button className="text-link" onClick={() => readerRef.current?.goTo(item.page)}>Buka halaman</button></article>)}
              {activeDocument.notes.map((item) => <article className="annotation-card" key={item.id}><div className="annotation-top"><span className="annotation-kind"><NotebookPen size={13} /> Catatan · hal. {item.page}</span><button className="icon-button compact" onClick={() => void removeNote(item.id)} aria-label="Hapus catatan"><Trash2 size={14} /></button></div><p>{item.text}</p><button className="text-link" onClick={() => readerRef.current?.goTo(item.page)}>Buka halaman</button></article>)}
              {!activeDocument.highlights.length && !activeDocument.notes.length && <p className="muted small">Belum ada catatan atau sorotan. Pilih teks pada halaman untuk mulai menandai.</p>}
            </div>
          </aside>
        )}

        {settingsOpen && (
          <aside className="side-panel settings-panel">
            <div className="panel-heading"><strong>Pengaturan membaca</strong><button className="icon-button compact" onClick={() => setSettingsOpen(false)} aria-label="Tutup pengaturan"><X size={17} /></button></div>
            <label className="setting-row"><span>Tampilan halaman</span><select value={singlePage ? 'single' : 'spread'} onChange={(event) => setSinglePage(event.target.value === 'single')}><option value="spread">Buku terbuka</option><option value="single">Satu halaman</option></select></label>
            <label className="setting-row"><span>Tema baca</span><select value={theme} onChange={(event) => setTheme(event.target.value as ReaderTheme)}><option value="paper">Kertas terang</option><option value="sepia">Sepia</option><option value="dark">Gelap</option></select></label>
            <label className="setting-row"><span>Kecerahan</span><input type="range" min="65" max="125" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label>
            <label className="setting-row"><span>Zoom</span><input type="range" min="65" max="160" step="5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
            <button className="outline-action" onClick={() => { setSettingsOpen(false); setTutorialOpen(true); }}><BookOpen size={15} /> Lihat tutorial singkat</button>
          </aside>
        )}
      </main>
    );
  }

  return (
    <main className="app home-page">
      <header className="home-topbar">
        <a className="brand" href="#home" aria-label="Folio beranda"><span className="brand-mark"><BookOpen size={20} /></span><span>folio<span className="brand-period">.</span></span></a>
        <div className="home-header-right"><span className="offline-indicator"><span /> OFFLINE READY</span><button className="icon-button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Pengaturan aplikasi"><Settings2 size={19} /></button></div>
      </header>

      <section className="welcome-section">
        <div className="welcome-copy"><span className="eyebrow">RUANG BACA PRIBADI</span><h1>Setiap halaman,<br /><em>sebuah perjalanan.</em></h1><p>Koleksi bacaanmu, dibuka kembali dengan sensasi membalik halaman buku.</p><button className="import-button" onClick={() => fileInput.current?.click()} disabled={busy}><FilePlus2 size={17} /> {busy ? 'Memproses…' : 'Import PDF'} <span>+</span></button><input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }} /></div>
        <div className="welcome-art" aria-hidden="true"><div className="art-back-cover" /><div className="art-book"><div className="art-pages"><i /><i /><i /><i /></div><div className="art-cover"><div className="art-cover-line" /><span>THE<br />ART OF<br /><b>READING</b></span><small>VOL. 01</small></div></div><div className="art-shadow" /></div>
      </section>

      <section className="library-section">
        <div className="section-heading"><div><span className="eyebrow">PERPUSTAKAANMU</span><h2>Rak bacaan</h2></div><div className="library-tools"><label className="library-search"><Search size={16} /><input placeholder="Cari dokumen…" value={filter} onChange={(event) => setFilter(event.target.value)} /></label><button className="quiet-button" onClick={() => fileInput.current?.click()}><Plus size={16} /> Tambah</button></div></div>

        {library.length > 0 ? (
          <>
            {recentDocuments.length > 0 && <div className="recent-heading"><Clock3 size={15} /><span>Baru dibuka</span></div>}
            <div className="document-grid">
              {recentDocuments.map((item, index) => (
                <article className={`document-card card-tone-${index % 4}`} key={item.id}>
                  <button className="document-open" onClick={() => void openDocument(item.id)}>
                    <div className="document-cover"><span className="cover-kicker">FOLIO READER</span><div className="cover-title">{item.name.replace(/\.pdf$/i, '').slice(0, 46)}</div><div className="cover-rules"><i /><i /><i /></div><span className="cover-page-count">{item.pageCount} HALAMAN</span></div>
                    <div className="document-info"><strong title={item.name}>{item.name}</strong><span>{formatBytes(item.size)} <i>·</i> {item.pageCount} halaman</span><div className="doc-progress"><span style={{ width: `${Math.min(100, (item.lastPage / Math.max(1, item.pageCount)) * 100)}%` }} /></div><small>{item.lastPage > 1 ? `Terakhir di halaman ${item.lastPage}` : 'Belum mulai dibaca'}</small></div>
                  </button>
                  <button className="card-menu" onClick={() => void deleteDocument(item)} aria-label={`Hapus ${item.name}`} title="Hapus dokumen"><MoreHorizontal size={18} /></button>
                </article>
              ))}
            </div>
            {filteredLibrary.length > 4 && <div className="collection-list"><div className="collection-header"><span><Library size={15} /> Semua dokumen</span><small>{filteredLibrary.length} FILE</small></div>{filteredLibrary.slice(4).map((item) => <article className="collection-row" key={item.id}><button onClick={() => void openDocument(item.id)}><span className="file-icon"><FileText size={18} /></span><span className="collection-name"><strong>{item.name}</strong><small>{item.pageCount} halaman · {formatBytes(item.size)}</small></span><span className="collection-date">{formatDate(item.addedAt)}</span><ChevronRight size={17} /></button><button className="delete-row" onClick={() => void deleteDocument(item)} aria-label={`Hapus ${item.name}`}><Trash2 size={15} /></button></article>)}</div>}
            {!filteredLibrary.length && <div className="empty-filter">Tidak ada dokumen yang cocok dengan “{filter}”.</div>}
          </>
        ) : (
          <div className="empty-library"><div className="empty-icon"><BookOpen size={27} /></div><h3>Rakmu masih kosong.</h3><p>Impor satu atau beberapa file PDF. Dokumen akan tersimpan di perangkat ini dan bisa dibaca tanpa internet.</p><button className="quiet-button" onClick={() => fileInput.current?.click()}><Plus size={16} /> Pilih file PDF</button></div>
        )}
      </section>

      <footer className="home-footer"><span>FOLIO READER <i>© 2026</i></span><span>{library.length} dokumen · {totalPages.toLocaleString('id-ID')} halaman tersimpan</span><span>Disimpan lokal di perangkatmu</span></footer>

      {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><section className="modal-card settings-modal" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><strong>Pengaturan Folio</strong><button className="icon-button compact" onClick={() => setSettingsOpen(false)}><X size={17} /></button></div><p className="muted small">Folio menyimpan file PDF, posisi baca, bookmark, catatan, dan sorotan di penyimpanan lokal perangkat.</p><button className="outline-action" onClick={() => { setSettingsOpen(false); setTutorialOpen(true); }}><BookOpen size={15} /> Tutorial penggunaan</button><div className="about-line"><span>Versi aplikasi</span><strong>1.0.0</strong></div><div className="about-line"><span>Mode penyimpanan</span><strong>Offline · IndexedDB</strong></div></section></div>}

      {tutorialOpen && <div className="modal-backdrop"><section className="modal-card tutorial-modal"><div className="tutorial-symbol"><BookOpen size={24} /></div><span className="eyebrow">SELAMAT DATANG DI FOLIO</span><h2>Membaca seperti membuka buku.</h2><p>Sentuh sudut halaman lalu tarik ke sisi berlawanan. Kamu juga bisa menggeser halaman ke kiri atau kanan untuk membaliknya.</p><div className="tutorial-steps"><div><span>01</span><p><b>Impor PDF</b><small>Pilih dokumen dari penyimpanan perangkat.</small></p></div><div><span>02</span><p><b>Balik halaman</b><small>Tarik sudut kertas atau gunakan gesture swipe.</small></p></div><div><span>03</span><p><b>Tandai bacaan</b><small>Simpan bookmark, sorotan, dan catatan pribadi.</small></p></div></div><button className="dark-button tutorial-done" onClick={() => { setTutorialOpen(false); localStorage.setItem('folio-tutorial-seen', '1'); }}>Mulai membaca <ChevronRight size={17} /></button></section></div>}

      {toast && <div className="toast-message" role="status">{toast}</div>}
      {busy && <div className="busy-overlay"><div className="loader" /><span>Membuka dokumen…</span></div>}
    </main>
  );
}

export default App;
