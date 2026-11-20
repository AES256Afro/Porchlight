// 05 Amber terminal (pixel): a quiet street drawn in four tones of amber
// phosphor; the only light on the street is your own porch.
import { Grid, drawText, measureText, bayer } from '../lib/pixel.mjs';
import { svg, writeConcept } from '../lib/svg.mjs';

const SLUG = '05-amber-terminal-pixel';

function check(name, rows, w) {
  rows.forEach((r, i) => {
    if ([...r].length !== w) throw new Error(`${name} row ${i} is ${[...r].length} wide, want ${w}: "${r}"`);
  });
  return rows;
}

// four tones, nothing else
const T = ['#140a00', '#4a2400', '#a65a00', '#ffb000'];
const P = { 0: T[0], 1: T[1], 2: T[2], 3: T[3] };
const idx = new Map(T.map((c, i) => [c, i]));

// House with a lit doorway, 22 x 22.
const HOUSE = check('house', [
  '..........22..........',
  '.........2112.........',
  '........210012..22....',
  '.......21111112.21....',
  '......210000001221....',
  '.....2111111111121....',
  '....21000000000012....',
  '...2111111111111112...',
  '..210000000000000012..',
  '.22222222222222222222.',
  '..111111113311111111..',
  '..111111222222111111..',
  '..100002233332200001..',
  '..100001233332100001..',
  '..111112232232211111..',
  '..100001232232100001..',
  '..100002233332200001..',
  '..122221233312122221..',
  '..111112233332211111..',
  '..111111233332111111..',
  '..111112333333211111..',
  '1111212233333322121111',
], 22);

// 16 x 16 favicon, redrawn: a tile of night with the house and its door.
const FAV16 = check('fav16', [
  '.00000000000000.',
  '0000000000000000',
  '0000000220000200',
  '0000002112000000',
  '0000021001200000',
  '0000211111120000',
  '0002100000012000',
  '0022222222222200',
  '0001112222111000',
  '0001002332001000',
  '0001002332001000',
  '0001112332111000',
  '0001112332111000',
  '0111223333221110',
  '0001010220101000',
  '.00000000000000.',
], 16);

// Monospaced pixel hand: 6-wide glyphs on an 8-pixel advance, 2px stems,
// cap 10, x-height 7, descender 3. '*' marks the i's dot.
const MONO = {
  P: ['#####.', '##..##', '##..##', '##..##', '#####.', '##....', '##....', '##....', '##....', '##....'],
  o: ['', '', '', '.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  r: ['', '', '', '##.###', '####..', '##....', '##....', '##....', '##....', '##....'],
  c: ['', '', '', '.#####', '##....', '##....', '##....', '##....', '##....', '.#####'],
  h: ['##....', '##....', '##....', '#####.', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##'],
  l: ['.###..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '...###'],
  i: ['..**..', '..**..', '', '.###..', '..##..', '..##..', '..##..', '..##..', '..##..', '.####.'],
  g: ['', '', '', '.#####', '##..##', '##..##', '##..##', '##..##', '##..##', '.#####', '....##', '....##', '#####.'],
  t: ['', '..##..', '..##..', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '...###'],
  '>': ['', '', '', '##....', '.##...', '..##..', '...##.', '..##..', '.##...', '##....'],
};
const ADV = 8;
// draws text on the 8px grid; returns the x after the last cell
function mono(g, text, x, y, color, dot = color) {
  let cx = x;
  for (const ch of text) {
    (MONO[ch] || []).forEach((row, j) =>
      [...row].forEach((p, i) => {
        if (p === '#') g.set(cx + i, y + j, color);
        if (p === '*') g.set(cx + i, y + j, dot);
      }),
    );
    cx += ADV;
  }
  return cx;
}
function cursor(g, x, y, color) {
  g.rect(x, y, 6, 12, color);
}

// ---- mark: the house on a dark screen tile, 32 x 32 --------------------------
function tile(n, { border = 1 } = {}) {
  const g = new Grid(n, n);
  const span = (y) => (y === 0 || y === n - 1 ? 2 : y === 1 || y === n - 2 ? 1 : 0);
  for (let y = 0; y < n; y++) {
    const a = span(y);
    g.hline(a, y, n - 2 * a, T[0]);
  }
  if (border) {
    for (let y = 0; y < n; y++) {
      const a = span(y);
      g.set(a, y, T[1]).set(n - 1 - a, y, T[1]);
    }
    g.hline(2, 0, n - 4, T[1]).hline(2, n - 1, n - 4, T[1]);
    g.set(1, 1, T[1]).set(n - 2, 1, T[1]).set(1, n - 2, T[1]).set(n - 2, n - 2, T[1]);
  }
  return g;
}

function markGrid() {
  const g = tile(32);
  g.stamp(HOUSE, P, 5, 4);
  // ground continues to the edges, the light thinning out
  g.hline(2, 25, 3, T[1]).hline(27, 25, 3, T[1]);
  for (const [x, c] of [[8, 1], [10, 2], [12, 1], [13, 2], [14, 2], [15, 3], [16, 3], [17, 2], [18, 2], [19, 1], [21, 2], [23, 1]]) g.set(x, 27, T[c]);
  for (const [x, c] of [[11, 1], [14, 1], [15, 2], [16, 2], [17, 1], [20, 1]]) g.set(x, 28, T[c]);
  // stars
  for (const [x, y, c] of [[5, 5, 2], [8, 9, 1], [25, 6, 1], [27, 10, 2], [4, 14, 1]]) g.set(x, y, T[c]);
  return g;
}

// ---- hero: 256 x 128 at x5 -----------------------------------------------------
function gable(g, { x0, x1, eaveY, s, fill = T[0], line = T[1], shingles = true }) {
  const R = Math.floor((x1 - x0 + 1) / (2 * s)) - 1;
  for (let r = 0; r <= R; r++) {
    const y = eaveY - R + r;
    const a = x0 + (R - r) * s;
    const b = x1 - (R - r) * s;
    g.hline(a, y, b - a + 1, shingles && r % 3 === 2 ? line : fill);
    g.hline(a, y, s, line).hline(b - s + 1, y, s, line);
  }
  g.hline(x0, eaveY + 1, x1 - x0 + 1, line);
  return eaveY - R;
}
function walls(g, x0, x1, y0, y1) {
  g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, T[0]);
  g.vline(x0, y0, y1 - y0 + 1, T[1]).vline(x1, y0, y1 - y0 + 1, T[1]);
}
function windowAt(g, x, y, w, h, { mullion = true } = {}) {
  g.rect(x, y, w, h, T[1]);
  g.rect(x + 1, y + 1, w - 2, h - 2, T[0]);
  if (mullion) {
    g.vline(x + (w >> 1), y + 1, h - 2, T[1]);
    g.hline(x + 1, y + (h >> 1), w - 2, T[1]);
  }
  g.hline(x - 1, y + h, w + 2, T[1]);
}

function hero() {
  const g = new Grid(256, 128, T[0]);
  // sky: dark, a faint dithered glow toward the horizon
  g.vgradient(0, 0, 256, 104, [{ y: 0, c: T[0] }, { y: 70, c: T[0] }, { y: 150, c: T[1] }]);
  // stars, hand placed, kept clear of the type
  const stars = [
    [6, 8, 1], [118, 6, 2], [134, 13, 1], [150, 5, 1], [168, 18, 2], [184, 9, 1], [200, 22, 1], [214, 6, 2],
    [246, 30, 1], [252, 8, 1], [8, 46, 1], [40, 50, 2], [70, 44, 1], [96, 52, 1], [112, 46, 2], [190, 46, 1], [214, 52, 2], [230, 44, 1],
    [124, 48, 1], [4, 26, 2],
  ];
  for (const [x, y, c] of stars) g.set(x, y, T[c]);
  for (const [x, y] of [[222, 38], [60, 54]]) {
    g.set(x, y, T[3]).set(x - 1, y, T[2]).set(x + 1, y, T[2]).set(x, y - 1, T[2]).set(x, y + 1, T[2]);
  }
  // crescent moon
  g.stamp(
    check('moon', [
      '...2222.....',
      '.22333......',
      '.2333.......',
      '2333........',
      '2333........',
      '2333........',
      '2333........',
      '23332.......',
      '.23332......',
      '.2233322....',
      '...22222....',
    ], 12),
    P,
    228,
    10,
  );

  // H1: two storeys, shallow roof, chimney
  g.rect(31, 52, 4, 9, T[0]).vline(31, 52, 9, T[1]).vline(34, 52, 9, T[1]).hline(30, 51, 6, T[1]);
  gable(g, { x0: 1, x1: 42, eaveY: 64, s: 2 });
  walls(g, 3, 40, 66, 95);
  windowAt(g, 8, 70, 7, 8);
  windowAt(g, 29, 70, 7, 8);
  windowAt(g, 8, 82, 7, 8);
  g.rect(22, 80, 7, 16, T[1]).rect(23, 81, 5, 15, T[0]).set(27, 88, T[1]);
  // H2: cottage, steep roof
  gable(g, { x0: 46, x1: 81, eaveY: 76, s: 1 });
  walls(g, 48, 79, 78, 95);
  windowAt(g, 53, 82, 7, 7);
  g.rect(67, 82, 7, 14, T[1]).rect(68, 83, 5, 13, T[0]);
  windowAt(g, 62, 66, 6, 6, { mullion: false }); // gable window
  // tree: a canopy of overlapping clumps, outlined, with clump arcs inside
  {
    const clumps = [[101, 58, 9], [92, 66, 8], [110, 66, 8], [97, 74, 7], [106, 74, 7], [101, 66, 9]];
    const inside = (x, y) => clumps.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r);
    for (let y = 45; y < 84; y++)
      for (let x = 80; x < 122; x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
        g.set(x, y, edge ? T[1] : T[0]);
      }
    // moonlit rim on the upper left, ordered dither fading inward
    for (let y = 45; y < 84; y++)
      for (let x = 80; x < 122; x++) {
        if (g.get(x, y) !== T[0] || !inside(x, y)) continue;
        let k = 0;
        while (k < 4 && inside(x - k - 1, y - k - 1)) k++;
        if (k < 4 && bayer(x, y) < [0.6, 0.38, 0.2, 0.08][k]) g.set(x, y, T[1]);
      }
    g.rect(99, 80, 4, 16, T[0]).vline(99, 80, 16, T[1]).vline(102, 80, 16, T[1]);
    g.set(100, 80, T[1]).set(101, 81, T[1]);
  }

  // H3: your house, with the porch
  gable(g, { x0: 124, x1: 183, eaveY: 63, s: 2 });
  walls(g, 127, 180, 65, 95);
  // attic window, arched
  g.stamp(['.111.', '10001', '10101', '11111', '10101', '10001', '11111'], P, 151, 52);
  // porch roof (shed) and posts
  g.rect(124, 73, 60, 4, T[0]);
  g.hline(124, 73, 60, T[1]).hline(124, 76, 60, T[1]).vline(124, 73, 4, T[1]).vline(183, 73, 4, T[1]);
  for (const px of [128, 178]) g.rect(px, 77, 2, 16, T[1]);
  windowAt(g, 134, 81, 9, 8);
  windowAt(g, 166, 81, 9, 8);
  // door with a lit pane
  g.rect(150, 79, 10, 17, T[1]);
  g.rect(151, 80, 8, 16, T[2]);
  g.rect(153, 82, 4, 5, T[3]);
  g.set(157, 89, T[0]);
  // porch floor and steps
  g.rect(124, 93, 60, 3, T[1]);
  g.hline(124, 93, 60, T[2]);
  g.rect(147, 96, 16, 2, T[1]).hline(147, 96, 16, T[2]);
  g.rect(145, 98, 20, 2, T[1]).hline(145, 98, 20, T[2]);
  // lamp beside the door
  g.stamp(['.1.', '121', '333', '323', '.1.'], P, 144, 80);
  // a cat on the top step, back to us, looking at the street

  // H4: small, steep
  gable(g, { x0: 189, x1: 220, eaveY: 74, s: 1 });
  walls(g, 191, 218, 76, 95);
  windowAt(g, 196, 81, 7, 7);
  g.rect(208, 81, 6, 15, T[1]).rect(209, 82, 4, 14, T[0]);
  // H5: tall, cut by the frame
  g.rect(235, 40, 4, 10, T[0]).vline(235, 40, 10, T[1]).vline(238, 40, 10, T[1]).hline(234, 39, 6, T[1]);
  gable(g, { x0: 224, x1: 263, eaveY: 56, s: 1 });
  walls(g, 226, 261, 58, 95);
  windowAt(g, 231, 63, 7, 9);
  windowAt(g, 247, 63, 7, 9);
  windowAt(g, 231, 80, 7, 9);
  g.rect(246, 78, 8, 18, T[1]).rect(247, 79, 6, 17, T[0]);

  // ground, fences, sidewalk, road
  g.rect(0, 96, 256, 8, T[0]);
  g.hline(0, 96, 256, T[1]);
  for (let x = 2; x < 120; x += 4) if (x < 18 || x > 30) g.vline(x, 98, 5, T[1]).set(x, 97, T[1]);
  g.hline(0, 100, 120, T[1]);
  for (let x = 188; x < 256; x += 4) if (x < 205 || x > 215) g.vline(x, 98, 5, T[1]).set(x, 97, T[1]);
  g.hline(186, 100, 70, T[1]);
  // path to your steps
  g.rect(149, 100, 12, 4, T[1]);
  g.vline(149, 100, 4, T[2]).vline(160, 100, 4, T[2]);
  // mailbox
  g.stamp(['.1111.', '122221', '120021', '111111', '...1..', '...1..', '...1..'], P, 170, 96);
  g.set(176, 97, T[2]).set(176, 98, T[2]); // flag
  // sidewalk with joints, curb, road with dashes
  g.rect(0, 104, 256, 5, T[0]);
  g.hline(0, 104, 256, T[1]).hline(0, 108, 256, T[1]);
  for (let x = 12; x < 256; x += 20) g.vline(x, 105, 3, T[1]);
  g.rect(0, 109, 256, 19, T[0]);
  g.hline(0, 110, 256, T[1]);
  for (let x = 4; x < 256; x += 16) g.hline(x, 119, 8, T[1]);

  // light: banded pool around the lamp; each band adds a fixed amount of
  // brightness, rendered as an ordered dither between the four tones
  const LX = 146, LY = 83;
  const wallPool = Grid.pool({ cx: LX, cy: LY, rx: 40, ry: 22, thresholds: [1, 0.62, 0.2], spread: 0.03 });
  const groundPool = Grid.pool({ cx: 155, cy: 99, rx: 30, ry: 9, thresholds: [1, 0.6, 0.28], spread: 0.04 });
  const underPorch = (x, y) => x >= 128 && x <= 179 && y >= 77 && y <= 95;
  const Q = [0, 0.5, 1, 1.5];
  const before = g.clone();
  for (let y = 40; y < 128; y++)
    for (let x = 96; x < 200; x++) {
      const c = before.get(x, y);
      const k = idx.get(c);
      if (k === undefined || k === 3) continue;
      const lv = y > 95 ? groundPool(x, y) : underPorch(x, y) ? wallPool(x, y) : 0;
      if (lv <= 0) continue;
      const v = k + Q[lv];
      let n = Math.floor(v) + (v - Math.floor(v) > bayer(x, y) ? 1 : 0);
      g.set(x, y, T[Math.min(3, Math.max(k, n))]);
    }
  // door, lamp and their frames drawn after the light so they stay crisp
  g.rect(150, 79, 10, 17, T[2]);
  g.rect(151, 80, 8, 16, T[2]);
  g.rect(152, 81, 6, 6, T[3]);
  g.vline(155, 81, 6, T[2]);
  g.hline(152, 84, 6, T[2]);
  g.rect(152, 88, 6, 7, T[1]).rect(153, 89, 4, 5, T[2]);
  g.set(157, 90, T[0]);
  g.stamp(['.111.', '12321', '13331', '13331', '12321', '.111.', '..1..'], P, 143, 79);
  // a cat on the porch, back to us, watching the street: a dark shape on the lit wall
  g.stamp(['0..0..', '0000..', '0000..', '.00...', '0000..', '00000.', '00000.', '000000'], P, 163, 85);
  // moths
  g.set(139, 76, T[3]).set(138, 75, T[2]).set(140, 75, T[2]);
  g.set(151, 76, T[3]).set(150, 75, T[2]).set(152, 75, T[2]);

  // type: prompt, wordmark, cursor, tagline
  mono(g, '>', 14, 12, T[2]);
  const end = mono(g, 'Porchlight', 26, 12, T[3]);
  cursor(g, end, 12, T[3]);
  drawText(g, 'A light left on over your own front door.', 26, 30, T[2]);
  return g;
}

// ---- logo: a dark terminal strip, 160 x 50 at x4 ------------------------------
function logoGrid() {
  const g = new Grid(160, 50);
  for (let y = 0; y < 50; y++) {
    const a = y === 0 || y === 49 ? 2 : y === 1 || y === 48 ? 1 : 0;
    g.hline(a, y, 160 - 2 * a, T[0]);
    g.set(a, y, T[1]).set(159 - a, y, T[1]);
  }
  g.hline(2, 0, 156, T[1]).hline(2, 49, 156, T[1]);
  g.set(1, 1, T[1]).set(158, 1, T[1]).set(1, 48, T[1]).set(158, 48, T[1]);
  g.stamp(HOUSE, P, 20, 13);
  for (const [x, y, c] of [[16, 15, 1], [44, 12, 2], [47, 20, 1], [14, 26, 1]]) g.set(x, y, T[c]);
  const end = mono(g, 'Porchlight', 54, 19, T[3]);
  cursor(g, end, 19, T[3]);
  return g;
}

// ---- icon: an amber monitor, 32 x 32 --------------------------------------------
function iconGrid() {
  const g = new Grid(32, 32);
  // case, screen, stand
  const r = (str, n) => str.repeat(n);
  const rows = [
    '..' + r('1', 28) + '..',
    '.' + r('1', 30) + '.',
    '11' + r('2', 28) + '11',
    ...Array.from({ length: 22 }, () => '112' + r('0', 26) + '211'),
    '11' + r('2', 28) + '11',
    r('1', 32),
    '.' + r('1', 21) + '2' + '1' + '33' + '1' + r('1', 4) + '.',
    '..' + r('1', 28) + '..',
    r('.', 8) + r('1', 16) + r('.', 8),
    r('.', 6) + r('1', 20) + r('.', 6),
  ];
  g.stamp(check('monitor', rows, 32), P, 0, 0);
  // screen contents: the house, smaller, and a prompt line
  const SMALL = check('smallhouse', [
    '.......22.......',
    '......2112......',
    '.....210012.....',
    '....21111112....',
    '...2100000012...',
    '..222222222222..',
    '...1112222111...',
    '...1002332001...',
    '...1002332001...',
    '...1112332111...',
    '...1112332111...',
    '.1112233332211..',
  ], 16);
  g.stamp(SMALL, P, 8, 6);
  g.set(5, 6, T[1]).set(26, 8, T[2]).set(24, 5, T[1]);
  g.hline(5, 21, 2, T[2]).hline(9, 21, 9, T[1]).rect(20, 20, 2, 3, T[3]);
  return g;
}

const crispSvg = (grid, w, h, vb) => svg({ w, h, vb, crisp: true, body: grid.toPaths() });

const mark = markGrid();
const files = {
  'mark.svg': crispSvg(mark, 512, 512, '0 0 32 32'),
  'favicon.svg': crispSvg(new Grid(16, 16).stamp(FAV16, P), 16, 16, '0 0 16 16'),
  'favicon-32.svg': crispSvg(mark, 32, 32, '0 0 32 32'),
  'logo.svg': crispSvg(logoGrid(), 640, 200, '0 0 160 50'),
  'icon.svg': crispSvg(iconGrid(), 512, 512, '0 0 32 32'),
  'hero.svg': crispSvg(hero(), 1280, 640, '0 0 256 128'),
  'notes.md': `# 05 Amber terminal (pixel)

A quiet street drawn in the four tones of an amber phosphor screen; every house is dark except yours, where the porch light is on. The wordmark is a monospaced pixel hand with a block cursor, because Porchlight runs on your own machine and is happy in a terminal.
Palette (four tones only): #140a00, #4a2400, #a65a00, #ffb000. The glow is ordered (Bayer) dithering between them.
Type: hand-drawn 6x10 monospaced pixel wordmark on an 8px advance, plus a 5px pixel face for the tagline.
`,
};
writeConcept(SLUG, files);
