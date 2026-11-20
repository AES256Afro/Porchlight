// 58 Deco lantern: concept 40 refined. The stepped arch, the gold wedge rays and
// the fat Bodoni name stay; the light bulb is gone. In its place a Deco wall
// lantern hangs over a small front door, so the emblem is plainly a porch light.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '58-deco-lantern';
const C = {
  night: '#0a1634', // banner ground
  navy: '#0f2150', // the arch's field
  blue: '#1b3a80', // rays on the ground, halo ring
  gold: '#e6b450',
  goldLt: '#f8dc8a',
  goldDk: '#a77a25',
  white: '#fff4d8', // warm white: the lit glass
  amber: '#ffc74a', // the edge of the glow
};
const FONTS = { Bod: 'BodoniSvtyTwoITCTT-Bold', DidotI: 'Didot-Italic' };
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;

// ---- the emblem on a 200 grid -----------------------------------------------------
const BX = 100;
const BY = 80;
const ARCH = 'M24,194V96H36V78H48V66A52,52 0 0 1 152,66V78H164V96H176V194Z';
const ARCH_IN = 'M33,186V105H45V87H57V66A43,43 0 0 1 143,66V87H155V105H167V186Z';
const LAMP = 'M96.5,27H103.5L109,40V46H118V53H128V61L120,113V119.5H113V125L100,139L87,125V119.5H80V113L72,61V53H82V46H91V40Z';

function wedges(cx, cy, n, half, r0, r1, skip = () => false) {
  let d = '';
  for (let i = 0; i < n; i++) {
    if (skip(i)) continue;
    const a = (i / n) * 360 - 90;
    const p = (r, deg) => `${f(cx + r * Math.cos(rad(deg)))},${f(cy + r * Math.sin(rad(deg)))}`;
    d += `M${p(r0, a - half * 0.35)}L${p(r1, a - half)}L${p(r1, a + half)}L${p(r0, a + half * 0.35)}Z`;
  }
  return d;
}

function emblem({ fine = true, pal = C } = {}) {
  return `
<path d="${ARCH}" fill="${pal.navy}"/>
<clipPath id="in${fine ? 'f' : 'b'}"><path d="${ARCH_IN}"/></clipPath>
<g clip-path="url(#in${fine ? 'f' : 'b'})">
  <path d="${wedges(BX, BY, 20, 3.4, 36, 190)}" fill="${pal.gold}"/>
  ${fine ? `<path d="${wedges(BX, BY, 20, 0.7, 62, 190)}" fill="${pal.goldDk}" transform="rotate(9 ${BX} ${BY})"/>` : ''}
</g>
<path d="${ARCH}" fill="none" stroke="${pal.gold}" stroke-width="8" stroke-linejoin="miter"/>
${fine ? `<path d="${ARCH_IN}" fill="none" stroke="${pal.goldDk}" stroke-width="1.6"/>` : ''}
<path d="M88,4H112L107,22H93Z" fill="${pal.goldLt}"/>
<!-- a dark ring keeps the rays off the lantern -->
<path d="${LAMP}" fill="${pal.navy}" stroke="${pal.navy}" stroke-width="15" stroke-linejoin="round"/>
<rect x="80" y="128" width="40" height="24" fill="${pal.navy}"/>
<!-- the lantern: stepped cap, tapered glass, stepped base, finial -->
<path d="M96.5,40H103.5L100,27Z" fill="${pal.gold}"/>
<rect x="91" y="40" width="18" height="6" fill="${pal.goldLt}"/>
<rect x="82" y="46" width="36" height="7" fill="${pal.gold}"/>
<rect x="72" y="53" width="56" height="8" fill="${pal.goldLt}"/>
<path d="M75,61H125L115,113H85Z" fill="${pal.amber}"/>
<path d="M81,65H119L110.6,109H89.4Z" fill="${pal.white}"/>
<path d="M92.5,61L95,113M107.5,61L105,113" stroke="${pal.navy}" stroke-width="3" fill="none"/>
<path d="M78,81H122" stroke="${pal.navy}" stroke-width="2.4"/>
<rect x="80" y="113" width="40" height="6.5" fill="${pal.goldLt}"/>
<rect x="87" y="119.5" width="26" height="5.5" fill="${pal.gold}"/>
<path d="M92,125H108L100,137Z" fill="${pal.goldDk}"/>
<!-- the door beneath it, in a stepped surround -->
<path d="M72,187V151H78V146H122V151H128V187Z" fill="${pal.navy}" stroke="${pal.navy}" stroke-width="8" stroke-linejoin="round"/>
<path d="M76,187V153H81V148H119V153H124V187Z" fill="${pal.gold}"/>
<rect x="85" y="154" width="30" height="33" fill="${pal.night}"/>
<rect x="85" y="154" width="30" height="33" fill="${pal.amber}"/>
<rect x="88" y="157" width="10.5" height="30" fill="${pal.white}"/>
<rect x="101.5" y="157" width="10.5" height="30" fill="${pal.white}"/>
<circle cx="104.6" cy="173" r="1.6" fill="${pal.navy}"/>
<!-- stepped plinth -->
<rect x="66" y="187" width="68" height="5" fill="${pal.goldLt}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: emblem({ fine: false }) });

// ---- favicons on the pixel grid --------------------------------------------------
const PIX0 = { N: C.navy, G: C.gold, L: C.goldLt, D: C.goldDk, W: C.white, A: C.amber, B: '#0a1634' };
const PIX = PIX0;
function pixRects(rows) {
  let out = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let e = x + 1;
      while (e < row.length && row[e] === ch) e++;
      if (ch !== '.') out += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${PIX[ch]}"/>`;
      x = e;
    }
  });
  return out;
}
const FAV16 = [
  '....GGGGGGGG....',
  '..GGGNNNNNNGGG..',
  '.GGNNNNLLNNNNGG.',
  '.GNNNLLLLLLNNNG.',
  'GGNNNAWWWWANNNGG',
  'GNNNNAWWWWANNNNG',
  'GNNNNAWWWWANNNNG',
  'GNNNNNWWWWNNNNNG',
  'GNNNNNLLLLNNNNNG',
  'GNNNNNNDDNNNNNNG',
  'GNNNNNNNNNNNNNNG',
  'GNNNNGGGGGGNNNNG',
  'GNNNNGAWWAGNNNNG',
  'GNNNNGAWWAGNNNNG',
  'GNNLLGAWWAGLLNNG',
  'GGGGGGGGGGGGGGGG',
];
function fav32Rows() {
  const n = 32;
  const g = Array.from({ length: n }, () => Array(n).fill('.'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < n && y >= 0 && y < n) g[y][x] = ch;
  };
  const r = (x0, y0, x1, y1, ch) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch);
  };
  // the stepped arch, then its frame: every pixel within two of the outside is gold
  const inside = (x, y) => {
    if (x < 0 || x > 31 || y < 0 || y > 31) return false;
    if (y >= 16) return x >= 0 && x <= 31;
    if (y >= 12) return x >= 4 && x <= 27;
    return Math.hypot(x + 0.5 - 16, y + 0.5 - 12) < 12;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!inside(x, y)) continue;
    let edge = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!inside(x + dx, y + dy)) edge = true;
    set(x, y, edge ? 'G' : 'N');
  }
  // four rays over the bulb
  const ray = (deg, r0, r1) => {
    for (let d = r0; d <= r1; d += 0.5) {
      const x = Math.floor(16 + d * Math.cos(rad(deg)));
      const y = Math.floor(13 + d * Math.sin(rad(deg)));
      if (g[y] && g[y][x] === 'N') set(x, y, 'G');
    }
  };
  for (const deg of [-150, -122, -58, -30, 172, 8]) ray(deg, 7, 17);
  // the lantern: cap, tapered glass, base
  r(15, 3, 16, 4, 'G');
  r(14, 5, 17, 5, 'L');
  r(12, 6, 19, 7, 'G');
  r(10, 8, 21, 9, 'L');
  for (let y = 10; y <= 18; y++) {
    const inset = Math.floor((y - 10) / 3);
    r(10 + inset, y, 21 - inset, y, 'N');
    r(11 + inset, y, 20 - inset, y, 'A');
    r(12 + inset, y, 19 - inset, y, 'W');
  }
  r(12, 19, 19, 19, 'L');
  r(13, 20, 18, 20, 'G');
  r(15, 21, 16, 22, 'D');
  // the door in its surround, lit
  r(10, 24, 21, 29, 'G');
  r(12, 25, 19, 29, 'A');
  r(13, 25, 18, 29, 'W');
  r(15, 25, 16, 29, 'W');
  set(17, 27, 'N');
  return g.map((row) => row.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon ------------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  body: `
<clipPath id="ico"><rect width="512" height="512" rx="112"/></clipPath>
<rect width="512" height="512" rx="112" fill="${C.night}"/>
<g clip-path="url(#ico)"><path d="${wedges(256, 236, 20, 4.5, 60, 520)}" fill="${C.blue}" transform="rotate(9 256 236)"/></g>
${nest({ x: 26, y: 24, w: 460, h: 460, vb: '0 0 200 200', body: emblem({ fine: false }) })}`,
});

// ---- logo --------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.white : C.night;
  const rule = dark ? C.gold : C.goldDk;
  const sub = dark ? C.goldLt : '#1b3a80';
  return svg({
    w: 640,
    h: 200,
    fonts: FONTS,
    body: `
${nest({ x: 4, y: 6, w: 188, h: 188, vb: '0 0 200 200', body: emblem({ fine: false }) })}
<text x="196" y="112" font-family="Bod" font-size="66" letter-spacing="2.2" fill="${ink}">PORCHLIGHT</text>
<path d="M199,130H622" stroke="${rule}" stroke-width="4"/>
<path d="M199,137.5H622" stroke="${rule}" stroke-width="1.2"/>
<text x="410" y="172" text-anchor="middle" font-family="DidotI" font-size="27" fill="${sub}">The light stays on.</text>`,
  });
}

// ---- hero --------------------------------------------------------------------------
function hero() {
  const S = 2.5; // the emblem's scale
  const EX = 748;
  const EY = 60;
  const cx = EX + BX * S;
  const cy = EY + BY * S;
  // the name, stacked and set to one width. Advances are Bodoni 72 Bold's at 100.
  const W = 612;
  const X0 = 88;
  const SIZE = 180;
  const word = (txt, adv, total, sx, y) => {
    const sc = SIZE / 100;
    const gap = (W - total * sc * sx) / (txt.length - 1);
    const xs = adv.map((a, i) => f(a * sc + (i * gap) / sx)).join(' ');
    return `<text transform="translate(${X0} ${y}) scale(${sx} 1)" x="${xs}" y="0" font-family="Bod" font-size="${SIZE}" fill="${C.white}">${txt}</text>`;
  };
  const stepped = (x, y, w, h, s) => {
    const x1 = x + w;
    const y1 = y + h;
    return `M${x + 2 * s},${y}H${x1 - 2 * s}V${y + s}H${x1 - s}V${y + 2 * s}H${x1}V${y1 - 2 * s}H${x1 - s}V${y1 - s}H${x1 - 2 * s}V${y1}H${x + 2 * s}V${y1 - s}H${x + s}V${y1 - 2 * s}H${x}V${y + 2 * s}H${x + s}V${y + s}H${x + 2 * s}Z`;
  };
  return `
<rect width="1280" height="640" fill="${C.night}"/>
<path d="${wedges(cx, cy, 36, 2.5, 150, 1500)}" fill="${C.navy}"/>
<path d="${stepped(22, 22, 1236, 596, 12)}" fill="none" stroke="${C.gold}" stroke-width="3.2"/>
<path d="${stepped(34, 34, 1212, 572, 12)}" fill="none" stroke="${C.goldDk}" stroke-width="1.4"/>

${word('PORCH', [0, 56.4, 127.4, 191.1, 254.7], 327.4, 0.99, 248)}
${word('LIGHT', [0, 56.4, 90, 156.4, 229.1], 287.7, 1.05, 406)}
<rect x="${X0}" y="438" width="${W}" height="7" fill="${C.gold}"/>
<rect x="${X0}" y="452" width="${W}" height="1.8" fill="${C.gold}"/>
<text x="${X0 - 2}" y="520" font-family="DidotI" font-size="57" fill="${C.goldLt}">The light stays on.</text>
<text x="${X0 + 1}" y="568" font-family="Futura" font-weight="500" font-size="16.5" letter-spacing="4.6" fill="${C.gold}">YOUR REPOS · YOUR SERVERS · YOUR COMPUTER</text>

<g transform="translate(${EX} ${EY}) scale(${S})">${emblem({ fine: true })}</g>`;
}
const heroSvg = svg({ w: 1280, h: 640, fonts: FONTS, body: hero() });

const notes = `# 58 Deco lantern

Concept 40 refined. The stepped gold arch, the wedge rays and the stacked Bodoni name stay, but the light bulb is gone: a Deco wall lantern with a stepped cap and tapered glass now hangs in the arch over a small front door, and the door is lit by it. Solid shapes throughout, so the emblem is a porch light at any size.
Palette: navy #0a1634 / #0f2150 / #1b3a80, gold #e6b450 / #f8dc8a / #a77a25, warm white #fff4d8, amber #ffc74a.
Type: Bodoni 72 Bold capitals for the name, Didot Italic for the tagline, Futura Medium capitals for the small line.
Tagline: The light stays on.
From: 40 Deco filament II
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logo(false),
  'logo-dark.svg': logo(true),
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
