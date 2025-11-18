import { contextBridge, ipcRenderer } from 'electron';

type NewDocumentPayload =
  | { mode: 'blank'; width: number; height: number }
  | { mode: 'fromClipboard'; width: number; height: number; imageDataUrl: string };

const api = {
  onNewDocument(callback: (payload: NewDocumentPayload) => void) {
    ipcRenderer.on('new-document', (_event, payload: NewDocumentPayload) => {
      callback(payload);
    });
  },
  onCopyCanvasRequest(callback: () => void) {
    ipcRenderer.on('copy-canvas', () => {
      callback();
    });
  },
  onUndoRequest(callback: () => void) {
    ipcRenderer.on('undo-canvas', () => {
      callback();
    });
  },
  onRedoRequest(callback: () => void) {
    ipcRenderer.on('redo-canvas', () => {
      callback();
    });
  },
  sendCanvasToClipboard(dataUrl: string) {
    ipcRenderer.invoke('canvas-to-clipboard', dataUrl);
  },
  setWindowContentSize(width: number, height: number) {
    ipcRenderer.invoke('set-window-content-size', { width, height });
  }
};

contextBridge.exposeInMainWorld('sketchAPI', api);

export type SketchAPI = typeof api;


