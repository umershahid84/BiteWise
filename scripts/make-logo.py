# Builds the ResDish logo files in public/assets from the original artwork (assets/brand/resdish-logo-original.jpg):
# the mascot mark, the "ResDish" wordmark (light and dark, with and without the FOOD RESCUE tagline) and the app icons.
#   pip install fonttools pillow
#   mkdir out && cp assets/brand/resdish-logo-original.jpg out/source.jpg
#   python3 scripts/make-logo.py out assets/pdf-fonts
# Then copy out/*.svg and out/*.png to public/assets (apple-icon.png and logo-mark.svg also to src/app/ as
# apple-icon.png and icon.svg). logo.png (1428 wide) and email-logo.png (560 wide) are renders of logo.svg.
import base64, io, sys
from PIL import Image, ImageDraw
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

S = sys.argv[1]; FONTS = sys.argv[2]
src = Image.open(f'{S}/source.jpg').convert('RGB')
BG = (241, 252, 248)

def b64(im, fmt='JPEG', q=88):
    buf = io.BytesIO(); im.save(buf, fmt, quality=q) if fmt == 'JPEG' else im.save(buf, fmt); return base64.b64encode(buf.getvalue()).decode()

# The mark and the icons: the whole mascot, with the grocery bag, the shoulder bag and the feet.
full = src.crop((45, 30, 825, 810))
mark = full.resize((400, 400), Image.LANCZOS)
mark.save(f'{S}/mark.png')
full.save(f'{S}/full.png')

font = TTFont(f'{FONTS}/plus-jakarta-sans-latin-800-normal.woff')
gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
def text_path(text, x, baseline, size, tracking=0, leaf_i=False):
    """The text as an SVG path. leaf_i: the "i" is drawn without its dot (its spacing kept), and the dot's place is
    returned so a leaf can sit there."""
    scale = size / upm; pen = SVGPathPen(gs); cx = 0; dot = None
    for ch in text:
        g = cmap[ord(ch)]; shift = 0
        if leaf_i and ch == 'i':
            # dotless i lines its stem up with the i's when moved 11 units right
            g, shift = cmap[0x131], 11
            dot = (x + cx + 128 * scale, baseline - 690 * scale)
        gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x + cx + shift * scale, baseline)))
        cx += gs[cmap[ord(ch)]].width * scale + tracking
    return (pen.getCommands(), cx, dot) if leaf_i else (pen.getCommands(), cx)

# The green leaf that is the dot of the i in "Dish". In the SVG logos it drifts down from above, swaying, and settles
# on the i (once, when the logo appears; not for people who ask for less motion). PNG renders show it in place.
LEAF_GREEN, LEAF_VEIN = '#4E9F3D', '#2E6E25'
def leaf(cx, cy, size=36):
    w, h = size * 0.62, size
    body = (f'M0,{-h/2:.1f} C{w*0.62:.1f},{-h*0.28:.1f} {w*0.62:.1f},{h*0.28:.1f} 0,{h/2:.1f} '
            f'C{-w*0.62:.1f},{h*0.28:.1f} {-w*0.62:.1f},{-h*0.28:.1f} 0,{-h/2:.1f} Z')
    vein = f'M0,{h/2 + 4:.1f} L0,{-h/2 + 5:.1f}'
    return (f'<g transform="translate({cx:.1f} {cy:.1f})"><g class="leaf"><g transform="rotate(38)">'
            f'<path d="{body}" fill="{LEAF_GREEN}"/><path d="{vein}" stroke="{LEAF_VEIN}" stroke-width="2.4" stroke-linecap="round" fill="none"/>'
            f'</g></g></g>')
LEAF_STYLE = ('<style>.leaf{transform-box:fill-box;transform-origin:center;animation:leaf-fall 2.2s cubic-bezier(.45,.05,.4,1) .2s both}'
              '@keyframes leaf-fall{0%{transform:translate(-18px,-95px) rotate(-55deg);opacity:0}6%{opacity:1}'
              '30%{transform:translate(16px,-64px) rotate(30deg)}55%{transform:translate(-12px,-33px) rotate(-24deg)}'
              '78%{transform:translate(6px,-9px) rotate(12deg)}90%{transform:translate(-2px,-2px) rotate(-4deg)}'
              '100%{transform:none;opacity:1}}'
              '@media (prefers-reduced-motion:reduce){.leaf{animation:none}}</style>')

TEAL, DARKTEAL, RED, WHITE, MINT, MUTED, MUTED_D = '#13827C', '#0E6964', '#D63B4B', '#FFFFFF', '#7FD6CF', '#5B7C7A', '#A7C9C5'
mark_b64 = b64(mark)
def svg(width, dark, tagline):
    word_x = 222
    res, w1 = text_path('Res', word_x, 128 if tagline else 138, 118)
    dish, w2, dot = text_path('Dish', word_x + w1, 128 if tagline else 138, 118, leaf_i=True)
    parts = [f'<path d="{res}" fill="{WHITE if dark else RED}"/>', f'<path d="{dish}" fill="{MINT if dark else TEAL}"/>', leaf(*dot)]
    if tagline:
        tag, tw = text_path('FOOD RESCUE', word_x + 4, 178, 30, tracking=7)
        parts.append(f'<path d="{tag}" fill="{MUTED_D if dark else MUTED}"/>')
    total = max(word_x + w1 + w2, word_x + (tw if tagline else 0)) + 8
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {total:.0f} 200" role="img" aria-label="ResDish">
  <defs><clipPath id="m"><rect x="4" y="4" width="192" height="192" rx="46"/></clipPath></defs>
  {LEAF_STYLE}
  <image x="4" y="4" width="192" height="192" clip-path="url(#m)" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,{mark_b64}" xlink:href="data:image/jpeg;base64,{mark_b64}"/>
  {"".join(parts)}
</svg>'''
open(f'{S}/logo.svg', 'w').write(svg(0, False, True))
open(f'{S}/logo-dark.svg', 'w').write(svg(0, True, True))
open(f'{S}/logo-compact.svg', 'w').write(svg(0, False, False))
open(f'{S}/logo-dark-compact.svg', 'w').write(svg(0, True, False))
open(f'{S}/logo-mark.svg', 'w').write(f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200" role="img" aria-label="ResDish">
  <defs><clipPath id="m"><rect x="0" y="0" width="200" height="200" rx="48"/></clipPath></defs>
  <image x="0" y="0" width="200" height="200" clip-path="url(#m)" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,{mark_b64}" xlink:href="data:image/jpeg;base64,{mark_b64}"/>
</svg>''')

# App icons: the whole mascot, full-bleed (phones round the corners themselves); maskable keeps it inside the safe zone.
for size, name in [(512, 'app-icon-512'), (192, 'app-icon-192'), (512, 'kiosk-icon-512'), (192, 'kiosk-icon-192'), (180, 'apple-touch-icon'), (180, 'apple-icon')]:
    full.resize((size, size), Image.LANCZOS).save(f'{S}/{name}.png', optimize=True)
for name in ['app-icon-maskable-512', 'kiosk-icon-maskable-512']:
    c = Image.new('RGB', (512, 512), BG); c.paste(full.resize((390, 390), Image.LANCZOS), (61, 61)); c.save(f'{S}/{name}.png', optimize=True)
m512 = Image.new('RGBA', (512, 512), (0, 0, 0, 0)); mk = mark.resize((512, 512), Image.LANCZOS).convert('RGBA')
mask = Image.new('L', (512, 512), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, 511, 511), 122, fill=255)
m512.paste(mk, (0, 0), mask); m512.save(f'{S}/logo-mark-512.png', optimize=True)
print('ok')
