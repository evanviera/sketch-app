import { app, BrowserWindow, Menu, MenuItemConstructorOptions, clipboard, nativeImage, screen, ipcMain } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

type NewDocumentPayload =
  | { mode: 'blank'; width: number; height: number }
  | { mode: 'fromClipboard'; width: number; height: number; imageDataUrl: string };

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const initialWidth = Math.floor(width / 2);
  const initialHeight = Math.floor(height / 2);

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    backgroundColor: '#2b2b2b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    useContentSize: true
  });

  const indexHtmlPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(indexHtmlPath).catch((err) => {
    console.error('Failed to load renderer HTML:', err);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) {
      sendNewDocument(mainWindow);
    }
  });

  buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  template.push({
    label: 'File',
    submenu: isMac
      ? [
          {
            label: 'New',
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              if (mainWindow) {
                sendNewDocument(mainWindow);
              }
            }
          },
          { role: 'close' }
        ]
      : [
          {
            label: 'New',
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              if (mainWindow) {
                sendNewDocument(mainWindow);
              }
            }
          },
          { role: 'quit' }
        ]
  });

  template.push({
    label: 'Edit',
    submenu: [
      {
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('undo-canvas');
          }
        }
      },
      {
        label: 'Redo',
        accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y',
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('redo-canvas');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Copy Canvas',
        accelerator: 'CmdOrCtrl+C',
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('copy-canvas');
          }
        }
      }
    ]
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createNewDocumentPayload(): NewDocumentPayload {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const scaleFactor = primaryDisplay.scaleFactor || 1;

  const blankWidth = Math.floor(width / 2);
  const blankHeight = Math.floor(height / 2);

  const image = clipboard.readImage();

  if (!image.isEmpty()) {
    const size = image.getSize();
    const dataUrl = image.toDataURL();

    const logicalWidth = Math.max(1, Math.round(size.width / scaleFactor));
    const logicalHeight = Math.max(1, Math.round(size.height / scaleFactor));

    return {
      mode: 'fromClipboard',
      width: logicalWidth,
      height: logicalHeight,
      imageDataUrl: dataUrl
    };
  }

  return {
    mode: 'blank',
    width: blankWidth,
    height: blankHeight
  };
}

function sendNewDocument(win: BrowserWindow) {
  const payload = createNewDocumentPayload();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: maxWidth, height: maxHeight } = primaryDisplay.workAreaSize;

  const toolbarHeight = 48;
  const targetContentWidth = Math.min(payload.width, maxWidth);
  const targetContentHeight = Math.min(payload.height + toolbarHeight, maxHeight);

  win.setContentSize(targetContentWidth, targetContentHeight);
  win.webContents.send('new-document', payload);
}

ipcMain.handle('canvas-to-clipboard', (_event, dataUrl: string) => {
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(image);
  } catch (err) {
    console.error('Failed to write canvas to clipboard:', err);
  }
});

ipcMain.handle('set-window-content-size', (_event, size: { width: number; height: number }) => {
  if (!mainWindow) return;
  const primaryDisplay = screen.getPrimaryDisplay();
  const max = primaryDisplay.workAreaSize;
  const targetWidth = Math.min(size.width, max.width);
  const targetHeight = Math.min(size.height, max.height);
  mainWindow.setContentSize(targetWidth, targetHeight);
});

app.on('ready', () => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});


