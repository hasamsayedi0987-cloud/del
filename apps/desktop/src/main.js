/**
 * Del Desktop — Electron main process (Step 1 + گام ۷: اعلان بومی و badge)
 */
const { app, BrowserWindow, shell, desktopCapturer, session, Notification, ipcMain } = require('electron');
const path = require('node:path');

app.disableHardwareAcceleration = app.disableHardwareAcceleration; // no-op safeguard

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    title: 'دل',
    backgroundColor: '#0A1628',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // لینک‌های بیرونی در مرورگر سیستم باز شوند نه داخل اپ
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  // گام ۶: مجوز اشتراک صفحه برای تماس — اولین نمایشگر
  session.defaultSession.setDisplayMediaRequestHandler((_opts, callback) => {
    void desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length && sources[0]) callback({ video: sources[0] });
        else callback({});
      })
      .catch(() => callback({}));
  });

  // ————— گام ۷: اعلان بومی + badge —————
  ipcMain.on('del:set-badge', (_event, count) => {
    // badge روی آیکون — macOS و Unity لینوکس؛ سایر پلتفرم‌ها no-op
    if (typeof app.setBadgeCount === 'function') app.setBadgeCount(Math.max(0, Number(count) || 0));
  });

  ipcMain.on('del:notify', (_event, payload) => {
    const { title, body, conversationId, kind } = payload ?? {};
    if (!Notification.isSupported() || !title) return;
    const n = new Notification({
      title: `دل — ${title}`,
      body: body ?? '',
      silent: kind === 'call' ? false : true,
    });
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send('del:notify-click', { conversationId, kind });
      }
    });
    n.show();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
