from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MASTER = ASSETS / "icon-master.png"
SIZES = (16, 32, 48, 128)


def draw_cat_tv(target_size: int) -> Image.Image:
    """Renders the Bold Kawaii Cat TV icon tuned for target_size with supersampling."""
    scale = 4
    S = target_size * scale
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    is_small = target_size <= 32
    stroke_w = int(S * (0.045 if is_small else 0.025))

    # Cat Ears (solid dark purple-black)
    d.polygon([(int(S * 0.12), int(S * 0.32)), (int(S * 0.22), int(S * 0.04)), (int(S * 0.38), int(S * 0.24))], fill="#18132e")
    d.polygon([(int(S * 0.88), int(S * 0.32)), (int(S * 0.78), int(S * 0.04)), (int(S * 0.62), int(S * 0.24))], fill="#18132e")

    # Pink inner ears
    d.polygon([(int(S * 0.16), int(S * 0.28)), (int(S * 0.23), int(S * 0.10)), (int(S * 0.34), int(S * 0.24))], fill="#ff708f")
    d.polygon([(int(S * 0.84), int(S * 0.28)), (int(S * 0.77), int(S * 0.10)), (int(S * 0.66), int(S * 0.24))], fill="#ff708f")

    # TV chassis
    pad_x = int(S * 0.05)
    top_y = int(S * 0.20)
    bot_y = int(S * 0.95)
    rad = int(S * 0.20)
    d.rounded_rectangle((pad_x, top_y, S - pad_x, bot_y), radius=rad, fill="#18132e", outline="#302758", width=stroke_w)

    # TV Screen inner
    s_pad_x = int(S * (0.12 if is_small else 0.11))
    s_top_y = int(S * (0.28 if is_small else 0.27))
    s_bot_y = int(S * (0.87 if is_small else 0.88))
    s_rad = int(S * 0.14)

    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((s_pad_x, s_top_y, S - s_pad_x, s_bot_y), radius=s_rad, fill=255)

    panes = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panes)
    cx = S // 2
    cy = (s_top_y + s_bot_y) // 2
    gap = int(S * (0.025 if is_small else 0.018))

    # Top-Left: Twitch Violet
    pd.rectangle((s_pad_x, s_top_y, cx - gap, cy - gap), fill="#9a62ff")
    # Top-Right: Kick Green
    pd.rectangle((cx + gap, s_top_y, S - s_pad_x, cy - gap), fill="#05d672")
    # Bottom-Left: Live Coral Red
    pd.rectangle((s_pad_x, cy + gap, cx - gap, s_bot_y), fill="#ff4d6a")
    # Bottom-Right: Sunny Amber Gold
    pd.rectangle((cx + gap, cy + gap, S - s_pad_x, s_bot_y), fill="#ffbe1a")

    im.paste(panes, (0, 0), mask)

    # Center Mascot Face Pill
    face_w = int(S * (0.50 if is_small else 0.44))
    face_h = int(S * (0.34 if is_small else 0.30))
    fx1, fy1 = (S - face_w) // 2, cy - face_h // 2
    fx2, fy2 = fx1 + face_w, fy1 + face_h

    d = ImageDraw.Draw(im)
    d.rounded_rectangle((fx1, fy1, fx2, fy2), radius=face_h // 2, fill="#ffffff", outline="#18132e", width=stroke_w)

    # Eyes
    eye_r = int(S * (0.048 if is_small else 0.040))
    eye_y = cy - int(S * 0.01)
    d.ellipse((fx1 + int(face_w * 0.26) - eye_r, eye_y - eye_r, fx1 + int(face_w * 0.26) + eye_r, eye_y + eye_r), fill="#18132e")
    d.ellipse((fx2 - int(face_w * 0.26) - eye_r, eye_y - eye_r, fx2 - int(face_w * 0.26) + eye_r, eye_y + eye_r), fill="#18132e")

    # Eye glint for larger sizes
    if not is_small:
        glint_r = int(eye_r * 0.32)
        d.ellipse((fx1 + int(face_w * 0.26) - eye_r // 2, eye_y - eye_r // 2, fx1 + int(face_w * 0.26) - eye_r // 2 + glint_r * 2, eye_y - eye_r // 2 + glint_r * 2), fill="#ffffff")
        d.ellipse((fx2 - int(face_w * 0.26) - eye_r // 2, eye_y - eye_r // 2, fx2 - int(face_w * 0.26) - eye_r // 2 + glint_r * 2, eye_y - eye_r // 2 + glint_r * 2), fill="#ffffff")

    # Cheeks
    if target_size >= 32:
        chk_r = int(S * 0.035)
        chk_y = cy + int(S * 0.04)
        d.ellipse((fx1 + int(face_w * 0.16) - chk_r, chk_y - chk_r // 2, fx1 + int(face_w * 0.16) + chk_r, chk_y + chk_r // 2), fill="#ff7a99")
        d.ellipse((fx2 - int(face_w * 0.16) - chk_r, chk_y - chk_r // 2, fx2 - int(face_w * 0.16) + chk_r, chk_y + chk_r // 2), fill="#ff7a99")

    # Smile
    d.arc((cx - int(S * 0.06), cy - int(S * 0.02), cx + int(S * 0.06), cy + int(S * 0.06)), start=20, end=160, fill="#18132e", width=stroke_w)

    out = im.resize((target_size, target_size), Image.Resampling.LANCZOS)
    if is_small:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.5, percent=140, threshold=2))
    return out


def main() -> None:
    # 1. Generate 1024x1024 master
    master = draw_cat_tv(1024)
    master.save(MASTER, optimize=True)
    print(f"Generated {MASTER}")

    # 2. Generate all standard icon sizes
    for size in SIZES:
        icon = draw_cat_tv(size)
        target = ASSETS / f"icon{size}.png"
        icon.save(target, optimize=True)
        print(f"Generated {target} ({size}x{size})")


if __name__ == "__main__":
    main()
