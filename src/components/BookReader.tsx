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

interface InternalPage {
  getElement: () => HTMLElement;
  getTemporaryCopy: () => unknown;
  hideTemporaryCopy: () => void;
}

interface InternalHtmlRenderer {
  leftPage: InternalPage | null;
  rightPage: InternalPage | null;
  flippingPage: InternalPage | null;
  bottomPage: InternalPage | null;
  shadow: unknown;
  clear: () => void;
  drawFrame: () => void;
  update: () => void;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(() => resolve(), { timeout: 90 });
    } else {
      window.setTimeout(resolve, 18);
    }
  });
}

/**
 * PageFlip's stock HTMLRender.clear() scans every PDF page on every animation frame.
 * Keep the one-time full cleanup, then clean only pages that were active in the last
 * frame. The four active page references are the only pages PageFlip can draw.
 */
function optimizeHtmlRenderer(instance: PageFlip): () => void {
  const renderer = instance.getRender() as unknown as InternalHtmlRenderer;
  const collection = instance.getPageCollection() as unknown as { getPages: () => InternalPage[] };
  if (
    typeof renderer.clear !== 'function' ||
    typeof renderer.drawFrame !== 'function' ||
    typeof renderer.update !== 'function' ||
    typeof collection.getPages !== 'function'
  ) {
    return () => undefined;
  }

  const originalClear = renderer.clear.bind(renderer);
  const originalDrawFrame = renderer.drawFrame.bind(renderer);
  const originalUpdate = renderer.update.bind(renderer);
  const allPages = collection.getPages();
  let initialized = false;
  let previousActive = new Set<InternalPage>();
  let wasAnimating = false;
  let hasStaticFrame = false;
  let forceStaticDraw = true;
  let lastLeftPage: InternalPage | null = null;
  let lastRightPage: InternalPage | null = null;
  let lastBounds = { left: NaN, top: NaN, width: NaN, height: NaN };

  renderer.update = () => {
    forceStaticDraw = true;
    originalUpdate();
  };

  renderer.drawFrame = () => {
    const animating = renderer.flippingPage !== null || renderer.bottomPage !== null || renderer.shadow !== null;
    if (animating) {
      wasAnimating = true;
      originalDrawFrame();
      return;
    }

    const bounds = instance.getBoundsRect();
    const changed = !hasStaticFrame || wasAnimating || forceStaticDraw ||
      renderer.leftPage !== lastLeftPage || renderer.rightPage !== lastRightPage ||
      bounds.left !== lastBounds.left || bounds.top !== lastBounds.top ||
      bounds.width !== lastBounds.width || bounds.height !== lastBounds.height;

    if (changed) originalDrawFrame();
    lastLeftPage = renderer.leftPage;
    lastRightPage = renderer.rightPage;
    lastBounds = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    hasStaticFrame = true;
    wasAnimating = false;
    forceStaticDraw = false;
  };

  renderer.clear = () => {
    const activePages = [renderer.leftPage, renderer.rightPage, renderer.flippingPage, renderer.bottomPage]
      .filter((page): page is InternalPage => page !== null);
    const activeSet = new Set(activePages);

    const cleanPage = (page: InternalPage, hide: boolean) => {
      if (hide) {
        const element = page.getElement();
        if (element.style.display !== 'none') element.style.display = 'none';
      }
      const temporaryCopy = page.getTemporaryCopy();
      if (temporaryCopy && temporaryCopy !== renderer.flippingPage) {
        page.hideTemporaryCopy();
      }
    };

    if (!initialized) {
      for (const page of allPages) cleanPage(page, !activeSet.has(page));
      initialized = true;
    } else {
      for (const page of previousActive) {
        if (!activeSet.has(page)) cleanPage(page, true);
        else cleanPage(page, false);
      }
      // A temporary fold copy may belong to an active original page. Keep it only
      // while it is the page currently being folded.
      for (const page of activePages) cleanPage(page, false);
    }

    previousActive = activeSet;
  };

  return () => {
    renderer.clear = originalClear;
    renderer.drawFrame = originalDrawFrame;
    renderer.update = originalUpdate;
  };
}

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
  const renderQueue = useRef<number[]>([]);
  const renderQueueRunning = useRef(false);
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
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
      // Keep enough resolution for crisp reading while avoiding oversized canvases
      // that compete with the 3D page animation on Android WebView.
      const renderScale = deviceMemory <= 3 ? 1.3 : 1.45;
      const viewport = page.getViewport({ scale: renderScale, rotation: pageRotation });
      const outputScale = Math.min(deviceMemory <= 3 ? 1.15 : 1.35, Math.max(1, window.devicePixelRatio || 1));
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
        canvas,
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
      const pageHighlights = highlights
        .filter((item) => item.page === pageNumber)
        .map((item) => ({ ...item, normalizedText: item.text.toLowerCase() }));
      const fragment = document.createDocumentFragment();
      let createdSpans = 0;
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
        const run = item.str.toLowerCase();
        const matched = pageHighlights.find((highlight) => (
          run.includes(highlight.normalizedText) ||
          (run.length > 2 && highlight.normalizedText.includes(run))
        ));
        if (matched) span.classList.add(`saved-highlight-${matched.color}`);
        fragment.appendChild(span);
        createdSpans += 1;

        // Long text layers can contain thousands of spans. Yield between chunks so
        // touch input and the page-flip animation get time on the main thread.
        if (createdSpans % 180 === 0) {
          layer.appendChild(fragment);
          await yieldToBrowser();
          if (version !== generation.current || !wantedPages.current.has(pageNumber)) return;
        }
      }
      layer.appendChild(fragment);
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

  const renderPageLatest = useRef(renderPage);
  renderPageLatest.current = renderPage;

  const pumpRenderQueue = useCallback(async () => {
    if (renderQueueRunning.current) return;
    renderQueueRunning.current = true;
    try {
      while (renderQueue.current.length > 0) {
        const pageNumber = renderQueue.current.shift();
        if (!pageNumber || !wantedPages.current.has(pageNumber)) continue;
        if (rendered.current.get(pageNumber) === generation.current) continue;
        await renderPageLatest.current(pageNumber);
        if (renderQueue.current.length > 0) await yieldToBrowser();
      }
    } finally {
      renderQueueRunning.current = false;
      if (renderQueue.current.length > 0) void pumpRenderQueue();
    }
  }, []);

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

    // Render one page at a time, closest to the current page first. Background pages
    // are picked up during idle time instead of competing with active touch gestures.
    renderQueue.current = Array.from(nextWindow)
      .filter((page) => rendered.current.get(page) !== generation.current)
      .sort((a, b) => Math.abs(a - first) - Math.abs(b - first));
    void pumpRenderQueue();
  }, [pageCount, pumpRenderQueue]);

  useLayoutEffect(() => {
    generation.current += 1;
    rendered.current.clear();
    rendering.current.clear();
    renderQueue.current = [];
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
    const restoreRenderer = optimizeHtmlRenderer(instance);
    setCurrentPage(safeStart);
    renderWindow(safeStart);
    onLoadPageCount(pageCount);

    return () => {
      generation.current += 1;
      const parent = host.parentNode;
      const nextSibling = host.nextSibling;
      try {
        restoreRenderer();
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
      renderQueue.current = [];
    };
    // The PageFlip engine is recreated when the PDF, layout or initial page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageCount, singlePage]);

  // Re-render visible sheets after rotation/highlight updates without rebuilding the book.
  useLayoutEffect(() => {
    generation.current += 1;
    rendered.current.clear();
    rendering.current.clear();
    renderQueue.current = [];
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
