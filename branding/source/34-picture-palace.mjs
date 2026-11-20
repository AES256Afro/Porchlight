// 34 Picture palace: a Deco cinema front at night. The blade sign spells the
// name in bulbs, the marquee carries it again over a readerboard with the
// tagline, and where the ticket booth would be there is a front door.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '34-picture-palace';
const C = {
  night0: '#0a2027',
  night1: '#0f2e37',
  beam: '#16414b',
  beam2: '#21565f',
  ink: '#170b10',
  deep: '#3a0d17',
  burgDk: '#58151f',
  burg: '#7c2231',
  lit: '#a33a40',
  cream: '#f6e6c3',
  gold: '#eab54d',
  hot: '#fff3c9',
  teal: '#2c8f8a',
  tealDk: '#134048',
  walk: '#211017',
  glow1: '#3d1c1e',
  glow2: '#6c3722',
  glow3: '#a9692c',
};
const FONTS = { Deco: 'Phosphate-Inline', DecoS: 'Phosphate-Solid', Block: 'Futura-CondensedExtraBold', FutB: 'Futura-Bold', FutM: 'Futura-Medium' };
const f = (n) => Math.round(n * 10) / 10;

// ---- helpers ------------------------------------------------------------------
function along(points, gap, offset = 0) {
  const out = [];
  let carry = offset;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let d = carry;
    while (d <= len) {
      const t = d / len;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      d += gap;
    }
    carry = d - len;
  }
  return out;
}
function bulbs(points, r, { socket = C.deep, lit = C.gold, hot = C.hot } = {}) {
  return points
    .map(
      ([x, y]) =>
        `${socket ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.4)}" fill="${socket}"/>` : ''}<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${lit}"/><circle cx="${f(x - r * 0.25)}" cy="${f(y - r * 0.25)}" r="${f(r * 0.45)}" fill="${hot}"/>`,
    )
    .join('');
}
function twinkle(cx, cy, s, fill) {
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + s * 0.16)},${f(cy - s * 0.16)} ${f(cx + s)},${cy}Q${f(cx + s * 0.16)},${f(cy + s * 0.16)} ${cx},${f(cy + s)}Q${f(cx - s * 0.16)},${f(cy + s * 0.16)} ${f(cx - s)},${cy}Q${f(cx - s * 0.16)},${f(cy - s * 0.16)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}
// a fan of wedge rays, upper half only
function fan(cx, cy, rays, fill) {
  return `<path d="${rays
    .map(([a, r0, r1, w]) => {
      const t = (a * Math.PI) / 180;
      const c = Math.cos(t);
      const s = Math.sin(t);
      return `M${f(cx + c * r0 - s * w * 0.35)},${f(cy + s * r0 + c * w * 0.35)}L${f(cx + c * r1 - s * w)},${f(cy + s * r1 + c * w)}L${f(cx + c * r1 + s * w)},${f(cy + s * r1 - c * w)}L${f(cx + c * r0 + s * w * 0.35)},${f(cy + s * r0 - c * w * 0.35)}Z`;
    })
    .join('')}" fill="${fill}"/>`;
}

// letters set in bulbs, 5 by 7
const DOT = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};
function dotLetter(ch, cx, y, px, py, r) {
  const pts = [];
  DOT[ch].forEach((row, j) => [...row].forEach((b, i) => b === '1' && pts.push([cx + (i - 2) * px, y + j * py])));
  return bulbs(pts, r, { socket: null });
}

// ---- mark: the blade sign with a P, ringed with bulbs ---------------------------
const BLADE_O = 'M100,9L119,26H135V43H147V150L100,191L53,150V43H65V26H81Z';
const BLADE_I = 'M100,26L113,37.5H124V54.5H136V144.5L100,176L64,144.5V54.5H76V37.5H87Z';
const BLADE_MID = [[100, 17.5], [116, 32], [129.5, 32], [129.5, 49], [141.5, 49], [141.5, 147.5], [100, 183.5], [58.5, 147.5], [58.5, 49], [70.5, 49], [70.5, 32], [84, 32], [100, 17.5]];
function markBody() {
  return `
<path d="${BLADE_O}" fill="${C.burg}" stroke="${C.cream}" stroke-width="3.5" stroke-linejoin="miter"/>
<path d="${BLADE_I}" fill="${C.deep}"/>
${bulbs(along(BLADE_MID, 12.35, 0).slice(0, -1), 2.9, { socket: C.deep })}
<text x="100.5" y="143" text-anchor="middle" font-family="Deco" font-size="108" fill="${C.cream}">P</text>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', fonts: FONTS, body: markBody() });

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { B: C.burg, D: C.deep, G: C.gold, C: C.cream };
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
  '.......BB.......',
  '.....GBBBBG.....',
  '....BBBBBBBB....',
  '...GBBBBBBBBG...',
  '...BBCCCCCBBB...',
  '...GBCCBBCCBG...',
  '...BBCCBBCCBB...',
  '...GBCCCCCBBG...',
  '...BBCCBBBBBB...',
  '...GBCCBBBBBG...',
  '...BBCCBBBBBB...',
  '...GBBBBBBBBG...',
  '....BBBBBBBB....',
  '.....GBBBBG.....',
  '......BBBB......',
  '.......GG.......',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const span = (y) => {
    if (y === 0) return [14, 17];
    if (y <= 2) return [12, 19];
    if (y <= 4) return [9, 22];
    if (y <= 24) return [6, 25];
    const k = y - 24; // V bottom
    return [6 + Math.round(k * 1.35), 25 - Math.round(k * 1.35)];
  };
  for (let y = 0; y < 32; y++) {
    const [a, b] = span(y);
    if (a > b) continue;
    for (let x = a; x <= b; x++) g[y][x] = 'B';
    // inner field
    if (y >= 6 && y <= 23) for (let x = 9; x <= 22; x++) g[y][x] = 'D';
  }
  for (let y = 24; y <= 27; y++) {
    const [a, b] = span(y);
    for (let x = a + 3; x <= b - 3; x++) g[y][x] = 'D';
  }
  // bulbs down the sides and on the steps
  for (let y = 6; y <= 24; y += 3) {
    g[y][7] = 'G';
    g[y][24] = 'G';
  }
  [[3, 10], [3, 21], [1, 13], [1, 18], [27, 11], [27, 20], [30, 15], [30, 16]].forEach(([y, x]) => (g[y][x] = 'G'));
  const P = ['CCCCCCCC..', 'CCCCCCCCC.', 'CCC...CCCC', 'CCC....CCC', 'CCC....CCC', 'CCC...CCCC', 'CCCCCCCCC.', 'CCCCCCCC..', 'CCC.......', 'CCC.......', 'CCC.......', 'CCC.......', 'CCC.......', 'CCC.......'];
  P.forEach((row, j) => [...row].forEach((ch, i) => ch === 'C' && (g[8 + j][11 + i] = 'C')));
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon -----------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  fonts: FONTS,
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="${C.night1}"/>
  <path d="M256,560L-40,0H90Z" fill="${C.beam}"/>
  <path d="M256,560L552,0H422Z" fill="${C.beam}"/>
  <path d="M256,560L150,0H362Z" fill="${C.beam}"/>
  ${twinkle(96, 150, 16, C.gold)}${twinkle(418, 118, 20, C.cream)}${twinkle(60, 330, 10, C.cream)}${twinkle(452, 312, 12, C.gold)}${twinkle(404, 420, 8, C.cream)}${twinkle(110, 432, 8, C.gold)}
  ${nest({ x: 16, y: 16, w: 480, h: 480, vb: '0 0 200 200', body: markBody() })}
</g>`,
});

// ---- logo -----------------------------------------------------------------------
const logo = (dark) =>
  svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    body: `
${nest({ x: 6, y: 6, w: 188, h: 188, vb: '0 0 200 200', body: markBody() })}
<text x="198" y="116" font-family="Deco" font-size="68" letter-spacing="1.5" fill="${dark ? C.gold : C.burg}">PORCHLIGHT</text>
<path d="M202,138H302M506,138H606" stroke="${dark ? C.cream : C.burgDk}" stroke-width="2.5"/>
${bulbs([[202, 138], [606, 138]], 3.4, { socket: dark ? C.deep : C.burgDk })}
<text x="404" y="144" text-anchor="middle" font-family="FutB" font-size="16" letter-spacing="6.5" fill="${dark ? C.cream : C.tealDk}">ON ALL NIGHT</text>`,
  });

// ---- hero -----------------------------------------------------------------------
function hero() {
  const r = rng(34);
  const GROUND = 584;
  const CX = 740;

  // sky with premiere searchlights behind the building
  const sky = `
<rect width="1280" height="640" fill="${C.night0}"/>
<rect y="330" width="1280" height="310" fill="${C.night1}"/>
<path d="M980,300L470,0H640Z" fill="${C.beam}"/>
<path d="M520,300L950,0H1120Z" fill="${C.beam}"/>
<path d="M704.5,138L745,113L816.5,155L751.5,197Z" fill="${C.beam2}"/>
<path d="M1150,360L1280,150V250Z" fill="${C.beam}"/>`;
  let stars = '';
  const big = [[56, 70, 9, C.gold], [330, 64, 7, C.cream], [420, 150, 5, C.gold], [1190, 60, 10, C.cream], [1100, 150, 6, C.gold], [1236, 300, 6, C.cream], [70, 220, 6, C.cream], [880, 40, 6, C.gold], [600, 44, 5, C.cream]];
  big.forEach(([x, y, s, c]) => (stars += twinkle(x, y, s, c)));
  for (let i = 0; i < 40; i++) {
    const x = r() * 1280;
    const y = r() * 300;
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + r())}" fill="${C.cream}" opacity="${f(0.35 + r() * 0.45)}"/>`;
  }

  // neighbours, in silhouette
  const neighbours = `
<path d="M0,372H96V340H136V${GROUND}H0Z" fill="${C.ink}"/>
<rect x="18" y="400" width="14" height="20" fill="${C.glow2}"/><rect x="62" y="446" width="14" height="20" fill="${C.glow1}"/>
<path d="M1180,300H1232V268H1280V${GROUND}H1180Z" fill="${C.ink}"/>
<path d="M1196,300V262H1220V300M1200,262L1208,250L1216,262" fill="${C.ink}"/>
<rect x="1206" y="340" width="14" height="20" fill="${C.glow1}"/><rect x="1244" y="408" width="14" height="20" fill="${C.glow2}"/>`;

  // ---- tower and blade ----
  const TX0 = 136;
  const TX1 = 300;
  const BX = 218;
  let tflutes = '';
  for (let x = TX0 + 14; x < TX1; x += 14) tflutes += `M${x},100V${GROUND}`;
  const tower = `
<path d="M${TX0},${GROUND}V96H150V78H166V60H270V78H286V96H${TX1}V${GROUND}Z" fill="${C.burg}"/>
<path d="${tflutes}" stroke="${C.burgDk}" stroke-width="3"/>
<path d="M${TX0},98H${TX1}M150,80H286M166,62H270" stroke="${C.cream}" stroke-width="4"/>`;
  const bladeO = `M${BX},28L${BX + 17},42H${BX + 32}V56H${BX + 44}V458L${BX},488L${BX - 44},458V56H${BX - 32}V42H${BX - 17}Z`;
  const bladeI = `M${BX},39L${BX + 12},49.5H${BX + 24.5}V63.5H${BX + 36.5}V453.5L${BX},478.5L${BX - 36.5},453.5V63.5H${BX - 24.5}V49.5H${BX - 12}Z`;
  let letters = '';
  [...'PORCHLIGHT'].forEach((ch, i) => (letters += dotLetter(ch, BX, 73 + i * 39.6, 6.6, 4.75, 2.3)));
  const blade = `
<path d="M${BX},28V16" stroke="${C.cream}" stroke-width="3"/>
${fan(BX, 14, [-90, -45, -135, 0, 180].map((a) => [a, 5, a === -90 ? 15 : 11, 1.6]), C.gold)}
<circle cx="${BX}" cy="14" r="4.6" fill="${C.gold}"/><circle cx="${BX - 1.2}" cy="12.8" r="2" fill="${C.hot}"/>
<path d="${bladeO}" fill="${C.teal}"/>
<path d="${bladeI}" fill="${C.deep}" stroke="${C.cream}" stroke-width="2"/>
${letters}`;

  // ---- main block ----
  const FX0 = 300;
  const FX1 = 1180;
  const block = `
<path d="M${FX0},${GROUND}V150H560V128H620V108H860V128H920V150H${FX1}V${GROUND}Z" fill="${C.burg}"/>
<path d="M${FX0},152H560V130H620V110H860V130H920V152H${FX1}" fill="none" stroke="${C.cream}" stroke-width="4"/>
<path d="M${FX0},166H${FX1}M${FX0},174H${FX1}" stroke="${C.burgDk}" stroke-width="3"/>`;
  // tall windows with stepped heads
  const win = (x) => {
    const w = 64;
    const y0 = 196;
    const y1 = 294;
    return `
<path d="M${x},${y1}V${y0 + 18}H${x + 10}V${y0 + 9}H${x + 20}V${y0}H${x + w - 20}V${y0 + 9}H${x + w - 10}V${y0 + 18}H${x + w}V${y1}Z" fill="${C.deep}"/>
<path d="M${x + 8},${y1}V${y0 + 26}H${x + 18}V${y0 + 17}H${x + 26}V${y0 + 8}H${x + w - 26}V${y0 + 17}H${x + w - 18}V${y0 + 26}H${x + w - 8}V${y1}Z" fill="${C.tealDk}"/>
<path d="M${x + w / 2},${y0 + 8}V${y1}M${x + 8},${y0 + 52}H${x + w - 8}M${x + 8},${y0 + 76}H${x + w - 8}" stroke="${C.teal}" stroke-width="2"/>
<rect x="${x - 4}" y="${y1}" width="${w + 8}" height="5" fill="${C.cream}"/>`;
  };
  let piers = '';
  [352, 458, 564, 916, 1022, 1128].forEach((x) => (piers += `<rect x="${x - 9}" y="186" width="18" height="118" fill="${C.burgDk}"/><path d="M${x - 3},186V304M${x + 3},186V304" stroke="${C.burg}" stroke-width="2"/>`));
  const upper = `${piers}${[373, 479, 937, 1043].map(win).join('')}`;
  // centre: flutes rising behind the crest
  let flutes = '';
  for (let i = -3; i <= 3; i++) flutes += `<rect x="${CX + i * 30 - 6}" y="${132 + Math.abs(i) * 18}" width="12" height="${174 - Math.abs(i) * 18}" fill="${C.burgDk}"/><rect x="${CX + i * 30 - 1.5}" y="${138 + Math.abs(i) * 18}" width="3" height="${168 - Math.abs(i) * 18}" fill="${C.deep}"/>`;

  // ---- marquee ----
  const MX0 = 380;
  const MX1 = 1100;
  const MY0 = 306;
  const MY1 = 440;
  const rays = [];
  for (let i = 0; i <= 12; i++) rays.push([-180 + i * 15, 30, i % 2 ? 62 : 84, i % 2 ? 3.2 : 4.4]);
  const crest = `
${fan(CX, MY0 - 4, rays, C.gold)}
${bulbs(rays.filter((_, i) => i % 2 === 0).map(([a, , r1]) => [CX + Math.cos((a * Math.PI) / 180) * (r1 + 7), MY0 - 4 + Math.sin((a * Math.PI) / 180) * (r1 + 7)]), 3.2, { socket: C.deep })}
<path d="M${CX - 34},${MY0 - 4}A34,34 0 0 1 ${CX + 34},${MY0 - 4}Z" fill="${C.teal}"/>
<path d="M${CX - 21},${MY0 - 4}A21,21 0 0 1 ${CX + 21},${MY0 - 4}Z" fill="${C.cream}"/>
<path d="M${CX - 110},${MY0}V${MY0 - 10}H${CX + 110}V${MY0}" fill="${C.cream}"/>`;
  const edge = [[MX0 + 9, MY0 + 9], [MX1 - 9, MY0 + 9], [MX1 - 9, MY1 - 9], [MX0 + 9, MY1 - 9], [MX0 + 9, MY0 + 9]];
  const BY0 = 386; // readerboard
  const BY1 = 428;
  const marquee = `
<path d="M${MX0 - 22},${MY1 + 8}L${MX0},${MY1}H${MX1}L${MX1 + 22},${MY1 + 8}V${MY1 + 14}H${MX0 - 22}Z" fill="${C.deep}"/>
<rect x="${MX0}" y="${MY0}" width="${MX1 - MX0}" height="${MY1 - MY0}" fill="${C.teal}"/>
<rect x="${MX0 + 18}" y="${MY0 + 18}" width="${MX1 - MX0 - 36}" height="${MY1 - MY0 - 36}" fill="${C.deep}"/>
${bulbs(along(edge, 17.15, 0).slice(0, -1), 3.7, { socket: C.tealDk })}
<text x="${CX}" y="378" text-anchor="middle" font-family="Deco" font-size="72" letter-spacing="7" fill="${C.gold}">PORCHLIGHT</text>
<rect x="${MX0 + 30}" y="${BY0}" width="${MX1 - MX0 - 60}" height="${BY1 - BY0 - 6}" fill="${C.cream}"/>
<path d="M${MX0 + 30},${BY0 + 6}H${MX1 - 30}M${MX0 + 30},${BY1 - 12}H${MX1 - 30}" stroke="#d9c69c" stroke-width="1.5"/>
<text x="${CX}" y="${BY1 - 13.5}" text-anchor="middle" font-family="Block" font-size="29" letter-spacing="9" fill="${C.ink}">ON ALL NIGHT</text>
${twinkle(CX - 190, BY0 + 18, 9, C.burg)}${twinkle(CX + 190, BY0 + 18, 9, C.burg)}
${bulbs(along([[MX0 - 8, MY1 + 11], [MX1 + 8, MY1 + 11]], 23.2, 6), 3.4, { socket: C.ink })}`;

  // ---- entrance ----
  const EY0 = MY1 + 14;
  const cinemaDoors = (x) => `
<rect x="${x - 4}" y="${EY0 + 14}" width="108" height="${GROUND - EY0 - 14}" fill="${C.deep}"/>
<rect x="${x}" y="${EY0 + 18}" width="48" height="${GROUND - EY0 - 18}" fill="${C.tealDk}"/><rect x="${x + 52}" y="${EY0 + 18}" width="48" height="${GROUND - EY0 - 18}" fill="${C.tealDk}"/>
<circle cx="${x + 24}" cy="${EY0 + 50}" r="13" fill="${C.glow3}" stroke="${C.cream}" stroke-width="3"/><circle cx="${x + 76}" cy="${EY0 + 50}" r="13" fill="${C.glow3}" stroke="${C.cream}" stroke-width="3"/>
<path d="M${x + 36},${EY0 + 78}V${EY0 + 108}M${x + 64},${EY0 + 78}V${EY0 + 108}" stroke="${C.gold}" stroke-width="4" stroke-linecap="round"/>
<path d="M${x},${GROUND - 8}H${x + 48}M${x + 52},${GROUND - 8}H${x + 100}" stroke="${C.gold}" stroke-width="3"/>`;
  const posterCase = (x, kind) => {
    const y = EY0 + 20;
    const w = 66;
    const h = 92;
    const art =
      kind === 'key'
        ? `<rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" fill="${C.tealDk}"/>
<circle cx="${x + w / 2}" cy="${y + 30}" r="11" fill="none" stroke="${C.gold}" stroke-width="5"/>
<path d="M${x + w / 2},${y + 41}V${y + 74}M${x + w / 2},${y + 60}H${x + w / 2 + 10}M${x + w / 2},${y + 70}H${x + w / 2 + 8}" stroke="${C.gold}" stroke-width="5" fill="none"/>`
        : `<rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" fill="${C.burgDk}"/>
<circle cx="${x + 46}" cy="${y + 24}" r="8" fill="${C.cream}"/>
<path d="M${x + 14},${y + 80}V${y + 54}L${x + 33},${y + 38}L${x + 52},${y + 54}V${y + 80}Z" fill="${C.gold}"/>
<rect x="${x + 28}" y="${y + 62}" width="10" height="18" fill="${C.deep}"/>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.cream}"/>${art}
<rect x="${x + 8}" y="${y + h + 5}" width="${w - 16}" height="5" fill="${C.gold}"/>`;
  };
  const DW = 70;
  const DH = 92;
  const DX = CX - DW / 2;
  const DY = GROUND - DH;
  const frontDoor = `
<path d="M${DX - 26},${GROUND}V${DY + 2}H${DX - 16}V${DY - 6}H${DX - 6}V${DY - 13}H${DX + DW + 6}V${DY - 6}H${DX + DW + 16}V${DY + 2}H${DX + DW + 26}V${GROUND}Z" fill="${C.cream}"/>
<path d="M${DX - 15},${GROUND}V${DY + 6}M${DX + DW + 15},${GROUND}V${DY + 6}" stroke="#d9c69c" stroke-width="3"/>
<rect x="${DX - 5}" y="${DY - 5}" width="${DW + 10}" height="${DH + 5}" fill="${C.ink}"/>
<rect x="${DX}" y="${DY}" width="${DW}" height="${DH}" fill="${C.teal}"/>
<path d="M${DX + 11},${DY + 30}A24,24 0 0 1 ${DX + DW - 11},${DY + 30}Z" fill="${C.hot}"/>
<path d="M${DX + DW / 2},${DY + 30}V${DY + 6}M${DX + DW / 2},${DY + 30}L${DX + 18},${DY + 13}M${DX + DW / 2},${DY + 30}L${DX + DW - 18},${DY + 13}" stroke="${C.teal}" stroke-width="3"/>
<rect x="${DX + 9}" y="${DY + 39}" width="22" height="44" fill="none" stroke="${C.tealDk}" stroke-width="3"/><rect x="${DX + 39}" y="${DY + 39}" width="22" height="44" fill="none" stroke="${C.tealDk}" stroke-width="3"/>
<rect x="${DX + 24}" y="${DY + 57}" width="22" height="6" fill="${C.gold}"/>
<circle cx="${DX + DW - 8}" cy="${DY + 64}" r="3.6" fill="${C.gold}"/>
<rect x="${DX - 12}" y="${GROUND}" width="${DW + 24}" height="7" fill="${C.gold}"/>`;
  // the porch lamp over the door, hung from the soffit
  const LY = EY0 + 12;
  const lamp = `
${fan(CX, LY + 9, [15, 50, 90, 130, 165, -20, 200].map((a) => [a, 12, 19, 1.5]), C.gold)}
<path d="M${CX},${LY}V${LY + 3}" stroke="${C.gold}" stroke-width="3"/>
<path d="M${CX - 7},${LY + 2}H${CX + 7}L${CX + 9},${LY + 6}H${CX - 9}Z" fill="${C.gold}"/>
<circle cx="${CX}" cy="${LY + 11}" r="8.5" fill="${C.hot}" stroke="${C.gold}" stroke-width="2"/>`;
  const palm = (x, flip) => {
    const s = flip ? -1 : 1;
    return `
<path d="M${x - 11},${GROUND}L${x - 14},${GROUND - 22}H${x + 14}L${x + 11},${GROUND}Z" fill="${C.gold}"/>
<rect x="${x - 16}" y="${GROUND - 26}" width="32" height="5" fill="${C.cream}"/>
<path d="M${x},${GROUND - 26}C${x - 4 * s},${GROUND - 60} ${x - 26 * s},${GROUND - 78} ${x - 34 * s},${GROUND - 70}C${x - 22 * s},${GROUND - 70} ${x - 8 * s},${GROUND - 54} ${x},${GROUND - 26}ZM${x},${GROUND - 26}C${x + 2 * s},${GROUND - 66} ${x + 18 * s},${GROUND - 90} ${x + 30 * s},${GROUND - 86}C${x + 18 * s},${GROUND - 80} ${x + 8 * s},${GROUND - 60} ${x},${GROUND - 26}ZM${x},${GROUND - 26}C${x - 2 * s},${GROUND - 70} ${x - 8 * s},${GROUND - 96} ${x - 2 * s},${GROUND - 104}C${x + 4 * s},${GROUND - 90} ${x + 4 * s},${GROUND - 60} ${x},${GROUND - 26}ZM${x},${GROUND - 26}C${x + 10 * s},${GROUND - 50} ${x + 30 * s},${GROUND - 58} ${x + 38 * s},${GROUND - 50}C${x + 26 * s},${GROUND - 52} ${x + 12 * s},${GROUND - 44} ${x},${GROUND - 26}Z" fill="${C.teal}"/>`;
  };
  const entrance = `
<rect x="${MX0 - 10}" y="${EY0}" width="${MX1 - MX0 + 20}" height="${GROUND - EY0}" fill="${C.lit}"/>
<rect x="${MX0 - 10}" y="${EY0}" width="${MX1 - MX0 + 20}" height="12" fill="${C.burg}"/>
<rect x="${FX0}" y="${GROUND - 16}" width="${MX0 - 10 - FX0}" height="16" fill="${C.burgDk}"/><rect x="${MX1 + 10}" y="${GROUND - 16}" width="${FX1 - MX1 - 10}" height="16" fill="${C.burgDk}"/>
${cinemaDoors(412)}${cinemaDoors(968)}
${posterCase(558, 'key')}${posterCase(856, 'house')}
${frontDoor}
${lamp}
${palm(662, false)}${palm(818, true)}`;

  // ---- pavement ----
  const walk = `
<rect y="${GROUND}" width="1280" height="${640 - GROUND}" fill="${C.walk}"/>
<path d="M${MX0 - 60},${GROUND}H${MX1 + 60}L${MX1 + 150},640H${MX0 - 150}Z" fill="${C.glow1}"/>
<path d="M${MX0 + 40},${GROUND}H${MX1 - 40}L${MX1},640H${MX0}Z" fill="${C.glow2}"/>
<path d="M${CX - 120},${GROUND}H${CX + 120}L${CX + 170},640H${CX - 170}Z" fill="${C.glow3}"/>
<path d="M0,618H1280" stroke="${C.ink}" stroke-width="3"/>`;
  // a cat on the pavement, looking at the door
  const cat = `<g transform="translate(-150 -112) scale(1.18)">
<path d="M846,612C836,612 832,602 836,592C838,584 844,580 846,574L844,564L850,569H857L863,564L861,575C866,582 868,592 868,600C868,608 864,612 858,612Z" fill="${C.ink}"/>
<path d="M864,608C880,610 886,600 880,592" fill="none" stroke="${C.ink}" stroke-width="4.5" stroke-linecap="round"/></g>`;

  return `
${sky}
${stars}
${neighbours}
${tower}
${block}
${flutes}
${upper}
${crest}
${entrance}
${marquee}
${blade}
${walk}
${cat}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 34 Picture palace

A Deco cinema front at night with searchlights behind it. The blade sign on the tower spells the name in bulbs, the marquee carries it again in gold inline capitals over a readerboard set with the tagline, and where the ticket booth would stand there is a front door with its own small lamp, a letterbox and a cat waiting outside. The mark is the blade sign: a stepped fin ringed with bulbs, with an inline P.
Palette: night #0a2027 / #0f2e37, burgundy #7c2231 / #58151f / #3a0d17, lit wall #a33a40, cream #f6e6c3, gold #eab54d, teal #2c8f8a / #134048, ink #170b10.
Type: Phosphate Inline for the name, Futura Condensed ExtraBold for the readerboard, Futura Bold capitals for small lines; the blade's letters are drawn in bulbs on a five-by-seven grid.
Tagline: On all night.
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
