#!/usr/bin/env python3
"""Converts the Mac app's icon set (soundboard-mac/src/renderer/icons.js) into
Swift data for the iPad app (soundboard-ipad/.../Model/IconData.swift).

Every SVG shape (path, circle, ellipse, rect) becomes an absolute path using
only M, L, C and Z, so the Swift side needs a very small parser.

Run from the repo root:  python3 tools/generate-ios-icons.py
"""
import json
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS_JS = ROOT / 'soundboard-mac/src/renderer/icons.js'
OUT = ROOT / 'soundboard-ipad/Soundboard.swiftpm/Model/IconData.swift'

K = 0.5522847498  # cubic approximation of a quarter circle


def load_icons():
    script = f"const I = require({json.dumps(str(ICONS_JS))}); console.log(JSON.stringify(I.list.map(i => ({{...i, svg: I.get(i.id).svg}}))));"
    return json.loads(subprocess.check_output(['node', '-e', script]))


# ---------- SVG path → absolute M/L/C/Z ----------

def tokenize(d):
    return re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?', d)


def arc_to_cubics(x1, y1, rx, ry, phi, large, sweep, x2, y2):
    """Endpoint arc (SVG spec F.6) as a list of cubic segments."""
    if rx == 0 or ry == 0:
        return [(x1, y1, x2, y2, x2, y2)]
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(phi)
    cos, sin = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cos * dx + sin * dy
    y1p = -sin * dx + cos * dy
    lam = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2
    if lam > 1:
        rx *= math.sqrt(lam)
        ry *= math.sqrt(lam)
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    coef = math.sqrt(max(0, num / den)) if den else 0
    if large == sweep:
        coef = -coef
    cxp = coef * rx * y1p / ry
    cyp = -coef * ry * x1p / rx
    cx = cos * cxp - sin * cyp + (x1 + x2) / 2
    cy = sin * cxp + cos * cyp + (y1 + y2) / 2

    def angle(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dt > 0:
        dt -= 2 * math.pi
    elif sweep and dt < 0:
        dt += 2 * math.pi
    segments = max(1, math.ceil(abs(dt) / (math.pi / 2) - 1e-9))
    delta = dt / segments
    alpha = 4 / 3 * math.tan(delta / 4)
    out = []
    t = t1
    for _ in range(segments):
        c1, s1 = math.cos(t), math.sin(t)
        c2, s2 = math.cos(t + delta), math.sin(t + delta)
        p1 = (c1 - alpha * s1, s1 + alpha * c1)
        p2 = (c2 + alpha * s2, s2 - alpha * c2)
        p3 = (c2, s2)
        pts = []
        for px, py in (p1, p2, p3):
            px, py = px * rx, py * ry
            pts += [cos * px - sin * py + cx, sin * px + cos * py + cy]
        out.append(tuple(pts))
        t += delta
    return out


def normalize_path(d, tx=0.0, ty=0.0):
    toks = tokenize(d)
    i = 0
    out = []
    x = y = sx = sy = 0.0
    last_ctrl = None  # reflection point for S/T
    last_q = None
    cmd = None

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    def flag():
        # Arc flags can be packed together, e.g. "a2 2 0 011 1".
        nonlocal i
        t = toks[i]
        if len(t) > 1 and t[0] in '01' and not t.startswith(('0.', '1.')):
            toks[i] = t[1:]
            return int(t[0])
        i += 1
        return int(float(t))

    def emit(c, *pts):
        out.append(c + ' ' + ' '.join(f'{v + (tx if k % 2 == 0 else ty):.3f}'.rstrip('0').rstrip('.') for k, v in enumerate(pts)) if pts else c)

    while i < len(toks):
        if re.match(r'[A-Za-z]', toks[i]):
            cmd = toks[i]
            i += 1
            if cmd in 'Zz':
                out.append('Z')
                x, y = sx, sy
                last_ctrl = last_q = None
                continue
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = (x, y) if rel else (0.0, 0.0)
        if c == 'M':
            x, y = ox + num(), oy + num()
            sx, sy = x, y
            emit('M', x, y)
            cmd = 'l' if rel else 'L'  # extra pairs are line-tos
            last_ctrl = last_q = None
        elif c == 'L':
            x, y = ox + num(), oy + num()
            emit('L', x, y)
            last_ctrl = last_q = None
        elif c == 'H':
            x = (x if rel else 0) + num()
            emit('L', x, y)
            last_ctrl = last_q = None
        elif c == 'V':
            y = (y if rel else 0) + num()
            emit('L', x, y)
            last_ctrl = last_q = None
        elif c == 'C':
            x1, y1, x2, y2, ex, ey = ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()
            emit('C', x1, y1, x2, y2, ex, ey)
            last_ctrl = (x2, y2)
            last_q = None
            x, y = ex, ey
        elif c == 'S':
            x1, y1 = (2 * x - last_ctrl[0], 2 * y - last_ctrl[1]) if last_ctrl else (x, y)
            x2, y2, ex, ey = ox + num(), oy + num(), ox + num(), oy + num()
            emit('C', x1, y1, x2, y2, ex, ey)
            last_ctrl = (x2, y2)
            last_q = None
            x, y = ex, ey
        elif c in 'QT':
            if c == 'Q':
                qx, qy = ox + num(), oy + num()
            else:
                qx, qy = (2 * x - last_q[0], 2 * y - last_q[1]) if last_q else (x, y)
            ex, ey = ox + num(), oy + num()
            emit('C', x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey)
            last_q = (qx, qy)
            last_ctrl = None
            x, y = ex, ey
        elif c == 'A':
            rx, ry, phi = num(), num(), num()
            large, sweep = flag(), flag()
            ex, ey = ox + num(), oy + num()
            for seg in arc_to_cubics(x, y, rx, ry, phi, large, sweep, ex, ey):
                emit('C', *seg)
            x, y = ex, ey
            last_ctrl = last_q = None
        else:
            raise ValueError(f'unsupported command {cmd} in {d}')
    return ' '.join(out)


def ellipse_path(cx, cy, rx, ry):
    kx, ky = rx * K, ry * K
    return (f'M {cx + rx} {cy} C {cx + rx} {cy + ky} {cx + kx} {cy + ry} {cx} {cy + ry} '
            f'C {cx - kx} {cy + ry} {cx - rx} {cy + ky} {cx - rx} {cy} '
            f'C {cx - rx} {cy - ky} {cx - kx} {cy - ry} {cx} {cy - ry} '
            f'C {cx + kx} {cy - ry} {cx + rx} {cy - ky} {cx + rx} {cy} Z')


def rect_path(x, y, w, h, r):
    if not r:
        return f'M {x} {y} L {x + w} {y} L {x + w} {y + h} L {x} {y + h} Z'
    return (f'M {x + r} {y} L {x + w - r} {y} A {r} {r} 0 0 1 {x + w} {y + r} L {x + w} {y + h - r} '
            f'A {r} {r} 0 0 1 {x + w - r} {y + h} L {x + r} {y + h} A {r} {r} 0 0 1 {x} {y + h - r} '
            f'L {x} {y + r} A {r} {r} 0 0 1 {x + r} {y} Z')


def attrs(tag):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', tag))


def shapes(svg):
    out = []
    for tag in re.findall(r'<(?:path|circle|ellipse|rect)\b[^>]*>', svg):
        a = attrs(tag)
        kind = re.match(r'<(\w+)', tag).group(1)
        f = lambda k, default=0.0: float(a.get(k, default))
        if kind == 'path':
            d = a['d']
        elif kind == 'circle':
            d = ellipse_path(f('cx'), f('cy'), f('r'), f('r'))
        elif kind == 'ellipse':
            d = ellipse_path(f('cx'), f('cy'), f('rx'), f('ry'))
        else:
            d = rect_path(f('x'), f('y'), f('width'), f('height'), f('rx'))
        tx = ty = 0.0
        m = re.match(r'translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)', a.get('transform', ''))
        if m:
            tx, ty = float(m.group(1)), float(m.group(2))
        elif a.get('transform'):
            raise ValueError(f'unsupported transform {a["transform"]}')
        out.append({
            'd': normalize_path(d, tx, ty),
            'fill': a.get('class') == 'f',
            'opacity': float(a.get('opacity', 1)),
        })
    return out


def swift_string(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def main():
    icons = load_icons()
    data = [{**i, 'shapes': shapes(i['svg'])} for i in icons]
    if '--json' in sys.argv:
        print(json.dumps(data))
        return
    lines = [
        '// Generated by tools/generate-ios-icons.py from the Mac app\'s icons.js. Do not edit by hand.',
        '',
        'enum IconData {',
        '    static let all: [IconDefinition] = [',
    ]
    for icon in data:
        parts = []
        for s in icon['shapes']:
            extra = ''
            if s['fill']:
                extra += ', fill: true'
            if s['opacity'] != 1:
                extra += f', opacity: {s["opacity"]}'
            parts.append(f'IconShape(path: {swift_string(s["d"])}{extra})')
        lines.append(f'        IconDefinition(id: {swift_string(icon["id"])}, name: {swift_string(icon["name"])}, '
                     f'category: {swift_string(icon["category"])}, shapes: [')
        for p in parts:
            lines.append(f'            {p},')
        lines.append('        ]),')
    lines += ['    ]', '']
    # Same emoji → icon map as the Mac app, for consistency in shared data.
    emoji = json.loads(subprocess.check_output(['node', '-e', f"console.log(JSON.stringify(require({json.dumps(str(ICONS_JS))}).FROM_EMOJI))"]))
    lines.append('    static let fromEmoji: [String: String] = [')
    for k, v in emoji.items():
        lines.append(f'        {swift_string(k)}: {swift_string(v)},')
    lines += ['    ]', '}', '']
    OUT.write_text('\n'.join(lines))
    print(f'Wrote {len(data)} icons to {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
