/**
 * postbuild — تولید باندل مرورگر (IIFE) برای دسکتاپ Electron
 * dist/index.js = CJS برای Node (API/اسکریپت‌ها) · dist/browser.js = IIFE با متغیر سراسری DelE2ee
 */
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  globalName: 'DelE2ee',
  outfile: path.join(root, 'dist/browser.js'),
  logLevel: 'info',
});
console.log('e2ee: browser bundle → dist/browser.js');
