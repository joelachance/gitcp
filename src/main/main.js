import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAuthState,
  loadToken,
  loginWithOAuth,
  logout,
} from './github-oauth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
const PRIMARY_ACCELERATOR = process.platform === 'darwin' ? 'Command+P+R' : 'Control+P+R';
const FALLBACK_ACCELERATOR = process.platform === 'darwin' ? 'Command+Shift+P' : 'Control+Shift+P';
let activeShortcut = null;
let usedFallback = false;

function getPreloadPath() {
  return path.join(__dirname, '../preload/preload.js');
}

function getRendererPath() {
  return path.join(__dirname, '../renderer/index.html');
}

function broadcastAuth() {
  const state = getAuthState();
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('gitcp:auth-changed', state);
  }
}

function showPalette() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('gitcp:focus-search');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    frame: true,
    title: 'GitCP',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(getRendererPath());
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerGlobalShortcut() {
  const tryRegister = (acc) => globalShortcut.register(acc, showPalette);
  if (tryRegister(PRIMARY_ACCELERATOR)) {
    activeShortcut = PRIMARY_ACCELERATOR;
    usedFallback = false;
    return;
  }
  console.warn(
    '[gitcp] Could not register',
    PRIMARY_ACCELERATOR,
    '— trying fallback',
    FALLBACK_ACCELERATOR,
  );
  if (tryRegister(FALLBACK_ACCELERATOR)) {
    activeShortcut = FALLBACK_ACCELERATOR;
    usedFallback = true;
    return;
  }
  console.error('[gitcp] Could not register any global shortcut');
  activeShortcut = null;
  usedFallback = false;
}

async function searchIssuesAndPrs(query) {
  const q = (query || '').trim();
  if (!q) {
    return { items: [] };
  }
  const token = loadToken()?.access_token;
  if (!token) {
    throw new Error('Sign in with GitHub to search.');
  }

  const fullQ = /\bis:(issue|pr)\b|\btype:(issue|pr)\b/i.test(q)
    ? q
    : `${q} (is:issue OR is:pr)`;

  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', fullQ);
  url.searchParams.set('per_page', '20');

  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'gitcp/0.1.0',
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || res.statusText || 'Search request failed';
    throw new Error(msg);
  }
  return { items: data.items || [] };
}

function setupIpc() {
  ipcMain.handle('gitcp:search-issues', async (_e, query) => searchIssuesAndPrs(query));

  ipcMain.handle('gitcp:open-external', async (_e, url) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('Invalid URL');
    }
    await shell.openExternal(url);
  });

  ipcMain.handle('gitcp:auth-status', () => getAuthState());

  ipcMain.handle('gitcp:login', async () => {
    await loginWithOAuth();
    broadcastAuth();
    return getAuthState();
  });

  ipcMain.handle('gitcp:logout', () => {
    logout();
    broadcastAuth();
    return getAuthState();
  });

  ipcMain.handle('gitcp:shortcut-info', () => ({
    primary: PRIMARY_ACCELERATOR,
    fallback: FALLBACK_ACCELERATOR,
    registered: Boolean(activeShortcut),
    accelerator: activeShortcut,
    primaryFailed: usedFallback,
  }));
}

app.whenReady().then(() => {
  setupIpc();
  createWindow();
  registerGlobalShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showPalette();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
