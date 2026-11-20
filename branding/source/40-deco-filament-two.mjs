// 40 Deco filament II: concept 20 taken further. The same idea, a bulb standing
// in a stepped arch with its filament bent into a house, but drawn in solid
// shapes: a lit bulb on navy, bold gold rays, a heavy frame, and a fat Bodoni
// wordmark. Nothing here is thinner than it needs to be.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '40-deco-filament-two';
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
const BY = 90;
const ARCH = 'M24,194V96H36V78H48V66A52,52 0 0 1 152,66V78H164V96H176V194Z';
const ARCH_IN = 'M33,186V105H45V87H57V66A43,43 0 0 1 143,66V87H155V105H167V186Z';
const BULB = 'M87,147C87,128 66,116 66,90A34,34 0 0 1 134,90C134,116 113,128 113,147Z';
const BULB_IN = 'M92,147C92,130 73,117 73,90A27,27 0 0 1 127,90C127,117 108,130 108,147Z';

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
  <path d="${wedges(BX, BY, 20, 3.4, 40, 190)}" fill="${pal.gold}"/>
  ${fine ? `<path d="${wedges(BX, BY, 20, 0.7, 62, 190)}" fill="${pal.goldDk}" transform="rotate(9 ${BX} ${BY})"/>` : ''}
</g>
<path d="${ARCH}" fill="none" stroke="${pal.gold}" stroke-width="8" stroke-linejoin="miter"/>
${fine ? `<path d="${ARCH_IN}" fill="none" stroke="${pal.goldDk}" stroke-width="1.6"/>` : ''}
<path d="M88,4H112L107,22H93Z" fill="${pal.goldLt}"/>
<!-- a dark ring keeps the rays off the glass -->
<path d="${BULB}" fill="${pal.navy}" stroke="${pal.navy}" stroke-width="16" stroke-linejoin="round"/>
<path d="${BULB}" fill="${pal.amber}"/>
<path d="${BULB_IN}" fill="${pal.white}"/>
<!-- the filament: a house on two lead wires, its door a keyhole -->
<path d="M90,111L95,144M110,111L105,144" stroke="${pal.navy}" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M82,111V88L100,70L118,88V111Z" fill="none" stroke="${pal.navy}" stroke-width="6" stroke-linejoin="miter"/>
<circle cx="100" cy="92.5" r="5" fill="${pal.navy}"/>
<path d="M97.4,95L94.6,109H105.4L102.6,95Z" fill="${pal.navy}"/>
<!-- cap -->
<rect x="84" y="145" width="32" height="7" fill="${pal.goldLt}"/>
<rect x="86" y="153.4" width="28" height="6" rx="3" fill="${pal.gold}"/>
<rect x="87" y="160.8" width="26" height="6" rx="3" fill="${pal.gold}"/>
<rect x="88" y="168.2" width="24" height="6" rx="3" fill="${pal.gold}"/>
<path d="M90,175.4H110L105,182H95Z" fill="${pal.goldDk}"/>
<!-- stepped plinth -->
<rect x="76" y="182" width="48" height="5" fill="${pal.goldLt}"/>
<rect x="62" y="187" width="76" height="5" fill="${pal.gold}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: emblem({ fine: false }) });

// ---- favicons on the pixel grid --------------------------------------------------
const PIX = { N: C.navy, G: C.gold, L: C.goldLt, D: C.goldDk, W: C.white, A: C.amber, B: '#0a1634' };
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
  '.GGNNNWWWWNNNGG.',
  '.GNNNWWWWWWNNNG.',
  'GGNNWWWBBWWWNNGG',
  'GNNNWWBBBBWWNNNG',
  'GNNNWWBWWBWWNNNG',
  'GNNNWWBWWBWWNNNG',
  'GNNNNWWWWWWNNNNG',
  'GNNNNNWWWWNNNNNG',
  'GNNNNNWWWWNNNNNG',
  'GNNNNNLLLLNNNNNG',
  'GNNNNNDDDDNNNNNG',
  'GNNNNNGGGGNNNNNG',
  'GNNNLLLLLLLLNNNG',
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
  for (const deg of [-146, -116, -64, -34]) ray(deg, 9.4, 17);
  // bulb
  for (let y = 4; y < 22; y++) for (let x = 6; x < 26; x++) {
    const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 13);
    if (d < 7.4) set(x, y, d < 6.2 ? 'W' : 'A');
  }
  r(12, 19, 19, 20, 'A');
  r(13, 19, 18, 21, 'W');
  // the house
  r(15, 8, 16, 8, 'N');
  r(14, 9, 17, 9, 'N');
  r(13, 10, 18, 10, 'N');
  r(12, 11, 19, 11, 'N');
  r(12, 12, 13, 17, 'N');
  r(18, 12, 19, 17, 'N');
  r(12, 17, 19, 17, 'N');
  r(14, 10, 17, 10, 'W');
  r(15, 9, 16, 9, 'W');
  r(15, 13, 16, 16, 'N');
  // cap and plinth
  r(12, 22, 19, 22, 'L');
  r(13, 23, 18, 23, 'D');
  r(13, 24, 18, 24, 'G');
  r(13, 25, 18, 25, 'D');
  r(14, 26, 17, 26, 'G');
  r(10, 27, 21, 27, 'L');
  r(6, 28, 25, 29, 'G');
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
<text x="${X0 - 2}" y="522" font-family="DidotI" font-size="57" fill="${C.goldLt}">The light stays on.</text>

<g transform="translate(${EX} ${EY}) scale(${S})">${emblem({ fine: true })}</g>`;
}
const heroSvg = svg({ w: 1280, h: 640, fonts: FONTS, body: hero() });

const notes = `# 40 Deco filament II

Concept 20 taken further: the bulb still stands in a stepped arch and its filament is still bent into a house with a keyhole for a door, but everything is drawn in solid shapes. The bulb is lit, warm white with an amber edge, on a navy field; the rays are gold wedges, not hairlines; the frame is heavy; and the name is stacked in fat Bodoni capitals. The mark is the emblem itself and holds up at favicon size.
Palette: navy #0a1634 / #0f2150 / #1b3a80, gold #e6b450 / #f8dc8a / #a77a25, warm white #fff4d8, amber #ffc74a.
Type: Bodoni 72 Bold capitals for the name, Didot Italic for the tagline.
Tagline: The light stays on.
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
