/**
 * Del Desktop — Electron main process (Step 1)
 */
const { app, BrowserWindow, shell, desktopCapturer, session } = require('electron');
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
