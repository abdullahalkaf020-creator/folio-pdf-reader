import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// The worker is bundled locally by Vite. No CDN or internet connection is needed at runtime.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjs };
export type { PDFDocumentProxy };

export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
    enableXfa: false,
    stopAtErrors: false,
    maxImageSize: 32 * 1024 * 1024,
  });
  return task.promise;
}

export async function readPdfMetadata(file: File): Promise<{ pageCount: number; title?: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
    enableXfa: false,
    stopAtErrors: false,
  }).promise;
  try {
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = metadata?.info as { Title?: string } | undefined;
    return { pageCount: pdf.numPages, title: info?.Title || undefined };
  } finally {
    await pdf.destroy();
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function flattenOutline(items: any[], depth = 0): Array<{ title: string; dest: unknown; depth: number }> {
  const result: Array<{ title: string; dest: unknown; depth: number }> = [];
  for (const item of items ?? []) {
    result.push({ title: String(item.title ?? 'Bagian tanpa judul'), dest: item.dest, depth });
    if (item.items?.length) result.push(...flattenOutline(item.items, depth + 1));
  }
  return result;
}
