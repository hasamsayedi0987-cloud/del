#!/usr/bin/env bash
# Del — تست دود کامل Step 1 (سرور باید روی :3000 بالا باشد)
set -e
BASE=http://localhost:3000/api/v1

echo "=== 1) درخواست OTP با ارقام فارسی (نرمال‌سازی +989…) ==="
RESP=$(curl -s -X POST $BASE/auth/otp/request -H "Content-Type: application/json" -d '{"phone":"۰۹۱۲۱۲۳۴۵۶۷"}')
echo "$RESP"
CODE=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['devCode'])")

echo ""
echo "=== 2) کد اشتباه → باید OTP_INVALID برگرداند ==="
curl -s -X POST $BASE/auth/otp/verify -H "Content-Type: application/json" \
  -d '{"phone":"09121234567","code":"000000"}' | head -c 150
echo ""

echo ""
echo "=== 3) کد درست → باید tokens + user بدهد ==="
VERIFY=$(curl -s -X POST $BASE/auth/otp/verify -H "Content-Type: application/json" \
  -d "{\"phone\":\"09121234567\",\"code\":\"$CODE\",\"platform\":\"android\",\"deviceName\":\"Smoke Test\"}")
echo "$VERIFY" | python3 -m json.tool | head -14
echo "$VERIFY" > /tmp/session.json

ACCESS=$(echo "$VERIFY" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
REFRESH=$(echo "$VERIFY" | python3 -c "import json,sys; print(json.load(sys.stdin)['refreshToken'])")

echo ""
echo "=== 4) GET /users/me با access token ==="
curl -s $BASE/users/me -H "Authorization: Bearer $ACCESS" | python3 -m json.tool

echo ""
echo "=== 5) GET /users/me بدون توکن → باید 401 باشد ==="
curl -s -o /dev/null -w "%{http_code}" $BASE/users/me
echo ""

echo ""
echo "=== 6) refresh token → جفت جدید (چرخش) ==="
R2=$(curl -s -X POST $BASE/auth/refresh -H "Content-Type: application/json" -d "{\"refreshToken\":\"$REFRESH\"}")
echo "$R2" | python3 -c "import json,sys; d=json.load(sys.stdin); print('new access:', d['accessToken'][:25]+'…', '| new refresh:', d['refreshToken'][:25]+'…')"

echo ""
echo "=== 7) استفاده مجدد از refresh قدیمی → باید REFRESH_REUSED باشد ==="
curl -s -X POST $BASE/auth/refresh -H "Content-Type: application/json" -d "{\"refreshToken\":\"$REFRESH\"}" | head -c 150
echo ""

echo ""
echo "=== 8) logout → 204 ==="
NEW_REFRESH=$(echo "$R2" | python3 -c "import json,sys; print(json.load(sys.stdin)['refreshToken'])")
curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/auth/logout -H "Content-Type: application/json" -d "{\"refreshToken\":\"$NEW_REFRESH\"}"
echo ""

echo ""
echo "OK: همه ۸ مرحله انجام شد"
