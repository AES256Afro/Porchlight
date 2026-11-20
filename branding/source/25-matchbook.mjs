// 25 Matchbook: a mid-century matchbook cover laid flat on a colour field.
// Two inks (tomato and midnight) on cream card, the tomato plate a little off
// register. The mark is the cover's emblem: a lantern in a starburst disc.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '25-matchbook';
const C = {
  field: '#2a8a87',
  fieldLt: '#38a19c',
  fieldDk: '#1c6766',
  card: '#f5e9cd',
  cardDk: '#e0cfa6',
  tomato: '#dc4a2c',
  tomatoLt: '#f08a68',
  navy: '#152a3c',
  striker: '#3a312e',
  strikerLt: '#62554e',
  strikerDk: '#241d1b',
  kraft: '#ecdcb2',
  kraftDk: '#cbb684',
  staple: '#b4b8bc',
  stapleLt: '#e8eaec',
};
const FONTS = { FutC: 'Futura-CondensedExtraBold', FutM: 'Futura-Medium', FutB: 'Futura-Bold' };
const f = (n) => Math.round(n * 100) / 100;
const MIS = [2.6, 2.1]; // how far the tomato plate sits off the midnight one

// A tapered spike from radius r0 (half-width hw) to a point at r1.
function spike(cx, cy, deg, r0, r1, hw) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return `M${f(cx + c * r0 - s * hw)},${f(cy + s * r0 + c * hw)}L${f(cx + c * r1)},${f(cy + s * r1)}L${f(cx + c * r0 + s * hw)},${f(cy + s * r0 - c * hw)}Z`;
}

// The lantern, drawn around (100,100) in the 200 box.
function lantern({ body = C.navy, glass = C.card, flame = C.tomato } = {}) {
  return `
<rect x="97" y="56" width="6" height="9" fill="${body}"/>
<path d="M100,61L126,81H74Z" fill="${body}"/>
<rect x="72" y="80" width="56" height="6" rx="1" fill="${body}"/>
<path d="M79,86H121L114,128H86Z" fill="${body}"/>
<path d="M85.5,91H114.5L109.6,123H90.4Z" fill="${glass}"/>
<path d="M100,96C106,104 107.5,108.5 107.5,112A7.5,7.5 0 0 1 92.5,112C92.5,108.5 94,104 100,96Z" fill="${flame}"/>
<rect x="84" y="128" width="32" height="6" rx="1" fill="${body}"/>
<circle cx="100" cy="141" r="5" fill="${body}"/>`;
}

// The emblem: starburst disc and lantern. `ring` is the midnight keyline.
function markBody({ ring = C.navy, mis = MIS, disc = C.tomato } = {}) {
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const long = i % 2 === 0;
    rays += spike(100, 100, i * 22.5 - 90, long ? 45 : 47, long ? 87 : 69, long ? 5.6 : 4.2);
  }
  return `
<circle cx="${100 + mis[0]}" cy="${100 + mis[1]}" r="92" fill="${disc}"/>
<path d="${rays}" fill="${C.card}" transform="translate(${mis[0]} ${mis[1]})"/>
<circle cx="100" cy="100" r="95" fill="none" stroke="${ring}" stroke-width="4"/>
${lantern()}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody({ ring: C.card }) });

// ---- favicons, on the pixel grid ----------------------------------------------
const PIX = { R: C.tomato, C: C.card, N: C.navy };
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
  '.....RRRRRR.....',
  '...RRRRRRRRRR...',
  '..RRRRRNNRRRRR..',
  '.RRRRRNNNNRRRRR.',
  '.RRRRNNNNNNRRRR.',
  'RRRRNNNNNNNNRRRR',
  'RRRRRNCCCCNRRRRR',
  'RRRRRNCCCCNRRRRR',
  'RRRRRNCRRCNRRRRR',
  'RRRRRNCRRCNRRRRR',
  'RRRRRNCCCCNRRRRR',
  '.RRRRNNNNNNRRRR.',
  '.RRRRRRNNRRRRRR.',
  '..RRRRRNNRRRRR..',
  '...RRRRRRRRRR...',
  '.....RRRRRR.....',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const cx = 15.5;
  const cy = 15.5;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > 15.7) continue;
      g[y][x] = 'R';
      // sixteen rays: the eight long ones two pixels wide, the short ones one
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      const k = Math.round(ang / 45);
      const off = Math.abs(ang - k * 45);
      const perp = Math.sin((off * Math.PI) / 180) * d;
      if (d >= 9.6 && d <= 14.2 && perp < 1.05 - (d - 9.6) * 0.12) g[y][x] = 'C';
    }
  const L = [
    '.....NN.....',
    '....NNNN....',
    '...NNNNNN...',
    '..NNNNNNNN..',
    '.NNNNNNNNNN.',
    'NNNNNNNNNNNN',
    '.NNNNNNNNNN.',
    '.NNCCCCCCNN.',
    '.NNCCCCCCNN.',
    '..NCCRRCCN..',
    '..NCRRRRCN..',
    '..NCRRRRCN..',
    '..NNCRRCNN..',
    '..NNCCCCNN..',
    '..NNNNNNNN..',
    '...NNNNNN...',
    '.....NN.....',
    '....NNNN....',
    '.....NN.....',
  ];
  L.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') g[6 + j][10 + i] = ch; }));
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- striker strip --------------------------------------------------------------
function striker(x, y, w, h, seed, { scratches = true } = {}) {
  const r = rng(seed);
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${C.striker}"/>`;
  let d1 = '';
  let d2 = '';
  const n = Math.round((w * h) / 46);
  for (let i = 0; i < n; i++) {
    const px = x + 2 + r() * (w - 4);
    const py = y + 2 + r() * (h - 4);
    const rr = 0.5 + r() * 0.9;
    const dot = `M${f(px)},${f(py)}h${f(rr)}v${f(rr)}h-${f(rr)}Z`;
    if (r() < 0.55) d1 += dot;
    else d2 += dot;
  }
  s += `<path d="${d1}" fill="${C.strikerLt}"/><path d="${d2}" fill="${C.strikerDk}"/>`;
  if (scratches) {
    // where matches have been struck
    const sc = [
      [0.3, 0.2, 0.62, 0.34],
      [0.2, 0.52, 0.74, 0.6],
      [0.36, 0.72, 0.7, 0.84],
    ];
    s += sc
      .map(([a, b, c, d]) => `<path d="M${f(x + w * a)},${f(y + h * b)}L${f(x + w * c)},${f(y + h * d)}" stroke="${C.strikerLt}" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>`)
      .join('');
  }
  return s;
}

// ---- icon: the cover, close up ---------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="${C.card}"/>
  <rect y="412" width="512" height="100" fill="${C.striker}"/>
  ${striker(0, 412, 512, 100, 25, { scratches: false })}
  <path d="M150,440L330,470M210,476L372,452" stroke="${C.strikerLt}" stroke-width="5" stroke-linecap="round" opacity="0.8"/>
  <rect y="400" width="512" height="12" fill="${C.cardDk}"/>
  ${nest({ x: 62, y: 8, w: 388, h: 388, vb: '0 0 200 200', body: markBody({ mis: [2.2, 1.8] }) })}
</g>`,
});

// ---- logo --------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.card : C.navy;
  return svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    body: `
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 0 200 200', body: markBody({ ring: ink }) })}
<text x="207" y="125" font-family="Brush Script MT" font-size="116" fill="${C.tomato}" transform="translate(4 3.5)">Porchlight</text>
<text x="207" y="125" font-family="Brush Script MT" font-size="116" fill="${ink}">Porchlight</text>
<text x="216" y="170" font-family="FutM" font-size="15" letter-spacing="5.2" fill="${ink}">THE LIGHT STAYS ON</text>`,
  });
}

// ---- hero ---------------------------------------------------------------------------
function match(x, y, deg, { burnt = false } = {}) {
  const sil = `<path d="M0,2V120" stroke="${C.fieldDk}" stroke-width="11" stroke-linecap="butt"/><ellipse cx="0" cy="-3" rx="8.6" ry="12" fill="${C.fieldDk}"/>`;
  const stem = burnt
    ? `<path d="M0,2V120" stroke="${C.kraft}" stroke-width="10"/><path d="M0,2V46" stroke="#6a5340" stroke-width="10"/><path d="M0,2V24" stroke="#2c2422" stroke-width="10"/><path d="M-3.4,26V120" stroke="${C.kraftDk}" stroke-width="2"/>`
    : `<path d="M0,2V120" stroke="${C.kraft}" stroke-width="10"/><path d="M-3.4,6V120" stroke="${C.kraftDk}" stroke-width="2"/>`;
  const head = burnt
    ? `<path d="M-6,4C-8,-4 -4,-11 1,-12C6,-11 8,-3 5.5,4Z" fill="#1f1a19"/>`
    : `<ellipse cx="0" cy="-3" rx="8.6" ry="12" fill="${C.tomato}"/><ellipse cx="-2.8" cy="-7.5" rx="2.2" ry="3.4" fill="${C.tomatoLt}"/>`;
  return `<g transform="translate(${x + 6} ${y + 8}) rotate(${deg})">${sil}</g><g transform="translate(${x} ${y}) rotate(${deg})">${stem}${head}</g>`;
}

function twinkle(cx, cy, s, fill) {
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + s * 0.14)},${f(cy - s * 0.14)} ${f(cx + s)},${cy}Q${f(cx + s * 0.14)},${f(cy + s * 0.14)} ${cx},${f(cy + s)}Q${f(cx - s * 0.14)},${f(cy + s * 0.14)} ${f(cx - s)},${cy}Q${f(cx - s * 0.14)},${f(cy - s * 0.14)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}

function hero() {
  // the cover flat: striker flap | front | spine | back
  const X0 = 84;
  const X1 = 1196;
  const Y0 = 122;
  const Y1 = 518;
  const FOLD1 = 170;
  const FOLD2 = 750;
  const FOLD3 = 800;
  const H = Y1 - Y0;

  // tabletop pattern, barely there
  const r = rng(250);
  let pat = '';
  for (let i = 0; i < 34; i++) {
    const x = 30 + r() * 1220;
    const y = 20 + r() * 600;
    pat += r() < 0.6 ? twinkle(f(x), f(y), f(5 + r() * 7), C.fieldLt) : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(3 + r() * 3)}" fill="none" stroke="${C.fieldLt}" stroke-width="1.6"/>`;
  }

  // front: emblem, script, small line
  const FCX = (FOLD1 + FOLD2) / 2;
  const front = `
${nest({ x: FCX - 112, y: 136, w: 224, h: 224, vb: '0 0 200 200', body: markBody() })}
<g transform="rotate(-4 ${FCX} 420) translate(-6 0)">
  <text x="${FCX}" y="442" text-anchor="middle" font-family="Brush Script MT" font-size="150" fill="none" stroke="${C.card}" stroke-width="16" stroke-linejoin="round">Porchlight</text>
  <text x="${FCX}" y="442" text-anchor="middle" font-family="Brush Script MT" font-size="150" fill="none" stroke="${C.card}" stroke-width="16" stroke-linejoin="round" transform="translate(6 5)">Porchlight</text>
  <text x="${FCX}" y="442" text-anchor="middle" font-family="Brush Script MT" font-size="150" fill="${C.tomato}" transform="translate(6 5)">Porchlight</text>
  <text x="${FCX}" y="442" text-anchor="middle" font-family="Brush Script MT" font-size="150" fill="${C.navy}">Porchlight</text>
</g>
<g transform="translate(${MIS[0]} ${MIS[1]})">${twinkle(262, 196, 13, C.tomato)}${twinkle(300, 262, 7, C.tomato)}${twinkle(232, 268, 5, C.tomato)}${twinkle(650, 178, 11, C.tomato)}${twinkle(622, 246, 6, C.tomato)}${twinkle(690, 236, 5, C.tomato)}</g>
<text x="${FCX}" y="500" text-anchor="middle" font-family="FutM" font-size="12.5" letter-spacing="4.6" fill="${C.navy}">KEYS · PACKAGES · DOMAINS · THIS MAC</text>`;

  // flap: striker, staples, the line every matchbook carries
  const flap = `
${striker(96, Y0 + 14, 40, H - 28, 7)}
<rect x="104" y="${Y0 + 96}" width="24" height="5" rx="2.5" fill="${C.staple}"/><rect x="106" y="${Y0 + 96.8}" width="20" height="1.4" fill="${C.stapleLt}"/>
<rect x="104" y="${Y1 - 101}" width="24" height="5" rx="2.5" fill="${C.staple}"/><rect x="106" y="${Y1 - 100.2}" width="20" height="1.4" fill="${C.stapleLt}"/>
<text transform="translate(157 ${(Y0 + Y1) / 2}) rotate(-90)" text-anchor="middle" font-family="FutM" font-size="10.5" letter-spacing="3.6" fill="${C.navy}">CLOSE COVER BEFORE STRIKING</text>`;

  // spine
  const spine = `
<rect x="${FOLD2 + 7}" y="${Y0 + 12}" width="${FOLD3 - FOLD2 - 14}" height="${H - 24}" fill="${C.navy}"/>
<text transform="translate(${(FOLD2 + FOLD3) / 2 + 5.4} ${(Y0 + Y1) / 2}) rotate(-90)" text-anchor="middle" font-family="FutB" font-size="15" letter-spacing="9" fill="${C.card}">PORCHLIGHT</text>`;

  // back: the lamp over the door, the tagline on the ground band
  const BX0 = FOLD3 + 12;
  const BX1 = X1 - 12;
  const BY0 = Y0 + 12;
  const BY1 = Y1 - 12;
  const BCX = (BX0 + BX1) / 2;
  const GROUND = 384;
  const LX = BCX;
  const LY = 190;
  // wedges that widen outward: draw as thin triangles from the lamp
  let wedges = '';
  for (let i = 0; i < 24; i++) {
    const a0 = ((i * 15 - 90 - 2.6) * Math.PI) / 180;
    const a1 = ((i * 15 - 90 + 2.6) * Math.PI) / 180;
    const R = i % 2 === 0 ? 360 : 128;
    const r0 = 46;
    wedges += `M${f(LX + Math.cos(a0) * r0)},${f(LY + Math.sin(a0) * r0)}L${f(LX + Math.cos(a0) * R)},${f(LY + Math.sin(a0) * R)}L${f(LX + Math.cos(a1) * R)},${f(LY + Math.sin(a1) * R)}L${f(LX + Math.cos(a1) * r0)},${f(LY + Math.sin(a1) * r0)}Z`;
  }
  const DW = 92;
  const DH = 106;
  const DX = BCX - DW / 2;
  const DY = GROUND - DH;
  const back = `
<clipPath id="backclip"><rect x="${BX0}" y="${BY0}" width="${BX1 - BX0}" height="${GROUND - BY0}"/></clipPath>
<rect x="${BX0 + MIS[0]}" y="${BY0 + MIS[1]}" width="${BX1 - BX0}" height="${GROUND - BY0}" fill="${C.tomato}"/>
<g clip-path="url(#backclip)"><path d="${wedges}" fill="${C.card}" transform="translate(${MIS[0]} ${MIS[1]})"/></g>
<rect x="${BX0}" y="${GROUND}" width="${BX1 - BX0}" height="${BY1 - GROUND}" fill="${C.navy}"/>
<circle cx="${LX}" cy="${LY}" r="36" fill="${C.card}"/>
${nest({ x: LX - 46, y: LY - 47, w: 92, h: 92, vb: '50 48 100 100', body: lantern() })}
<rect x="${DX - 22}" y="${DY - 16}" width="${DW + 44}" height="7" fill="${C.card}"/>
<rect x="${DX - 8}" y="${DY - 9}" width="${DW + 16}" height="${DH + 9}" fill="${C.card}"/>
<rect x="${DX - 26}" y="${GROUND - 7}" width="${DW + 52}" height="7" fill="${C.card}"/>
<rect x="${DX}" y="${DY}" width="${DW}" height="${DH - 7}" fill="${C.navy}"/>
<rect x="${DX + 13}" y="${DY + 13}" width="14" height="14" fill="${C.card}"/>
<rect x="${DX + 39}" y="${DY + 28}" width="14" height="14" fill="${C.card}"/>
<rect x="${DX + 65}" y="${DY + 43}" width="14" height="14" fill="${C.card}"/>
<circle cx="${DX + 76}" cy="${DY + 72}" r="4.2" fill="${C.tomato}"/>
<text x="${BCX}" y="${GROUND + 52}" text-anchor="middle" font-family="FutC" font-size="50" letter-spacing="2.5" fill="${C.card}">THE LIGHT</text>
<text x="${BCX}" y="${GROUND + 102}" text-anchor="middle" font-family="FutC" font-size="50" letter-spacing="2.5" fill="${C.card}">STAYS ON.</text>`;

  const cover = `
<rect x="${X0 + 10}" y="${Y0 + 15}" width="${X1 - X0}" height="${H}" rx="9" fill="${C.fieldDk}"/>
<rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${H}" rx="9" fill="${C.card}"/>
<path d="M${FOLD1},${Y0}V${Y1}M${FOLD2},${Y0}V${Y1}M${FOLD3},${Y0}V${Y1}" stroke="${C.cardDk}" stroke-width="2"/>
${flap}
${front}
${spine}
${back}`;

  return `
<rect width="1280" height="640" fill="${C.field}"/>
${pat}
${match(1172, 46, 77)}
${match(128, 600, -99)}
${match(1028, 586, 82, { burnt: true })}
<g transform="rotate(-3 640 320)">
${cover}
</g>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 25 Matchbook

A mid-century matchbook cover laid flat on a tabletop: the lantern-in-a-starburst emblem and the script name on the front, the striker strip and its staples on the flap, the name up the spine, and on the back the lamp shining over a door with the tagline on the ground beneath. Two inks on cream card, the tomato plate printed a little off register; three loose matches, one already struck. The mark is the emblem, and the icon is the cover close up with its striker.
Palette: tomato #dc4a2c, midnight #152a3c, cream card #f5e9cd, tabletop teal #2a8a87 / #1c6766, striker #3a312e, match kraft #ecdcb2.
Type: Brush Script for the name; Futura Condensed ExtraBold capitals for the tagline; Futura Medium and Bold tracked capitals for the small lines.
Tagline: The light stays on.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'mark-dark.svg': markDarkSvg,
  'logo.svg': logo(false),
  'logo-dark.svg': logo(true),
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
