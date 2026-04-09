import { contextBridge, ipcRenderer } from 'electron';

const GRID_SIZE_CHANGE_CHANNEL = 'worksheet:grid-size-changed';
const GRID_SIZE_REQUEST_CHANNEL = 'worksheet:get-grid-size';
const THEME_CHANGE_CHANNEL = 'worksheet:theme-changed';
const THEME_REQUEST_CHANNEL = 'worksheet:get-theme';

type WorksheetTheme = 'light' | 'dark';

contextBridge.exposeInMainWorld('worksheetMenu', {
  getGridSize: (): Promise<number> => ipcRenderer.invoke(GRID_SIZE_REQUEST_CHANNEL),
  getTheme: (): Promise<WorksheetTheme> => ipcRenderer.invoke(THEME_REQUEST_CHANNEL),
  onGridSizeChange: (listener: (gridSize: number) => void): (() => void) => {
    const handleGridSizeChange = (_event: Electron.IpcRendererEvent, gridSize: number): void => {
      listener(gridSize);
    };

    ipcRenderer.on(GRID_SIZE_CHANGE_CHANNEL, handleGridSizeChange);

    return () => {
      ipcRenderer.removeListener(GRID_SIZE_CHANGE_CHANNEL, handleGridSizeChange);
    };
  },
  onThemeChange: (listener: (theme: WorksheetTheme) => void): (() => void) => {
    const handleThemeChange = (
      _event: Electron.IpcRendererEvent,
      theme: WorksheetTheme,
    ): void => {
      listener(theme);
    };

    ipcRenderer.on(THEME_CHANGE_CHANNEL, handleThemeChange);

    return () => {
      ipcRenderer.removeListener(THEME_CHANGE_CHANNEL, handleThemeChange);
    };
  },
});
