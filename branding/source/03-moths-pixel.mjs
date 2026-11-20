// 03 Moths (pixel): a bare bulb in a porcelain socket hanging from a
// beadboard porch ceiling, moths circling it on dotted flight paths.
import { Grid, drawText, bayer } from '../lib/pixel.mjs';
import { svg, writeConcept } from '../lib/svg.mjs';

const SLUG = '03-moths-pixel';

function check(name, rows, w) {
  rows.forEach((r, i) => {
    if ([...r].length !== w) throw new Error(`${name} row ${i} is ${[...r].length} wide, want ${w}: "${r}"`);
  });
  return rows;
}

const C = {
  K: '#0f0612',
  // porcelain
  P: '#f6ede2',
  p: '#d2c2b9',
  s: '#94798a',
  S: '#5c435c',
  // brass
  b: '#e0b462',
  B: '#8a6430',
  // glass, hot to rim
  F: '#ffffff',
  f: '#fffbe8',
  e: '#fff0b8',
  d: '#ffd87c',
  c: '#f4aa4c',
  a: '#c9773a',
  // moth
  A: '#efe4cd',
  m: '#bba58a',
  h: '#d3bfa1',
  M: '#7d6650',
  n: '#9a846c',
  t: '#bda88b',
};

// ---- bulb: hand-set silhouette, shaded from the glowing centre -----------
// glass half-widths per row (as even widths), neck at the top
function drawBulb(g, cx2, top, { socket, base, glass, hot }) {
  // cx2 = 2 * centre x (so even widths centre on a pixel boundary)
  let y = top;
  const span = (w) => [Math.round((cx2 - w) / 2), Math.round((cx2 + w) / 2) - 1];
  // socket rows: [width, shade-row] where shade-row is a string pattern
  for (const row of socket) {
    const [x0] = span(row.length);
    [...row].forEach((ch, i) => ch !== '.' && g.set(x0 + i, y, C[ch]));
    y++;
  }
  for (const row of base) {
    const [x0] = span(row.length);
    [...row].forEach((ch, i) => ch !== '.' && g.set(x0 + i, y, C[ch]));
    y++;
  }
  const gy0 = y;
  const H = glass.length;
  const cy = gy0 + H * hot;
  const maxW = Math.max(...glass);
  glass.forEach((w, k) => {
    const [x0, x1] = span(w);
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx2 / 2) / (maxW / 2);
      const dy = (y + 0.5 - cy) / (H * 0.55);
      const d = Math.sqrt(dx * dx + dy * dy) + (bayer(x, y) - 0.5) * 0.12;
      const col = d < 0.22 ? C.F : d < 0.42 ? C.f : d < 0.6 ? C.e : d < 0.76 ? C.d : d < 0.9 ? C.c : C.a;
      g.set(x, y, col);
    }
    // the rim one shade deeper, then the outline
    g.set(x0, y, C.a).set(x1, y, C.a);
    y++;
  });
  return { gy0, gy1: y - 1 };
}

const BIG_SOCKET = [
  'KKKKKKKKKK',
  'KSssssssSK',
  'KSsspssSSK',
  'KSspPpssSK',
  'KSspPppsSK',
  'KSspPppsSK',
  'KKKKKKKKKK',
  'KSspPPPppsSK',
  'KSppPPPPppSK',
  'KKKKKKKKKKKK',
];
const BIG_BASE = ['KbbbbbbK', 'KBBBBBBK', 'KbbbbbbK', 'KBbbbbBK'];
const BIG_GLASS = [8, 8, 10, 12, 14, 16, 18, 20, 20, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 20, 20, 18, 16, 14, 10, 6];

const SMALL_SOCKET = ['KKKKKKKK', 'KSspPpsK', 'KSspPpsK', 'KSspPpsK', 'KKKKKKKK', 'KSpPPpsSK'.slice(0, 8)];
const SMALL_BASE = ['KbbbbK', 'KBBBBK'];
const SMALL_GLASS = [6, 8, 10, 12, 14, 14, 14, 14, 14, 14, 12, 12, 10, 6];

// ---- moths, drawn by hand -------------------------------------------------
const MOTH_SPREAD = check('spread', [
  '...n.....n...',
  '....n...n....',
  '.....nMn.....',
  'AAAAAmMmAAAAA',
  '.AAmAAMAAmAA.',
  '..tAAhMhAAt..',
  '...hhhMhhh...',
  '....hhMhh....',
  '....h...h....',
], 13);
const MOTH_TILT = check('tilt', [
  'A.......A',
  'AA.....AA',
  'AAA...AAA',
  '.AAn.nAA.',
  '.mAAMAAm.',
  '..mhMhm..',
  '...hMh...',
], 9);
const MOTH_SMALL = check('msmall', ['A.A', '.M.'], 3);
const MOTH_SPREAD_SMALL = check('mss', ['AA.AA', '.hMh.', '..M..'], 5);
const MOTH_MARK_L = check('markL', [
  '.n...n.',
  'AAmMmAA',
  'AAmMmAA',
  '.hhMhh.',
  '..h.h..',
], 7);
const MOTH_MARK_R = check('markR', [
  'n...n..',
  '.n.n...',
  'AAmMmA.',
  'AAAMAA.',
  '.hhMhh.',
], 7);

function stamp(g, rows, x, y, flipX = false) {
  g.stamp(rows, C, x, y, { flipX });
}

// Dotted flight path along an ellipse from angle a0 to a1 (radians), with
// dots every `step` pixels; the last dots (nearest the moth) are brighter.
function flightPath(g, { cx, cy, rx, ry, a0, a1, step = 3, tilt = 0, colours, skip = () => false }) {
  const pts = [];
  const n = Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) * 2);
  let last = null;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    const x = Math.round(cx + ex * Math.cos(tilt) - ey * Math.sin(tilt));
    const y = Math.round(cy + ex * Math.sin(tilt) + ey * Math.cos(tilt));
    if (last && Math.abs(last[0] - x) + Math.abs(last[1] - y) < step) continue;
    last = [x, y];
    pts.push([x, y]);
  }
  pts.forEach(([x, y], i) => {
    if (skip(x, y)) return;
    const t = i / Math.max(1, pts.length - 1);
    const col = colours[Math.min(colours.length - 1, Math.floor(t * colours.length))];
    g.set(x, y, col);
  });
}

// ---- wordmark ------------------------------------------------------------------
// Wordmark for the hero and logo: narrow italic, 2px vertical stems and 1px
// hairline curves, drawn upright (cap rows 0-20, x-height 8-20, descender
// 21-25) and sheared one pixel every three rows, the same for every row.
const ITAL = {
  P: ['######..', '##...##.', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##...##.', '######..', '##......', '##......', '##......', '##......', '##......', '##......', '##......', '##......', '##......', '##......', '##......'],
  o: ['', '', '', '', '', '', '', '', '..####..', '.##..##.', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '.##..##.', '..####..'],
  r: ['', '', '', '', '', '', '', '', '##.###', '####..', '###...', '##....', '##....', '##....', '##....', '##....', '##....', '##....', '##....', '##....', '##....'],
  c: ['', '', '', '', '', '', '', '', '..#####', '.##....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '.##....', '..#####'],
  h: ['##......', '##......', '##......', '##......', '##......', '##......', '##......', '##......', '##.###..', '###..##.', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##'],
  l: ['##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '.##'],
  i: ['', '', '', '', '', '', '', '', '##', '##', '##', '##', '##', '##', '##', '##', '##', '##', '##', '##', '##'],
  g: ['', '', '', '', '', '', '', '', '..######', '.##...##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '.##...##', '..######', '......##', '......##', '......##', '.##..##.', '..####..'],
  t: ['', '', '', '.##..', '.##..', '.##..', '.##..', '.##..', '#####', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '..###'],
};
const ITAL_GAP = 2;
const shear3 = (y) => Math.floor((25 - y) / 3);

// Returns a grid with the wordmark and where the i's moth goes.
function thinWordmark(fill) {
  const g = new Grid(110, 28);
  let x = 0;
  let iPos = null;
  for (const ch of 'Porchlight') {
    const gl = ITAL[ch];
    const w = Math.max(...gl.map((r) => r.length));
    gl.forEach((row, y) => [...row].forEach((p, i) => p === '#' && g.set(x + i + shear3(y), y + 1, fill)));
    if (ch === 'i') iPos = [x + shear3(4), 3]; // moth centred over the stem, rows 3-5
    x += w + ITAL_GAP;
  }
  return { g, iPos, width: x - ITAL_GAP + shear3(0) };
}

// ---- scene palette -----------------------------------------------------------
const S = {
  ink: '#0f0612',
  n0: '#130918',
  n1: '#1a0d1f',
  n2: '#221228',
  n3: '#2b1731',
  star: '#c8b6cc',
  starDim: '#6e5576',
  tree: '#0c040e',
  yard: '#110714',
  ceil: '#2b1730',
  ceilLn: '#190b1d',
  ceilHi: '#3a2140',
  beam: '#2f1934',
  beamHi: '#43264a',
  beamLo: '#1c0d21',
  rail: '#29152f',
  railHi: '#3c2243',
  railLo: '#160a1a',
  cord: '#3e2a2c',
  cord2: '#5c4038',
};
const RAMPS = {
  [S.ceil]: ['#3b2234', '#56303a', '#7d4740', '#a8634a'],
  [S.ceilLn]: ['#25132a', '#3a1d30', '#552a34', '#73393a'],
  [S.ceilHi]: ['#4a2c44', '#6a3e46', '#93594c', '#c27a58'],
  [S.beam]: ['#40243a', '#5e343e', '#875044', '#b46d4e'],
  [S.beamHi]: ['#55314e', '#7a4650', '#a8664f', '#d98c5c'],
  [S.beamLo]: ['#2a1529', '#3d1f2c', '#572c30', '#763c34'],
  [S.rail]: ['#381f36', '#53303a', '#7b4a40', '#a8684a'],
  [S.railHi]: ['#4d2c48', '#704250', '#9c6050', '#cf855a'],
  [S.railLo]: ['#1f0f20', '#2d1724', '#422228', '#5c302c'],
  [S.n0]: ['#1a0d1f', '#22122a', '#2b172f', '#331c33'],
  [S.n1]: ['#22122a', '#2b1730', '#351c34', '#402236'],
  [S.n2]: ['#2a172f', '#341c34', '#402237', '#4d293a'],
  [S.n3]: ['#33203a', '#3e2538', '#4b2b3b', '#5a333e'],
  [S.yard]: ['#1a0d1b', '#24131f', '#311a24', '#40222a'],
  [S.tree]: ['#140913', '#1d0e17', '#28131b', '#35191f'],
  [S.star]: [S.star, S.star, S.star, S.star],
};

function hero() {
  const g = new Grid(320, 160, S.n0);
  g.vgradient(0, 0, 320, 132, [
    { y: 18, c: S.n0 },
    { y: 60, c: S.n1 },
    { y: 104, c: S.n2 },
    { y: 128, c: S.n3 },
  ]);
  for (const [x, y, k] of [[196, 34, 1], [231, 29, 0], [262, 38, 1], [289, 31, 1], [176, 106, 1], [248, 110, 0], [298, 102, 1], [158, 30, 1], [214, 112, 1], [140, 114, 1], [30, 104, 1], [9, 96, 1]]) g.set(x, y, k ? S.starDim : S.star);
  // far trees and the yard
  const tops = [];
  for (let x = 0; x < 320; x++) {
    const h = 118 + Math.round(3 * Math.sin(x / 9) + 2 * Math.sin(x / 4.3 + 1) + 4 * Math.sin(x / 31 + 2));
    tops.push(h);
    g.vline(x, h, 132 - h, S.tree);
  }
  g.rect(0, 130, 320, 30, S.yard);

  // ceiling: beadboard running away from us, converging on the far beam
  g.rect(0, 0, 320, 21, S.ceil);
  const VP = 150;
  for (let k = -6; k < 40; k++) {
    const xt = k * 11;
    const xb = Math.round(VP + (xt - VP) * 0.78);
    for (let y = 0; y < 21; y++) {
      const x = Math.round(xt + ((xb - xt) * y) / 20);
      g.set(x, y, S.ceilLn);
      g.set(x + 1, y, S.ceilHi);
    }
  }
  // beam across the front of the porch
  g.rect(0, 21, 320, 8, S.beam);
  g.hline(0, 21, 320, S.beamLo);
  g.hline(0, 22, 320, S.beamHi);
  g.hline(0, 28, 320, S.beamLo);
  // posts
  for (const [px, w] of [[0, 9], [306, 14]]) {
    g.rect(px, 29, w, 131, S.beam);
    g.vline(px + (px === 0 ? w - 2 : 1), 29, 131, S.beamHi);
    g.vline(px + (px === 0 ? w - 1 : 0), 29, 131, S.beamLo);
    g.rect(px, 29, w, 3, S.beamHi);
  }
  // railing
  g.rect(9, 122, 297, 4, S.rail);
  g.hline(9, 122, 297, S.railHi);
  g.hline(9, 125, 297, S.railLo);
  for (let x = 13; x < 304; x += 9) {
    g.rect(x, 126, 3, 28, S.rail);
    g.vline(x, 126, 28, S.railHi);
    g.vline(x + 2, 126, 28, S.railLo);
  }
  g.rect(9, 152, 297, 3, S.rail);
  g.hline(9, 152, 297, S.railHi);
  g.rect(0, 155, 320, 5, S.beamLo);
  g.hline(0, 155, 320, S.beam);

  // light
  const BX = 84;
  const BY = 62;
  const halo = Grid.pool({ cx: BX, cy: BY, rx: 92, ry: 80, thresholds: [1, 0.72, 0.5, 0.32], spread: 0.08 });
  g.relight(halo, RAMPS);

  // ceiling rose, cord (twisted cloth), bulb
  g.stamp(['..KKKKKK..', '.KspPPpsK.', 'KKKKKKKKKK'], C, BX - 5, 8);
  for (let y = 11; y < 34; y++) {
    g.set(BX - 1, y, (y % 3 === 0) ? S.cord2 : S.cord);
    g.set(BX, y, (y % 3 === 1) ? S.cord2 : S.cord);
  }
  drawBulb(g, BX * 2, 34, { socket: BIG_SOCKET, base: BIG_BASE, glass: BIG_GLASS, hot: 0.62 });
  // outline the glass
  const bulbCols = [C.F, C.f, C.e, C.d, C.c, C.a];
  g.outline(bulbCols, C.K, { onto: Object.values(S).concat(Object.values(RAMPS).flat()) });

  // flight paths, then moths at their heads
  const dots = ['#4a2c4c', '#6b4258', '#94606a', '#c48a7a'];
  const dotSkip = (x, y) => {
    const c = g.get(x, y);
    return bulbCols.includes(c) || c === C.K;
  };
  flightPath(g, { cx: BX, cy: BY + 4, rx: 36, ry: 13, a0: 3.6, a1: 3.6 + 4.4, tilt: -0.18, colours: dots, skip: dotSkip });
  flightPath(g, { cx: BX + 2, cy: BY - 2, rx: 54, ry: 26, a0: 0.4, a1: 0.4 + 3.9, tilt: 0.12, step: 4, colours: dots, skip: dotSkip });
  flightPath(g, { cx: BX - 4, cy: BY + 10, rx: 26, ry: 30, a0: -1.0, a1: -1.0 + 3.4, tilt: 0.5, colours: dots, skip: dotSkip });
  // where the paths end
  const end = (cx, cy, rx, ry, a, tilt) => {
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    return [Math.round(cx + ex * Math.cos(tilt) - ey * Math.sin(tilt)), Math.round(cy + ex * Math.sin(tilt) + ey * Math.cos(tilt))];
  };
  const [m1x, m1y] = end(BX, BY + 4, 36, 13, 3.6 + 4.4, -0.18);
  stamp(g, MOTH_SPREAD, m1x - 6, m1y - 4);
  const [m2x, m2y] = end(BX + 2, BY - 2, 54, 26, 0.4 + 3.9, 0.12);
  stamp(g, MOTH_TILT, m2x - 4, m2y - 3);
  const [m3x, m3y] = end(BX - 4, BY + 10, 26, 30, -1.0 + 3.4, 0.5);
  stamp(g, MOTH_TILT, m3x - 4, m3y - 3);
  stamp(g, MOTH_SMALL, 128, 44);
  stamp(g, MOTH_SMALL, 52, 34);
  stamp(g, MOTH_SMALL, 118, 96);

  // type
  const { g: wm, iPos } = thinWordmark('#f7ead2');
  const TX = 166;
  const TY = 44;
  g.blit(wm, TX, TY);
  stamp(g, MOTH_SPREAD_SMALL, TX + iPos[0] - 1, TY + iPos[1]);
  const TAG = '#c0a5c4';
  drawText(g, 'A light left on over', TX + 2, 84, TAG);
  drawText(g, 'your own front door.', TX + 2, 96, TAG);
  return g;
}

// ---- mark ------------------------------------------------------------------
function markGrid() {
  const g = new Grid(32, 32);
  drawBulb(g, 32, 0, { socket: SMALL_SOCKET, base: SMALL_BASE, glass: SMALL_GLASS, hot: 0.55 });
  const bulbCols = [C.F, C.f, C.e, C.d, C.c, C.a];
  g.outline(bulbCols, C.K);
  // a dotted orbit passing behind the bulb
  const dots = ['#a66f62', '#c4866f', '#dca07c'];
  flightPath(g, { cx: 16, cy: 15, rx: 15, ry: 6, a0: 0.15, a1: 0.15 + 2.9, tilt: -0.3, colours: dots, skip: (x, y) => g.get(x, y) != null });
  g.stamp(MOTH_MARK_L, C, 0, 13);
  g.stamp(MOTH_MARK_R, C, 24, 3);
  return g;
}

const FAV = check('fav', [
  '................',
  '.....KKKKKK.....',
  '.....KSpPpK.....',
  '.....KSpPpK..A.A',
  '......KbbK....M.',
  '.....KcddcK.....',
  '....KcdeedcK....',
  '...KcdeffedcK...',
  '...KdefFFfedK...',
  '...KdefFFfedK...',
  'A.AKcdeffedcK...',
  '.M..KcdeedcK....',
  '.....KaccaK.....',
  '......KKKK......',
  '................',
  '................',
], 16);

function logo() {
  const g = new Grid(160, 50);
  g.blit(markGrid(), 12, 9);
  const { g: wm, iPos } = thinWordmark('#2a1530');
  const X = 52;
  const Y = 12;
  g.blit(wm, X, Y);
  g.stamp(MOTH_SPREAD_SMALL, { A: '#d08a4a', h: '#a8683a', M: '#2a1530' }, X + iPos[0] - 1, Y + iPos[1]);
  return g;
}

function icon() {
  const g = new Grid(32, 32, S.n0);
  g.vgradient(0, 0, 32, 32, [{ y: 0, c: S.n0 }, { y: 16, c: S.n1 }, { y: 31, c: S.n2 }]);
  // ceiling strip
  g.rect(0, 0, 32, 3, S.ceil);
  for (let x = 1; x < 32; x += 4) g.vline(x, 0, 3, S.ceilLn).vline(x + 1, 0, 3, S.ceilHi);
  g.hline(0, 3, 32, S.beamLo);
  const halo = Grid.pool({ cx: 16, cy: 15, rx: 17, ry: 16, thresholds: [1, 0.72, 0.5, 0.3], spread: 0.12 });
  g.relight(halo, RAMPS);
  // cord + compact bulb
  g.vline(15, 4, 2, S.cord).vline(16, 4, 2, S.cord2);
  drawBulb(g, 32, 6, { socket: ['KKKKKK', 'KSpPsK', 'KKKKKK'], base: ['KbbK'], glass: [4, 6, 8, 10, 10, 10, 10, 10, 8, 6, 4], hot: 0.5 });
  g.outline([C.F, C.f, C.e, C.d, C.c, C.a], C.K, { onto: Object.values(S).concat(Object.values(RAMPS).flat()) });
  const dots = ['#5a3858', '#7d4f64', '#a86a6e'];
  flightPath(g, { cx: 16, cy: 17, rx: 12, ry: 5, a0: 0.1, a1: 0.1 + 3.6, tilt: -0.25, colours: dots, skip: (x, y) => [C.F, C.f, C.e, C.d, C.c, C.a, C.K].includes(g.get(x, y)) });
  g.stamp(MOTH_MARK_L, C, 1, 15);
  g.stamp(['A.A', '.M.'], C, 23, 7);
  // tile edge
  const out = new Grid(32, 32);
  const span = (y) => (y === 0 || y === 31 ? [3, 28] : y <= 2 || y >= 29 ? [1, 30] : [0, 31]);
  for (let y = 0; y < 32; y++) {
    const [a, b] = span(y);
    for (let x = a; x <= b; x++) out.set(x, y, g.get(x, y));
    out.set(a, y, S.ink).set(b, y, S.ink);
  }
  out.hline(3, 0, 26, S.ink).hline(3, 31, 26, S.ink);
  for (const [x, y] of [[1, 1], [2, 1], [29, 1], [30, 1], [1, 30], [2, 30], [29, 30], [30, 30]]) out.set(x, y, S.ink);
  return out;
}

const mark = markGrid();
writeConcept(SLUG, {
  'mark.svg': svg({ w: 512, h: 512, vb: '0 0 32 32', crisp: true, body: mark.toPaths() }),
  'favicon.svg': svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: new Grid(16, 16).stamp(FAV, C).toPaths() }),
  'favicon-32.svg': svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: mark.toPaths() }),
  'logo.svg': svg({ w: 640, h: 200, vb: '0 0 160 50', crisp: true, body: logo().toPaths() }),
  'icon.svg': svg({ w: 512, h: 512, vb: '0 0 32 32', crisp: true, body: icon().toPaths() }),
  'hero.svg': svg({ w: 1280, h: 640, vb: '0 0 320 160', crisp: true, body: hero().toPaths() }),
  'notes.md': `# 03 Moths (pixel)

A bare bulb in a porcelain pendant socket hangs from a beadboard porch ceiling; moths circle it on dotted flight paths, and a small moth sits where the i's dot would be. Looking out past the railing into a plum night.
Palette: aubergine night #130918 / #221228 / #2b1731, beadboard #2b1730 lit to #a8634a, porcelain #f6ede2 / #94798a, glass #ffffff / #fff0b8 / #ffd87c / #f4aa4c, moth wings #efe4cd / #bba58a, flight dots #6b4258 → #c48a7a.
Type: hand-drawn narrow pixel italic, 2px stems and 1px hairline curves, sheared one pixel every three rows; tagline in a 5px pixel face.
`,
});
