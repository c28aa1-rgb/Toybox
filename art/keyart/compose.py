"""Compose the 'Molded Specimen' key art plate from the img2threejs hero and gun renders."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = Path.home() / '.claude/skills/canvas-design/canvas-fonts'
W, H = 2400, 3200
MARGIN = 150

FIELD = (36, 18, 63)
TILE_A = (41, 22, 71)
TILE_B = (44, 24, 76)
SEAM = (58, 36, 96)
INK = (27, 16, 48)
CREAM = (255, 244, 224)
LEMON = (255, 228, 92)
MUTED = (178, 160, 210)

HEROES = [
    ('blink', 'FLICKER', 'FLK-01', 'BLINK', '5 S'),
    ('swap', 'SWITCH', 'SWT-02', 'SWAP', '9 S'),
    ('chrono', 'TOCK', 'TCK-03', 'TIME BUBBLE', '12 S'),
    ('decoy', 'MIRAGE', 'MRG-04', 'DECOY', '10 S'),
    ('builder', 'BRICK', 'BRK-05', 'WALL', '7 S'),
]
GUNS = [
    ('pistol', 'PEA SHOOTER', 'OPEN'),
    ('smg', 'BUZZBOX', 'OPEN'),
    ('shotgun', 'BOOMSTICK', '5 KILLS'),
    ('sniper', 'LONGSHOT', '15 KILLS'),
    ('rocket', 'PARTY POPPER', '30 KILLS'),
]


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def trimmed(path: Path) -> Image.Image:
    im = Image.open(path).convert('RGBA')
    return im.crop(im.getchannel('A').getbbox())


def text_w(d: ImageDraw.ImageDraw, s: str, f: ImageFont.FreeTypeFont, spacing: int = 0) -> int:
    return int(d.textlength(s, font=f)) + spacing * max(0, len(s) - 1)


def tracked(d: ImageDraw.ImageDraw, xy, s: str, f, fill, spacing: int) -> None:
    x, y = xy
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + spacing


def main() -> None:
    img = Image.new('RGB', (W, H), FIELD)
    d = ImageDraw.Draw(img)

    # Foam-mat checker and seams inside the margins: the measuring grid.
    tile = 100
    for gy in range(MARGIN, H - MARGIN, tile):
        for gx in range(MARGIN, W - MARGIN, tile):
            c = TILE_A if ((gx - MARGIN) // tile + (gy - MARGIN) // tile) % 2 else TILE_B
            d.rectangle([gx, gy, min(gx + tile, W - MARGIN) - 1, min(gy + tile, H - MARGIN) - 1], fill=c)
    for gx in range(MARGIN, W - MARGIN + 1, tile * 4):
        d.line([(gx, MARGIN), (gx, H - MARGIN)], fill=SEAM, width=2)
    for gy in range(MARGIN, H - MARGIN + 1, tile * 4):
        d.line([(MARGIN, gy), (W - MARGIN, gy)], fill=SEAM, width=2)

    # Registration crosses at the four plate corners.
    for cx, cy in [(MARGIN, MARGIN), (W - MARGIN, MARGIN), (MARGIN, H - MARGIN), (W - MARGIN, H - MARGIN)]:
        d.line([(cx - 40, cy), (cx + 40, cy)], fill=MUTED, width=3)
        d.line([(cx, cy - 40), (cx, cy + 40)], fill=MUTED, width=3)
        d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], outline=MUTED, width=3)

    # Wordmark: the one loud element.
    title = font('Boldonse-Regular.ttf', 230)
    t = 'GUN GAME'
    tw = text_w(d, t, title, 6)
    tx, ty = (W - tw) // 2, 330
    tracked(d, (tx + 14, ty + 18), t, title, INK, 6)
    tracked(d, (tx, ty), t, title, LEMON, 6)
    mono = font('DMMono-Regular.ttf', 30)
    sub = 'PLATE I  ·  FIVE SPECIMENS, ONE TRICK EACH  ·  FREE-FOR-ALL, FIRST TO 15'
    tracked(d, ((W - text_w(d, sub, mono, 4)) // 2, ty + 380), sub, mono, MUTED, 4)

    # Heroes at true relative scale on one baseline.
    base_y = 1820
    hero_h = 540  # px for the tallest silhouette in the set; leaves clear floor between specimens
    imgs = [(h, trimmed(HERE / 'renders' / f'{h[0]}.png')) for h in HEROES]
    tallest = max(im.height for _, im in imgs)
    scale = hero_h / tallest
    slot = (W - 2 * MARGIN - 120) / len(imgs)
    name_f = font('BricolageGrotesque-Bold.ttf', 58)
    small = font('DMMono-Regular.ttf', 26)
    for i, ((hid, name, code, ability, cd), im) in enumerate(imgs):
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        cx = int(MARGIN + 60 + slot * (i + 0.5))
        # Contact shadow: a soft ellipse on the floor.
        sh = Image.new('L', (W, H), 0)
        ImageDraw.Draw(sh).ellipse([cx - im.width * 0.42, base_y - 22, cx + im.width * 0.42, base_y + 26], fill=150)
        sh = sh.filter(ImageFilter.GaussianBlur(18))
        img.paste(Image.new('RGB', (W, H), INK), (0, 0), sh)
        img.paste(im, (cx - im.width // 2, base_y - im.height), im)
        d = ImageDraw.Draw(img)
        # Leader line and specimen label.
        ly = base_y + 70
        d.line([(cx, base_y + 34), (cx, ly - 8)], fill=MUTED, width=2)
        tracked(d, (cx - text_w(d, code, small, 3) // 2, ly), code, small, MUTED, 3)
        d.text((cx - text_w(d, name, name_f) // 2, ly + 42), name, font=name_f, fill=CREAM)
        line = f'{ability}  ·  {cd}'
        tracked(d, (cx - text_w(d, line, small, 2) // 2, ly + 120), line, small, MUTED, 2)

    # Scale bar: 1 m at the hero scale (heroes are 1.45 m sole to crown, antenna excluded).
    px_per_m = hero_h / 2.0  # tallest silhouette (Flicker incl. antenna) stands ~2.0 m
    sx, sy = MARGIN + 80, base_y + 330
    d.line([(sx, sy), (sx + px_per_m, sy)], fill=CREAM, width=4)
    for k in range(11):
        x = sx + px_per_m * k / 10
        d.line([(x, sy - (18 if k % 5 == 0 else 9)), (x, sy)], fill=CREAM, width=3)
    tracked(d, (sx, sy + 18), '1 M', small, CREAM, 3)

    # Gun rack: second register, smaller, aligned to the same five columns.
    rack_y = 2560
    tracked(d, (MARGIN + 80, rack_y - 180), 'ARMAMENT  ·  DROPPED ON DEFEAT, CARRIED UNTIL THE NEXT', small, MUTED, 4)
    d.line([(MARGIN + 80, rack_y - 130), (W - MARGIN - 80, rack_y - 130)], fill=SEAM, width=2)
    guns = [(g, trimmed(HERE / 'renders' / f'{g[0]}.png')) for g in GUNS]
    gun_w = slot * 0.82
    gun_name = font('BricolageGrotesque-Bold.ttf', 40)
    for i, ((gid, gname, unlock), im) in enumerate(guns):
        k = min(gun_w / im.width, 190 / im.height)
        im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
        cx = int(MARGIN + 60 + slot * (i + 0.5))
        img.paste(im, (cx - im.width // 2, rack_y + 120 - im.height), im)
        d = ImageDraw.Draw(img)
        d.text((cx - text_w(d, gname, gun_name) // 2, rack_y + 170), gname, font=gun_name, fill=CREAM)
        tracked(d, (cx - text_w(d, unlock, small, 3) // 2, rack_y + 228), unlock, small, MUTED, 3)

    foot = 'CATALOGUED FROM CONCEPT  ·  REBUILT IN CODE  ·  2026'
    tracked(d, ((W - text_w(d, foot, small, 4)) // 2, H - MARGIN - 70), foot, small, (96, 72, 140), 4)

    img.save(HERE / 'molded-specimen.png')
    img.resize((W // 2, H // 2), Image.LANCZOS).save(HERE / 'molded-specimen-preview.png')
    print(HERE / 'molded-specimen.png')


if __name__ == '__main__':
    main()
