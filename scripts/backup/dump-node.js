/**
 * Del — پشتیبان‌گیری/بازیابی منطقی با Node (fallback برای محیط‌های بدون pg_dump)
 *
 *   node dump-node.js backup  <DATABASE_URL> <خروجی.json>
 *   node dump-node.js restore <DATABASE_URL مقصد> <خروجی.json>
 *
 * قالب: JSON { schema, tables: [{name, rows}] } — بازیابی با رعایت ترتیب وابستگی FK
 * برای پروداکشن pg_dump (scripts/backup/backup.sh) توصیه می‌شود؛ این ابزار
 * برای تمرین بازیابی و محیط‌های محدود است.
 */
const { Client } = require('pg');
const fs = require('fs');

// ترتیب وابستگی FK — برای restore؛ backup به ترتیب الفبایی می‌خواند
const RESTORE_ORDER = [
  'User',
  'Device',
  'OtpCode',
  'RefreshToken',
  'Conversation',
  'MediaAsset',
  'Participant',
  'Message',
  'Call',
  'E2eeIdentity',
  'E2eeOneTimePreKey',
  'E2eeKeyBackup',
  'AiUsage',
  'UserBlock',
  'UserReport',
  'AuditLog',
];

async function connect(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function listTables(c) {
  const r = await c.query(
    "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1",
  );
  return r.rows.map((x) => x.tablename);
}

async function main() {
  const [mode, url, file] = process.argv.slice(2);
  if (!mode || !url || !file) {
    console.error('استفاده: node dump-node.js backup|restore <DATABASE_URL> <file.json>');
    process.exit(1);
  }

  if (mode === 'backup') {
    const c = await connect(url);
    const tables = await listTables(c);
    const out = { schema: 'public', createdAt: new Date().toISOString(), tables: [] };
    for (const t of tables) {
      const r = await c.query(`select * from "${t}"`);
      out.tables.push({ name: t, rows: r.rows });
      console.log(`  ${t}: ${r.rowCount} سطر`);
    }
    await c.end();
    fs.writeFileSync(file, JSON.stringify(out));
    console.log(`✅ پشتیبان منطقی ساخته شد: ${file} (${tables.length} جدول)`);
  } else if (mode === 'restore') {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const c = await connect(url);
    // ترتیب وابستگی: جدول‌های ناشناخته به آخر
    const names = data.tables.map((t) => t.name);
    const ordered = [
      ...RESTORE_ORDER.filter((n) => names.includes(n)),
      ...names.filter((n) => !RESTORE_ORDER.includes(n)),
    ];
    await c.query('begin');
    try {
      for (const name of ordered) {
        const t = data.tables.find((x) => x.name === name);
        if (!t.rows.length) continue;
        await c.query(`truncate table "${name}" cascade`);
        const cols = Object.keys(t.rows[0]);
        const colList = cols.map((k) => `"${k}"`).join(', ');
        for (const row of t.rows) {
          const vals = cols.map((k) => {
            const v = row[k];
            return v === null ? null : typeof v === 'object' ? JSON.stringify(v) : v;
          });
          const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
          await c.query(`insert into "${name}" (${colList}) values (${ph})`, vals);
        }
        console.log(`  ${name}: ${t.rows.length} سطر بازیابی شد`);
      }
      await c.query('commit');
      await c.end();
      console.log('✅ بازیابی کامل شد');
    } catch (e) {
      await c.query('rollback');
      await c.end();
      throw e;
    }
  } else {
    console.error('حالت نامعتبر');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('خطا:', e.message);
  process.exit(1);
});
