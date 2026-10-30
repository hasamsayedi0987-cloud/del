/**
 * همگام‌سازی باندل مرورگر E2EE از packages/e2ee به رندرر دسکتاپ
 * اجرا: node scripts/sync-e2ee.js  (در prebuild و predev خودکار است)
 */
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', '..', '..', 'packages', 'e2ee', 'dist', 'browser.js');
const destDir = path.join(__dirname, '..', 'src', 'renderer', 'vendor');
const dest = path.join(destDir, 'e2ee.js');

if (!fs.existsSync(src)) {
  console.error('e2ee bundle missing — run: pnpm --filter @del/e2ee build');
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('synced packages/e2ee/dist/browser.js → apps/desktop/src/renderer/vendor/e2ee.js');
