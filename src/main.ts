import './styles.css';
import { loadBrandFonts } from './brand';
loadBrandFonts();
import { History, constrain, drawAnnotation, feedbackText, fitScale, nextPin, pinRadius, resizePin, hitAnnotation, annotationBounds, moveAnnotation, resizeAnnotation, type ResizeHandle, type Annotation, type Point, type Tool } from './model';
import { renderNotesSheet, canvasBlob } from './notes-sheet';
import { loadDraft, saveDraft } from './storage';
import { native, openNative, pasteImage, copyImage, exportImage, copyText } from './native';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { checkForUpdates } from './updater';

function el<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id) as T; }
const viewport = el('viewport'), stage = el('stage');
const source = el<HTMLImageElement>('source');
const annotations = el<HTMLCanvasElement>('annotations'), preview = el<HTMLCanvasElement>('preview');
const ink = annotations.getContext('2d')!, live = preview.getContext('2d')!;
const history = new History();
const fileInput = el<HTMLInputElement>('file-input');
const textDialog = el<HTMLDialogElement>('text-dialog');
const textInput = el<HTMLTextAreaElement>('annotation-text');
let tool: Tool = 'pen', color = '#ff785a', size = 4;
let width = 0, height = 0, zoom = 1, offset = { x: 0, y: 0 }, resolution = 1;
let imageBlob: Blob | null = null, imageUrl = '', filename = 'Untitled feedback';
let active: Annotation | null = null, pending: Annotation | null = null;
let pointer: number | null = null, panStart: Point | null = null, panOrigin: Point | null = null;
let space = false, comparing = false, frame = 0, savedTimer = 0, toastTimer = 0;
let saving: Promise<void> = Promise.resolve(), generation = 0, busy = false, loading = false;
let followFit = true, ready = false;
let selectedId: string | null = null;
type AnnotationEdit = { before: Annotation; draft: Annotation; start: Point; kind: 'move' | 'resize' | 'slider' | ResizeHandle };
let annotationEdit: AnnotationEdit | null = null;
let sheetBlob: Blob | null = null, sheetUrl = '', sheetVersion = 0;
let menuFrame = 0, menuSnapshot = '';
let menuSync: Promise<unknown> = Promise.resolve();

function editingText() { return !!document.activeElement?.matches('textarea, input:not([type=range]):not([type=file]), [contenteditable]'); }
function syncMenu() {
  if (!native || menuFrame) return;
  menuFrame = requestAnimationFrame(() => {
    menuFrame = 0;
    const modal = !!document.querySelector('dialog[open]'), editing = editingText();
    const available = ready && !loading && !busy && !modal, image = available && !!imageBlob;
    const notes = image && history.items.some(item => item.type === 'pin');
    const selected = selectedAnnotation();
    const states: Record<string, boolean> = {
      open: available, 'paste-image': available, export: image, sheet: notes,
      'copy-image': image, 'copy-sheet': notes, 'copy-notes': notes,
      undo: editing || (image && history.canUndo), redo: editing || (image && history.canRedo),
      delete: image && !!selected && !editing && !comparing,
      'edit-text': image && !!selected && ['text', 'pin'].includes(selected.type),
      fit: image, 'actual-size': image, 'zoom-in': image, 'zoom-out': image, original: image, help: !modal, 'check-updates': !modal,
    };
    for (const name of Object.keys(toolInfo)) states[`tool-${name}`] = available;
    const snapshot = JSON.stringify(states);
    if (snapshot === menuSnapshot) return;
    menuSnapshot = snapshot;
    menuSync = menuSync.catch(() => {}).then(() => invoke('sync_menu', { states })).catch(error => { menuSnapshot = ''; report(error); });
  });
}

const toolInfo: Record<Tool, [string, string]> = {
  select: ['Select', 'Click or drag any annotation · handles to resize · Delete to remove'],
  pen: ['Pen', 'Draw directly on the image'], arrow: ['Arrow', 'Drag an arrow to move · drag its endpoints to resize'],
  rectangle: ['Rectangle', 'Drag a box to move · drag a corner to resize'], highlight: ['Highlight', 'Bring attention to a detail'],
  text: ['Text', 'Drag text to move · drag its corner to resize · double-click to edit'], pin: ['Feedback pin', 'Click to add · drag a marker to move · drag its corner to resize'],
  hand: ['Pan', 'Drag to move around the image'],
};
function toast(message: string, error = false) {
  clearTimeout(toastTimer); const target = el('toast'); target.textContent = message;
  target.classList.toggle('error', error); target.hidden = false;
  toastTimer = window.setTimeout(() => target.hidden = true, error ? 6500 : 3500);
}
function report(error: unknown) { toast(error instanceof Error ? error.message : String(error), true); }
async function run(task: () => Promise<unknown>) { try { await task(); } catch (error) { report(error); } finally { syncMenu(); } }
function setTool(value: Tool) {
  cancelGesture(); tool = value;
  selectedId = null;
  updateSelection();
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
  });
  el('tool-name').textContent = toolInfo[tool][0]; el('tool-hint').textContent = toolInfo[tool][1];
  viewport.style.cursor = tool === 'hand' || space ? 'grab' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair';
}
function pointAt(event: { clientX: number; clientY: number }): Point {
  const rect = viewport.getBoundingClientRect();
  return { x: (event.clientX - rect.left - offset.x) / zoom, y: (event.clientY - rect.top - offset.y) / zoom };
}
function clear(ctx: CanvasRenderingContext2D) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
}
function redraw() {
  clear(ink);
  for (const item of history.items) if (item.id !== annotationEdit?.before.id) drawAnnotation(ink, item);
}
function renderPreview() {
  frame = 0; clear(live); if (active) drawAnnotation(live, active);
  if (annotationEdit) drawAnnotation(live, annotationEdit.draft);
}
function schedulePreview() { if (!frame) frame = requestAnimationFrame(renderPreview); }
function resizeLayers() {
  // View-sized caches, capped at 8 MP each. Export renders vectors at source resolution.
  const next = Math.min(1, zoom * devicePixelRatio, Math.sqrt(8_000_000 / (width * height)));
  const w = Math.max(1, Math.ceil(width * next)), h = Math.max(1, Math.ceil(height * next));
  if (annotations.width === w && annotations.height === h) return;
  resolution = next;
  for (const canvas of [annotations, preview]) {
    canvas.width = w; canvas.height = h; canvas.getContext('2d')!.setTransform(resolution, 0, 0, resolution, 0, 0);
  }
  redraw(); schedulePreview();
}
function transform() {
  stage.style.transform = `translate(${offset.x}px,${offset.y}px) scale(${zoom})`;
  el('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  source.style.imageRendering = zoom >= 2 ? 'pixelated' : 'auto';
  updateSelection();
}
function fit() {
  if (!width) return;
  followFit = true; zoom = fitScale(width, height, viewport.clientWidth, viewport.clientHeight);
  offset = { x: (viewport.clientWidth - width * zoom) / 2, y: (viewport.clientHeight - height * zoom) / 2 };
  transform(); resizeLayers();
}
function setZoom(value: number, anchor = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
  if (!width) return;
  followFit = false;
  const next = Math.min(8, Math.max(0.01, value));
  offset = { x: anchor.x - (anchor.x - offset.x) * next / zoom, y: anchor.y - (anchor.y - offset.y) * next / zoom };
  zoom = next; transform(); resizeLayers();
}
function compare(value: boolean) {
  comparing = value && !!imageBlob;
  annotations.style.visibility = preview.style.visibility = comparing ? 'hidden' : 'visible';
  el('compare-label').hidden = !comparing;
  updateSelection();
}
function refresh() {
  el<HTMLButtonElement>('undo').disabled = !history.canUndo;
  el<HTMLButtonElement>('redo').disabled = !history.canRedo;
  el('annotation-count').textContent = `${history.items.length} annotation${history.items.length === 1 ? '' : 's'}`;
  const notes = history.items.filter(item => item.type === 'pin');
  el('note-count').textContent = String(notes.length);
  el<HTMLButtonElement>('copy-notes').disabled = !notes.length;
  el<HTMLButtonElement>('notes-sheet').disabled = !notes.length;
  el<HTMLButtonElement>('copy-sheet').disabled = !notes.length || busy;
  const container = el('notes');
  container.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div'); empty.className = 'notes-empty';
    empty.innerHTML = '<span>⌖</span><p>A little context goes a long way.</p><small>Choose the pin tool <kbd>N</kbd>, click<br>the image, and leave a note.</small>';
    container.append(empty);
  }
  for (const note of notes) {
    const row = document.createElement('div'); row.className = 'note'; row.dataset.noteId = note.id;
    const badge = document.createElement('button'); badge.className = 'note-number'; badge.textContent = String(note.number);
    badge.style.background = note.color; badge.title = `Select note ${note.number}`; badge.setAttribute('aria-label', badge.title);
    badge.onclick = () => {
      setTool('select'); selectedId = note.id;
      const point = note.points[0]; followFit = false;
      offset = { x: viewport.clientWidth / 2 - point.x * zoom, y: viewport.clientHeight / 2 - point.y * zoom }; transform();
    };
    const text = document.createElement('p');
    const edit = document.createElement('button'); edit.className = 'note-text'; edit.textContent = note.text || '';
    edit.title = 'Edit feedback'; edit.setAttribute('aria-label', `Edit note ${note.number}`);
    edit.onclick = () => showText(note); text.append(edit);
    const remove = document.createElement('button'); remove.className = 'delete-note'; remove.textContent = '×';
    remove.title = `Delete note ${note.number}`; remove.setAttribute('aria-label', remove.title);
    remove.onclick = () => { history.commit(history.items.filter(item => item.id !== note.id)); changed(); };
    row.append(badge, text, remove); container.append(row);
  }
  updateSelection();
}
function selectedAnnotation() { return annotationEdit?.draft ?? history.items.find(item => item.id === selectedId); }
function updateSelection() {
  syncMenu();
  const pin = selectedAnnotation();
  if (!pin) selectedId = null;
  const ring = el('pin-selection');
  const visible = !!pin && !comparing && (tool === 'select' || pin.type === tool);
  ring.hidden = !visible || pin?.type !== 'pin';
  el('selected-note').hidden = ring.hidden;
  el('object-selection').hidden = el('selected-object').hidden = !visible || pin?.type === 'pin';
  document.querySelectorAll<HTMLElement>('.note').forEach(row => row.classList.toggle('selected', row.dataset.noteId === selectedId));
  if (!pin) return;
  if (pin.type !== 'pin') {
    const bounds = annotationBounds(pin, ink), box = el('object-bounds');
    box.hidden = pin.type === 'arrow';
    box.style.left = `${offset.x + bounds.x * zoom - 5}px`; box.style.top = `${offset.y + bounds.y * zoom - 5}px`;
    box.style.width = `${bounds.width * zoom + 10}px`; box.style.height = `${bounds.height * zoom + 10}px`;
    for (const handle of document.querySelectorAll<HTMLElement>('[data-resize]')) {
      const name = handle.dataset.resize as ResizeHandle;
      handle.hidden = pin.type === 'arrow' ? !['start', 'end'].includes(name) : pin.type === 'text' ? name !== 'se' : ['start', 'end'].includes(name);
      const point = pin.type === 'arrow' ? (name === 'start' ? pin.points[0] : pin.points.at(-1)!) : {
        x: bounds.x + (name.includes('e') ? bounds.width : 0), y: bounds.y + (name.includes('s') ? bounds.height : 0),
      };
      handle.style.left = `${offset.x + point.x * zoom}px`; handle.style.top = `${offset.y + point.y * zoom}px`;
    }
    el('object-kind').textContent = pin.type === 'rectangle' ? 'Box' : pin.type.charAt(0).toUpperCase() + pin.type.slice(1);
    el('edit-text').hidden = pin.type !== 'text';
    el('object-hint').textContent = pin.type === 'arrow' ? 'Drag the arrow to move it. Drag either endpoint to resize or redirect it.' : 'Drag to move. Drag a corner to resize.';
    return;
  }
  const radius = pinRadius(pin), edge = radius * zoom + 6;
  ring.style.left = `${offset.x + pin.points[0].x * zoom - edge}px`;
  ring.style.top = `${offset.y + pin.points[0].y * zoom - edge}px`;
  ring.style.width = ring.style.height = `${edge * 2}px`;
  el('selected-note-number').textContent = String(pin.number);
  el('pin-diameter-value').textContent = `${radius * 2} px`;
  el<HTMLInputElement>('pin-diameter').value = String(radius * 2);
}
function beginAnnotationEdit(pin: Annotation, kind: AnnotationEdit['kind'], start: Point) {
  selectedId = pin.id;
  annotationEdit = { before: pin, draft: pin, start, kind };
  redraw(); schedulePreview(); updateSelection();
}
function commitAnnotationEdit() {
  if (!annotationEdit) return;
  const { before, draft } = annotationEdit;
  annotationEdit = null;
  if (JSON.stringify(before) !== JSON.stringify(draft)) {
    history.commit(history.items.map(item => item.id === before.id ? draft : item)); changed();
  } else { redraw(); updateSelection(); }
  schedulePreview();
}
function persist() {
  if (!imageBlob) return;
  clearTimeout(savedTimer);
  const version = generation;
  const draft = { image: imageBlob, name: filename, annotations: history.items, savedAt: Date.now() };
  el('save-state').textContent = 'Saving…';
  saving = saving.catch(() => {}).then(() => saveDraft(draft)).then(() => {
    if (version === generation) el('save-state').textContent = 'Saved locally';
  }).catch(() => {
    if (version === generation) { el('save-state').textContent = 'Not saved'; toast('Draft could not be saved. Export your image before closing.', true); }
  });
}
function changed() {
  redraw(); refresh(); el('save-state').textContent = 'Saving…';
  clearTimeout(savedTimer); savedTimer = window.setTimeout(persist, 350);
}
function cancelGesture() {
  active = null; panStart = null; panOrigin = null;
  if (annotationEdit) { annotationEdit = null; redraw(); updateSelection(); }
  if (pointer !== null && viewport.hasPointerCapture(pointer)) viewport.releasePointerCapture(pointer);
  pointer = null; viewport.classList.remove('dragging'); schedulePreview();
}
async function confirmReplace() {
  if (!imageBlob || history.items.length === 0) return true;
  const dialog = el<HTMLDialogElement>('replace-dialog'); dialog.showModal();
  return new Promise<boolean>(resolve => {
    const finish = (value: boolean) => { dialog.close(); resolve(value); };
    el('replace-cancel').onclick = () => finish(false);
    el('replace-confirm').onclick = () => finish(true);
    dialog.oncancel = () => resolve(false);
  });
}
async function loadImage(blob: Blob, name: string, items: Annotation[] = [], restoring = false) {
  if (loading || (!restoring && !ready)) return;
  loading = true;
  const url = URL.createObjectURL(blob);
  let accepted = false;
  try {
    if (blob.size > 80 * 1024 * 1024) throw new Error('Choose an image under 80 MB.');
    // Inspect decoded dimensions before allocating any canvas layers.
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error('Could not open this image. Choose a PNG, JPG, or WebP.'); }
    const w = image.naturalWidth, h = image.naturalHeight;
    if (!w || !h || w * h > 40_000_000 || w > 16384 || h > 16384) throw new Error('Use an image under 40 megapixels and 16,384 pixels per side.');
    if (!restoring && !await confirmReplace()) return;
    cancelGesture(); selectedId = null; compare(false); clearTimeout(savedTimer); generation++;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = url; accepted = true; imageBlob = blob; filename = name;
    width = w; height = h; source.src = url;
    stage.style.width = `${w}px`; stage.style.height = `${h}px`;
    stage.hidden = false; el('empty').hidden = true;
    history.reset(items); el('filename').textContent = name;
    el('image-info').textContent = `${w.toLocaleString()} × ${h.toLocaleString()} px`;
    for (const id of ['copy', 'export', 'compare', 'zoom-in', 'zoom-out', 'zoom-value', 'fit']) el<HTMLButtonElement>(id).disabled = false;
    fit(); redraw(); refresh();
    if (restoring) { el('save-state').textContent = 'Saved locally'; toast('Your last review is ready to continue.'); }
    else persist();
  } finally { if (!accepted) URL.revokeObjectURL(url); loading = false; }
}
async function open() {
  if (native) { const blob = await openNative(); if (blob) await loadImage(blob, 'Image feedback'); }
  else { fileInput.value = ''; fileInput.click(); }
}
async function paste() { await loadImage(await pasteImage(), 'Clipboard image'); }
function showText(item: Annotation) {
  finishGesture();
  pending = item; textInput.value = item.text || '';
  const editing = history.items.some(existing => existing.id === item.id);
  el('text-submit').textContent = editing ? 'Save changes' : 'Add to image ↗';
  el('text-title').textContent = item.type === 'pin' ? `Feedback note ${item.number}` : editing ? 'Edit text' : 'Add text';
  textInput.placeholder = item.type === 'pin' ? 'What should change, and why?' : 'Type your annotation…';
  textDialog.showModal(); textInput.focus();
}
function finishGesture() {
  commitAnnotationEdit();
  if (active) { history.commit([...history.items, active]); selectedId = ['arrow', 'rectangle'].includes(active.type) ? active.id : null; active = null; changed(); }
  cancelGesture();
}
viewport.addEventListener('pointerdown', event => {
  if (!imageBlob || comparing || loading || pointer !== null || ![0, 1].includes(event.button)) return;
  viewport.focus();
  if (tool === 'hand' || space || event.button === 1) {
    pointer = event.pointerId; viewport.setPointerCapture(pointer);
    panStart = { x: event.clientX, y: event.clientY }; panOrigin = { ...offset }; viewport.classList.add('dragging'); return;
  }
  const point = pointAt(event);
  const pin = event.altKey && tool !== 'select' ? undefined : hitAnnotation(history.items, point, zoom, tool, ink);
  if (pin) {
    pointer = event.pointerId; viewport.setPointerCapture(pointer);
    beginAnnotationEdit(pin, 'move', point); return;
  }
  selectedId = null; updateSelection();
  if (tool === 'select') return;
  if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) return;
  const item: Annotation = { id: crypto.randomUUID(), type: tool, color, size, points: [point] };
  if (tool === 'text' || tool === 'pin') {
    if (tool === 'pin') item.number = nextPin(history.items);
    showText(item); return;
  }
  pointer = event.pointerId; viewport.setPointerCapture(pointer); active = item; schedulePreview();
});
function movePointer(event: PointerEvent) {
  if (pointer === null && tool === 'select' && imageBlob && !comparing) {
    viewport.style.cursor = space ? 'grab' : hitAnnotation(history.items, pointAt(event), zoom, tool, ink) ? 'move' : 'default';
  }
  if (pointer !== event.pointerId) return;
  if (panStart && panOrigin) {
    followFit = false; offset = { x: panOrigin.x + event.clientX - panStart.x, y: panOrigin.y + event.clientY - panStart.y }; transform(); return;
  }
  if (annotationEdit) {
    const point = pointAt(event), { before, start, kind } = annotationEdit;
    if (kind === 'move') annotationEdit.draft = moveAnnotation(before, { x: point.x - start.x, y: point.y - start.y }, width, height, ink);
    else if (kind === 'resize') {
      const center = before.points[0];
      const delta = (Math.hypot(point.x - center.x, point.y - center.y) - Math.hypot(start.x - center.x, start.y - center.y)) / Math.SQRT2;
      annotationEdit.draft = resizePin(before, pinRadius(before) + delta);
    } else if (kind !== 'slider') {
      annotationEdit.draft = resizeAnnotation(before, kind, { x: point.x - start.x, y: point.y - start.y }, ink, width, height, event.shiftKey);
    }
    schedulePreview(); updateSelection(); return;
  }
  if (!active) return;
  const events = event.getCoalescedEvents?.() || [event];
  for (const sample of events.length ? events : [event]) {
    let point = pointAt(sample);
    point = { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) };
    if (active.type === 'arrow' || active.type === 'rectangle') {
      const start = active.points[0];
      if (event.shiftKey && active.type === 'arrow') point = constrain(start, point);
      if (event.shiftKey && active.type === 'rectangle') {
        const side = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
        point = { x: start.x + Math.sign(point.x - start.x || 1) * side, y: start.y + Math.sign(point.y - start.y || 1) * side };
      }
      active.points = [start, point];
    } else {
      const previous = active.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.5 / zoom) active.points.push(point);
    }
  }
  schedulePreview();
}
viewport.addEventListener('pointermove', movePointer);
viewport.addEventListener('pointerup', event => { if (event.pointerId === pointer) { movePointer(event); finishGesture(); } });
viewport.addEventListener('pointercancel', cancelGesture);
viewport.addEventListener('lostpointercapture', () => { if (pointer !== null) cancelGesture(); });
viewport.addEventListener('dblclick', event => {
  if (!imageBlob || comparing || !['select', 'text', 'pin'].includes(tool)) return;
  const item = hitAnnotation(history.items, pointAt(event), zoom, tool, ink);
  if (item && ['text', 'pin'].includes(item.type)) { event.preventDefault(); showText(item); }
});
viewport.addEventListener('wheel', event => {
  if (!imageBlob || active || annotationEdit) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const rect = viewport.getBoundingClientRect();
    setZoom(zoom * Math.exp(-event.deltaY * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  } else { followFit = false; offset.x -= event.deltaX; offset.y -= event.deltaY; transform(); }
}, { passive: false });

el<HTMLFormElement>('text-form').onsubmit = event => {
  event.preventDefault(); const text = textInput.value.trim();
  if (!pending || !text) return;
  const existing = history.items.find(item => item.id === pending!.id);
  const updated = { ...pending, text };
  if (!existing || existing.text !== text) history.commit(existing ? history.items.map(item => item.id === pending!.id ? updated : item) : [...history.items, updated]);
  if (tool !== 'select') setTool(pending.type); selectedId = pending.id;
  pending = null;
  textDialog.close(); changed(); viewport.focus();
};
el('text-cancel').onclick = () => textDialog.close();
textDialog.addEventListener('close', () => { pending = null; viewport.focus(); });
textInput.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') el<HTMLFormElement>('text-form').requestSubmit();
});

async function renderExport(): Promise<Blob> {
  if (!imageBlob) throw new Error('Open an image first.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, width, height);
  for (const item of history.items) drawAnnotation(ctx, item);
  return canvasBlob(canvas);
}
async function output(mode: 'copy' | 'save') {
  if (!imageBlob || busy) return;
  finishGesture(); busy = true;
  const button = el<HTMLButtonElement>(mode === 'copy' ? 'copy' : 'export'); button.disabled = true;
  try {
    if (mode === 'copy') { await copyImage(renderExport()); toast('Image copied. Paste it into your conversation with the artist.'); }
    else if (await exportImage(await renderExport(), `${filename.replace(/\.[^.]+$/, '')}-feedback.png`)) toast('Full-resolution PNG exported.');
  } finally { busy = false; button.disabled = false; }
}
async function openSheet() {
  if (!imageBlob || busy || !history.items.some(item => item.type === 'pin')) return;
  finishGesture();
  const version = ++sheetVersion;
  const canvas = renderNotesSheet(source, history.items);
  el('sheet-info').textContent = `${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} px · All numbered notes included${Math.max(width, height) > 4096 ? ' · Image scaled to fit' : ''}`;
  el<HTMLButtonElement>('sheet-copy').disabled = el<HTMLButtonElement>('sheet-save').disabled = true;
  el('sheet-status').textContent = '';
  el<HTMLDialogElement>('sheet-dialog').showModal();
  try {
    const blob = await canvasBlob(canvas);
    if (version !== sheetVersion) return;
    sheetBlob = blob; sheetUrl = URL.createObjectURL(blob);
    el<HTMLImageElement>('sheet-preview').src = sheetUrl;
    el<HTMLButtonElement>('sheet-copy').disabled = el<HTMLButtonElement>('sheet-save').disabled = false;
  } catch (error) { el<HTMLDialogElement>('sheet-dialog').close(); throw error; }
}
async function copyNotesSheet() {
  if (!imageBlob || busy || !history.items.some(item => item.type === 'pin')) return;
  finishGesture(); busy = true;
  el<HTMLButtonElement>('copy-sheet').disabled = true;
  try {
    // Keep clipboard.write inside this click's user activation in browser previews.
    await copyImage(canvasBlob(renderNotesSheet(source, history.items)));
    toast('Notes sheet copied. The image and all numbered feedback are ready to send.');
  } finally { busy = false; refresh(); }
}
el('copy-sheet').onclick = () => void run(copyNotesSheet);
async function outputSheet(mode: 'copy' | 'save') {
  if (!sheetBlob || busy) return;
  busy = true; el('sheet-status').textContent = '';
  el<HTMLButtonElement>('sheet-copy').disabled = el<HTMLButtonElement>('sheet-save').disabled = true;
  try {
    if (mode === 'copy') { await copyImage(Promise.resolve(sheetBlob)); el('sheet-status').textContent = 'Copied. Paste the image and all numbered feedback into your conversation.'; }
    else if (await exportImage(sheetBlob, `${filename.replace(/\.[^.]+$/, '')}-notes-sheet.png`)) el('sheet-status').textContent = 'Saved as one PNG with all numbered feedback.';
  } catch (error) {
    el('sheet-status').textContent = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    el<HTMLButtonElement>('sheet-copy').disabled = el<HTMLButtonElement>('sheet-save').disabled = !sheetBlob;
  }
}
el('notes-sheet').onclick = () => void run(openSheet);
el('sheet-copy').onclick = () => void run(() => outputSheet('copy'));
el('sheet-save').onclick = () => void run(() => outputSheet('save'));
el('sheet-close').onclick = () => el<HTMLDialogElement>('sheet-dialog').close();
el<HTMLDialogElement>('sheet-dialog').addEventListener('close', () => {
  sheetVersion++; sheetBlob = null;
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = ''; el<HTMLImageElement>('sheet-preview').removeAttribute('src');
});
el('pin-resize').onpointerdown = event => {
  if (event.button !== 0 || pointer !== null || comparing || space) return;
  const pin = selectedAnnotation(); if (!pin) return;
  event.preventDefault(); event.stopPropagation(); viewport.focus();
  pointer = event.pointerId; viewport.setPointerCapture(pointer);
  beginAnnotationEdit(pin, 'resize', pointAt(event));
};
el<HTMLInputElement>('pin-diameter').oninput = event => {
  const pin = selectedAnnotation(); if (!pin) return;
  const diameter = Number((event.target as HTMLInputElement).value);
  if (!annotationEdit) beginAnnotationEdit(pin, 'slider', pin.points[0]);
  annotationEdit!.draft = resizePin(annotationEdit!.before, diameter / 2);
  schedulePreview(); updateSelection();
};
el('pin-diameter').onchange = commitAnnotationEdit;
el('edit-note').onclick = el('edit-text').onclick = () => {
  const item = selectedAnnotation(); if (item) showText(item);
};
for (const handle of document.querySelectorAll<HTMLElement>('[data-resize]')) {
  handle.onpointerdown = event => {
    if (event.button !== 0 || pointer !== null || comparing || space) return;
    const item = selectedAnnotation(); if (!item) return;
    event.preventDefault(); event.stopPropagation(); viewport.focus();
    pointer = event.pointerId; viewport.setPointerCapture(pointer);
    beginAnnotationEdit(item, handle.dataset.resize as ResizeHandle, pointAt(event));
  };
}
function deleteSelected() {
  const id = selectedId; if (!id || comparing) return;
  cancelGesture(); selectedId = null;
  history.commit(history.items.filter(item => item.id !== id)); changed(); viewport.focus();
}
for (const button of document.querySelectorAll<HTMLElement>('[data-delete-selected]')) button.onclick = deleteSelected;
function undo() { cancelGesture(); history.undo(); changed(); }
function redo() { cancelGesture(); history.redo(); changed(); }
for (const id of ['open', 'empty-open']) el(id).onclick = () => void run(open);
el('paste').onclick = () => void run(paste);
fileInput.onchange = () => { const file = fileInput.files?.[0]; if (file) void run(() => loadImage(file, file.name)); };
el('copy').onclick = () => void run(() => output('copy'));
el('export').onclick = () => void run(() => output('save'));
el('undo').onclick = undo; el('redo').onclick = redo;
el('fit').onclick = fit;
el('zoom-in').onclick = () => setZoom(zoom * 1.25);
el('zoom-out').onclick = () => setZoom(zoom / 1.25);
el('zoom-value').onclick = () => setZoom(1);
el('copy-notes').onclick = () => void run(async () => { await copyText(feedbackText(history.items)); toast('Numbered feedback notes copied.'); });
el('help').onclick = () => el<HTMLDialogElement>('help-dialog').showModal();
el('help-close').onclick = () => el<HTMLDialogElement>('help-dialog').close();
el('compare').onpointerdown = event => { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); compare(true); };
el('compare').onpointerup = () => compare(false);
el('compare').onpointercancel = () => compare(false);
el('compare').onkeydown = event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); compare(true); } };
el('compare').onkeyup = () => compare(false);
el('compare').onblur = () => compare(false);
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.onclick = () => setTool(button.dataset.tool as Tool));
document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(button => button.onclick = () => {
  color = button.dataset.color!; el('color-name').textContent = button.dataset.name!;
  el('stroke-preview').style.background = color;
  document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(swatch => {
    swatch.classList.toggle('selected', swatch === button); swatch.setAttribute('aria-pressed', String(swatch === button));
  });
});
el<HTMLInputElement>('size').oninput = event => {
  size = Number((event.target as HTMLInputElement).value);
  el('size-value').textContent = `${size} px`; el('stroke-preview').style.height = `${size}px`;
};
window.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).matches('input, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
  if (command) {
    // Native accelerators dispatch through the menu once; text copy/paste remain
    // standard OS edit commands, with dedicated Shift+C/V for image operations.
    if (native && (['o', 's', 'z', '0', '1', '+', '=', '-', '/'].includes(key) || (event.shiftKey && ['c', 'v'].includes(key)))) return;
    if (key === 'o') { event.preventDefault(); void run(open); }
    if (key === 'v' && native) { event.preventDefault(); void run(paste); }
    if (key === 'c' && imageBlob) { event.preventDefault(); void run(() => output('copy')); }
    if (key === 's' && imageBlob) { event.preventDefault(); void run(() => event.shiftKey ? openSheet() : output('save')); }
    if (key === 'z' && imageBlob) { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (key === 'y' && imageBlob) { event.preventDefault(); redo(); }
    if (key === '0') { event.preventDefault(); fit(); }
    if (key === '1') { event.preventDefault(); setZoom(1); }
    return;
  }
  if (event.repeat) return;
  if ((key === 'delete' || key === 'backspace') && selectedId && !comparing) { event.preventDefault(); deleteSelected(); return; }
  const shortcuts: Record<string, Tool> = { b: 'pen', a: 'arrow', r: 'rectangle', h: 'highlight', t: 'text', n: 'pin', v: 'select' };
  if (shortcuts[key]) setTool(shortcuts[key]);
  if (key === ' ') { event.preventDefault(); space = true; viewport.style.cursor = 'grab'; }
  if (key === 'o') compare(true);
  if (key === '0') fit();
  if (key === '1') setZoom(1);
  if (key === '+' || key === '=') setZoom(zoom * 1.25);
  if (key === '-') setZoom(zoom / 1.25);
  if (key === 'escape') { cancelGesture(); selectedId = null; updateSelection(); }
  if (key === '?') el<HTMLDialogElement>('help-dialog').showModal();
});
window.addEventListener('keyup', event => {
  if (event.key === ' ') { space = false; viewport.style.cursor = tool === 'hand' ? 'grab' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair'; }
  if (event.key.toLowerCase() === 'o') compare(false);
});
window.addEventListener('blur', () => { space = false; compare(false); cancelGesture(); });
window.addEventListener('paste', event => {
  if ((event.target as HTMLElement).matches('input, textarea') || document.querySelector('dialog[open]')) return;
  // Desktop paste is handled by Rust to support image clipboard formats consistently.
  if (native) { event.preventDefault(); return; }
  const file = Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith('image/'));
  if (file) { event.preventDefault(); void run(() => loadImage(file, 'Clipboard image')); }
});
let dragDepth = 0;
window.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { dragDepth++; el('drop-overlay').hidden = false; } });
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; el('drop-overlay').hidden = true; } });
window.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; el('drop-overlay').hidden = true;
  const file = event.dataTransfer?.files[0]; if (file) void run(() => loadImage(file, file.name));
});
new ResizeObserver(() => { if (imageBlob && followFit) fit(); }).observe(viewport);
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => { if (document.hidden && imageBlob) persist(); });
// Await recovery before accepting another image, avoiding a late draft overwriting a new review.
async function init() {
  if (native) await listen<string>('menu-action', event => void run(async () => {
    const action = event.payload;
    if (editingText() && ['undo', 'redo'].includes(action)) { document.execCommand(action); return; }
    if (action === 'check-updates') { await updates(true); return; }
    if (document.querySelector('dialog[open]') || !ready || loading || busy) return;
    if (action.startsWith('tool-')) {
      const next = action.slice(5) as Tool; if (next in toolInfo) setTool(next); return;
    }
    switch (action) {
      case 'open': await open(); break;
      case 'paste-image': await paste(); break;
      case 'export': await output('save'); break;
      case 'sheet': await openSheet(); break;
      case 'copy-image': await output('copy'); break;
      case 'copy-sheet': await copyNotesSheet(); break;
      case 'copy-notes': await copyText(feedbackText(history.items)); toast('Numbered feedback notes copied.'); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'delete': deleteSelected(); break;
      case 'edit-text': { const item = selectedAnnotation(); if (item && ['text', 'pin'].includes(item.type)) showText(item); break; }
      case 'fit': fit(); break;
      case 'actual-size': setZoom(1); break;
      case 'zoom-in': setZoom(zoom * 1.25); break;
      case 'zoom-out': setZoom(zoom / 1.25); break;
      case 'original': compare(!comparing); break;
      case 'help': el<HTMLDialogElement>('help-dialog').showModal(); break;
    }
    syncMenu();
  }));
  for (const id of ['open', 'empty-open', 'paste']) el<HTMLButtonElement>(id).disabled = true;
  try { const draft = await loadDraft(); if (draft) await loadImage(draft.image, draft.name, draft.annotations, true); }
  catch { toast('The previous draft could not be restored. You can open a new image.', true); }
  finally { ready = true; for (const id of ['open', 'empty-open', 'paste']) el<HTMLButtonElement>(id).disabled = false; syncMenu(); }
  void updates(false);
}
// Save the open review before relaunching into a new version, so nothing is lost.
function updates(manual: boolean) {
  return checkForUpdates({ manual, notify: toast, beforeRestart: async () => { persist(); await saving; } });
}
document.addEventListener('focusin', syncMenu);
document.addEventListener('focusout', syncMenu);
const dialogObserver = new MutationObserver(syncMenu);
document.querySelectorAll('dialog').forEach(dialog => dialogObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
void init();
