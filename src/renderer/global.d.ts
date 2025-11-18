export {};

type NewDocumentPayload =
  | { mode: 'blank'; width: number; height: number }
  | { mode: 'fromClipboard'; width: number; height: number; imageDataUrl: string };

interface SketchAPI {
  onNewDocument(callback: (payload: NewDocumentPayload) => void): void;
  onCopyCanvasRequest(callback: () => void): void;
  onUndoRequest(callback: () => void): void;
  onRedoRequest(callback: () => void): void;
  sendCanvasToClipboard(dataUrl: string): void;
   setWindowContentSize(width: number, height: number): void;
}

declare global {
  interface Window {
    sketchAPI: SketchAPI;
  }
}


