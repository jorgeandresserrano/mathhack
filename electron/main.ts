import {
  Menu,
  app,
  BrowserWindow,
  ipcMain,
  type MenuItemConstructorOptions,
} from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_NAME = 'MathHack';
const DEFAULT_GRID_SIZE = 20;
const GRID_SIZE_OPTIONS = [5, 10, 15, 20, 25, 30, 35] as const;
const GRID_SIZE_CHANGE_CHANNEL = 'worksheet:grid-size-changed';
const GRID_SIZE_REQUEST_CHANNEL = 'worksheet:get-grid-size';
const DEFAULT_THEME = 'light' as const;
const THEME_CHANGE_CHANNEL = 'worksheet:theme-changed';
const THEME_REQUEST_CHANNEL = 'worksheet:get-theme';

type WorksheetTheme = 'light' | 'dark';

let currentGridSize = DEFAULT_GRID_SIZE;
let currentTheme: WorksheetTheme = DEFAULT_THEME;
let mainWindow: BrowserWindow | null = null;

app.setName(APP_NAME);

function broadcastGridSize(gridSize: number): void {
  currentGridSize = gridSize;

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(GRID_SIZE_CHANGE_CHANNEL, gridSize);
  }
}

function getWindowBackgroundColor(theme: WorksheetTheme): string {
  return theme === 'dark' ? '#16191f' : '#f7f6ee';
}

function broadcastTheme(theme: WorksheetTheme): void {
  currentTheme = theme;

  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(getWindowBackgroundColor(theme));
    window.webContents.send(THEME_CHANGE_CHANNEL, theme);
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      role: 'viewMenu',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Grid Size',
          submenu: GRID_SIZE_OPTIONS.map((gridSize) => ({
            label: `${gridSize} px`,
            type: 'radio',
            checked: gridSize === currentGridSize,
            click: () => {
              broadcastGridSize(gridSize);
            },
          })),
        },
        {
          label: 'Theme',
          submenu: [
            {
              label: 'Light',
              type: 'radio',
              checked: currentTheme === 'light',
              click: () => {
                broadcastTheme('light');
              },
            },
            {
              label: 'Dark',
              type: 'radio',
              checked: currentTheme === 'dark',
              click: () => {
                broadcastTheme('dark');
              },
            },
          ],
        },
      ],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isBlockedWindowShortcut(input: Electron.Input): boolean {
  const key = input.key.toLowerCase();
  const hasPrimaryModifier = input.meta || input.control;

  if (key === 'f12') {
    return true;
  }

  if (!hasPrimaryModifier) {
    return false;
  }

  if (key === 'r') {
    return true;
  }

  return key === 'i' && input.alt;
}

function createWindow(): void {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const preloadPath = join(currentDirectory, 'preload.mjs');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    backgroundColor: getWindowBackgroundColor(currentTheme),
    webPreferences: {
      devTools: false,
      preload: preloadPath,
      contextIsolation: true,
    },
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (isBlockedWindowShortcut(input)) {
      event.preventDefault();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    const indexHtmlPath = join(currentDirectory, '../dist/index.html');
    void mainWindow.loadFile(indexHtmlPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcMain.handle(GRID_SIZE_REQUEST_CHANNEL, () => currentGridSize);
  ipcMain.handle(THEME_REQUEST_CHANNEL, () => currentTheme);
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
