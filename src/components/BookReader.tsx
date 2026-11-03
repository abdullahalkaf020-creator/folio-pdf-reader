import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PageFlip } from 'page-flip';
import type { PDFDocumentProxy } from '../lib/pdf';
import { pdfjs } from '../lib/pdf';
import type { Highlight } from '../types';

export interface BookReaderHandle {
  next: () => void;
  previous: () => void;
  goTo: (pageNumber: number) => void;
  currentPage: () => number;
}

interface BookReaderProps {
  pdf: PDFDocumentProxy;
  initialPage: number;
  singlePage: boolean;
  zoom: number;
  brightness: number;
  rotation: number;
  highlights: Highlight[];
  onPageChange: (pageNumber: number) => void;
  onSelection: (pageNumber: number, selectedText: string) => void;
  onLoadPageCount: (count: number) => void;
}

const BookReader = forwardRef<BookReaderHandle, BookReaderProps>(function BookReader(
  {
    pdf,
    initialPage,
    singlePage,
    zoom,
    brightness,
    rotation,
    highlights,
    onPageChange,
    onSelection,
    onLoadPageCount,
  },
  ref,
) {
  const engineRef = useRef<HTMLDivElement | null>(null);
  const pageNodes = useRef<Array<HTMLDivElement | null>>([]);
  const flipRef = useRef<PageFlip | null>(null);
  const rendered = useRef(new Map<number, number>());
  const rendering = useRef(new Map<number, Promise<void>>());
  const generation = useRef(0);
  const wantedPages = useRef<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(Math.max(0, initialPage));
  const [renderProgress, setRenderProgress] = useState(0);
  const pageCount = pdf.numPages;

  const markRendered = useCallback((pageNumber: number, version: number) => {
    if (version !== generation.current) return;
    rendered.current.set(pageNumber, version);
    setRenderProgress((value) => Math.min(100, Math.max(value, Math.round((rendered.current.size / Math.min(3, pageCount)) * 100))));
  }, [pageCount]);

  const renderPage = useCallback(async (pageNumber: number): Promise<void> => {
    if (pageNumber < 1 || pageNumber > pageCount) return;
    const version = generation.current;
    if (rendered.current.get(pageNumber) === version) return;
    const inflight = rendering.current.get(pageNumber);
    if (inflight) return inflight;

    let task: Promise<void>;
    task = (async () => {
      const originalNode = pageNodes.current[pageNumber - 1];
      if (!originalNode) return;
      const page = await pdf.getPage(pageNumber);
      if (version !== generation.current) return;

      const pageRotation = (rotation + (page.rotate || 0)) % 360;
      const viewport = page.getViewport({ scale: 1.55, rotation: pageRotation });
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
      const outputScale = Math.min(deviceMemory <= 3 ? 1.2 : 1.6, Math.max(1, window.devicePixelRatio || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.className = 'pdf-page-canvas';
      canvas.setAttribute('aria-label', `Halaman ${pageNumber}`);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas tidak dapat dibuat pada perangkat ini.');
      context.fillStyle = '#fffdf8';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        background: '#fffdf8',
      }).promise;
      if (version !== generation.current) return;

      const layer = document.createElement('div');
      layer.className = 'pdf-text-layer';
      layer.style.width = `${viewport.width}px`;
      layer.style.height = `${viewport.height}px`;
      const measureNode = originalNode.querySelector<HTMLElement>('.page-content');
      const contentBox = measureNode?.getBoundingClientRect();
      const contentWidth = contentBox?.width || 460;
      const contentHeight = contentBox?.height || 650;
      const textScale = Math.min(contentWidth / viewport.width, contentHeight / viewport.height);
      layer.style.left = `${Math.max(0, (contentWidth - viewport.width * textScale) / 2)}px`;
      layer.style.top = `${Math.max(0, (contentHeight - viewport.height * textScale) / 2)}px`;
      layer.style.transform = `scale(${textScale})`;
      layer.style.transformOrigin = 'top left';
      const textContent = await page.getTextContent();
      const pageHighlights = highlights.filter((item) => item.page === pageNumber);
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str) continue;
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.max(1, Math.hypot(transform[2], transform[3]));
        const span = document.createElement('span');
        span.textContent = item.str;
        span.className = 'pdf-text-span';
        span.style.left = `${transform[4]}px`;
        span.style.top = `${transform[5] - height}px`;
        span.style.fontSize = `${height}px`;
        span.style.width = `${Math.max(0, item.width * viewport.scale)}px`;
        span.style.height = `${height * 1.2}px`;
        span.style.transform = `rotate(${Math.atan2(transform[1], transform[0])}rad)`;
        const matched = pageHighlights.find((highlight) => {
          const quote = highlight.text.toLowerCase();
          const run = item.str.toLowerCase();
          return run.includes(quote) || (run.length > 2 && quote.includes(run));
        });
        if (matched) span.classList.add(`saved-highlight-${matched.color}`);
        layer.appendChild(span);
      }
      if (version !== generation.current || !wantedPages.current.has(pageNumber)) return;
      // In portrait mode StPageFlip may clone the HTML sheets. Update every matching
      // instance so the visible clone receives the newly-rendered canvas as well.
      const matchingNodes = new Set<HTMLElement>([originalNode]);
      engineRef.current?.querySelectorAll<HTMLElement>(`[data-page-number="${pageNumber}"]`).forEach((node) => matchingNodes.add(node));
      let firstCanvas = true;
      for (const node of matchingNodes) {
        const content = node.querySelector<HTMLElement>('.page-content');
        if (!content) continue;
        let pageCanvas = canvas;
        if (!firstCanvas) {
          pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = canvas.height;
          pageCanvas.className = canvas.className;
          const copyContext = pageCanvas.getContext('2d');
          if (copyContext) copyContext.drawImage(canvas, 0, 0);
        }
        firstCanvas = false;
        content.replaceChildren(pageCanvas, layer.cloneNode(true));
      }
      markRendered(pageNumber, version);
    })().catch((error) => {
      console.error(`Folio failed to render PDF page ${pageNumber}`, error);
      const pageNode = pageNodes.current[pageNumber - 1];
      const content = pageNode?.querySelector<HTMLElement>('.page-content');
      if (content && version === generation.current) {
        content.innerHTML = '<div class="page-render-error">Halaman ini tidak dapat dirender.</div>';
      }
    }).finally(() => {
      // An older render must not erase a newer render registered for the same page.
      if (rendering.current.get(pageNumber) === task) rendering.current.delete(pageNumber);
    });
    rendering.current.set(pageNumber, task);
    return task;
  }, [pdf, pageCount, rotation, highlights, markRendered]);

  const renderWindow = useCallback((zeroBasedIndex: number) => {
    const first = Math.max(1, zeroBasedIndex);
    const last = Math.min(pageCount, zeroBasedIndex + 3);
    const nextWindow = new Set<number>();
    for (let page = first; page <= last; page += 1) nextWindow.add(page);
    wantedPages.current = nextWindow;

    // Release canvases that are far from the active spread. Page elements remain in
    // the flip engine, but their expensive pixel buffers are reclaimed.
    for (const pageNumber of rendered.current.keys()) {
      if (nextWindow.has(pageNumber)) continue;
      const nodes = new Set<HTMLElement>();
      const original = pageNodes.current[pageNumber - 1];
      if (original) nodes.add(original);
      engineRef.current?.querySelectorAll<HTMLElement>(`[data-page-number="${pageNumber}"]`).forEach((node) => nodes.add(node));
      for (const node of nodes) {
        const content = node.querySelector<HTMLElement>('.page-content');
        if (!content) continue;
        const placeholder = document.createElement('div');
        placeholder.className = 'page-loading';
        placeholder.textContent = String(pageNumber);
        content.replaceChildren(placeholder);
      }
      rendered.current.delete(pageNumber);
    }
    for (const page of nextWindow) void renderPage(page);
  }, [pageCount, renderPage]);

  useLayoutEffect(() => {
    generation.current += 1;
    rendered.current.clear();
    rendering.current.clear();
    wantedPages.current.clear();
    setRenderProgress(0);
    const host = engineRef.current;
    if (!host) return;
    const pages = pageNodes.current.filter((node): node is HTMLDivElement => Boolean(node));
    const safeStart = Math.min(Math.max(0, initialPage), pageCount - 1);
    const instance = new PageFlip(host, {
      width: 460,
      height: 650,
      size: 'stretch',
      minWidth: 250,
      maxWidth: 620,
      minHeight: 320,
      maxHeight: 850,
      drawShadow: true,
      flippingTime: 820,
      usePortrait: true,
      startPage: safeStart,
      autoSize: true,
      maxShadowOpacity: 0.58,
      showCover: true,
      mobileScrollSupport: false,
      swipeDistance: 26,
      clickEventForward: true,
      useMouseEvents: true,
      disableFlipByClick: true,
    });
    flipRef.current = instance;
    instance.on('flip', (event) => {
      const index = Number(event.data);
      setCurrentPage(index);
      onPageChange(index + 1);
      renderWindow(index);
    });
    instance.loadFromHTML(pages);
    setCurrentPage(safeStart);
    renderWindow(safeStart);
    onLoadPageCount(pageCount);

    return () => {
      generation.current += 1;
      const parent = host.parentNode;
      const nextSibling = host.nextSibling;
      try {
        instance.destroy();
      } catch (error) {
        console.warn('PageFlip cleanup:', error);
      }
      // StPageFlip removes its root node on destroy. Reattach it before React performs
      // its own reconciliation (for document switches or layout-mode changes).
      if (parent && !host.parentNode) parent.insertBefore(host, nextSibling);
      if (flipRef.current === instance) flipRef.current = null;
      rendered.current.clear();
      rendering.current.clear();
    };
    // The PageFlip engine is recreated when the PDF, layout or initial page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageCount, singlePage]);

  // Re-render visible sheets after rotation/highlight updates without rebuilding the book.
  useLayoutEffect(() => {
    generation.current += 1;
    rendered.current.clear();
    rendering.current.clear();
    setRenderProgress(0);
    renderWindow(flipRef.current?.getCurrentPageIndex() ?? currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, highlights]);

  useImperativeHandle(ref, () => ({
    next: () => flipRef.current?.flipNext('bottom'),
    previous: () => flipRef.current?.flipPrev('bottom'),
    goTo: (pageNumber: number) => {
      if (!flipRef.current) return;
      const pageIndex = Math.min(Math.max(0, pageNumber - 1), pageCount - 1);
      flipRef.current.turnToPage(pageIndex);
      setCurrentPage(pageIndex);
      onPageChange(pageIndex + 1);
      renderWindow(pageIndex);
    },
    currentPage: () => (flipRef.current?.getCurrentPageIndex() ?? currentPage) + 1,
  }), [pageCount, currentPage, onPageChange, renderWindow]);

  const pageElements = useMemo(() => Array.from({ length: pageCount }, (_, index) => index), [pageCount]);

  const handleSelection = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (!selectedText || selectedText.length < 2) return;
    const anchor = selection?.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const sheet = anchor?.closest<HTMLElement>('[data-page-number]');
    const pageNumber = Number(sheet?.dataset.pageNumber || currentPage + 1);
    onSelection(pageNumber, selectedText.slice(0, 1200));
  };

  return (
    <div className="reader-stage" onMouseUp={handleSelection} onTouchEnd={handleSelection}>
      <div className="reader-surface" style={{ filter: `brightness(${brightness}%)`, transform: `scale(${zoom / 100})` }}>
        <div className={`book-engine ${singlePage ? 'book-engine-single' : ''}`} ref={engineRef}>
          {pageElements.map((index) => (
            <div
              className="page-sheet"
              data-density={index === 0 || index === pageCount - 1 ? 'hard' : 'soft'}
              data-page-number={index + 1}
              key={index}
              ref={(node) => { pageNodes.current[index] = node; }}
            >
              <div className="page-paper-edge" />
              <div className="page-content">
                <div className="page-loading">{index + 1}</div>
              </div>
              <span className="page-number-print">{index + 1}</span>
            </div>
          ))}
        </div>
      </div>
      {renderProgress < 100 && (
        <div className="render-progress" aria-live="polite">
          <span style={{ width: `${Math.max(4, renderProgress)}%` }} />
          <small>Menyiapkan halaman yang diperlukan…</small>
        </div>
      )}
    </div>
  );
});

export default BookReader;
