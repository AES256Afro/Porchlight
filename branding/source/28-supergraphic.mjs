// 28 Supergraphic: on cream, a band of four stripes runs in from the left as
// the path to the door, turns up, and arches over it. The light sits at the
// centre the stripes are drawn round, so they read as its rings.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '28-supergraphic';
const C = {
  cream: '#f6ecd6',
  creamDk: '#eadcbd',
  teal: '#2a7f86',
  tomato: '#dc4b2c',
  orange: '#f0862d',
  mustard: '#f4b942',
  navy: '#17303f',
  navyLt: '#234a5c',
  hot: '#fff8de',
};
const FONTS = { FutM: 'Futura-Medium' };
const f = (n) => Math.round(n * 100) / 100;
const BANDS = [C.teal, C.tomato, C.orange, C.mustard]; // outermost first

// ---- mark: the arch on its own (200 box) -----------------------------------------
function arch(cx, cy, rOut, t, base, { door = C.navy, light = true } = {}) {
  let out = '';
  BANDS.forEach((col, i) => {
    const r = rOut - i * t - t / 2;
    out += `<path d="M${f(cx - r)},${base}V${cy}A${f(r)},${f(r)} 0 0 1 ${f(cx + r)},${cy}V${base}" fill="none" stroke="${col}" stroke-width="${f(t + 0.4)}"/>`;
  });
  const rin = rOut - BANDS.length * t;
  out += `<path d="M${f(cx - rin)},${base}V${cy}A${f(rin)},${f(rin)} 0 0 1 ${f(cx + rin)},${cy}V${base}Z" fill="${door}"/>`;
  if (light) {
    out += `<circle cx="${cx}" cy="${cy}" r="${f(rin * 0.58)}" fill="none" stroke="${C.mustard}" stroke-width="${f(rin * 0.085)}"/><circle cx="${cx}" cy="${cy}" r="${f(rin * 0.36)}" fill="${C.hot}"/>`;
  }
  return out;
}
const markBody = () => arch(100, 100, 82, 13, 186);
const markSvg = svg({ w: 512, h: 512, vb: '0 2 200 200', body: markBody() });

// ---- favicons, on the pixel grid ------------------------------------------------------
const PIX = { G: C.teal, T: C.tomato, O: C.orange, M: C.mustard, N: C.navy, H: C.hot };
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
  '..GGGGGGGGGGGG..',
  '.GGGTTTTTTTTGGG.',
  'GGGTTTTTTTTTTGGG',
  'GGTTTOOOOOOTTTGG',
  'GGTTOOMMMMOOTTGG',
  'GGTTOMMNNMMOTTGG',
  'GGTTOMNHHNMOTTGG',
  'GGTTOMNHHNMOTTGG',
  'GGTTOMNNNNMOTTGG',
  'GGTTOMNNNNMOTTGG',
  'GGTTOMNNNNMOTTGG',
  'GGTTOMNNNNMOTTGG',
  'GGTTOMNNNNMOTTGG',
  'GGTTOMNNNNMOTTGG',
  'GGTTOMNNNNMOTTGG',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const cx = 15.5;
  const cy = 15.5;
  const edges = [16, 13, 10, 7, 4.2]; // outer radius of teal, tomato, orange, mustard, door
  const keys = ['G', 'T', 'O', 'M', 'N'];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = y <= cy ? Math.hypot(x - cx, y - cy) : Math.abs(x - cx);
      keys.forEach((k, i) => { if (d <= edges[i] + 0.05) g[y][x] = k; });
      const dl = Math.hypot(x - cx, y - (cy + 1));
      if (dl <= 2.3) g[y][x] = 'H';
    }
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon: the doorway, rising from the bottom edge --------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="${C.cream}"/>
  ${arch(256, 262, 178, 29, 520)}
</g>`,
});

// ---- wordmark: Arial Rounded, fattened with a stroke of its own colour ----------------------
function word(x, y, size, fill) {
  return `<text x="${x}" y="${y}" font-family="Arial Rounded MT Bold" font-size="${size}" letter-spacing="${f(size * 0.062)}" fill="${fill}" stroke="${fill}" stroke-width="${f(size * 0.105)}" stroke-linejoin="round">porchlight</text>`;
}
function logo(dark) {
  const ink = dark ? C.cream : C.navy;
  return svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    body: `
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 2 200 200', body: arch(100, 100, 82, 13, 186, { door: dark ? '#0f2531' : C.navy }) })}
${word(210, 114, 70, ink)}
<text x="208" y="162" font-family="FutM" font-size="14.5" letter-spacing="4.6" fill="${ink}">LOOK AFTER YOUR OWN HOUSE</text>`,
  });
}

// ---- hero -------------------------------------------------------------------------------------
function hero() {
  const t = 18; // one stripe
  const T = 430; // top of the band where it runs level
  const B = T + BANDS.length * t; // its foot, and the floor
  const R0 = 24; // tightest turn
  const AX = 1004; // arch centre
  const CY = 284; // springing line
  const RIN = 74;
  const ROUT = RIN + BANDS.length * t;
  const FX = AX - ROUT - R0;
  const FY = T - R0;

  let band = '';
  BANDS.forEach((col, i) => {
    const c = i * t + t / 2;
    band += `<path d="M-20,${T + c}H${FX}A${R0 + c},${R0 + c} 0 0 0 ${FX + R0 + c},${FY}V${CY}A${ROUT - c},${ROUT - c} 0 0 1 ${AX + ROUT - c},${CY}V${B}" fill="none" stroke="${col}" stroke-width="${t + 0.5}"/>`;
  });

  const door = `
<path d="M${AX - RIN},${B}V${CY}A${RIN},${RIN} 0 0 1 ${AX + RIN},${CY}V${B}Z" fill="${C.navy}"/>
<path d="M${AX - RIN + 16},${B}V${CY + 86}H${AX + RIN - 16}V${B}" fill="none" stroke="${C.navyLt}" stroke-width="3"/>
<path d="M${AX},${CY + 86}V${B}" stroke="${C.navyLt}" stroke-width="3"/>
<circle cx="${AX}" cy="${CY}" r="43" fill="none" stroke="${C.mustard}" stroke-width="6"/>
<circle cx="${AX}" cy="${CY}" r="27" fill="${C.hot}"/>
<rect x="${AX + 12}" y="${CY + 132}" width="7" height="34" rx="3.5" fill="${C.mustard}"/>
<rect x="${AX - RIN}" y="${B - 0.5}" width="${1290 - AX + RIN}" height="5" fill="${C.navy}"/>`;

  // a snake plant in a pot, by the door
  const PX = 1212;
  const leaves = [
    [-22, -6, -30, -92, C.teal],
    [-9, -4, -8, -128, C.navy],
    [6, -4, 10, -104, C.teal],
    [18, -6, 34, -74, C.navy],
  ]
    .map(([bx, by, tx, ty, col]) => `<path d="M${PX + bx - 8},${B - 44 + by}Q${PX + (bx + tx) / 2 - 12},${B - 44 + (by + ty) / 2} ${PX + tx},${B - 44 + ty}Q${PX + (bx + tx) / 2 + 12},${B - 44 + (by + ty) / 2} ${PX + bx + 8},${B - 44 + by}Z" fill="${col}"/>`)
    .join('');
  const plant = `
${leaves}
<path d="M${PX - 30},${B - 48}H${PX + 30}L${PX + 23},${B}H${PX - 23}Z" fill="${C.tomato}"/>
<rect x="${PX - 33}" y="${B - 52}" width="66" height="11" rx="2" fill="${C.tomato}"/>
<rect x="${PX - 33}" y="${B - 41}" width="66" height="3" fill="#b93a20"/>`;

  return `
<rect width="1280" height="640" fill="${C.cream}"/>
${band}
${door}
${plant}
<text x="80" y="196" font-family="FutM" font-size="15.5" letter-spacing="5.6" fill="${C.teal}">YOUR CODE · YOUR DOMAINS · YOUR MAC</text>
${word(82, 350, 122, C.navy)}
<text x="80" y="572" font-family="FutM" font-size="36" letter-spacing="0.4" fill="${C.navy}">Look after your own house.</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 28 Supergraphic

A 1970s wall supergraphic, on cream: a band of four stripes runs in from the left as the path to the door, turns up beside it and arches over it. The light is the round window at the centre the stripes are drawn round, so they read as its rings, the brightest nearest the lamp. The mark is the arch on its own: the door, its light and the four rings. The companion to 27 for a light page, and the cleaner of the two.
Palette: cream #f6ecd6, teal #2a7f86, tomato #dc4b2c, orange #f0862d, mustard #f4b942, navy #17303f, lamp white #fff8de.
Type: Arial Rounded Bold in lower case, fattened with its own outline, for the name; Futura Medium for the tagline and the small tracked capitals.
Tagline: Look after your own house.
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
