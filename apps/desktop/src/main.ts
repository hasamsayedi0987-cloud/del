import { app, BrowserWindow, shell, Menu, nativeTheme } from "electron";
import path from "path";

const isMac = process.platform === "darwin";
let win: BrowserWindow | null = null;

function createWindow() {
  nativeTheme.themeSource = "dark";

  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 420,
    minHeight: 560,
    title: "دل — Del",
    icon: path.join(__dirname, "../icon.png"),
    backgroundColor: "#0a1220",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
    show: false,
  });

  win.loadFile(path.join(__dirname, "../www/index.html"));

  win.once("ready-to-show", () => win?.show());

  // open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    win = null;
  });
}

// minimal Persian-friendly menu
const template: Electron.MenuItemConstructorOptions[] = [
  ...(isMac ? [{ role: "appMenu" as const }] : []),
  {
    label: "ویرایش",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut", label: "برش" },
      { role: "copy", label: "کپی" },
      { role: "paste", label: "چسباندن" },
      { role: "selectAll", label: "انتخاب همه" },
    ],
  },
  {
    label: "نمایش",
    submenu: [
      { role: "reload", label: "بارگذاری مجدد" },
      { role: "togglefullscreen", label: "تمام‌صفحه" },
      { role: "zoomIn", label: "بزرگ‌نمایی" },
      { role: "zoomOut", label: "کوچک‌نمایی" },
    ],
  },
];
Menu.setApplicationMenu(Menu.buildFromTemplate(template));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
