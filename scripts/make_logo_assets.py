# ساخت assetهای لوگوی دل از تصویر جدید کاربر (grok jpg روی پس‌زمینهٔ سفید)
# حذف پس‌زمینهٔ سفید با ماتِ آلفا + پرکردن حفرهٔ داخل + عاری‌سازی رنگ لبه‌ها
import numpy as np
from PIL import Image, ImageFilter

SRC = "/home/z/my-project/upload/grok_1793880728455.jpg"
OUT = "/home/z/my-project/apps/mobile/assets"

im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(np.float32)

# کمی محو‌سازی برای خفه‌کردن نویز JPEG پس‌زمینه
im_s = im.filter(ImageFilter.GaussianBlur(1.2))
a = np.asarray(im_s).astype(np.float32)

# فاصله از سفید: سفید کامل => 0
d = 255.0 - a.min(axis=2)
# نویز تا ~35 حذف؛ لبهٔ ضدالیاسing روی رمپ 35..125
alpha = np.clip((d - 35.0) / 90.0, 0.0, 1.0) * 255.0

fg = d >= 120.0  # پیکسل‌های قطعاً پیش‌زمینه

try:
    from scipy.ndimage import binary_fill_holes
    solid = binary_fill_holes(fg)
except ImportError:
    # جایگزین: پراکندگی پشت‌زمینه از لبه‌ها (~fg)؛ آنچه به لبه نمی‌رسد حفرهٔ داخل است
    bg = np.zeros_like(fg)
    bg[0, :] = bg[-1, :] = bg[:, 0] = bg[:, -1] = True
    bg &= ~fg
    prev = None
    while prev is not bg.tobytes():
        prev = bg.tobytes()
        grown = bg.copy()
        grown[1:, :] |= bg[:-1, :]
        grown[:-1, :] |= bg[1:, :]
        grown[:, 1:] |= bg[:, :-1]
        grown[:, :-1] |= bg[:, 1:]
        bg = grown & ~fg
    solid = fg | (~bg & ~fg)

alpha = np.where(solid, 255.0, alpha)

# عاری‌سازی رنگ: C = α*F + (1-α)*255  =>  F = (C - (1-α)*255) / α
af = (alpha / 255.0)[..., None]
F = (a - (1.0 - af) * 255.0) / np.maximum(af, 1e-3)
F = np.clip(F, 0, 255)

rgba = np.dstack([F, alpha]).astype(np.uint8)
master = Image.fromarray(rgba)

ys, xs = np.where(alpha > 128)  # فقط نواحی با آلفای جدی — حاشیهٔ نویز کنار می‌رود
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
pad = 6
master = master.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
print("master:", master.size)

NAVY = (10, 22, 40, 255)  # #0A1628 — پس‌زمینهٔ آیکون اپ


def compose(canvas_px, logo_w, bg=None):
    """لوگو را وسط بوم می‌گذارد؛ bg=None یعنی شفاف"""
    logo = master.resize((logo_w, round(master.height * logo_w / master.width)), Image.LANCZOS)
    if bg is None:
        c = Image.new("RGBA", (canvas_px, canvas_px), (0, 0, 0, 0))
    else:
        c = Image.new("RGBA", (canvas_px, canvas_px), bg)
    c.paste(logo, ((canvas_px - logo.width) // 2, (canvas_px - logo.height) // 2), logo)
    return c

# آیکون اپ (legacy + iOS): لوگو روی سرمه‌ای
compose(1024, 760, NAVY).save(f"{OUT}/icon.png")
# adaptive foreground: شفاف با حاشیهٔ امن (لوگو ~62٪ بوم)
compose(1024, 640).save(f"{OUT}/adaptive-icon.png")
# اسپلش: شفاف (پس‌زمینهٔ سرمه‌ای از app.json می‌آید)
compose(1024, 800).save(f"{OUT}/splash.png")
# لوگوی داخل اپ
compose(512, 460).save(f"{OUT}/logo.png")

# mipmaps اندروید را هم در ریپو به‌روز می‌کنیم (prebuild هم دوباره تولید می‌کند — دو لایهٔ اطمینان)
RES = f"/home/z/my-project/apps/mobile/android/app/src/main/res"
for dpi, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
    ic = compose(px, round(px * 0.74), NAVY).resize((px, px), Image.LANCZOS)
    ic.save(f"{RES}/mipmap-{dpi}/ic_launcher.png")
    # round: دایرهٔ سرمه‌ای + لوگو
    r = compose(px * 4, round(px * 4 * 0.74), NAVY)
    mask = Image.new("L", (px * 4, px * 4), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((0, 0, px * 4, px * 4), fill=255)
    rr = Image.new("RGBA", (px * 4, px * 4), (0, 0, 0, 0))
    rr.paste(r, (0, 0), mask)
    rr.resize((px, px), Image.LANCZOS).save(f"{RES}/mipmap-{dpi}/ic_launcher_round.png")

# تصویر اثبات: چهار خروجی روی زمینهٔ روشن/تیره کنار هم
proof = Image.new("RGB", (1400, 760), (240, 240, 240))
p1 = compose(320, 240, NAVY).resize((320, 320))
p2 = compose(320, 200)
p2bg = Image.new("RGB", (320, 320), (16, 34, 60))
p2bg.paste(p2, (0, 0), p2)
p3 = compose(320, 260).resize((320, 320))
p3bg = Image.new("RGB", (320, 320), (240, 240, 240))
p3bg.paste(p3, (0, 0), p3)
p4 = compose(320, 280, NAVY).resize((320, 320))
for i, p in enumerate([p1, p2bg.convert("RGB"), p3bg, p4.convert("RGB")]):
    proof.paste(p.resize((320, 320)), (40 + i * 340, 220))
proof.save("/tmp/v152/proof_icons.png")
print("OK — همهٔ assetها ساخته شد")
