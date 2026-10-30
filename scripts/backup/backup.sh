#!/usr/bin/env bash
# Del — پشتیبان‌گیری پایگاه‌داده (گام ۱۰)
# استفاده:  DATABASE_URL=... ./backup.sh [خروجی]
# خروجی: فایل custom-format pg_dump (قابل restore با restore.sh)
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL لازم است}"
OUT="${1:-del-backup-$(date +%Y%m%d-%H%M%S).dump}"

echo "پشتیبان‌گیری → $OUT"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "✅ پشتیبان ساخته شد: $OUT ($SIZE)"
echo "بازیابی:  ./restore.sh \"$OUT\" \"postgresql://user:pass@host:5432/del_restore\""
