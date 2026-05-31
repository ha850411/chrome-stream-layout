from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SIZES = (16, 32, 48, 128)


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_icon(size):
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def s(value):
        return int(round(value * size * scale / 128))

    ink = (39, 56, 68, 255)
    blush = (255, 159, 186, 190)
    cream = (255, 253, 244, 255)

    rounded(draw, (s(8), s(8), s(120), s(120)), s(30), (158, 233, 223, 255))
    draw.pieslice((s(-8), s(-4), s(93), s(81)), 180, 360, fill=(255, 242, 184, 255))
    draw.pieslice((s(51), s(47), s(138), s(134)), 0, 180, fill=(184, 204, 255, 255))

    draw.line((s(24), s(29), s(13), s(22), s(7), s(22)), fill=ink, width=max(1, s(6)), joint="curve")
    draw.line((s(104), s(29), s(115), s(22), s(121), s(22)), fill=ink, width=max(1, s(6)), joint="curve")
    draw.ellipse((s(3), s(17), s(13), s(27)), fill=(255, 127, 158, 255))
    draw.ellipse((s(115), s(17), s(125), s(27)), fill=(255, 127, 158, 255))

    rounded(draw, (s(20), s(26), s(108), s(108)), s(22), ink)
    rounded(draw, (s(25), s(31), s(103), s(103)), s(18), cream)

    panes = [
        ((33, 40, 60, 60), (78, 215, 198, 255)),
        ((68, 40, 95, 60), (255, 154, 119, 255)),
        ((33, 67, 60, 87), (130, 183, 255, 255)),
        ((68, 67, 95, 87), (255, 215, 109, 255)),
    ]
    for box, color in panes:
        rounded(draw, tuple(s(v) for v in box), s(8), color)

    if size >= 32:
        draw.polygon([(s(46), s(50)), (s(53), s(54)), (s(46), s(58))], fill=(255, 255, 255, 240))
        draw.polygon([(s(81), s(50)), (s(88), s(54)), (s(81), s(58))], fill=(255, 255, 255, 240))

    # Face details are intentionally omitted at 16px to keep the favicon crisp.
    if size >= 32:
        draw.ellipse((s(50.5), s(90.5), s(57.5), s(97.5)), fill=ink)
        draw.ellipse((s(70.5), s(90.5), s(77.5), s(97.5)), fill=ink)
        draw.ellipse((s(37.5), s(88.5), s(46.5), s(97.5)), fill=blush)
        draw.ellipse((s(81.5), s(88.5), s(90.5), s(97.5)), fill=blush)
        draw.arc((s(58), s(91), s(70), s(107)), 35, 145, fill=ink, width=max(1, s(3.6)))

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def main():
    ASSETS.mkdir(exist_ok=True)
    for size in SIZES:
        draw_icon(size).save(ASSETS / f"icon{size}.png")


if __name__ == "__main__":
    main()
