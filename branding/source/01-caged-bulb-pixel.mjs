// 01 Caged bulb (pixel): a jelly-jar porch light in a wire cage, beside the
// front door, on navy clapboard at night.
import { Grid, drawText, measureText } from '../lib/pixel.mjs';
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '01-caged-bulb-pixel';

function check(name, rows, w) {
  rows.forEach((r, i) => {
    if ([...r].length !== w) throw new Error(`${name} row ${i} is ${[...r].length} wide, want ${w}: "${r}"`);
  });
  return rows;
}

// Lamp palette
const L = {
  K: '#0a0c12', // iron outline
  i: '#262b3b', // iron
  I: '#3d4459', // iron light
  h: '#6b7594', // iron highlight (moonlight)
  w: '#8a5a2e', // iron lit by the bulb
  a: '#7a3a14', // glass, deep
  b: '#c0612a',
  c: '#ea943a',
  d: '#ffc35c',
  e: '#ffe4a0',
  f: '#fff7de',
  F: '#ffffff', // filament
};

// 32 x 32 caged jelly-jar lamp (the mark).
const LAMP32 = check('lamp32', [
  '................................',
  '..............KKKK..............',
  '.............KiIhiK.............',
  '..............KIiK..............',
  '...........KIhhIIiiiK...........',
  '.........KIhhIIIIiiiiiK.........',
  '........KIhIIIIIIiiiiiiK........',
  '.......KIIIIIIIiiiiiiiiiK.......',
  '......KiiiiiiiiiiiiiiiiiiK......',
  '......KwwwwwwwwwwwwwwwwwwK......',
  '.......KaabKbcwwwwcbKbaaK.......',
  '.......KabbKcdwwwwdcKbbaK.......',
  '......KKKKKKKKKKKKKKKKKKKK......',
  '.......KabbKcddeeddcKbbaK.......',
  '.......KbccKcdeffedcKccbK.......',
  '.......KbccKdeffffedKccbK.......',
  '.......KbccKdefFFfedKccbK.......',
  '.......KbccKdeffffedKccbK.......',
  '.......KbccKcdeffedcKccbK.......',
  '.......KabbKccdeedccKbbaK.......',
  '.......KabbKccddddccKbbaK.......',
  '.......KabbKccddddccKbbaK.......',
  '......KKKKKKKKKKKKKKKKKKKK......',
  '.......KabbKbccccccbKbbaK.......',
  '........KabKbbccccbbKbaK........',
  '.........KaKabbbbbbaKaK.........',
  '..........KwwwwwwwwwwK..........',
  '...........KiiiiiiiiK...........',
  '.............KiiiiK.............',
  '..............KIiK..............',
  '...............KK...............',
  '................................',
], 32);

// Short rays, hand placed (2:1 steps and a level dash), mirrored.
const RAYS = [
  [1, 10, 'c'], [2, 10, 'd'], [3, 11, 'd'], [4, 11, 'c'],
  [1, 17, 'c'], [2, 17, 'd'], [3, 17, 'd'],
  [1, 24, 'c'], [2, 24, 'd'], [3, 23, 'd'], [4, 23, 'c'],
];

// 20-row lamp for the icon.
const LAMP20 = check('lamp20', [
  '......KKKK......',
  '.....KIhiiK.....',
  '....KIhIiiiK....',
  '...KIIIIiiiiK...',
  '..KiiiiiiiiiiK..',
  '..KwwwwwwwwwwK..',
  '...KaKbwwbKaK...',
  '..KKKKKKKKKKKK..',
  '...KbKdeedKbK...',
  '...KcKeffeKcK...',
  '...KcKfFFfKcK...',
  '...KcKeffeKcK...',
  '...KbKdeedKbK...',
  '...KbKcddcKbK...',
  '..KKKKKKKKKKKK..',
  '...KaKbccbKaK...',
  '....KKbbbbKK....',
  '.....KwwwwK.....',
  '......KiiK......',
  '.......KK.......',
], 16);

// 16 x 16 favicon: the same lamp, redrawn for the tab.
const FAV16 = check('fav16', [
  '................',
  '......KKKK......',
  '.....KIhiiK.....',
  '....KIIiiiiK....',
  '...KKKKKKKKKK...',
  '...KaKdeedKaK...',
  '...KbKeffeKbK...',
  '...KbKfFFfKbK...',
  '...KbKeffeKbK...',
  '..KKKKKKKKKKKK..',
  '...KaKcddcKaK...',
  '....KKccccKK....',
  '.....KKKKKK.....',
  '......KiiK......',
  '.......KK.......',
  '................',
], 16);

// Hand-drawn wordmark, small: 2px stems, cap 11, x-height 8, descender 3.
const SMALL = {
  P: ['######.', '##...##', '##...##', '##...##', '##...##', '######.', '##.....', '##.....', '##.....', '##.....', '##.....', '', '', ''],
  o: ['', '', '', '.#####.', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.', '', '', ''],
  r: ['', '', '', '##.###', '####..', '##....', '##....', '##....', '##....', '##....', '##....', '', '', ''],
  c: ['', '', '', '.#####', '##....', '##....', '##....', '##....', '##....', '##....', '.#####', '', '', ''],
  h: ['##.....', '##.....', '##.....', '######.', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '', '', ''],
  l: ['##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '.##', '', '', ''],
  i: ['**', '**', '..', '##', '##', '##', '##', '##', '##', '##', '##', '', '', ''],
  g: ['', '', '', '.######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.######', '.....##', '.....##', '######.'],
  t: ['', '.##..', '.##..', '#####', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '..###', '', '', ''],
};

// Hand-drawn wordmark, large: 3px stems, cap 19, x-height 13, descender 5.
const BIG = {
  P: ['#########...', '##########..', '###.....###.', '###......###', '###......###', '###......###', '###......###', '###.....###.', '##########..', '#########...',
    '###.........', '###.........', '###.........', '###.........', '###.........', '###.........', '###.........', '###.........', '###.........'],
  o: ['', '', '', '', '', '', '...######...', '.##########.', '.###....###.', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '.###....###.', '.##########.', '...######...'],
  r: ['', '', '', '', '', '', '###..####', '###.#####', '#####....', '####.....', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......'],
  c: ['', '', '', '', '', '', '...#######', '.#########', '.###......', '###.......', '###.......', '###.......', '###.......', '###.......', '###.......', '###.......', '.###......', '.#########', '...#######'],
  h: ['###.........', '###.........', '###.........', '###.........', '###.........', '###.........', '###.######..', '###########.', '#####...####', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###'],
  l: ['###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '###.', '.###'],
  i: ['', '***', '***', '***', '', '', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###'],
  g: ['', '', '', '', '', '', '...#########', '.###########', '.###....####', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '###......###', '.###....####', '.###########', '...#########',
    '.........###', '.........###', '........###.', '.#########..', '..#######...'],
  t: ['', '', '.###...', '.###...', '.###...', '.###...', '#######', '#######', '.###...', '.###...', '.###...', '.###...', '.###...', '.###...', '.###...', '.###...', '.###...', '.####..', '..#####'],
};

function glyphW(g) {
  return Math.max(...g.map((r) => r.length));
}
function wordWidth(font, word, gap) {
  return [...word].reduce((s, ch) => s + glyphW(font[ch]), 0) + gap * (word.length - 1);
}
// paint(x, y, ch) where ch is '#' (letter) or '*' (the i's dot)
function drawWord(font, word, gap, paint) {
  let x = 0;
  for (const ch of word) {
    const g = font[ch];
    g.forEach((row, y) => [...row].forEach((p, i) => p !== '.' && paint(x + i, y, p)));
    x += glyphW(g) + gap;
  }
  return x - gap;
}

function lampGrid() {
  const g = new Grid(32, 32);
  g.stamp(LAMP32, L);
  for (const [x, y, c] of RAYS) {
    g.set(x, y, L[c]);
    g.set(31 - x, y, L[c]);
  }
  return g;
}

// ---- mark, favicon --------------------------------------------------------
const mark = lampGrid();
const markSvg = svg({ w: 512, h: 512, vb: '0 0 32 32', crisp: true, body: mark.toPaths() });

const fav = new Grid(16, 16).stamp(FAV16, L);
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: fav.toPaths() });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: new Grid(32, 32).stamp(LAMP32, L).toPaths() });

// ---- logo: 128 x 40 grid at x5 --------------------------------------------
const INK = '#18213d';
const logo = new Grid(128, 40);
logo.blit(mark, 7, 4);
{
  const x0 = 46;
  const y0 = 16;
  drawWord(SMALL, 'Porchlight', 2, (x, y, p) => logo.set(x0 + x, y0 + y, p === '*' ? L.c : INK));
  // a warm pixel on the i's dot, like the lamp
  const ix = x0 + [...'Porchl'].reduce((s, ch) => s + glyphW(SMALL[ch]) + 2, 0);
  logo.set(ix, y0, L.d);
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 128 40', crisp: true, body: logo.toPaths() });

// ---- scene palette ---------------------------------------------------------
const S = {
  ink: '#070b16',
  n1: '#0e1528',
  n2: '#17213f',
  n3: '#22305a',
  trim: '#46506e',
  trimLo: '#2c3450',
  trimHi: '#5b6688',
  door: '#12281f',
  doorHi: '#1c3a2d',
  doorLo: '#0a1913',
  glass: '#0b1322',
  plank: '#1b1a2a',
  plankHi: '#26253c',
  plankLn: '#0b0a14',
  mat: '#2b2018',
  mat2: '#211710',
  matEdge: '#120d09',
  brass: '#8a6a35',
  brassHi: '#e8c27a',
  brassLo: '#4a3518',
};
// light ramps: level 1..4
const RAMPS = {
  [S.n1]: ['#161834', '#271f33', '#3f2d36', '#5e4038'],
  [S.n2]: ['#252846', '#41354d', '#6d4f4f', '#a2735a'],
  [S.n3]: ['#333a60', '#5a4a62', '#94705f', '#d49e67'],
  [S.ink]: ['#0c0d1c', '#16121f', '#221822', '#332224'],
  [S.trim]: ['#666a86', '#9a8f90', '#cdb89c', '#f2dfb6'],
  [S.trimLo]: ['#3b3d58', '#5d5462', '#87706a', '#b48d72'],
  [S.trimHi]: ['#7b7e98', '#b4a59a', '#e3cca5', '#fff0cc'],
  [S.door]: ['#19322a', '#284331', '#3e5a37', '#5e7442'],
  [S.doorHi]: ['#244636', '#37593d', '#527446', '#7d9252'],
  [S.doorLo]: ['#10201a', '#192b1f', '#263a25', '#3b4d2b'],
  [S.glass]: ['#101827', '#17202e', '#212935', '#2e333d'],
  [S.plank]: ['#282334', '#433233', '#6d4b37', '#a27146'],
  [S.plankHi]: ['#352e42', '#574235', '#8a603d', '#c38d52'],
  [S.plankLn]: ['#120f1a', '#1f171d', '#33241f', '#4f3523'],
  [S.mat]: ['#3c2b1e', '#5e4024', '#8b5f30', '#b8843f'],
  [S.mat2]: ['#302217', '#4a321c', '#6f4c26', '#996a32'],
  [S.matEdge]: ['#1a120c', '#2a1c10', '#3d2814', '#563818'],
};

const MOTH_OPEN = ['A.A.A', '.ABA.', '..B..'];
const MOTH_UP = ['A.A', 'ABA', '.B.'];
const MOTH = { A: '#e8d9b8', B: '#9c8566' };

function siding(g, x0, y0, w, h, pitch) {
  for (let y = y0; y < y0 + h; y++) {
    const k = (y - y0) % pitch;
    const c = k === 0 ? S.n3 : k === pitch - 1 ? S.n1 : S.n2;
    g.hline(x0, y, w, c);
  }
}

// ---- hero: 320 x 160 at x4 ---------------------------------------------------
function hero() {
  const g = new Grid(320, 160, S.n2);
  siding(g, 0, 0, 320, 122, 7);

  // door casing and head
  g.rect(6, 26, 60, 98, S.trim);
  g.rect(4, 24, 64, 2, S.trimHi); // cap moulding
  g.hline(4, 26, 64, S.trimLo);
  g.vline(6, 27, 97, S.trimHi);
  g.vline(65, 27, 97, S.trimLo);
  g.vline(11, 34, 90, S.trimLo); // inner edge shadow
  // door leaf
  g.rect(12, 34, 48, 90, S.door);
  g.hline(12, 34, 48, S.doorLo);
  g.vline(12, 34, 90, S.doorLo);
  // window: three lights
  g.rect(18, 39, 36, 16, S.doorLo);
  g.rect(19, 40, 34, 14, S.glass);
  g.vline(29, 40, 14, S.door).vline(30, 40, 14, S.doorHi);
  g.vline(41, 40, 14, S.door).vline(42, 40, 14, S.doorHi);
  g.hline(18, 55, 36, S.doorHi);
  // panels
  for (const px of [17, 38]) {
    g.rect(px, 63, 17, 54, S.door);
    g.hline(px, 63, 17, S.doorLo).vline(px, 63, 54, S.doorLo);
    g.hline(px, 116, 17, S.doorHi).vline(px + 16, 63, 54, S.doorHi);
    g.rect(px + 3, 66, 11, 48, S.doorHi); // raised field
    g.rect(px + 4, 67, 10, 47, S.door);
  }
  // mail slot
  g.rect(27, 58, 18, 3, S.brass);
  g.hline(27, 58, 18, S.brassHi);
  g.hline(28, 59, 16, S.ink);
  // sill + baseboard
  g.rect(0, 122, 320, 3, S.trim);
  g.hline(0, 122, 320, S.trimHi);
  g.hline(0, 124, 320, S.trimLo);
  g.rect(4, 121, 64, 4, S.trim); // threshold
  g.hline(4, 121, 64, S.trimHi);
  // porch floor: boards parallel to the wall, widening toward us
  const edges = [125, 127, 130, 134, 139, 145, 152, 160];
  for (let k = 0; k < edges.length - 1; k++) {
    const y = edges[k];
    const h = edges[k + 1] - y;
    g.rect(0, y, 320, h, S.plank);
    g.hline(0, y, 320, S.plankHi);
    g.hline(0, y + h - 1, 320, S.plankLn);
    // staggered butt joints
    for (let x = (k * 53) % 97 + 20; x < 320; x += 97 + k * 7) g.vline(x, y, h, S.plankLn);
  }
  // doormat (trapezoid, coir weave)
  for (let y = 127; y <= 138; y++) {
    const t = y - 127;
    const x0 = 15 - Math.floor(t / 3);
    const x1 = 57 + Math.floor(t / 3);
    for (let x = x0; x <= x1; x++) {
      const edge = y === 127 || y === 138 || x === x0 || x === x1;
      const inner = y === 129 || y === 136 || x === x0 + 2 || x === x1 - 2;
      g.set(x, y, edge ? S.matEdge : inner ? S.mat2 : (x + (y % 2)) % 2 ? S.mat : S.mat2);
    }
  }
  // backplate behind the lamp
  g.rect(87, 27, 10, 39, S.ink);
  g.rect(88, 28, 8, 37, '#1d2233');
  g.vline(88, 28, 37, '#2e3550');

  // light: a pool on the wall around the bulb and one on the floor below it
  const LX = 92;
  const LY = 47;
  const wall = Grid.pool({ cx: LX, cy: LY, rx: 84, ry: 76, thresholds: [1, 0.74, 0.5, 0.3], spread: 0.1 });
  const floor = Grid.pool({ cx: LX - 8, cy: 136, rx: 92, ry: 26, thresholds: [1, 0.7, 0.45, 0.25], spread: 0.12 });
  const level = (x, y) => {
    let l = y >= 125 ? Math.max(floor(x, y), wall(x, y) - 1) : wall(x, y);
    // the cap throws a fan of shadow up the wall
    if (y < 31 && Math.abs(x + 0.5 - LX) < 7 + (31 - y) * 0.9) l -= 1;
    return Math.max(0, l);
  };
  g.relight(level, RAMPS);

  // lamp (emissive, drawn after the light)
  g.blit(new Grid(32, 32).stamp(LAMP32, L), LX - 16, LY - 16);
  // brass knob and escutcheon with keyhole, lit from the right
  g.stamp(['.bb.', 'bBBb', 'bBbl', '.ll.'], { b: '#c99a4c', B: '#ffe7a8', l: '#6b4a1f' }, 53, 83);
  g.stamp(['.b.', 'bkb', 'bkb', 'bbb', '.l.'], { b: '#b8893f', k: S.ink, l: '#6b4a1f' }, 54, 89);
  // window glass picks up a reflection of the lamp
  g.set(51, 42, '#4a4a52').set(51, 43, '#6a5d4e').set(52, 42, '#3a3c48');
  // moths
  g.stamp(MOTH_OPEN, MOTH, 104, 26);
  g.stamp(MOTH_UP, MOTH, 74, 33);
  g.stamp(MOTH_OPEN, MOTH, 109, 52);
  g.stamp(['A.A', '.B.'], MOTH, 81, 19);

  // wordmark, large, cream to amber, outlined
  const word = new Grid(130, 30);
  const WX = 2;
  const WY = 2;
  const CREAM = '#fff1d2';
  const AMBER = '#ffc15a';
  let dot = null;
  drawWord(BIG, 'Porchlight', 3, (x, y, p) => {
    if (p === '*') {
      word.set(WX + x, WY + y, '#fffbe8');
      dot = dot || [WX + x, WY + y];
      return;
    }
    // top two thirds cream, then a dithered step into amber
    const t = (y - 9) / 5;
    word.set(WX + x, WY + y, t <= 0 ? CREAM : t >= 1 ? AMBER : ((x + y) % 2 === 0 && t < 0.5) || ((x + y) % 2 === 1 && t < 1) ? CREAM : AMBER);
  });
  word.outline([CREAM, AMBER, '#fffbe8'], S.ink);
  // the i's dot glows: a ring of amber around it
  if (dot) {
    const [dx, dy] = dot;
    for (const [x, y] of [[-1, 0], [3, 0], [-1, 1], [3, 1], [-1, 2], [3, 2], [0, -1], [1, -1], [2, -1], [0, 3], [1, 3], [2, 3]]) word.set(dx + x, dy + y, '#ffb347');
    for (const [x, y] of [[-2, 1], [4, 1], [1, -2], [1, 4]]) word.set(dx + x, dy + y, '#c96a2a');
  }
  const TX = 178;
  g.blit(word, TX - WX, 40);
  // tagline
  const TAG = '#c4b392';
  drawText(g, 'A light left on over', TX, 76, TAG, { shadow: S.ink });
  drawText(g, 'your own front door.', TX, 89, TAG, { shadow: S.ink });

  return g;
}

// ---- icon: 32 x 32 tile at x4 (128) and x16 (512) --------------------------
function icon() {
  const g = new Grid(32, 32);
  const rowSpan = (y) => (y === 0 || y === 31 ? [3, 28] : y === 1 || y === 30 ? [1, 30] : y === 2 || y === 29 ? [1, 30] : [0, 31]);
  // siding inside the tile
  for (let y = 0; y < 32; y++) {
    const [a, b] = rowSpan(y);
    const k = y % 4;
    g.hline(a, y, b - a + 1, k === 1 ? S.n3 : k === 0 ? S.n1 : S.n2);
  }
  const pool = Grid.pool({ cx: 16, cy: 15, rx: 17, ry: 16, thresholds: [1, 0.72, 0.48, 0.28], spread: 0.14 });
  g.relight((x, y) => Math.max(0, pool(x, y) - (y < 6 && Math.abs(x - 15.5) < 3 + (6 - y) ? 2 : 0)), RAMPS);
  g.stamp(LAMP20, L, 8, 6);
  // two rays each side
  for (const [x, y, c] of [[3, 15, 'c'], [4, 15, 'd'], [4, 10, 'c'], [5, 11, 'd'], [4, 21, 'c'], [5, 20, 'd']]) {
    g.set(x, y, L[c]);
    g.set(31 - x, y, L[c]);
  }
  g.stamp(['A.A', '.B.'], MOTH, 23, 5);
  // tile edge
  const out = new Grid(32, 32);
  out.blit(g);
  for (let y = 0; y < 32; y++) {
    const [a, b] = rowSpan(y);
    out.set(a, y, S.ink);
    out.set(b, y, S.ink);
  }
  out.hline(3, 0, 26, S.ink).hline(3, 31, 26, S.ink);
  for (const [x, y] of [[1, 1], [2, 1], [30, 1], [29, 1], [1, 30], [2, 30], [30, 30], [29, 30]]) out.set(x, y, S.ink);
  return out;
}

const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 320 160', crisp: true, body: hero().toPaths() });
const iconSvg = svg({ w: 512, h: 512, vb: '0 0 32 32', crisp: true, body: icon().toPaths() });

const notes = `# 01 Caged bulb (pixel)

A jelly-jar porch light in a wire cage, mounted beside a green front door on navy clapboard. The light pool, the floor and the doormat are lit with hand-set ramps and ordered dithering; the dot of the i in the wordmark is a second little bulb.
Palette: night #070b16 / #17213f / #22305a, iron #262b3b / #3d4459, glass #c0612a / #ea943a / #ffc35c / #ffe4a0, door #12281f, cream #fff1d2.
Type: hand-drawn pixel wordmark in two sizes (2px stems for the logo, 3px for the hero); tagline in a 5px pixel face.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'logo.svg': logoSvg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
