// 02 Porch steps (pixel): a small house at night, one lit porch; the light
// runs down the steps, along the path and onto the lawn.
import { Grid, drawText } from '../lib/pixel.mjs';
import { svg, writeConcept } from '../lib/svg.mjs';

const SLUG = '02-porch-steps-pixel';

function check(name, rows, w) {
  rows.forEach((r, i) => {
    if ([...r].length !== w) throw new Error(`${name} row ${i} is ${[...r].length} wide, want ${w}: "${r}"`);
  });
  return rows;
}
const glyphW = (g) => Math.max(...g.map((r) => r.length));
function drawWord(font, word, gap, paint) {
  let x = 0;
  for (const ch of word) {
    const g = font[ch];
    g.forEach((row, y) => [...row].forEach((p, i) => p !== '.' && paint(x + i, y, p)));
    x += glyphW(g) + gap;
  }
  return x - gap;
}

// ---- mark palette ------------------------------------------------------------
const M = {
  K: '#0a110d',
  i: '#232b22',
  I: '#3d4a38',
  c: '#e8973a',
  d: '#ffc861',
  e: '#ffe6a3',
  f: '#fff6d8',
  F: '#ffffff',
  T: '#f3e0b0', // trim, lit
  t: '#c4aa7c',
  u: '#7f6f52',
  R: '#b9502f', // door, lit
  r: '#8a3424',
  q: '#5c1f1a',
  Q: '#3e1513',
  G: '#7a6440', // glass catching the lamp
  g: '#1d2620',
  b: '#f0c878', // knob
  1: '#f2c477', // treads
  2: '#d79c4e',
  3: '#a8723a',
  4: '#4a3a2a', // risers (they face away from the lamp)
  5: '#2f271e',
};

// 32 x 32: lamp above the door, steps below.
const MARK = check('mark', [
  '...............KK...............',
  '..............KIiK..............',
  '.............KIiiiK.............',
  '............KKKKKKKK............',
  '............KdeffedK............',
  '............KefFFfeK............',
  '............KeffffeK............',
  '............KdeeeedK............',
  '.............KKKKKK.............',
  '...............KK...............',
  '........KKKKKKKKKKKKKKKK........',
  '.........TTTTTTTTTTTTTT.........',
  '.........TurrrrrrrrrruT.........',
  '.........TuRGGRGGRGGRuT.........',
  '.........TuRggRggRggRuT.........',
  '.........TtRRRRRRRRRRtT.........',
  '.........ttrrrrrrrrrrtt.........',
  '.........ttrQQQrrQQQrtt.........',
  '.........ttrQqqrrQqqrtt.........',
  '.........ttrQqqrrQqqrtt.........',
  '.........ttrQqqrrQqqbtt.........',
  '.........uuqQqqqqQqqquu.........',
  '.........uuqQqqqqQqqquu.........',
  '.........uuqQrrqqQrrquu.........',
  '.........uuqqqqqqqqqquu.........',
  '.........uuQQQQQQQQQQuu.........',
  '........1111111111111111........',
  '........4444444444444444........',
  '......32222222222222222223......',
  '......54444444444444444445......',
  '....533322222222222222223335....',
  '....555555555555555555555555....',
], 32);
const MARK_RAYS = [
  [7, 5, 'c'], [8, 5, 'd'], [9, 5, 'd'],
  [9, 1, 'c'], [10, 2, 'd'],
  [8, 8, 'c'], [9, 8, 'd'],
];

const FAV = check('fav', [
  '......KKKK......',
  '.....KeffeK.....',
  '.....KdFFdK.....',
  '......KKKK......',
  '...KKKKKKKKKK...',
  '...KTTTTTTTTK...',
  '...KTRRRRRRTK...',
  '...KTRGRRGRTK...',
  '...KtrrrrrrtK...',
  '...KtrqrrqrtK...',
  '...KuqqqqqbuK...',
  '...KuqqqqqquK...',
  '..K1111111111K..',
  '..K4444444444K..',
  'K22222222222222K',
  'K55555555555555K',
], 16);

function markGrid() {
  const g = new Grid(32, 32).stamp(MARK, M);
  g.outline(Object.values(M).filter((c) => c !== M.K), M.K);
  for (const [x, y, c] of MARK_RAYS) {
    g.set(x, y, M[c]);
    g.set(31 - x, y, M[c]);
  }
  return g;
}

// ---- wordmark: slab serifs, 2px strokes, cap 14, x-height 10, desc 4 -------
const SLAB = {
  P: ['########..', '#########.', '.##....###', '.##.....##', '.##.....##', '.##....###', '.########.', '.#######..', '.##.......', '.##.......', '.##.......', '.##.......', '####......', '####......'],
  o: ['', '', '', '', '..######..', '.########.', '###....###', '##......##', '##......##', '##......##', '##......##', '###....###', '.########.', '..######..'],
  r: ['', '', '', '', '###..###.', '###.#####', '.####....', '.###.....', '.##......', '.##......', '.##......', '.##......', '####.....', '####.....'],
  c: ['', '', '', '', '..######.', '.########', '###....##', '##.......', '##.......', '##.......', '##.......', '###......', '.########', '..#######'],
  h: ['###........', '###........', '.##........', '.##........', '.##.####...', '.#########.', '.###....##.', '.##.....##.', '.##.....##.', '.##.....##.', '.##.....##.', '.##.....##.', '####...####', '####...####'],
  l: ['###.', '###.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####', '####'],
  i: ['.**.', '.**.', '....', '....', '###.', '###.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####', '####'],
  g: ['', '', '', '', '..########', '.#########', '###....##.', '##.....##.', '##.....##.', '##.....##.', '##.....##.', '###....##.', '.########.', '..#######.', '.......##.', '##....###.', '.#######..', '..#####...'],
  t: ['', '.##....', '.##....', '.##....', '######.', '######.', '.##....', '.##....', '.##....', '.##....', '.##....', '.##....', '.###.##', '..####.'],
};
const GAP = 2;

function wordmark(fill, dotFill, { outline = null, shadow = null } = {}) {
  const w = new Grid(110, 22);
  const ox = 1;
  const oy = 1;
  let dot = null;
  drawWord(SLAB, 'Porchlight', GAP, (x, y, p) => {
    if (p === '*') {
      w.set(ox + x, oy + y, dotFill);
      if (!dot) dot = [ox + x, oy + y];
    } else w.set(ox + x, oy + y, fill);
  });
  if (shadow) {
    const s = new Grid(w.w, w.h);
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (w.get(x, y) === fill) s.set(x + 1, y + 1, shadow);
    s.blit(w);
    return { g: outline ? s.outline([fill, dotFill, shadow], outline) : s, dot };
  }
  if (outline) w.outline([fill, dotFill], outline);
  return { g: w, dot };
}

// ---- logo: 160 x 50 at x4 -----------------------------------------------------
function logo() {
  const g = new Grid(160, 50);
  g.blit(markGrid(), 8, 9);
  const { g: wm } = wordmark('#16241a', M.d);
  g.blit(wm, 47, 17);
  return g;
}

// ---- scene palette -------------------------------------------------------------
const S = {
  ink: '#07100a',
  sky0: '#060d09',
  sky1: '#0a150f',
  sky2: '#0f1e16',
  sky3: '#14271c',
  star: '#d6dcb8',
  starDim: '#6c7d66',
  tree0: '#040905',
  tree1: '#08120b',
  roof: '#0f1712',
  roofHi: '#1a261d',
  wall: '#1a2a1f',
  wallLn: '#111d15',
  wallHi: '#223427',
  trim: '#46584a',
  trimLo: '#2c3a30',
  trimHi: '#5b6e5d',
  door: '#3e1714',
  doorHi: '#52201a',
  doorLo: '#270d0c',
  glass: '#09130e',
  stone: '#2a2b24',
  stoneHi: '#36372d',
  stoneLo: '#171914',
  path: '#22241d',
  pathLn: '#101310',
  lawn: '#0d1b10',
  lawn2: '#122416',
  lawnDk: '#08120a',
  lawnB: '#10200f',
  bush: '#0b180e',
  bushHi: '#142619',
  lattice: '#1d2a22',
  fence: '#10190f',
  fenceHi: '#1c291e',
};
const RAMPS = {
  [S.wall]: ['#27331f', '#454526', '#74622f', '#ac863f'],
  [S.wallLn]: ['#1b2618', '#30311d', '#504524', '#76602e'],
  [S.wallHi]: ['#313d26', '#55532d', '#8a7437', '#c99d4a'],
  [S.trim]: ['#6a735f', '#9a9472', '#cdb889', '#f3dfac'],
  [S.trimLo]: ['#3e4537', '#5d5942', '#85754f', '#ad925c'],
  [S.trimHi]: ['#7f8a71', '#b3aa82', '#e2cb97', '#fff0c4'],
  [S.door]: ['#521f17', '#6e2b1b', '#923d22', '#b9542c'],
  [S.doorHi]: ['#682a1c', '#873822', '#ae4d2a', '#d66c37'],
  [S.doorLo]: ['#341210', '#481a12', '#622416', '#82321b'],
  [S.glass]: ['#111a12', '#1c2416', '#2d311b', '#433f21'],
  [S.stone]: ['#3a3727', '#5b502f', '#8d7339', '#c69c49'],
  [S.stoneHi]: ['#47422c', '#6e5e35', '#a4853f', '#e2b557'],
  [S.stoneLo]: ['#1f1e17', '#2b2619', '#3a311c', '#4c3e20'],
  [S.path]: ['#33311f', '#504628', '#7b6631', '#ab8b3e'],
  [S.pathLn]: ['#191a11', '#282515', '#3c3419', '#53461e'],
  [S.lawn]: ['#16261a', '#27371c', '#3f4b20', '#5f6526'],
  [S.lawn2]: ['#1c301d', '#31421f', '#4d5824', '#72782b'],
  [S.lawnB]: ['#192b18', '#2c3d1c', '#475421', '#687029'],
  [S.lawnDk]: ['#0f1a0f', '#1b2512', '#2b3415', '#404618'],
  [S.bush]: ['#132313', '#223316', '#38461a', '#535f20'],
  [S.bushHi]: ['#1d321e', '#33461f', '#516126', '#78852f'],
  [S.roof]: ['#192017', '#2a2c1c', '#423b22', '#5f4f28'],
  [S.roofHi]: ['#252d20', '#3a3a24', '#564b2a', '#7a6431'],
  [S.lattice]: ['#2c3426', '#47452b', '#6f6133', '#9e823e'],
  [S.fence]: ['#192316', '#2b2f19', '#433f1e', '#605322'],
  [S.fenceHi]: ['#27331f', '#434526', '#6a602e', '#97803a'],
  [S.ink]: ['#0d150c', '#181b0e', '#262311', '#383015'],
};

const LANTERN = check('lantern', [
  '..KK..',
  '.KIiK.',
  'KKKKKK',
  'KdffdK',
  'KfFFfK',
  'KeffeK',
  'KdeedK',
  '.KKKK.',
  '..KK..',
], 6);

function hero() {
  const g = new Grid(320, 160, S.sky0);
  // sky: dithered bands toward a faintly lighter horizon
  g.vgradient(0, 0, 320, 120, [
    { y: 0, c: S.sky0 },
    { y: 44, c: S.sky1 },
    { y: 86, c: S.sky2 },
    { y: 118, c: S.sky3 },
  ]);
  // stars, placed by hand clear of the type
  const stars = [[6, 8], [27, 15], [52, 6], [71, 19], [98, 9], [121, 4], [143, 16], [161, 7], [179, 24], [196, 12], [214, 4], [262, 6], [281, 15], [301, 5], [313, 22], [158, 38], [9, 92], [136, 30], [292, 34], [171, 52], [112, 96], [62, 102], [148, 88]];
  stars.forEach(([x, y], k) => g.set(x, y, k % 3 === 0 ? S.star : S.starDim));
  for (const [x, y] of [[121, 4], [214, 4]]) {
    g.set(x - 1, y, S.starDim).set(x + 1, y, S.starDim).set(x, y - 1, S.starDim).set(x, y + 1, S.starDim);
  }

  // tree line on the left (two depths), hand-placed canopies and two firs
  const back = [[4, 104, 12], [22, 100, 13], [44, 106, 10], [64, 98, 14], [92, 104, 11], [118, 100, 13], [142, 106, 12], [162, 104, 10]];
  for (const [cx, cy, r] of back) for (let y = cy - r; y <= 120; y++) for (let x = cx - r - 2; x <= cx + r + 2; x++) {
    const dx = (x - cx) / (r + 2);
    const dy = (y - cy) / r;
    if (dx * dx + dy * dy < 1 || y > cy) g.set(x, y, S.tree1);
  }
  const front = [[12, 110, 9], [34, 108, 11], [80, 110, 9], [104, 112, 8], [132, 110, 10], [158, 113, 7]];
  for (const [cx, cy, r] of front) for (let y = cy - r; y <= 120; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
    const dx = (x - cx) / (r + 1);
    const dy = (y - cy) / r;
    const bump = ((x * 7 + y * 3) % 5 === 0) ? 0.12 : 0;
    if (dx * dx + dy * dy < 1 - bump || y > cy) g.set(x, y, S.tree0);
  }
  for (const [tx, ty, h] of [[54, 78, 34], [176, 86, 28]]) {
    for (let k = 0; k < h; k++) {
      const half = Math.floor(k / 2.6) + ((k % 6) > 3 ? 1 : 0);
      g.hline(tx - half, ty + k, half * 2 + 1, S.tree0);
    }
    g.rect(tx - 1, ty + h, 3, 120 - ty - h, S.tree0);
  }

  // lawn
  g.rect(0, 118, 320, 42, S.lawn);
  // mowing stripes, widening toward us, with dithered edges
  const bands = [119, 122, 126, 131, 137, 144, 152, 161];
  for (let k = 0; k < bands.length - 1; k += 2)
    for (let y = bands[k]; y < bands[k + 1]; y++)
      for (let x = 0; x < 320; x++) {
        const edge = y === bands[k] || y === bands[k + 1] - 1;
        if (!edge || (x + y) % 2 === 0) g.set(x, y, S.lawnB);
      }
  for (let y = 118; y < 160; y++) for (let x = 0; x < 320; x++) {
    const v = (x * 131 + y * 71 + ((x * y) % 13)) % 23;
    if (v === 0) g.set(x, y, S.lawn2);
    else if (v === 7 && y > 122) g.set(x, y, S.lawnDk);
  }
  g.hline(0, 118, 320, S.lawnDk);
  // back fence on the left
  g.hline(0, 112, 180, S.fence).hline(0, 116, 180, S.fence);
  for (let x = 1; x < 180; x += 5) {
    g.vline(x, 108, 11, S.fence).vline(x + 1, 108, 11, S.fence);
    g.set(x, 107, S.fenceHi).set(x + 1, 107, S.fence);
  }

  // ---- the house (gable to the street) ----
  const AX = 238;
  // gable: wall fill inside the roof line
  for (let y = 14; y < 112; y++) {
    const half = y < 50 ? Math.floor((y - 12) * 1.6) : 58;
    const x0 = Math.max(180, AX - half);
    const x1 = Math.min(296, AX + half);
    for (let x = x0; x <= x1; x++) {
      const k = (y - 14) % 6;
      g.set(x, y, k === 0 ? S.wallHi : k === 5 ? S.wallLn : S.wall);
    }
  }
  // chimney behind the right slope
  g.rect(266, 16, 10, 26, S.roof).rect(264, 14, 14, 3, S.roofHi);
  g.vline(266, 17, 25, S.roofHi);
  // roof: barge boards along both slopes, 4 thick, with a light top edge
  for (let y = 10; y < 52; y++) {
    const half = Math.floor((y - 10) * 1.6);
    for (let t = 0; t < 5; t++) {
      g.set(AX - half - 3 + t, y, t === 0 ? S.ink : S.roof);
      g.set(AX + half + 3 - t, y, t === 0 ? S.ink : S.roof);
    }
    g.set(AX - half + 1, y, S.roofHi);
    g.set(AX + half - 1, y, S.roofHi);
  }
  g.hline(AX - 1, 9, 3, S.ink).hline(AX - 2, 10, 5, S.roof);
  // eave returns under the ends of the barge boards
  g.hline(AX - 70, 52, 12, S.roof).hline(AX - 70, 53, 12, S.ink);
  g.hline(AX + 59, 52, 12, S.roof).hline(AX + 59, 53, 12, S.ink);
  // attic window (dark, round-topped)
  g.stamp(['..KKKK..', '.KggggK.', 'KggGggGK', 'KggGggGK', 'KKKKKKKK', 'KggGggGK', 'KggggggK', 'KKKKKKKK', '.tttttt.'],
    { K: S.trimLo, g: S.glass, G: '#16211a', t: S.trim }, 234, 24);
  // foundation and lattice skirting
  g.rect(180, 108, 117, 10, S.lattice);
  for (let y = 109; y < 118; y++) for (let x = 180; x < 297; x++) if ((x + y) % 4 === 0 || (x - y + 400) % 4 === 0) g.set(x, y, S.ink);
  // windows on each side
  for (const wx of [184, 280]) {
    g.rect(wx - 2, 68, 17, 30, S.trim);
    g.hline(wx - 3, 67, 19, S.trimHi);
    g.rect(wx, 70, 13, 25, S.ink);
    g.rect(wx + 1, 71, 5, 11, S.glass).rect(wx + 7, 71, 5, 11, S.glass);
    g.rect(wx + 1, 83, 5, 11, S.glass).rect(wx + 7, 83, 5, 11, S.glass);
    g.hline(wx - 3, 97, 19, S.trimHi).hline(wx - 2, 98, 17, S.trimLo);
  }
  // porch: pediment, beam, posts, deck
  const PX0 = 200;
  const PX1 = 276;
  for (let y = 50; y <= 62; y++) {
    const half = Math.floor((y - 50) * 3.1);
    g.hline(AX - half, y, half * 2 + 1, S.roof);
    g.set(AX - half, y, S.ink).set(AX + half, y, S.ink);
    if (y > 52) g.hline(AX - half + 4, y, Math.max(0, half * 2 - 7), S.trimLo);
  }
  g.rect(PX0 - 2, 62, PX1 - PX0 + 5, 4, S.trim);
  g.hline(PX0 - 2, 62, PX1 - PX0 + 5, S.trimHi);
  g.hline(PX0 - 2, 65, PX1 - PX0 + 5, S.trimLo);
  g.rect(PX0, 66, PX1 - PX0 + 1, 2, S.wallLn); // ceiling shadow
  for (const px of [PX0 + 2, PX1 - 5]) {
    g.rect(px, 66, 4, 38, S.trim);
    g.vline(px, 66, 38, S.trimHi);
    g.vline(px + 3, 66, 38, S.trimLo);
    g.rect(px - 1, 66, 6, 2, S.trimHi);
    g.rect(px - 1, 101, 6, 3, S.trimHi);
  }
  g.rect(PX0 - 4, 104, PX1 - PX0 + 9, 4, S.trim);
  g.hline(PX0 - 4, 104, PX1 - PX0 + 9, S.trimHi);
  g.hline(PX0 - 4, 107, PX1 - PX0 + 9, S.trimLo);
  // door + casing
  g.rect(226, 74, 24, 30, S.trim);
  g.hline(225, 74, 26, S.trimHi).hline(225, 75, 26, S.trim).hline(226, 76, 24, S.trimLo);
  g.vline(226, 77, 27, S.trimHi).vline(249, 77, 27, S.trimLo);
  g.rect(230, 78, 16, 26, S.door);
  g.vline(230, 78, 26, S.doorLo).hline(230, 78, 16, S.doorLo);
  // three-light window in the door
  g.rect(232, 80, 12, 6, S.doorLo);
  for (const gx of [233, 237, 241]) g.rect(gx, 81, 3, 4, S.glass);
  // panels
  for (const px of [232, 239]) {
    g.rect(px, 88, 5, 13, S.doorLo);
    g.rect(px + 1, 89, 3, 11, S.door);
    g.hline(px, 100, 5, S.doorHi).vline(px + 4, 88, 13, S.doorHi);
  }
  // steps: treads lit from behind and above, risers in their own shadow
  const steps = [
    [108, 220, 256],
    [114, 218, 258],
    [120, 216, 260],
    [126, 214, 262],
  ];
  for (const [y, x0, x1] of steps) {
    g.hline(x0, y, x1 - x0 + 1, S.stoneHi);
    g.hline(x0, y + 1, x1 - x0 + 1, S.stone);
    g.rect(x0, y + 2, x1 - x0 + 1, 4, S.stoneLo);
    g.set(x0, y, S.ink).set(x1, y, S.ink);
    g.vline(x0, y + 1, 5, S.ink).vline(x1, y + 1, 5, S.ink);
  }
  // cheek walls of the steps
  // path: flagstones, widening toward us
  for (let y = 132; y < 160; y++) {
    const t = (y - 132) / 28;
    const x0 = Math.round(216 - t * 16);
    const x1 = Math.round(260 + t * 16);
    for (let x = x0; x <= x1; x++) g.set(x, y, S.path);
  }
  // joints of the flagstones, drawn by hand
  const joints = [
    [[216, 136, 45]], [[226, 132, 4], [244, 132, 4]],
    [[213, 141, 51]], [[230, 137, 4], [251, 137, 4], [221, 137, 4]],
    [[210, 147, 58]], [[218, 142, 5], [239, 142, 5], [258, 142, 5]],
    [[206, 154, 66]], [[227, 148, 6], [250, 148, 6], [213, 148, 6], [266, 148, 6]],
    [[221, 155, 5], [244, 155, 5], [262, 155, 5], [208, 155, 5]],
  ];
  for (const row of joints) for (const [x, y, n] of row) {
    if (n > 8) g.hline(x, y, n, S.pathLn);
    else g.vline(x, y, n, S.pathLn);
  }
  // grass creeping into the path edges
  for (let y = 132; y < 160; y += 2) {
    const t = (y - 132) / 28;
    g.set(Math.round(216 - t * 16), y, S.lawn2);
    g.set(Math.round(260 + t * 16), y + 1, S.lawn2);
  }
  // bushes either side of the steps
  const bushes = [[204, 110, 15, 9], [272, 110, 15, 9], [190, 114, 9, 6], [286, 114, 9, 6]];
  for (const [cx, cy, rx, ry] of bushes) for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const d = dx * dx + dy * dy;
    if (d < 1 && y <= 124) {
      const leaf = (x * 5 + y * 3) % 7 === 0 || (x * 3 + y * 11) % 9 === 0;
      g.set(x, y, leaf ? S.bushHi : S.bush);
    }
  }
  // mailbox on a post, left of the path
  g.rect(190, 136, 2, 16, S.fence);
  g.stamp(['.KKKKKKKK', 'KmmmmmmmK', 'KmMMMMMmK', 'KmmmmmmmK', 'KKKKKKKKK'], { K: S.ink, m: S.trimLo, M: S.trim }, 186, 130);
  g.stamp(['f', 'f', 'F'], { f: '#7a2a20', F: '#5a1d16' }, 195, 127);

  // ---- light ----
  const LX = 238;
  const LY = 72;
  const porch = Grid.pool({ cx: LX, cy: LY + 6, rx: 64, ry: 50, thresholds: [1, 0.72, 0.5, 0.3], spread: 0.1 });
  const steps2 = Grid.pool({ cx: LX, cy: 118, rx: 44, ry: 26, thresholds: [1, 0.74, 0.5, 0.3], spread: 0.12 });
  const path = Grid.pool({ cx: LX, cy: 142, rx: 52, ry: 24, thresholds: [1, 0.68, 0.42], spread: 0.14 });
  const level = (x, y) => {
    if (y < 62) return 0; // the porch roof keeps the gable dark
    let l = porch(x, y);
    if (y >= 104) l = Math.max(l, steps2(x, y));
    if (y >= 124) l = Math.max(l, path(x, y));
    // posts throw a little shade outward
    if (y > 66 && y < 104 && ((x < PX0 + 2 && x > PX0 - 14) || (x > PX1 - 2 && x < PX1 + 12))) l -= 1;
    return Math.max(0, l);
  };
  g.relight(level, RAMPS);

  // lantern under the porch beam
  g.vline(237, 66, 2, S.ink).vline(238, 66, 2, S.ink);
  g.stamp(LANTERN, M, 235, 67);
  // brass knob
  g.stamp(['bB', 'Bb'], { b: '#c08a3e', B: '#ffe3a0' }, 242, 92);
  // glints on the door glass
  g.set(234, 81, '#8a7046').set(238, 81, '#a88a52').set(242, 81, '#8a7046');
  // a moth or two
  g.stamp(['A.A', '.B.'], { A: '#eadcb8', B: '#9c8566' }, 246, 70);
  g.stamp(['A.A', '.B.'], { A: '#eadcb8', B: '#9c8566' }, 228, 64);

  // ---- type ----
  const { g: wm, dot } = wordmark('#f3e3b8', '#ffc861', { outline: S.ink, shadow: S.ink });
  const TX = 18;
  const TY = 30;
  g.blit(wm, TX - 1, TY - 1);
  if (dot) {
    const [dx, dy] = dot;
    for (const [x, y] of [[-1, 0], [-1, 1], [2, 0], [2, 1], [0, -1], [1, -1], [0, 2], [1, 2]]) g.set(TX - 1 + dx + x, TY - 1 + dy + y, '#c8822f');
  }
  const TAG = '#a3b18e';
  drawText(g, 'A light left on over', TX, 58, TAG, { shadow: S.ink });
  drawText(g, 'your own front door.', TX, 71, TAG, { shadow: S.ink });
  return g;
}

// ---- icon: 32 x 32 tile ------------------------------------------------------
function icon() {
  const g = new Grid(32, 32);
  const span = (y) => (y === 0 || y === 31 ? [3, 28] : y <= 2 || y >= 29 ? [1, 30] : [0, 31]);
  g.vgradient(0, 0, 32, 25, [{ y: 0, c: S.sky0 }, { y: 10, c: S.sky1 }, { y: 24, c: S.sky3 }]);
  for (const [x, y] of [[4, 5], [27, 4], [7, 11], [26, 10], [21, 2]]) g.set(x, y, S.starDim);
  g.set(27, 4, S.star).set(4, 5, S.star);
  g.rect(0, 24, 32, 8, S.lawn);
  for (let y = 24; y < 32; y++) for (let x = 0; x < 32; x++) if ((x * 7 + y * 5) % 11 === 0) g.set(x, y, S.lawn2);
  g.hline(0, 24, 32, S.lawnDk);
  // gable wall
  for (let y = 4; y < 24; y++) {
    const half = y < 14 ? y - 4 : 10;
    for (let x = 16 - half; x <= 15 + half; x++) if (x >= 6 && x <= 25) g.set(x, y, (y - 4) % 3 === 2 ? S.wallLn : S.wall);
  }
  // roof: moonlit edge, board, ink
  for (let y = 2; y < 15; y++) {
    const half = y - 2;
    for (const [dx, c] of [[0, S.roofHi], [1, S.roof], [2, S.ink]]) {
      g.set(15 - half - dx, y, c);
      g.set(16 + half + dx, y, c);
    }
  }
  g.hline(15, 1, 2, S.ink);
  g.set(15, 2, S.roofHi).set(16, 2, S.roofHi);
  // windows

  // door and casing
  g.rect(12, 15, 8, 9, S.trim);
  g.hline(11, 15, 10, S.trimHi);
  g.rect(13, 17, 6, 7, S.door);
  g.vline(13, 17, 7, S.doorLo);
  g.hline(14, 18, 4, S.doorHi);
  // steps and path
  g.hline(11, 24, 10, S.stoneHi).hline(11, 25, 10, S.stoneLo);
  g.hline(10, 26, 12, S.stoneHi).hline(10, 27, 12, S.stoneLo);
  g.hline(9, 28, 14, S.stoneHi).hline(9, 29, 14, S.stoneLo);
  g.hline(10, 30, 12, S.path).hline(9, 31, 14, S.path);
  const pool = Grid.pool({ cx: 16, cy: 20, rx: 9, ry: 13, thresholds: [1, 0.72, 0.5, 0.3], spread: 0.15 });
  g.relight((x, y) => (y < 13 ? 0 : pool(x, y)), RAMPS);
  // windows stay dark: unlit glass, a curtain line and a faint sill
  for (const wx of [7, 22]) {
    g.rect(wx, 15, 3, 4, S.glass);
    g.vline(wx + 1, 15, 4, '#0e1912');
    g.hline(wx - 1, 19, 5, '#1f2a1d');
  }
  // lantern over the door
  g.stamp(['.KK.', 'KefK', 'KFFK', 'KdeK', '.KK.'], M, 14, 10);
  g.set(18, 18, '#f0c878');
  // tile edge
  const out = new Grid(32, 32);
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
const files = {
  'mark.svg': svg({ w: 512, h: 512, vb: '0 0 32 32', crisp: true, body: mark.toPaths() }),
  'favicon.svg': svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: new Grid(16, 16).stamp(FAV, M).toPaths() }),
  'favicon-32.svg': svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: mark.toPaths() }),
  'logo.svg': svg({ w: 640, h: 200, vb: '0 0 160 50', crisp: true, body: logo().toPaths() }),
  'icon.svg': svg({ w: 512, h: 512, vb: '0 0 32 32', crisp: true, body: icon().toPaths() }),
  'hero.svg': svg({ w: 1280, h: 640, vb: '0 0 320 160', crisp: true, body: hero().toPaths() }),
  'notes.md': `# 02 Porch steps (pixel)

A small gable-fronted house at night with one lit porch: the lantern under the porch beam lights the red door, and its light runs down four stone steps (treads lit, risers in their own shade), along a flagstone path and onto the lawn.
Palette: moss night #060d09 / #0f1e16 / #1a2a1f, trees #040905, door #3e1714 → #b9542c, stone and light #c69c49 / #ffc861 / #fff6d8, cream type #f3e3b8, sage tagline #a3b18e.
Type: hand-drawn pixel slab serif (2px strokes, 4px block serifs); tagline in a 5px pixel face.
`,
};
writeConcept(SLUG, files);
