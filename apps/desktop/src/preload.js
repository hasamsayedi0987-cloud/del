/**
 * Del Desktop — preload (گام ۷: اعلان بومی + badge)
 * فقط یک پل کوچک و امن (contextBridge) — بدون دسترسی Node به رندرر.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('delDesktop', {
  /** مجموع پیام‌های خوانده‌نشده → badge آیکون اپ (macOS/Linux) */
  setBadge: (count) => ipcRenderer.send('del:set-badge', Number(count) || 0),
  /** اعلان بومی — وقتی پنجره فوکوس ندارد */
  notify: (payload) => ipcRenderer.send('del:notify', payload),
  /** تپ روی اعلان → پنجره فوکوس می‌شود و این callback صدا زده می‌شود */
  onNotifyClick: (cb) => {
    ipcRenderer.on('del:notify-click', (_event, data) => cb(data));
  },
});
