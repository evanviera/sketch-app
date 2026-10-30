import { brandBodyFont } from './brand';
import { drawAnnotation, type Annotation } from './model';

export type SheetRow = { note: Annotation; lines: string[]; y: number; height: number };
export type SheetLayout = {
  width: number; height: number; imageWidth: number; imageHeight: number;
  imageScale: number; imageX: number; panelX: number; rows: SheetRow[];
  fontSize: number; lineHeight: number; padding: number; textX: number; badgeSize: number;
};
const sheetFont = (size: number) => `${size}px ${brandBodyFont}`;

/** Preserve paragraphs and wrap even a URL or a word wider than the text column. */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const { segment } of segmenter.segment(paragraph)) {
      if (line && measure(line + segment) > maxWidth) {
        const breakAt = line.lastIndexOf(' ');
        if (breakAt > 0) { lines.push(line.slice(0, breakAt)); line = line.slice(breakAt + 1); }
        else { lines.push(line); line = ''; }
      }
      line += segment;
    }
    lines.push(line);
  }
  return lines;
}

export function layoutSheet(width: number, height: number, items: Annotation[], measure: (text: string, fontSize: number) => number): SheetLayout {
  const notes = items.filter(item => item.type === 'pin').sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  if (!notes.length) throw new Error('Add a numbered feedback note before exporting a notes sheet.');
  // Shareable sheets cap only the image section; ordinary PNG export stays full resolution.
  const imageScale = Math.min(1, 4096 / Math.max(width, height));
  const imageWidth = Math.round(width * imageScale), imageHeight = Math.round(height * imageScale);
  const panelX = Math.max(480, imageWidth);
  // Scale typography with the complete sheet, so a 1000px-wide preview keeps
  // feedback around 18px even beside a 4K image. The panel gets a third of the width.
  const panelWidth = Math.max(480, Math.round(panelX / 2));
  const fontSize = Math.max(28, Math.ceil((panelX + panelWidth) * .018));
  const lineHeight = Math.ceil(fontSize * 1.45), padding = Math.ceil(fontSize * 1.1);
  const badgeSize = Math.ceil(fontSize * 1.4), textX = padding + badgeSize + Math.ceil(fontSize * .65);
  let y = padding;
  const rows = notes.map(note => {
    const lines = wrapText(note.text || '', panelWidth - textX - padding, text => measure(text, fontSize));
    const row = { note, lines, y, height: Math.max(badgeSize, lines.length * lineHeight) + padding };
    y += row.height;
    return row;
  });
  const sheetWidth = panelX + panelWidth, sheetHeight = Math.max(imageHeight, y + padding);
  if (sheetHeight > 16384 || sheetWidth * sheetHeight > 40_000_000) {
    throw new Error('These notes exceed the single-image size limit. Shorten the feedback or copy the notes as text; no notes have been omitted.');
  }
  return { width: sheetWidth, height: sheetHeight, imageWidth, imageHeight, imageScale,
    imageX: (panelX - imageWidth) / 2, panelX, rows, fontSize, lineHeight, padding, textX, badgeSize };
}

export function renderNotesSheet(source: HTMLImageElement, items: Annotation[]) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  let measuredSize = 0;
  const layout = layoutSheet(source.naturalWidth, source.naturalHeight, items, (text, size) => {
    if (size !== measuredSize) { ctx.font = sheetFont(size); measuredSize = size; }
    return ctx.measureText(text).width;
  });
  const { fontSize, lineHeight, padding, textX, badgeSize } = layout;
  canvas.width = layout.width; canvas.height = layout.height;
  ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(layout.imageX, 0); ctx.scale(layout.imageScale, layout.imageScale);
  // Clip artwork and annotations exactly as in the normal image export.
  ctx.beginPath(); ctx.rect(0, 0, source.naturalWidth, source.naturalHeight); ctx.clip();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, source.naturalWidth, source.naturalHeight);
  ctx.drawImage(source, 0, 0);
  for (const item of items) drawAnnotation(ctx, item);
  ctx.restore();
  for (const row of layout.rows) {
    const x = layout.panelX;
    ctx.fillStyle = row.note.color;
    ctx.fillRect(x + padding, row.y, badgeSize, badgeSize);
    ctx.fillStyle = '#202628'; ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(row.note.number), x + padding + badgeSize / 2, row.y + badgeSize / 2, badgeSize - 8);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = sheetFont(fontSize); ctx.fillStyle = '#eeeeee';
    row.lines.forEach((line, index) => ctx.fillText(line, x + textX, row.y + index * lineHeight));
  }
  return canvas;
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    canvas.width = canvas.height = 1;
    if (blob) resolve(blob); else reject(new Error('Image export failed. Try a smaller image.'));
  }, 'image/png'));
}
