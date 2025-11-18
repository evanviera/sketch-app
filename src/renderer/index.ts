type NewDocumentPayload =
  | { mode: 'blank'; width: number; height: number }
  | { mode: 'fromClipboard'; width: number; height: number; imageDataUrl: string };

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

let currentColor = '#ff0000';
let currentBrushSize = 10;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let hasMoved = false;
let points: { x: number; y: number }[] = [];
let docWidth = 0;
let docHeight = 0;

const UNDO_LIMIT = 8;
let undoStack: ImageData[] = [];
let redoStack: ImageData[] = [];
let strokeStartSnapshot: ImageData | null = null;

function resetHistory() {
  undoStack = [];
  redoStack = [];
  strokeStartSnapshot = null;
}

function captureSnapshot(): ImageData | null {
  if (!canvas.width || !canvas.height) {
    return null;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.restore();
  return snapshot;
}

function restoreSnapshot(snapshot: ImageData) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(snapshot, 0, 0);
  ctx.restore();
}

function setupCanvasSize(width: number, height: number) {
  docWidth = width;
  docHeight = height;

  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  resetHistory();
}

function handleNewDocument(payload: NewDocumentPayload) {
  isDrawing = false;
  setupCanvasSize(payload.width, payload.height);

  if (payload.mode === 'fromClipboard') {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, payload.width, payload.height);
    };
    img.src = payload.imageDataUrl;
  }
}

function startDrawing(event: PointerEvent) {
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  lastX = event.clientX - rect.left;
  lastY = event.clientY - rect.top;
  hasMoved = false;
  points = [{ x: lastX, y: lastY }];
  strokeStartSnapshot = captureSnapshot();
  // Starting a new stroke invalidates redo history.
  redoStack = [];

  ctx.strokeStyle = currentColor;
  ctx.lineWidth = currentBrushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1.0;

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
}

function continueDrawing(event: PointerEvent) {
  if (!isDrawing) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const dx = x - lastX;
  const dy = y - lastY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Ignore very tiny moves to avoid noise.
  if (distance < 0.5) {
    return;
  }

  points.push({ x, y });

  if (points.length === 2) {
    // First segment: simple line.
    const p0 = points[0];
    const p1 = points[1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    ctx.stroke();
  } else if (points.length > 2) {
    // Subsequent segments: smooth using last two points.
    const p1 = points[points.length - 2];
    const p2 = points[points.length - 1];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
    ctx.stroke();
  }

  lastX = x;
  lastY = y;
  hasMoved = true;
}

function stopDrawing() {
  if (!isDrawing) {
    return;
  }

  if (!hasMoved) {
    // Draw a dot when the pointer was pressed and released without movement.
    ctx.beginPath();
    ctx.arc(lastX, lastY, currentBrushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = currentColor;
    ctx.globalAlpha = 1.0;
    ctx.fill();
  }

  if (strokeStartSnapshot) {
    undoStack.push(strokeStartSnapshot);
    if (undoStack.length > UNDO_LIMIT) {
      undoStack.shift();
    }
    strokeStartSnapshot = null;
  }

  isDrawing = false;
  points = [];
}

function undo() {
  if (!undoStack.length) {
    return;
  }
  const current = captureSnapshot();
  if (!current) {
    return;
  }
  const snapshot = undoStack.pop()!;
  redoStack.push(current);
  restoreSnapshot(snapshot);
}

function redo() {
  if (!redoStack.length) {
    return;
  }
  const current = captureSnapshot();
  if (!current) {
    return;
  }
  const snapshot = redoStack.pop()!;
  undoStack.push(current);
  restoreSnapshot(snapshot);
}

function wireBrushSizeButtons() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.brush-size-button'));
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const size = Number(button.dataset.size || '10');
      currentBrushSize = size;

      buttons.forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
    });
  });
}

function wireColorButtons() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.color-button'));
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const color = button.dataset.color;
      if (!color) return;

      currentColor = color;

      buttons.forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
    });
  });
}

function setupPointerEvents() {
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    startDrawing(event);
  });

  canvas.addEventListener('pointermove', (event) => {
    continueDrawing(event);
  });

  canvas.addEventListener('pointerup', (event) => {
    canvas.releasePointerCapture(event.pointerId);
    stopDrawing();
  });

  canvas.addEventListener('pointerleave', () => {
    stopDrawing();
  });
}

function setupClipboardIntegration() {
  window.sketchAPI.onNewDocument((payload) => {
    handleNewDocument(payload);
  });

  window.sketchAPI.onCopyCanvasRequest(() => {
    if (!docWidth || !docHeight) {
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    window.sketchAPI.sendCanvasToClipboard(dataUrl);
  });

  window.sketchAPI.onUndoRequest(() => {
    undo();
  });

  window.sketchAPI.onRedoRequest(() => {
    redo();
  });
}

function init() {
  wireBrushSizeButtons();
  wireColorButtons();
  setupPointerEvents();
  setupClipboardIntegration();

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init();
});


