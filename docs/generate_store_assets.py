"""Generate Chrome Web Store listing artwork for Stream Layout with cute aesthetic.

Generates:
- Screenshots (1280x800) for zh-TW and en
- Small Promo Tile (440x280)
- Marquee Promo Tile (1400x560)

Run from the repository root with:
    python3 docs/generate_store_assets.py
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUTPUT = DOCS / "images"
ICON_PATH = ROOT / "assets" / "icon-master.png"
FONTS_DIR = DOCS / "fonts"

COLORS = {
    "bg_dark": "#0c0a17",
    "bg_mid": "#16132b",
    "bg_card": "#1d1938",
    "bg_card_inner": "#252147",
    "border": "#3c3666",
    "border_light": "#5b5394",
    "text": "#ffffff",
    "text_muted": "#b8b3db",
    "text_subtle": "#857fae",
    "accent_lavender": "#a78bfa",
    "accent_pink": "#f472b6",
    "accent_coral": "#fb7185",
    "accent_mint": "#34d399",
    "accent_cyan": "#38bdf8",
    "accent_yellow": "#fbbf24",
}

FONT_HUNINN = FONTS_DIR / "jf-openhuninn-2.0.ttf"
FONT_NOTO_BOLD = FONTS_DIR / "NotoSansTC-Bold.otf"


def font(size, *, bold=False, cjk=False):
    if FONT_HUNINN.exists():
        return ImageFont.truetype(str(FONT_HUNINN), size)
    elif FONT_NOTO_BOLD.exists():
        return ImageFont.truetype(str(FONT_NOTO_BOLD), size)
    for p in (r"C:\Windows\Fonts\msjhbd.ttc", r"C:\Windows\Fonts\msjh.ttc", r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\segoeui.ttf"):
        path = Path(p)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


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


def glow(canvas, center, radius=260, color=(167, 139, 250), opacity=90):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x, y = center
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, opacity))
    layer = layer.filter(ImageFilter.GaussianBlur(radius / 2.2))
    return Image.alpha_composite(canvas.convert("RGBA"), layer)


def draw_rounded_pill(canvas, box, radius, fill=(35, 30, 65, 220), outline=None, width=1):
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay, "RGBA")
    d.rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)
    return Image.alpha_composite(canvas, overlay)


def add_text(draw, xy, text, size, fill, *, bold=False, cjk=False, anchor=None):
    f = font(size, bold=bold, cjk=cjk)
    draw.text(xy, text, font=f, fill=fill, anchor=anchor)


def draw_icon(canvas, box, shadow=True):
    icon = Image.open(ICON_PATH).convert("RGBA")
    icon.thumbnail((box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS)
    x = box[0] + (box[2] - box[0] - icon.width) // 2
    y = box[1] + (box[3] - box[1] - icon.height) // 2
    if shadow:
        pad = 32
        pad_layer = Image.new("RGBA", (icon.width + pad * 2, icon.height + pad * 2), (0, 0, 0, 0))
        pad_layer.paste(icon, (pad, pad))
        shadow_alpha = pad_layer.getchannel("A").filter(ImageFilter.GaussianBlur(16))
        shadow_color = Image.new("RGBA", pad_layer.size, (0, 0, 0, 140))
        shadow_color.putalpha(shadow_alpha)
        canvas.alpha_composite(shadow_color, (x - pad + 2, y - pad + 10))
    canvas.alpha_composite(icon, (x, y))


def scene(kind, size):
    """Render one of 4 cute video stream panels with clean layout and zero collisions."""
    w, h = size
    palettes = [
        ("#1a1033", "#4c1d95"),  # Kind 0: Gaming Live (dusk purple to violet)
        ("#0f172a", "#312e81"),  # Kind 1: Lo-Fi Music (deep midnight indigo)
        ("#4c0519", "#be185d"),  # Kind 2: Creative & Cooking (sweet berry rose)
        ("#064e3b", "#0d9488"),  # Kind 3: Pet & Nature Cam (mint emerald)
    ]
    image = gradient(size, *palettes[kind])
    draw = ImageDraw.Draw(image, "RGBA")

    if kind == 0:  # Gaming / Pixel Adventure Live
        # Sun in upper center-left (never collides with chat on the right)
        draw.ellipse((int(w * 0.26), int(h * 0.18), int(w * 0.38), int(h * 0.38)), fill=(253, 224, 71, 230))
        # Mountain / hills silhouette
        points = [
            (0, h), (0, int(h * 0.70)), (int(w * 0.22), int(h * 0.55)), 
            (int(w * 0.45), int(h * 0.72)), (int(w * 0.72), int(h * 0.58)), 
            (w, int(h * 0.68)), (w, h)
        ]
        draw.polygon(points, fill=(60, 25, 110, 240))
        draw.rectangle((0, int(h * 0.78), w, h), fill=(26, 16, 51, 255))
        
        # Cute streamer webcam box in bottom-left
        wc_w, wc_h = int(w * 0.20), int(h * 0.26)
        if wc_w > 40 and wc_h > 30:
            wc_x, wc_y = 16, h - wc_h - 24
            draw.rounded_rectangle((wc_x, wc_y, wc_x + wc_w, wc_y + wc_h), 6, fill=(20, 15, 38, 230), outline=COLORS["accent_lavender"], width=1)
            # Cute streamer cat head in webcam
            ch_cx = wc_x + wc_w // 2
            ch_cy = wc_y + wc_h // 2 + 2
            draw.polygon([(ch_cx - 10, ch_cy - 4), (ch_cx - 6, ch_cy - 16), (ch_cx - 2, ch_cy - 6)], fill=(244, 114, 182, 220))
            draw.polygon([(ch_cx + 2, ch_cy - 6), (ch_cx + 6, ch_cy - 16), (ch_cx + 10, ch_cy - 4)], fill=(244, 114, 182, 220))
            draw.ellipse((ch_cx - 12, ch_cy - 8, ch_cx + 12, ch_cy + 12), fill=(244, 114, 182, 220))

        # Floating chat bubbles on right
        chat_w = int(w * 0.30)
        chat_x = int(w * 0.66)
        for i in range(3):
            cy = int(h * 0.26) + i * 22
            if cy + 14 < h - 24:
                draw.rounded_rectangle((chat_x, cy, chat_x + chat_w, cy + 14), 7, fill=(15, 23, 42, 160))
                draw.rounded_rectangle((chat_x + 8, cy + 4, chat_x + chat_w - 14, cy + 10), 3, fill=(255, 255, 255, 80))

        # Badge: LIVE & Viewers
        badge_x, badge_y = 16, 16
        draw.rounded_rectangle((badge_x, badge_y, badge_x + 58, badge_y + 22), 6, fill=(239, 68, 68, 220))
        add_text(draw, (badge_x + 29, badge_y + 11), "LIVE", 11, "#ffffff", bold=True, anchor="mm")
        draw.rounded_rectangle((badge_x + 64, badge_y, badge_x + 130, badge_y + 22), 6, fill=(15, 23, 42, 180))
        add_text(draw, (badge_x + 97, badge_y + 11), "18.4K", 11, COLORS["accent_yellow"], bold=True, anchor="mm")

    elif kind == 1:  # Lo-Fi Room & Cozy Music Stream
        # Night stars
        for i in range(10):
            sx = (i * 73 + 19) % int(w * 0.70) + 10
            sy = int(h * 0.12 + ((i * 43) % int(h * 0.40)))
            r = 2 if i % 2 == 0 else 3
            draw.ellipse((sx - r, sy - r, sx + r, sy + r), fill=(255, 255, 255, 180))
            
        # Glowing crescent moon in upper center-left (never touches top-right toolbar!)
        mx, my = int(w * 0.25), int(h * 0.26)
        draw.ellipse((mx - 18, my - 18, mx + 18, my + 18), fill=(254, 240, 138, 230))
        draw.ellipse((mx - 12, my - 22, mx + 20, my + 14), fill=(15, 23, 42, 255))
        
        # Cozy warm study window on right
        win_x = int(w * 0.58)
        win_y = int(h * 0.42)
        win_w = int(w * 0.34)
        win_h = int(h * 0.38)
        draw.rounded_rectangle((win_x, win_y, win_x + win_w, win_y + win_h), 8, fill=(254, 240, 138, 190), outline=(50, 45, 80, 255), width=2)
        # Window panes
        draw.line([(win_x + win_w // 2, win_y), (win_x + win_w // 2, win_y + win_h)], fill=(50, 45, 80, 255), width=2)
        draw.line([(win_x, win_y + win_h // 2), (win_x + win_w, win_y + win_h // 2)], fill=(50, 45, 80, 255), width=2)

        # Floating musical note symbols on left
        for i, (nx, ny) in enumerate([(w * 0.15, h * 0.50), (w * 0.38, h * 0.42), (w * 0.48, h * 0.55)]):
            draw.ellipse((nx - 6, ny - 6, nx + 6, ny + 6), fill=(167, 139, 250, 220))
            draw.line((nx + 4, ny - 6, nx + 4, ny - 18), fill=(167, 139, 250, 220), width=2)
            draw.line((nx + 4, ny - 18, nx + 12, ny - 15), fill=(167, 139, 250, 220), width=2)

        # Badge: BGM
        badge_x, badge_y = 16, 16
        draw.rounded_rectangle((badge_x, badge_y, badge_x + 95, badge_y + 22), 6, fill=(15, 23, 42, 190))
        add_text(draw, (badge_x + 47, badge_y + 11), "24/7 Lo-Fi", 11, COLORS["accent_cyan"], bold=True, anchor="mm")

    elif kind == 2:  # Creative / Baking & VTuber Stream
        # Sweet bakery counter
        draw.rectangle((0, int(h * 0.70), w, h), fill=(48, 6, 24, 255))
        # Cute cake on counter
        ck_x = int(w * 0.36)
        ck_y = int(h * 0.54)
        ck_w = int(w * 0.24)
        ck_h = int(h * 0.18)
        draw.rounded_rectangle((ck_x, ck_y, ck_x + ck_w, ck_y + ck_h), 8, fill=(251, 113, 133, 220))
        draw.rounded_rectangle((ck_x + 4, ck_y + 4, ck_x + ck_w - 4, ck_y + 12), 4, fill=(255, 241, 242, 240))
        # Cherry on top
        draw.ellipse((ck_x + ck_w // 2 - 5, ck_y - 8, ck_x + ck_w // 2 + 5, ck_y + 2), fill=(225, 29, 72, 255))

        # Floating sweet hearts drifting upwards
        for i, (hx, hy) in enumerate([(w * 0.20, h * 0.45), (w * 0.68, h * 0.38), (w * 0.82, h * 0.50)]):
            draw.ellipse((hx - 7, hy - 7, hx, hy), fill=(251, 113, 133, 200))
            draw.ellipse((hx, hy - 7, hx + 7, hy), fill=(251, 113, 133, 200))
            draw.polygon([(hx - 7, hy - 2), (hx + 7, hy - 2), (hx, hy + 8)], fill=(251, 113, 133, 200))

        # Badge: CREATIVE
        badge_x, badge_y = 16, 16
        draw.rounded_rectangle((badge_x, badge_y, badge_x + 92, badge_y + 22), 6, fill=(15, 23, 42, 190))
        add_text(draw, (badge_x + 46, badge_y + 11), "Sweet Cafe", 11, COLORS["accent_pink"], bold=True, anchor="mm")

    else:  # Pet & Nature Cam
        # Rolling green hills
        draw.polygon([(0, h), (0, int(h * 0.60)), (int(w * 0.45), int(h * 0.50)), (w, int(h * 0.65)), (w, h)], fill=(13, 148, 136, 220))
        draw.polygon([(0, h), (0, int(h * 0.72)), (int(w * 0.25), int(h * 0.65)), (int(w * 0.75), int(h * 0.58)), (w, int(h * 0.72)), (w, h)], fill=(4, 120, 87, 240))
        # Cozy sun
        draw.ellipse((int(w * 0.76), int(h * 0.16), int(w * 0.88), int(h * 0.36)), fill=(254, 240, 138, 230))
        
        # Cute Kitten Sitting on the hill
        kx, ky = int(w * 0.32), int(h * 0.60)
        # Ears
        draw.polygon([(kx - 14, ky - 6), (kx - 8, ky - 20), (kx - 2, ky - 7)], fill=(255, 255, 255, 230))
        draw.polygon([(kx + 2, ky - 7), (kx + 8, ky - 20), (kx + 14, ky - 6)], fill=(255, 255, 255, 230))
        # Inner pink ears
        draw.polygon([(kx - 12, ky - 7), (kx - 8, ky - 17), (kx - 4, ky - 8)], fill=(255, 175, 190, 230))
        draw.polygon([(kx + 4, ky - 8), (kx + 8, ky - 17), (kx + 12, ky - 7)], fill=(255, 175, 190, 230))
        # Head
        draw.ellipse((kx - 16, ky - 10, kx + 16, ky + 14), fill=(255, 255, 255, 230))
        # Eyes
        draw.ellipse((kx - 8, ky - 2, kx - 4, ky + 2), fill=(35, 30, 60, 255))
        draw.ellipse((kx + 4, ky - 2, kx + 8, ky + 2), fill=(35, 30, 60, 255))
        # Pink nose
        draw.polygon([(kx - 2, ky + 3), (kx + 2, ky + 3), (kx, ky + 6)], fill=(255, 140, 160, 255))
        
        # Badge: PET CAM
        badge_x, badge_y = 16, 16
        draw.rounded_rectangle((badge_x, badge_y, badge_x + 92, badge_y + 22), 6, fill=(15, 23, 42, 190))
        add_text(draw, (badge_x + 46, badge_y + 11), "Kitten Cam", 11, COLORS["accent_mint"], bold=True, anchor="mm")

    # Bottom player scrubber line with glowing thumb dot
    scrub_y = h - 16
    draw.rounded_rectangle((16, scrub_y, w - 16, scrub_y + 6), 3, fill=(255, 255, 255, 45))
    progress = 0.28 + kind * 0.18
    fill_w = int((w - 32) * progress)
    accent_bar = [COLORS["accent_lavender"], COLORS["accent_cyan"], COLORS["accent_pink"], COLORS["accent_mint"]][kind]
    draw.rounded_rectangle((16, scrub_y, 16 + fill_w, scrub_y + 6), 3, fill=accent_bar)
    draw.ellipse((16 + fill_w - 5, scrub_y - 2, 16 + fill_w + 5, scrub_y + 8), fill="#ffffff")

    return image


def toolbar(draw, x, y):
    """Render the 3 floating control buttons in top-right corner."""
    for i in range(3):
        bx = x + i * 46
        draw.rounded_rectangle((bx, y, bx + 38, y + 38), 10, fill=(24, 21, 46, 230), outline=(255, 255, 255, 50), width=1)
        color = (255, 255, 255, 235)
        if i == 0:  # Settings sliders
            draw.line((bx + 11, y + 13, bx + 27, y + 13), fill=color, width=2)
            draw.line((bx + 11, y + 19, bx + 27, y + 19), fill=color, width=2)
            draw.line((bx + 11, y + 25, bx + 27, y + 25), fill=color, width=2)
            draw.ellipse((bx + 16, y + 10, bx + 20, y + 16), fill=color)
            draw.ellipse((bx + 22, y + 16, bx + 26, y + 22), fill=color)
            draw.ellipse((bx + 14, y + 22, bx + 18, y + 28), fill=color)
        elif i == 1:  # Sync / Reload
            draw.arc((bx + 10, y + 10, bx + 28, y + 28), 35, 320, fill=color, width=2)
            draw.polygon(((bx + 26, y + 9), (bx + 30, y + 15), (bx + 23, y + 15)), fill=color)
        else:  # Fullscreen corners
            draw.line((bx + 11, y + 17, bx + 11, y + 11, bx + 17, y + 11), fill=color, width=2)
            draw.line((bx + 21, y + 11, bx + 27, y + 11, bx + 27, y + 17), fill=color, width=2)
            draw.line((bx + 11, y + 21, bx + 11, y + 27, bx + 17, y + 27), fill=color, width=2)
            draw.line((bx + 21, y + 27, bx + 27, y + 27, bx + 27, y + 21), fill=color, width=2)


def stage_image(size, layout=4, with_toolbar=True, accent_split=True):
    w, h = size
    image = Image.new("RGBA", size, COLORS["bg_dark"])
    gap = 6
    if layout == 2:
        boxes = [(0, 0, w // 2 - gap // 2, h), (w // 2 + gap // 2, 0, w, h)]
    elif layout == 3:
        boxes = [(0, 0, int(w * 0.62) - gap, h), (int(w * 0.62), 0, w, h // 2 - gap // 2), (int(w * 0.62), h // 2 + gap // 2, w, h)]
    else:
        boxes = [
            (0, 0, w // 2 - gap // 2, h // 2 - gap // 2),
            (w // 2 + gap // 2, 0, w, h // 2 - gap // 2),
            (0, h // 2 + gap // 2, w // 2 - gap // 2, h),
            (w // 2 + gap // 2, h // 2 + gap // 2, w, h),
        ]
    for index, box in enumerate(boxes):
        image.paste(scene(index, (box[2] - box[0], box[3] - box[1])), box[:2])
    draw = ImageDraw.Draw(image, "RGBA")
    split_color = (167, 139, 250, 220) if accent_split else (20, 18, 38, 255)
    if layout in (2, 4):
        draw.rectangle((w // 2 - 3, 0, w // 2 + 3, h), fill=split_color)
    elif layout == 3:
        x = int(w * 0.62)
        draw.rectangle((x - 3, 0, x + 3, h), fill=split_color)
    if layout in (3, 4):
        x0 = int(w * 0.62) if layout == 3 else 0
        draw.rectangle((x0, h // 2 - 3, w, h // 2 + 3), fill=split_color)
    if with_toolbar:
        toolbar(draw, w - 150, 12)
    return image


def window_frame(canvas, box, stage, title="Stream Layout"):
    x1, y1, x2, y2 = box
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x1 - 10, y1 + 14, x2 + 10, y2 + 24), 26, fill=(0, 0, 0, 180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    canvas.alpha_composite(shadow)
    draw = ImageDraw.Draw(layer, "RGBA")
    # Outer frame
    draw.rounded_rectangle(box, 20, fill=(24, 21, 46, 255), outline=COLORS["border"], width=1)
    # Title bar
    draw.rounded_rectangle((x1 + 1, y1 + 1, x2 - 1, y1 + 44), 19, fill=(32, 28, 58, 255))
    draw.rectangle((x1 + 1, y1 + 24, x2 - 1, y1 + 45), fill=(32, 28, 58, 255))
    # Candy window buttons (pastel coral, yellow, mint)
    for i, c in enumerate(((251, 113, 133, 255), (251, 191, 36, 255), (52, 211, 153, 255))):
        draw.ellipse((x1 + 18 + i * 22, y1 + 16, x1 + 30 + i * 22, y1 + 28), fill=c)
        
    # Title with mini mascot icon in title bar
    mid_x = (x1 + x2) // 2
    draw_icon(layer, (mid_x - 68, y1 + 12, mid_x - 46, y1 + 34), shadow=False)
    add_text(draw, (mid_x + 10, y1 + 22), title, 15, COLORS["text_muted"], bold=True, anchor="mm")
    
    canvas.alpha_composite(layer)
    paste_rounded(canvas, stage, (x1 + 1, y1 + 44, x2 - 1, y2 - 1), 0)


COPY = {
    "en": {
        "tag": "Chrome Extension",
        "hero": "Watch more. Switch less.",
        "hero_sub": "Arrange up to four stream sources in one focused Chrome tab.",
        "pills": ("Cute Mascot", "Draggable Panes", "Fullscreen Mode"),
        "layout": "2, 3, or 4 sources. Your layout.",
        "layout_sub": "Choose a view, then drag the dividers to fit the moment.",
        "control": "Simple controls. Maximum viewing space.",
        "control_sub": "Paste URLs, apply the layout, reload all, or go fullscreen.",
        "sources": "Sources and layout",
        "language": "Interface Language",
        "source": "Source",
        "clear": "Clear",
        "apply": "Apply Layout",
        "drag_badge": "Drag to resize",
    },
    "zh-TW": {
        "tag": "Chrome 擴充功能",
        "hero": "多看幾場，少切幾次。",
        "hero_sub": "在同一個 Chrome 分頁中，同時排列最多四個直播來源。",
        "pills": ("貓咪電視吉祥物", "自由拖曳窗格", "一鍵全螢幕"),
        "layout": "2、3 或 4 個來源，由你配置。",
        "layout_sub": "選擇版面後，拖曳分隔線即可調整每個畫面的大小。",
        "control": "控制更簡單，觀看空間更完整。",
        "control_sub": "貼上網址、套用版面、一鍵重載，或切換全螢幕。",
        "sources": "來源與版面設定",
        "language": "介面語言",
        "source": "來源",
        "clear": "清除",
        "apply": "套用版面",
        "drag_badge": "自由拖曳調整",
    },
}


def screenshot_base(locale, title, subtitle):
    cjk = locale == "zh-TW"
    copy = COPY[locale]
    canvas = gradient((1280, 800), COLORS["bg_mid"], COLORS["bg_dark"]).convert("RGBA")
    canvas = glow(canvas, (1100, 140), 340, color=(167, 139, 250), opacity=90)
    canvas = glow(canvas, (160, 200), 280, color=(244, 114, 182), opacity=65)
    
    # Mascot Icon on header
    draw_icon(canvas, (70, 48, 116, 94), shadow=False)
    
    # Brand tag pill
    badge_w = 260 if cjk else 270
    canvas = draw_rounded_pill(canvas, (126, 52, 126 + badge_w, 86), 17, fill=(35, 30, 65, 220), outline=(167, 139, 250, 220))
    draw = ImageDraw.Draw(canvas, "RGBA")
    add_text(draw, (142, 69), "Stream Layout", 14, COLORS["accent_lavender"], bold=True, anchor="lm")
    add_text(draw, (250, 69), "•  " + copy["tag"], 12, COLORS["text_subtle"], cjk=cjk, anchor="lm")
    
    # Title & Subtitle
    add_text(draw, (70, 116), title, 44 if cjk else 46, COLORS["text"], bold=True, cjk=cjk)
    add_text(draw, (72, 174), subtitle, 20, COLORS["text_muted"], cjk=cjk)
    return canvas


def screenshot_hero(locale):
    copy = COPY[locale]
    canvas = screenshot_base(locale, copy["hero"], copy["hero_sub"])
    
    # Feature pill badges on the right side of header
    pills = copy["pills"]
    for i, pill in enumerate(pills):
        px = 640 + i * 190
        py = 52
        canvas = draw_rounded_pill(canvas, (px, py, px + 175, py + 34), 17, fill=(35, 30, 65, 220), outline=(91, 83, 148, 220))
        draw = ImageDraw.Draw(canvas, "RGBA")
        add_text(draw, (px + 87, py + 17), pill, 13, COLORS["text"], bold=True, cjk=locale == "zh-TW", anchor="mm")

    stage = stage_image((1140, 510), layout=4)
    window_frame(canvas, (70, 235, 1210, 758), stage)
    return canvas.convert("RGB")


def screenshot_layouts(locale):
    copy = COPY[locale]
    canvas = screenshot_base(locale, copy["layout"], copy["layout_sub"])
    specs = [(2, 70), (3, 468), (4, 866)]
    for layout, x in specs:
        # Card container
        canvas = draw_rounded_pill(canvas, (x, 246, x + 344, 712), 20, fill=(28, 25, 52, 245), outline=COLORS["border"], width=1)
        draw = ImageDraw.Draw(canvas, "RGBA")
        lbl = f"{layout} 個窗格" if locale == "zh-TW" else f"{layout} Panes"
        add_text(draw, (x + 28, 280), lbl, 22, COLORS["text"], bold=True, cjk=locale == "zh-TW")
        preview = stage_image((288, 330), layout=layout, with_toolbar=False)
        paste_rounded(canvas, preview, (x + 28, 326, x + 316, 656), 12)
        
        # Bottom badge
        canvas = draw_rounded_pill(canvas, (x + 85, 668, x + 259, 702), 16, fill=(38, 32, 70, 240), outline=(167, 139, 250, 220))
        draw = ImageDraw.Draw(canvas, "RGBA")
        add_text(draw, (x + 172, 685), copy["drag_badge"], 13, COLORS["accent_lavender"], bold=True, cjk=locale == "zh-TW", anchor="mm")
    return canvas.convert("RGB")


def screenshot_controls(locale):
    copy = COPY[locale]
    cjk = locale == "zh-TW"
    canvas = screenshot_base(locale, copy["control"], copy["control_sub"])
    stage = stage_image((1140, 510), layout=4)
    window_frame(canvas, (70, 235, 1210, 758), stage)
    
    # Dialog bounds
    dx1, dy1, dx2, dy2 = 755, 265, 1175, 738
    
    # 1. Drop shadow behind dialog
    shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer, "RGBA")
    sd.rounded_rectangle((dx1 - 4, dy1 + 10, dx2 + 4, dy2 + 24), 28, fill=(0, 0, 0, 160))
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(20))
    canvas.alpha_composite(shadow_layer)
    
    # 2. Authentic Apple Frosted Glass: Blur the underlying canvas content where dialog sits
    dialog_mask = Image.new("L", canvas.size, 0)
    md = ImageDraw.Draw(dialog_mask)
    md.rounded_rectangle((dx1, dy1, dx2, dy2), 24, fill=255)
    
    blurred_canvas = canvas.filter(ImageFilter.GaussianBlur(24))
    canvas.paste(blurred_canvas, (0, 0), dialog_mask)
    
    # 3. Glass tint and border layer
    card_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    cd = ImageDraw.Draw(card_layer, "RGBA")
    # Frosted glass gradient/tint
    cd.rounded_rectangle((dx1, dy1, dx2, dy2), 24, fill=(20, 17, 38, 195), outline=(255, 255, 255, 48), width=1)
    
    # Specular highlight on top edge (Apple glass rim)
    cd.line([(dx1 + 25, dy1 + 1), (dx2 - 25, dy1 + 1)], fill=(255, 255, 255, 100), width=1)
    
    # Header: Title with Mascot Icon
    draw_icon(card_layer, (dx1 + 24, dy1 + 18, dx1 + 60, dy1 + 54), shadow=False)
    add_text(cd, (dx1 + 68, dy1 + 34), "Stream Layout", 19, COLORS["text"], bold=True, anchor="lm")
    
    # Language pill selector (top right of header)
    language_names = ("繁中", "EN")
    for i, name in enumerate(language_names):
        lx = dx2 - 110 + i * 48
        active = (locale == "zh-TW" and i == 0) or (locale == "en" and i == 1)
        cd.rounded_rectangle((lx, dy1 + 20, lx + 44, dy1 + 48), 10, fill=(167, 139, 250, 220) if active else (255, 255, 255, 20), outline=(255, 255, 255, 45) if not active else (167, 139, 250, 255))
        add_text(cd, (lx + 22, dy1 + 34), name, 12, "#120e26" if active else COLORS["text_subtle"], bold=True, cjk=True, anchor="mm")
    
    # Layout Segmented Switch: [2] [3] [4] with Apple recessed container
    cd.rounded_rectangle((dx1 + 24, dy1 + 68, dx2 - 24, dy1 + 110), 12, fill=(0, 0, 0, 95), outline=(255, 255, 255, 22), width=1)
    seg_w = (dx2 - dx1 - 48 - 8) / 3
    for i, n in enumerate((2, 3, 4)):
        sx = int(dx1 + 28 + i * seg_w)
        active = n == 4
        if active:
            cd.rounded_rectangle((sx, dy1 + 72, int(sx + seg_w - 4), dy1 + 106), 9, fill=(167, 139, 250, 90), outline=(167, 139, 250, 180), width=1)
            # tiny active indicator dot
            cd.ellipse((sx + seg_w - 14, dy1 + 77, sx + seg_w - 10, dy1 + 81), fill=(167, 139, 250, 255))
        lbl = f"{n} 分割" if cjk else f"{n} Panes"
        add_text(cd, (int(sx + (seg_w - 4) / 2), dy1 + 89), lbl, 13, "#ffffff" if active else COLORS["text_muted"], bold=True, cjk=cjk, anchor="mm")
        
    urls = (
        ("https://twitch.tv/lofi_cat", "Twitch", "#c084fc"), 
        ("https://youtube.com/live/cozy_cafe", "YouTube", "#fb7185"), 
        ("https://kick.com/game_zone", "Kick", "#4ade80"), 
        ("https://bilibili.com/live/1024", "Bilibili", "#38bdf8")
    )
    for i, (url, platform, tag_col) in enumerate(urls):
        y = dy1 + 122 + i * 68
        # Card container
        cd.rounded_rectangle((dx1 + 24, y, dx2 - 24, y + 60), 14, fill=(255, 255, 255, 14), outline=(255, 255, 255, 26), width=1)
        # Position badge
        cd.rounded_rectangle((dx1 + 34, y + 8, dx1 + 56, y + 26), 6, fill=(0, 0, 0, 90), outline=(255, 255, 255, 30))
        add_text(cd, (dx1 + 45, y + 17), str(i + 1), 11, COLORS["accent_lavender"], bold=True, anchor="mm")
        
        # Source Platform Pill tag
        cd.rounded_rectangle((dx1 + 64, y + 8, dx1 + 132, y + 26), 9, fill=(255, 255, 255, 18), outline=(255, 255, 255, 30))
        cd.ellipse((dx1 + 72, y + 15, dx1 + 77, y + 20), fill=tag_col)
        add_text(cd, (dx1 + 84, y + 17), platform, 10, COLORS["text"], bold=True, anchor="lm")
        
        # Input Box
        cd.rounded_rectangle((dx1 + 34, y + 31, dx2 - 34, y + 53), 8, fill=(0, 0, 0, 110), outline=(255, 255, 255, 25))
        add_text(cd, (dx1 + 44, y + 42), url, 10, COLORS["text_subtle"], anchor="lm")
        
    # Buttons Footer with Apple Glass Pill Buttons
    by = dy2 - 58
    cd.line([(dx1, by - 6), (dx2, by - 6)], fill=(255, 255, 255, 20), width=1)
    
    # Clear button
    cd.rounded_rectangle((dx1 + 24, by, dx1 + 110, by + 38), 10, fill=(255, 255, 255, 16), outline=(255, 255, 255, 30))
    add_text(cd, (dx1 + 67, by + 19), copy["clear"], 13, COLORS["text_subtle"], bold=True, cjk=cjk, anchor="mm")
    
    # Apply candy pill button
    cd.rounded_rectangle((dx2 - 145, by, dx2 - 24, by + 38), 11, fill=(167, 139, 250, 240), outline=(255, 255, 255, 140))
    cd.line([(dx2 - 135, by + 1), (dx2 - 34, by + 1)], fill=(255, 255, 255, 180), width=1)
    add_text(cd, (dx2 - 84, by + 19), copy["apply"], 13, "#1a103c", bold=True, cjk=cjk, anchor="mm")
    
    canvas.alpha_composite(card_layer)
    return canvas.convert("RGB")



def promo_small():
    """Small promo tile: 440 x 280."""
    canvas = gradient((440, 280), COLORS["bg_mid"], COLORS["bg_dark"], horizontal=True).convert("RGBA")
    canvas = glow(canvas, (110, 140), 160, color=(167, 139, 250), opacity=120)
    canvas = glow(canvas, (350, 210), 130, color=(244, 114, 182), opacity=70)
    
    # Mascot Icon
    draw_icon(canvas, (25, 45, 195, 215))
    
    # Right Text
    draw = ImageDraw.Draw(canvas, "RGBA")
    add_text(draw, (206, 75), "chrome", 18, COLORS["text_subtle"], bold=True)
    add_text(draw, (206, 104), "Stream Layout", 25, COLORS["text"], bold=True)
    add_text(draw, (207, 150), "Four sources.", 16, COLORS["accent_lavender"], bold=True)
    add_text(draw, (207, 175), "One focused tab.", 16, COLORS["accent_pink"], bold=True)
    
    # Cute feature pill
    canvas = draw_rounded_pill(canvas, (206, 205, 385, 237), 16, fill=(38, 32, 70, 240), outline=(167, 139, 250, 220))
    d2 = ImageDraw.Draw(canvas, "RGBA")
    add_text(d2, (295, 221), "自由縮放・可愛相伴", 12, COLORS["text"], bold=True, cjk=True, anchor="mm")
    
    return canvas.convert("RGB")


def promo_marquee():
    """Marquee promo banner: 1400 x 560."""
    canvas = gradient((1400, 560), COLORS["bg_mid"], COLORS["bg_dark"], horizontal=True).convert("RGBA")
    canvas = glow(canvas, (1060, 240), 450, color=(167, 139, 250), opacity=90)
    canvas = glow(canvas, (240, 280), 320, color=(244, 114, 182), opacity=75)
    
    # Left Hero: Mascot icon & text
    draw_icon(canvas, (75, 105, 335, 365))
    draw = ImageDraw.Draw(canvas, "RGBA")
    add_text(draw, (360, 160), "Stream Layout", 46, COLORS["text"], bold=True)
    add_text(draw, (362, 230), "多串流分割・可愛隨行", 26, COLORS["accent_lavender"], bold=True, cjk=True)
    add_text(draw, (362, 276), "把喜歡的直播與影片，裝進同一個視窗！", 18, COLORS["text_muted"], cjk=True)
    
    # Feature Pills
    pills = ("貓咪電視", "自由調整比例", "一鍵重載全螢幕")
    for i, pill in enumerate(pills):
        px = 362 + i * 140
        py = 325
        canvas = draw_rounded_pill(canvas, (px, py, px + 128, py + 34), 17, fill=(35, 30, 65, 220), outline=(91, 83, 148, 220))
        d2 = ImageDraw.Draw(canvas, "RGBA")
        add_text(d2, (px + 64, py + 17), pill, 13, COLORS["text"], bold=True, cjk=True, anchor="mm")

    # Right side: Window Frame mockup
    preview = stage_image((560, 350), layout=4, with_toolbar=False, accent_split=True)
    window_frame(canvas, (785, 100, 1355, 470), preview, title="Stream Layout")
    return canvas.convert("RGB")


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
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
