# همهٔ requireهای تصویری داخل src موبایل را نسبت به فایل مبدا رزول و وجودشان را چک می‌کند
import os, re, sys

root = "/home/z/my-project/apps/mobile/src"
bad = []
for dirpath, _, files in os.walk(root):
    for f in files:
        if not f.endswith((".ts", ".tsx")):
            continue
        p = os.path.join(dirpath, f)
        src = open(p, encoding="utf-8").read()
        for m in re.finditer(r"require\(['\"](\.{1,2}/[^'\"]+\.(?:png|jpe?g|gif|webp))['\"]\)", src):
            rel = m.group(1)
            resolved = os.path.normpath(os.path.join(dirpath, rel))
            if not os.path.exists(resolved):
                bad.append((os.path.relpath(p, root), rel))
print("BROKEN:", bad if bad else "none — همهٔ مسیرهای asset معتبرند")
sys.exit(1 if bad else 0)
