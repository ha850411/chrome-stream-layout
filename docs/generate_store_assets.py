"""Generate Chrome Web Store listing artwork for chrome stream layout.

The artwork is deliberately rendered from simple shapes and the extension's
real icon so that it stays reproducible and does not imply support for a
specific streaming service. Run from the repository root with:

    python docs/generate_store_assets.py
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUTPUT = DOCS / "images"
ICON_PATH = ROOT / "assets" / "icon-master.png"

COLORS = {
    "bg": "#050706",
    "surface": "#111412",
    "surface_2": "#1a1e1b",
    "line": "#343b37",
    "text": "#f7f4ea",
    "muted": "#aaa69a",
    "accent": "#16b8a6",
    "accent_bright": "#36e0cc",
}

FONT_REGULAR = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_CJK = Path(r"C:\Windows\Fonts\msjh.ttc")
FONT_CJK_BOLD = Path(r"C:\Windows\Fonts\msjhbd.ttc")


def font(size, *, bold=False, cjk=False):
    path = FONT_CJK_BOLD if cjk and bold else FONT_CJK if cjk else FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(str(path), size)


def gradient(size, top, bottom, horizontal=False):
    image = Image.new("RGB", size, top)
    draw = ImageDraw.Draw(image)
    start = tuple(int(top[i : i + 2], 16) for i in (1, 3, 5))
    end = tuple(int(bottom[i : i + 2], 16) for i in (1, 3, 5))
    steps = size[0] if horizontal else size[1]
    for i in range(steps):
        t = i / max(1, steps - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(start, end))
        if horizontal:
            draw.line((i, 0, i, size[1]), fill=color)
        else:
            draw.line((0, i, size[0], i), fill=color)
    return image


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def paste_rounded(canvas, image, box, radius):
    image = image.resize((box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS)
    canvas.paste(image, box[:2], rounded_mask(image.size, radius))


def glow(canvas, center, radius=250, color=(22, 184, 166), opacity=85):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x, y = center
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, opacity))
    layer = layer.filter(ImageFilter.GaussianBlur(radius / 2.5))
    return Image.alpha_composite(canvas.convert("RGBA"), layer)


def add_text(draw, xy, text, size, fill, *, bold=False, cjk=False, anchor=None):
    draw.text(xy, text, font=font(size, bold=bold, cjk=cjk), fill=fill, anchor=anchor)


def draw_icon(canvas, box, shadow=True):
    icon = Image.open(ICON_PATH).convert("RGBA")
    icon.thumbnail((box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS)
    x = box[0] + (box[2] - box[0] - icon.width) // 2
    y = box[1] + (box[3] - box[1] - icon.height) // 2
    if shadow:
        alpha = icon.getchannel("A").filter(ImageFilter.GaussianBlur(18))
        shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        shadow_layer.paste((0, 0, 0, 145), (x + 2, y + 14), alpha)
        canvas.alpha_composite(shadow_layer)
    canvas.alpha_composite(icon, (x, y))


def scene(kind, size):
    w, h = size
    palettes = [
        ("#091b2c", "#0f5f72"),
        ("#25102e", "#c24d4f"),
        ("#071f1c", "#198b69"),
        ("#1a152c", "#485bb7"),
    ]
    image = gradient(size, *palettes[kind])
    draw = ImageDraw.Draw(image, "RGBA")

    if kind == 0:  # stadium-like light and field
        draw.rectangle((0, h * .62, w, h), fill=(7, 72, 59, 255))
        for x in range(-w, w * 2, max(30, w // 7)):
            draw.line((w // 2, h * .68, x, h), fill=(70, 221, 173, 70), width=2)
        draw.ellipse((w * .35, h * .72, w * .65, h * 1.08), outline=(220, 255, 240, 120), width=3)
        for x in (w * .12, w * .88):
            draw.ellipse((x - 18, h * .2 - 18, x + 18, h * .2 + 18), fill=(255, 248, 210, 220))
    elif kind == 1:  # concert lights
        for i, x in enumerate((.15, .35, .58, .82)):
            c = [(54, 224, 204, 120), (255, 184, 90, 120), (237, 105, 150, 125), (120, 153, 255, 120)][i]
            draw.polygon([(w*x-8, 0), (w*x+8, 0), (w*(x-.16), h)], fill=c)
        for i in range(18):
            x = (i * 83) % w
            y = h * .72 + math.sin(i) * 18
            draw.ellipse((x-10, y-10, x+10, y+10), fill=(5, 6, 7, 210))
    elif kind == 2:  # city/news studio
        for i in range(11):
            bw = max(22, w // 15)
            x = i * (w / 10) - bw
            bh = h * (.20 + ((i * 37) % 50) / 100)
            draw.rectangle((x, h - bh, x + bw, h), fill=(3, 20, 22, 230))
            for yy in range(int(h - bh + 12), h - 8, 18):
                draw.rectangle((x + 7, yy, x + 11, yy + 5), fill=(72, 230, 190, 150))
        draw.arc((w*.18, h*.06, w*.82, h*.7), 195, 345, fill=(121, 255, 225, 155), width=3)
    else:  # mountain / travel video
        draw.ellipse((w*.68, h*.10, w*.82, h*.30), fill=(255, 215, 135, 220))
        draw.polygon([(0, h), (0, h*.55), (w*.24, h*.27), (w*.42, h*.60), (w*.63, h*.24), (w, h*.62), (w, h)], fill=(25, 44, 74, 255))
        draw.polygon([(0, h), (0, h*.74), (w*.35, h*.54), (w*.58, h*.80), (w*.84, h*.52), (w, h*.64), (w, h)], fill=(12, 25, 39, 255))

    # player progress line gives the panels the feel of real video, without using a third-party brand.
    draw.rounded_rectangle((18, h - 18, w - 18, h - 12), 3, fill=(255, 255, 255, 55))
    draw.rounded_rectangle((18, h - 18, 18 + (w - 36) * (.24 + kind * .13), h - 12), 3, fill=(54, 224, 204, 220))
    return image


def toolbar(draw, x, y):
    for i in range(3):
        bx = x + i * 48
        draw.rounded_rectangle((bx, y, bx + 40, y + 40), 8, fill=(13, 15, 14, 225), outline=(255, 255, 255, 45), width=1)
        color = (247, 244, 234, 235)
        if i == 0:  # settings sliders
            draw.line((bx+12, y+14, bx+28, y+14), fill=color, width=2)
            draw.line((bx+12, y+20, bx+28, y+20), fill=color, width=2)
            draw.line((bx+12, y+26, bx+28, y+26), fill=color, width=2)
            draw.ellipse((bx+17, y+11, bx+21, y+17), fill=color)
            draw.ellipse((bx+23, y+17, bx+27, y+23), fill=color)
            draw.ellipse((bx+15, y+23, bx+19, y+29), fill=color)
        elif i == 1:  # reload
            draw.arc((bx+11, y+11, bx+29, y+29), 35, 320, fill=color, width=2)
            draw.polygon(((bx+27, y+10), (bx+31, y+16), (bx+24, y+16)), fill=color)
        else:  # fullscreen corners
            draw.line((bx+12, y+18, bx+12, y+12, bx+18, y+12), fill=color, width=2)
            draw.line((bx+22, y+12, bx+28, y+12, bx+28, y+18), fill=color, width=2)
            draw.line((bx+12, y+22, bx+12, y+28, bx+18, y+28), fill=color, width=2)
            draw.line((bx+22, y+28, bx+28, y+28, bx+28, y+22), fill=color, width=2)


def stage_image(size, layout=4, with_toolbar=True, accent_split=False):
    w, h = size
    image = Image.new("RGBA", size, COLORS["bg"])
    gap = 6
    if layout == 2:
        boxes = [(0, 0, w//2-gap//2, h), (w//2+gap//2, 0, w, h)]
    elif layout == 3:
        boxes = [(0, 0, int(w*.62)-gap, h), (int(w*.62), 0, w, h//2-gap//2), (int(w*.62), h//2+gap//2, w, h)]
    else:
        boxes = [(0, 0, w//2-gap//2, h//2-gap//2), (w//2+gap//2, 0, w, h//2-gap//2),
                 (0, h//2+gap//2, w//2-gap//2, h), (w//2+gap//2, h//2+gap//2, w, h)]
    for index, box in enumerate(boxes):
        image.paste(scene(index, (box[2]-box[0], box[3]-box[1])), box[:2])
    draw = ImageDraw.Draw(image, "RGBA")
    split_color = (22, 184, 166, 235) if accent_split else (3, 4, 4, 255)
    if layout in (2, 4):
        draw.rectangle((w//2-3, 0, w//2+3, h), fill=split_color)
    elif layout == 3:
        x = int(w*.62)
        draw.rectangle((x-3, 0, x+3, h), fill=split_color)
    if layout in (3, 4):
        x0 = int(w*.62) if layout == 3 else 0
        draw.rectangle((x0, h//2-3, w, h//2+3), fill=split_color)
    if with_toolbar:
        toolbar(draw, w-154, 12)
    return image


def window_frame(canvas, box, stage, title="chrome stream layout"):
    x1, y1, x2, y2 = box
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x1-10, y1+12, x2+10, y2+22), 24, fill=(0, 0, 0, 190))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    canvas.alpha_composite(shadow)
    draw = ImageDraw.Draw(layer, "RGBA")
    draw.rounded_rectangle(box, 18, fill=(18, 20, 19, 255), outline=(255, 255, 255, 42), width=1)
    draw.rounded_rectangle((x1+1, y1+1, x2-1, y1+44), 17, fill=(30, 33, 31, 255))
    draw.rectangle((x1+1, y1+26, x2-1, y1+45), fill=(30, 33, 31, 255))
    for i, c in enumerate(((255, 102, 94, 255), (255, 190, 72, 255), (57, 201, 105, 255))):
        draw.ellipse((x1+16+i*22, y1+16, x1+28+i*22, y1+28), fill=c)
    add_text(draw, ((x1+x2)//2, y1+22), title, 14, (205, 205, 198, 255), anchor="mm")
    canvas.alpha_composite(layer)
    paste_rounded(canvas, stage, (x1+1, y1+44, x2-1, y2-1), 0)


COPY = {
    "en": {
        "hero": "Watch more. Switch less.",
        "hero_sub": "Arrange up to four stream sources in one focused Chrome tab.",
        "layout": "2, 3, or 4 sources. Your layout.",
        "layout_sub": "Choose a view, then drag the dividers to fit the moment.",
        "control": "Simple controls. Maximum viewing space.",
        "control_sub": "Paste URLs, apply the layout, reload all, or go fullscreen.",
        "sources": "Sources and layout",
        "language": "Language",
        "source": "Source",
        "clear": "Clear",
        "apply": "Apply",
        "full": "Full-window viewing",
        "resize": "Resizable panes",
        "remember": "Saved automatically",
    },
    "zh-TW": {
        "hero": "多看幾場，少切幾次。",
        "hero_sub": "在同一個 Chrome 分頁中，同時排列最多四個直播來源。",
        "layout": "2、3 或 4 個來源，由你配置。",
        "layout_sub": "選擇版面後，拖曳分隔線即可調整每個畫面的大小。",
        "control": "控制更簡單，觀看空間更完整。",
        "control_sub": "貼上網址、套用版面、一鍵重載，或切換全螢幕。",
        "sources": "來源與版面",
        "language": "介面語言",
        "source": "來源",
        "clear": "清除",
        "apply": "套用",
        "full": "全視窗觀看",
        "resize": "可調整窗格",
        "remember": "自動儲存設定",
    },
}


def screenshot_base(locale, title, subtitle):
    cjk = locale == "zh-TW"
    canvas = gradient((1280, 800), "#111815", "#050706").convert("RGBA")
    canvas = glow(canvas, (1020, 150), 310, opacity=90)
    draw = ImageDraw.Draw(canvas, "RGBA")
    add_text(draw, (70, 64), "chrome stream layout", 19, COLORS["accent_bright"], bold=True)
    add_text(draw, (70, 106), title, 47 if not cjk else 44, COLORS["text"], bold=True, cjk=cjk)
    add_text(draw, (72, 171), subtitle, 21, COLORS["muted"], cjk=cjk)
    return canvas


def screenshot_hero(locale):
    copy = COPY[locale]
    canvas = screenshot_base(locale, copy["hero"], copy["hero_sub"])
    stage = stage_image((1120, 510), layout=4)
    window_frame(canvas, (70, 235, 1210, 758), stage)
    return canvas.convert("RGB")


def screenshot_layouts(locale):
    copy = COPY[locale]
    canvas = screenshot_base(locale, copy["layout"], copy["layout_sub"])
    draw = ImageDraw.Draw(canvas, "RGBA")
    specs = [(2, 70), (3, 468), (4, 866)]
    for layout, x in specs:
        draw.rounded_rectangle((x, 250, x+344, 700), 18, fill=(20, 24, 22, 245), outline=(255, 255, 255, 35), width=1)
        add_text(draw, (x+28, 280), f"{layout} panes" if locale == "en" else f"{layout} 個窗格", 22, COLORS["text"], bold=True, cjk=locale=="zh-TW")
        preview = stage_image((288, 320), layout=layout, with_toolbar=False)
        paste_rounded(canvas, preview, (x+28, 326, x+316, 646), 10)
        draw.rounded_rectangle((x+126, 665, x+218, 695), 15, fill=(22, 184, 166, 36), outline=(22, 184, 166, 120))
        add_text(draw, (x+172, 680), "Drag" if locale == "en" else "可拖曳", 13, COLORS["accent_bright"], bold=True, cjk=locale=="zh-TW", anchor="mm")
    return canvas.convert("RGB")


def screenshot_controls(locale):
    copy = COPY[locale]
    cjk = locale == "zh-TW"
    canvas = screenshot_base(locale, copy["control"], copy["control_sub"])
    stage = stage_image((1120, 510), layout=4)
    window_frame(canvas, (70, 235, 1210, 758), stage)
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay, "RGBA")
    od.rounded_rectangle((755, 270, 1175, 738), 16, fill=(24, 24, 22, 248), outline=(255, 255, 255, 50), width=1)
    add_text(od, (785, 298), "chrome stream layout", 18, COLORS["text"], bold=True)
    add_text(od, (785, 327), copy["sources"], 13, COLORS["muted"], cjk=cjk)
    add_text(od, (785, 367), copy["language"], 12, COLORS["muted"], bold=True, cjk=cjk)
    language_names = ("繁體中文", "English")
    for i, name in enumerate(language_names):
        x = 920 + i*112
        active = (locale == "zh-TW" and i == 0) or (locale == "en" and i == 1)
        od.rounded_rectangle((x, 349, x+106, 385), 6, fill=COLORS["accent"] if active else "#0d0d0d", outline=COLORS["line"])
        add_text(od, (x+53, 367), name, 11, "#061311" if active else COLORS["muted"], bold=True, cjk=i == 0, anchor="mm")
    for i, n in enumerate((2, 3, 4)):
        x = 785 + i*115
        active = n == 4
        od.rounded_rectangle((x, 397, x+105, 433), 6, fill=COLORS["accent"] if active else "#0d0d0d", outline=COLORS["line"])
        add_text(od, (x+52, 415), str(n), 14, "#061311" if active else COLORS["muted"], bold=True, anchor="mm")
    urls = ("https://video.example/live-1", "https://stream.example/live-2", "https://media.example/live-3", "https://watch.example/live-4")
    for i, url in enumerate(urls):
        y = 449 + i*50
        add_text(od, (785, y), f"{copy['source']} {i+1}", 11, COLORS["text"], bold=True, cjk=cjk)
        od.rounded_rectangle((785, y+15, 1145, y+39), 6, fill="#090909", outline="#464641")
        add_text(od, (797, y+27), url, 9, COLORS["muted"], anchor="lm")
    od.rounded_rectangle((937, 665, 1029, 705), 8, fill="#20201e", outline=COLORS["line"])
    od.rounded_rectangle((1039, 665, 1145, 705), 8, fill=COLORS["accent"], outline=COLORS["accent"])
    add_text(od, (983, 685), copy["clear"], 13, COLORS["text"], bold=True, cjk=cjk, anchor="mm")
    add_text(od, (1092, 685), copy["apply"], 13, "#061311", bold=True, cjk=cjk, anchor="mm")
    canvas.alpha_composite(overlay)
    return canvas.convert("RGB")


def promo_small():
    canvas = gradient((440, 280), "#111a17", "#050706", horizontal=True).convert("RGBA")
    canvas = glow(canvas, (90, 140), 150, opacity=110)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw_icon(canvas, (25, 52, 190, 217))
    add_text(draw, (201, 87), "chrome", 20, COLORS["muted"], bold=True)
    add_text(draw, (201, 115), "stream layout", 27, COLORS["text"], bold=True)
    add_text(draw, (202, 164), "Four sources.", 16, COLORS["accent_bright"], bold=True)
    add_text(draw, (202, 188), "One tab.", 16, COLORS["accent_bright"], bold=True)
    return canvas.convert("RGB")


def promo_marquee():
    canvas = gradient((1400, 560), "#111a17", "#030504", horizontal=True).convert("RGBA")
    canvas = glow(canvas, (1040, 230), 430, opacity=100)
    canvas = glow(canvas, (180, 280), 300, opacity=55)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw_icon(canvas, (80, 120, 320, 360))
    add_text(draw, (350, 180), "chrome stream layout", 42, COLORS["text"], bold=True)
    add_text(draw, (352, 248), "Four sources. One focused tab.", 24, COLORS["accent_bright"], bold=True)
    add_text(draw, (352, 291), "Arrange live video your way.", 18, COLORS["muted"])
    preview = stage_image((560, 350), layout=4, with_toolbar=False, accent_split=True)
    window_frame(canvas, (790, 100, 1360, 470), preview, title="chrome stream layout")
    return canvas.convert("RGB")


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Standard compression is a little larger than Pillow's optimizer, but is
    # decoded more consistently by store previews and image inspection tools.
    image.save(path, "PNG", compress_level=6)
    print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


def main():
    for locale in ("en", "zh-TW"):
        save(screenshot_hero(locale), OUTPUT / locale / "01-four-sources-one-tab.png")
        save(screenshot_layouts(locale), OUTPUT / locale / "02-flexible-layouts.png")
        save(screenshot_controls(locale), OUTPUT / locale / "03-simple-controls.png")
    save(promo_small(), OUTPUT / "global" / "promo-small-440x280.png")
    save(promo_marquee(), OUTPUT / "global" / "promo-marquee-1400x560.png")


if __name__ == "__main__":
    main()
