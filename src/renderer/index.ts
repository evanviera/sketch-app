type NewDocumentPayload =
  | { mode: 'blank'; width: number; height: number }
  | { mode: 'fromClipboard'; width: number; height: number; imageDataUrl: string };

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
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
let resizeTimeoutId: number | null = null;
let isLineConstrained = false;
let lineAnchor: { x: number; y: number } = { x: 0, y: 0 };
let linePreviewBase: ImageData | null = null;
let linePreviewActive = false;
let lastMidX = 0;
let lastMidY = 0;

type CanvasSnapshot = {
  imageData: ImageData;
  width: number;
  height: number;
};

const UNDO_LIMIT = 8;
let undoStack: CanvasSnapshot[] = [];
let redoStack: CanvasSnapshot[] = [];
let strokeStartState: CanvasSnapshot | null = null;

function resetHistory() {
  undoStack = [];
  redoStack = [];
  strokeStartState = null;
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

function captureCanvasState(): CanvasSnapshot | null {
  const imageData = captureSnapshot();
  if (!imageData) {
    return null;
  }
  return {
    imageData,
    width: docWidth,
    height: docHeight
  };
}

function restoreCanvasState(state: CanvasSnapshot) {
  docWidth = state.width;
  docHeight = state.height;

  const dpr = window.devicePixelRatio || 1;
  const backingWidth = Math.max(1, Math.round(docWidth * dpr));
  const backingHeight = Math.max(1, Math.round(docHeight * dpr));

  canvas.width = backingWidth;
  canvas.height = backingHeight;
  canvas.style.width = `${docWidth}px`;
  canvas.style.height = `${docHeight}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  restoreSnapshot(state.imageData);

  // Also resize the window content so the viewport matches the document size.
  const toolbarHeight = 48;
  window.sketchAPI.setWindowContentSize(docWidth, docHeight + toolbarHeight);
}

function getConstrainedPoint(anchor: { x: number; y: number }, x: number, y: number) {
  const dx = x - anchor.x;
  const dy = y - anchor.y;
  if (dx === 0 && dy === 0) {
    return { x: anchor.x, y: anchor.y };
  }

  const angle = Math.atan2(dy, dx);
  const snapStep = Math.PI / 4; // 45°
  const snappedAngle = Math.round(angle / snapStep) * snapStep;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return {
    x: anchor.x + Math.cos(snappedAngle) * distance,
    y: anchor.y + Math.sin(snappedAngle) * distance
  };
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

function resizeCanvasPreservingContent(newWidth: number, newHeight: number) {
  if (!newWidth || !newHeight) {
    return;
  }

  if (newWidth === docWidth && newHeight === docHeight) {
    return;
  }

  const prevState = captureCanvasState();
  const snapshot = prevState?.imageData;

  if (!prevState || !snapshot) {
    return;
  }

  docWidth = newWidth;
  docHeight = newHeight;

  const dpr = window.devicePixelRatio || 1;
  const backingWidth = Math.max(1, Math.round(docWidth * dpr));
  const backingHeight = Math.max(1, Math.round(docHeight * dpr));

  canvas.width = backingWidth;
  canvas.height = backingHeight;
  canvas.style.width = `${docWidth}px`;
  canvas.style.height = `${docHeight}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Paint previous image data back at the origin. If the new canvas is smaller,
  // content is cropped; if larger, the extra area is blank.
  restoreSnapshot(snapshot);

  // Record the resize as an undoable operation.
  undoStack.push(prevState);
  if (undoStack.length > UNDO_LIMIT) {
    undoStack.shift();
  }
  redoStack = [];
  strokeStartState = null;
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
  strokeStartState = captureCanvasState();
  // Starting a new stroke invalidates redo history.
  redoStack = [];
  lineAnchor = { x: lastX, y: lastY };
  isLineConstrained = event.shiftKey;
  linePreviewBase = null;
  linePreviewActive = false;
  lastMidX = lastX;
  lastMidY = lastY;

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

  const shiftKeyActive = event.shiftKey;

  if (shiftKeyActive) {
    if (!linePreviewActive) {
      lineAnchor = { x: lastX, y: lastY };
      const previewSnapshot = captureSnapshot();
      if (previewSnapshot) {
        linePreviewBase = previewSnapshot;
        linePreviewActive = true;
      }
    }

    if (linePreviewBase) {
      restoreSnapshot(linePreviewBase);
    }

    const constrainedPoint = getConstrainedPoint(lineAnchor, x, y);
    const dxLine = constrainedPoint.x - lineAnchor.x;
    const dyLine = constrainedPoint.y - lineAnchor.y;
    const lineDistance = Math.sqrt(dxLine * dxLine + dyLine * dyLine);
    if (lineDistance >= 0.25) {
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = currentBrushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1.0;

      ctx.beginPath();
      ctx.moveTo(lineAnchor.x, lineAnchor.y);
      ctx.lineTo(constrainedPoint.x, constrainedPoint.y);
      ctx.stroke();

      lastX = constrainedPoint.x;
      lastY = constrainedPoint.y;
      lastMidX = lastX;
      lastMidY = lastY;
      points = [{ x: lineAnchor.x, y: lineAnchor.y }, { x: lastX, y: lastY }];
      hasMoved = true;
    }

    isLineConstrained = true;
    return;
  }

  if (linePreviewActive) {
    linePreviewActive = false;
    linePreviewBase = null;
    isLineConstrained = false;
    points = [{ x: lastX, y: lastY }];
    lastMidX = lastX;
    lastMidY = lastY;
  }

  const dx = x - lastX;
  const dy = y - lastY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Ignore very tiny moves to avoid noise.
  if (distance < 0.5) {
    return;
  }

  points.push({ x, y });

  ctx.strokeStyle = currentColor;
  ctx.lineWidth = currentBrushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1.0;

  const midX = (lastX + x) / 2;
  const midY = (lastY + y) / 2;

  ctx.beginPath();
  ctx.moveTo(lastMidX, lastMidY);
  ctx.quadraticCurveTo(lastX, lastY, midX, midY);
  ctx.stroke();

  lastMidX = midX;
  lastMidY = midY;
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

  if (strokeStartState) {
    undoStack.push(strokeStartState);
    if (undoStack.length > UNDO_LIMIT) {
      undoStack.shift();
    }
    strokeStartState = null;
  }

  isDrawing = false;
  points = [];
  linePreviewActive = false;
  linePreviewBase = null;
  isLineConstrained = false;
}

function undo() {
  if (!undoStack.length) {
    return;
  }
  const current = captureCanvasState();
  if (!current) {
    return;
  }
  const prevState = undoStack.pop()!;
  redoStack.push(current);
  restoreCanvasState(prevState);
}

function redo() {
  if (!redoStack.length) {
    return;
  }
  const current = captureCanvasState();
  if (!current) {
    return;
  }
  const nextState = redoStack.pop()!;
  undoStack.push(current);
  restoreCanvasState(nextState);
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

function setupResizeHandling() {
  window.addEventListener('resize', () => {
    if (!docWidth || !docHeight) {
      return;
    }
    const rect = canvasContainer.getBoundingClientRect();
    const newWidth = Math.max(1, Math.round(rect.width));
    const newHeight = Math.max(1, Math.round(rect.height));

    // Debounce resize so we only commit one destructive resize per drag,
    // instead of many tiny steps that would spam the undo history.
    if (resizeTimeoutId !== null) {
      window.clearTimeout(resizeTimeoutId);
    }
    resizeTimeoutId = window.setTimeout(() => {
      resizeTimeoutId = null;
      resizeCanvasPreservingContent(newWidth, newHeight);
    }, 150);
  });
}

function init() {
  wireBrushSizeButtons();
  wireColorButtons();
  setupPointerEvents();
  setupClipboardIntegration();
  setupResizeHandling();

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init();
});


