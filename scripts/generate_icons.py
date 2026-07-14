from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MASTER = ASSETS / "icon-master.png"
SIZES = (16, 32, 48, 128)


def render_icon(master: Image.Image, size: int) -> Image.Image:
    icon = master.resize((size, size), Image.Resampling.LANCZOS)
    if size <= 48:
        icon = icon.filter(ImageFilter.UnsharpMask(radius=0.6, percent=120, threshold=2))
    return icon


def main() -> None:
    if not MASTER.exists():
        raise FileNotFoundError(f"Missing icon master: {MASTER}")

    with Image.open(MASTER) as source:
        master = source.convert("RGBA")
        for size in SIZES:
            render_icon(master, size).save(ASSETS / f"icon{size}.png", optimize=True)


if __name__ == "__main__":
    main()
