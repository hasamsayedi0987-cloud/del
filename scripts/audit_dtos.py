#!/usr/bin/env python3
"""Audit: find DTO classes without any field decorators (whitelist strips their fields)."""
import re, pathlib

root = pathlib.Path('/home/z/my-project/apps/api/src')
broken = []
for p in root.rglob('*.ts'):
    lines = p.read_text(encoding='utf-8').splitlines()
    for m in re.finditer(r'^\s*(?:export\s+)?class\s+(\w*Dton?\w*|\w+Dto)\b', '\n'.join(lines), re.M):
        pass
    for i, ln in enumerate(lines):
        m = re.match(r'^\s*(?:export\s+)?class\s+(\w+)\b', ln)
        if not m or 'Dto' not in m.group(1):
            continue
        name = m.group(1)
        # body تا براکتِ بستهٔ کلاس در ستون ۰ — نه تا کلاس بعدی (وگرنه decoratorهای کنترلر بعدی هم می‌آیند)
        j = i + 1
        body = []
        while j < len(lines) and not re.match(r'^\}', lines[j]):
            body.append(lines[j]); j += 1
        # field decorators: decorator lines that appear between fields (heuristic: any @Word inside body excluding class-level ones attached at class decl)
        field_dec = [b for b in body if re.match(r'^\s*@[A-Z]', b)]
        has_fields = [b for b in body if re.match(r'^\s*\w+[?!]?\s*:', b)]
        if has_fields and not field_dec:
            broken.append(f'{p.relative_to(root)}:{i+1} class {name} — {len(has_fields)} fields, 0 decorators')

print('BROKEN DTOs (fields with no validators → whitelist strips them):')
for b in broken: print(' ', b)
print('none' if not broken else f'{len(broken)} found')
