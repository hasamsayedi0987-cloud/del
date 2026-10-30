#!/usr/bin/env bash
# Del — بازیابی پشتیبان (گام ۱۰ — تمرین بازیابی باید مستند شود: docs/10-release.md)
# استفاده:  ./restore.sh <فایل پشتیبان> <DATABASE_URL مقصد>
# مثال:
#   ./restore.sh del-backup-20261030.dump "postgresql://postgres:pw@localhost:5432/del_restore"
# نکته: پایگاه مقصد باید از قبل وجود داشته باشد (createdb) و خالی باشد.
set -euo pipefail

DUMP_FILE="${1:?فایل پشتیبان لازم است}"
TARGET_URL="${2:?DATABASE_URL مقصد لازم است}"

echo "بازیابی $DUMP_FILE → $TARGET_URL"
pg_restore \
  --dbname="$TARGET_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$DUMP_FILE"

echo "✅ بازیابی کامل شد — مقایسهٔ تعداد رکوردها برای راستی‌آزمایی توصیه می‌شود:"
echo "  psql \"$TARGET_URL\" -c 'select (select count(*) from \"User\") users, (select count(*) from \"Message\") messages;'"
