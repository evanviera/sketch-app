export type Point = { x: number; y: number };
export type Tool = 'select' | 'pen' | 'arrow' | 'rectangle' | 'highlight' | 'text' | 'pin' | 'hand';
export type Annotation = {
  id: string; type: Exclude<Tool, 'hand' | 'select'>; color: string; size: number;
  points: Point[]; text?: string; number?: number; radius?: number; fontSize?: number;
};
export class History {
  private past: Annotation[][] = [];
  private future: Annotation[][] = [];
  items: Annotation[] = [];
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  commit(items: Annotation[]) {
    this.past.push(this.items);
    if (this.past.length > 150) this.past.shift();
    this.items = items;
    this.future = [];
  }
  undo() {
    if (!this.canUndo) return;
    this.future.push(this.items);
    this.items = this.past.pop()!;
  }
  redo() {
    if (!this.canRedo) return;
    this.past.push(this.items);
    this.items = this.future.pop()!;
  }
  reset(items: Annotation[] = []) { this.items = items; this.past = []; this.future = []; }
}
export function constrain(start: Point, end: Point): Point {
  const angle = Math.round(Math.atan2(end.y - start.y, end.x - start.x) / (Math.PI / 4)) * Math.PI / 4;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}
export function fitScale(width: number, height: number, viewWidth: number, viewHeight: number) {
  return Math.max(0.01, Math.min((viewWidth - 96) / width, (viewHeight - 96) / height, 1));
}
export function nextPin(items: Annotation[]) {
  return Math.max(0, ...items.map(item => item.number ?? 0)) + 1;
}
export function feedbackText(items: Annotation[]) {
  return items.filter(item => item.type === 'pin').map(item => `${item.number}. ${item.text || 'Review this area'}`).join('\n');
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, item: Annotation) {
  const [start] = item.points;
  if (!start) return;
  const end = item.points.at(-1)!;
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (item.type === 'pen' || item.type === 'highlight') {
    ctx.globalAlpha = item.type === 'highlight' ? 0.32 : 1;
    ctx.lineWidth = item.type === 'highlight' ? item.size * 5 : item.size;
    ctx.beginPath();
    if (item.points.length === 1) {
      ctx.arc(start.x, start.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < item.points.length - 1; i++) {
        const point = item.points[i], next = item.points[i + 1];
        ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      ctx.lineTo(end.x, end.y); ctx.stroke();
    }
  } else if (item.type === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(14, item.size * 4);
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
    ctx.moveTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  } else if (item.type === 'rectangle') {
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else if (item.type === 'text') {
    const size = textSize(item);
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    (item.text || '').split('\n').forEach((line, index) => {
      const y = start.y + index * size * 1.3;
      ctx.strokeStyle = '#141618'; ctx.lineWidth = Math.max(2, size / 9);
      ctx.strokeText(line, start.x, y); ctx.fillText(line, start.x, y);
    });
  } else if (item.type === 'pin') {
    const radius = pinRadius(item);
    ctx.fillRect(start.x - radius, start.y - radius, radius * 2, radius * 2);
    ctx.fillStyle = '#151719'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${radius}px system-ui, sans-serif`;
    ctx.fillText(String(item.number), start.x, start.y + 1, radius * 1.6);
  }
  ctx.restore();
}

// Stored as radius for draft compatibility; it is now the square marker's half-size.
export function pinRadius(item: Annotation) { return item.radius ?? Math.max(14, item.size * 3); }
export function hitPin(items: Annotation[], point: Point, zoom: number) {
  return [...items].reverse().find(item => item.type === 'pin' &&
    Math.max(Math.abs(point.x - item.points[0].x), Math.abs(point.y - item.points[0].y)) <= pinRadius(item) + 4 / zoom);
}
export function movePin(item: Annotation, delta: Point, width: number, height: number): Annotation {
  return { ...item, points: [{
    x: Math.max(0, Math.min(width, item.points[0].x + delta.x)),
    y: Math.max(0, Math.min(height, item.points[0].y + delta.y)),
  }] };
}
export function resizePin(item: Annotation, radius: number): Annotation {
  return { ...item, radius: Math.round(Math.max(8, Math.min(96, radius))) };
}

export type Bounds = { x: number; y: number; width: number; height: number };
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';
export const textSize = (item: Annotation) => item.fontSize ?? Math.max(18, item.size * 5);
export function annotationBounds(item: Annotation, ctx: CanvasRenderingContext2D): Bounds {
  const a = item.points[0], b = item.points.at(-1)!;
  if (item.type === 'text') {
    const size = textSize(item), lines = (item.text || '').split('\n');
    ctx.save(); ctx.font = `600 ${size}px system-ui, sans-serif`;
    const width = Math.max(size / 2, ...lines.map(line => ctx.measureText(line).width));
    ctx.restore();
    return { x: a.x, y: a.y, width, height: lines.length * size * 1.3 };
  }
  if (item.type === 'pen' || item.type === 'highlight') {
    let minX = a.x, minY = a.y, maxX = a.x, maxY = a.y;
    for (const point of item.points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    const pad = item.size * (item.type === 'highlight' ? 5 : 1) / 2;
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  }
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
const hitPaths = new WeakMap<Annotation, Path2D>();
function hitStroke(item: Annotation, point: Point, zoom: number, ctx: CanvasRenderingContext2D) {
  const strokeWidth = item.size * (item.type === 'highlight' ? 5 : 1);
  if (item.points.length === 1) return Math.hypot(point.x - item.points[0].x, point.y - item.points[0].y) <= strokeWidth / 2 + 6 / zoom;
  let path = hitPaths.get(item);
  if (!path) {
    path = new Path2D(); path.moveTo(item.points[0].x, item.points[0].y);
    for (let i = 1; i < item.points.length - 1; i++) {
      const a = item.points[i], b = item.points[i + 1];
      path.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    const end = item.points.at(-1)!; path.lineTo(end.x, end.y); hitPaths.set(item, path);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = strokeWidth + 12 / zoom; ctx.lineCap = ctx.lineJoin = 'round';
  const hit = ctx.isPointInStroke(path, point.x, point.y); ctx.restore(); return hit;
}
/** Select hits the topmost annotation of any kind, including the actual smoothed stroke. */
export function hitAnnotation(items: Annotation[], point: Point, zoom: number, tool: Tool, ctx: CanvasRenderingContext2D) {
  if (tool === 'pin') return hitPin(items, point, zoom);
  return [...items].reverse().find(item => {
    if (tool !== 'select' && (item.type !== tool || !['arrow', 'rectangle', 'text'].includes(item.type))) return false;
    if (item.type === 'pin') return !!hitPin([item], point, zoom);
    if (item.type === 'pen' || item.type === 'highlight') return hitStroke(item, point, zoom, ctx);
    const tolerance = 6 / zoom + item.size / 2;
    if (item.type === 'arrow') {
      const a = item.points[0], b = item.points.at(-1)!, angle = Math.atan2(b.y - a.y, b.x - a.x), head = Math.max(14, item.size * 4);
      return segmentDistance(point, a, b) <= tolerance || [-1, 1].some(sign =>
        segmentDistance(point, b, { x: b.x - head * Math.cos(angle + sign * Math.PI / 6), y: b.y - head * Math.sin(angle + sign * Math.PI / 6) }) <= tolerance);
    }
    const bounds = annotationBounds(item, ctx);
    return point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance &&
      point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
  });
}
export function moveAnnotation(item: Annotation, delta: Point, width: number, height: number, ctx: CanvasRenderingContext2D): Annotation {
  if (!delta.x && !delta.y) return item;
  if (item.type === 'pin') return movePin(item, delta, width, height);
  const bounds = annotationBounds(item, ctx);
  if (item.type === 'pen' || item.type === 'highlight') {
    const pad = item.size * (item.type === 'highlight' ? 5 : 1) / 2;
    bounds.x += pad; bounds.y += pad; bounds.width -= pad * 2; bounds.height -= pad * 2;
  }
  const x = Math.max(-bounds.x, Math.min(Math.max(0, width - bounds.width) - bounds.x, delta.x));
  const y = Math.max(-bounds.y, Math.min(Math.max(0, height - bounds.height) - bounds.y, delta.y));
  return { ...item, points: item.points.map(point => ({ x: point.x + x, y: point.y + y })) };
}
export function resizeAnnotation(item: Annotation, handle: ResizeHandle, delta: Point, ctx: CanvasRenderingContext2D, width: number, height: number, snap = false): Annotation {
  if (!delta.x && !delta.y) return item;
  const clamp = (point: Point) => ({ x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) });
  if (item.type === 'arrow') {
    const index = handle === 'start' ? 0 : 1, points = [item.points[0], item.points.at(-1)!];
    let point = { x: points[index].x + delta.x, y: points[index].y + delta.y };
    if (snap) point = constrain(points[1 - index], point);
    points[index] = clamp(point);
    return { ...item, points };
  }
  const bounds = annotationBounds(item, ctx);
  if (item.type === 'text') {
    // Uniform scaling keeps glyphs and multiline spacing proportional.
    const scale = 1 + (delta.x * bounds.width + delta.y * bounds.height) / (bounds.width ** 2 + bounds.height ** 2);
    return { ...item, fontSize: Math.round(Math.max(8, Math.min(512, textSize(item) * scale))) };
  }
  const left = handle.includes('w'), top = handle.includes('n');
  const fixed = { x: bounds.x + (left ? bounds.width : 0), y: bounds.y + (top ? bounds.height : 0) };
  const moving = clamp({ x: bounds.x + (left ? 0 : bounds.width) + delta.x, y: bounds.y + (top ? 0 : bounds.height) + delta.y });
  if (item.type === 'pen' || item.type === 'highlight') {
    const sx = (moving.x - fixed.x) / ((left ? -1 : 1) * bounds.width);
    const sy = (moving.y - fixed.y) / ((top ? -1 : 1) * bounds.height);
    return { ...item, size: Math.max(.5, Math.min(256, item.size * Math.sqrt(Math.abs(sx * sy)))),
      points: item.points.map(point => ({ x: fixed.x + (point.x - fixed.x) * sx, y: fixed.y + (point.y - fixed.y) * sy })) };
  }
  return { ...item, points: [fixed, moving] };
}
