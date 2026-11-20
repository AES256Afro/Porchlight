// 04 Lantern keyhole (pixel): a carriage lantern on a scrolled bracket on
// red-brown brick; its glazing bars frame a keyhole-shaped pane of light.
// The name is on a brass house plaque beside it.
import { Grid, drawText, measureText, bayer } from '../lib/pixel.mjs';
import { svg, writeConcept } from '../lib/svg.mjs';

const SLUG = '04-lantern-keyhole-pixel';

function check(name, rows, w) {
  rows.forEach((r, i) => {
    if ([...r].length !== w) throw new Error(`${name} row ${i} is ${[...r].length} wide, want ${w}: "${r}"`);
  });
  return rows;
}

const P = {
  K: '#0c0a0a',
  i: '#2a2626', // iron
  I: '#4a423c',
  y: '#6e4f22', // brass, shadow
  Y: '#b8893f', // brass
  Z: '#e8c071', // brass highlight
  z: '#ffd98a', // brass lit from inside
  a: '#8a3e12',
  b: '#c4652a',
  c: '#e8913a',
  d: '#ffbe5c',
  e: '#ffe29c',
  f: '#fff4d4',
  F: '#ffffff',
  s: '#6e3214', // side glass
  S: '#9a4c22',
};

// ---- the lantern (24 wide), body built around a keyhole pane -------------
const LANTERN_TOP = check('ltop', [
  '...........KK...........',
  '..........KZYK..........',
  '..........KYyK..........',
  '...........KK...........',
  '.........KKYYKK.........',
  '........KZYYYYyK........',
  '.......KZYYYYYYyK.......',
  '.......KyyyyyyyyK.......',
  '........KiIiiiiK........',
  '.....KKKKKKKKKKKKKK.....',
  '....KZYYYYYYYYYYYYyK....',
  '...KZYYYYYYYYYYYYYYyK...',
  '..KZYYYYYYYYYYYYYYYYyK..',
  '.KyyyyyyyyyyyyyyyyyyyyK.',
  '.KzzzzzzzzzzzzzzzzzzzzK.',
  '..KKKKKKKKKKKKKKKKKKKK..',
], 24);
const LANTERN_BOTTOM = check('lbot', [
  '...KzzzzzzzzzzzzzzzzK...',
  '...KYYYYYYYYYYYYYYyyK...',
  '....KyYYYYYYYYYYYyyK....',
  '.....KKyYYYYYYYyyKK.....',
  '.......KKyYYYYyKK.......',
  '.........KZYyK..........',
  '..........KYK...........',
  '..........KK............',
], 24);

// Keyhole pane: inside spans (columns of a 12-wide pane) per body row.
const KEY_INSIDE = {
  2: [4, 7], 3: [3, 8], 4: [2, 9], 5: [2, 9], 6: [2, 9], 7: [2, 9], 8: [3, 8], 9: [4, 7],
  10: [4, 7], 11: [4, 7], 12: [4, 7], 13: [3, 8], 14: [3, 8], 15: [3, 8], 16: [3, 8],
};
const BODY_ROWS = 20;

function lantern() {
  const g = new Grid(24, 16 + BODY_ROWS + LANTERN_BOTTOM.length);
  g.stamp(LANTERN_TOP, P, 0, 0);
  const inside = (r, c) => KEY_INSIDE[r] && c >= KEY_INSIDE[r][0] && c <= KEY_INSIDE[r][1];
  for (let r = 0; r < BODY_ROWS; r++) {
    const y = 16 + r;
    const side = r < 6 ? 2 : r < 13 ? 1 : 0;
    const x0 = 4 - side - 1; // outline x
    const x1 = 19 + side + 1;
    g.set(x0, y, P.K).set(x1, y, P.K);
    for (let k = 0; k < side; k++) {
      g.set(x0 + 1 + k, y, (r + k) % 3 === 0 ? P.S : P.s);
      g.set(x1 - 1 - k, y, (r + k) % 3 === 1 ? P.S : P.s);
    }
    g.set(5, y, r % 5 === 0 ? P.I : P.i).set(18, y, P.i);
    for (let c = 0; c < 12; c++) {
      const x = 6 + c;
      let col;
      if (inside(r, c)) {
        const d = Math.hypot((c + 0.5 - 6) / 4, (r + 0.5 - 8) / 6) + (bayer(x, y) - 0.5) * 0.25;
        col = d < 0.32 ? P.F : d < 0.62 ? P.f : P.e;
      } else {
        const bar =
          [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dc, dr]) => inside(r + dr, c + dc)) || r === 17 || (r === 11 && (c < 3 || c > 8));
        if (bar) col = P.i;
        else {
          const d = Math.hypot((c + 0.5 - 6) / 6, (r + 0.5 - 9) / 10) + (bayer(x, y) - 0.5) * 0.3;
          col = r === 0 ? P.a : d < 0.55 ? P.d : d < 0.85 ? P.c : P.b;
        }
      }
      g.set(x, y, col);
    }
  }
  g.stamp(LANTERN_BOTTOM, P, 0, 16 + BODY_ROWS);
  return g;
}

// ---- bracket: backplate, arm, scroll -----------------------------------------
const BRACKET = check('bracket', [
  '.KKK..................',
  'KIiiK.................',
  'KIiiK.................',
  'KIYiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiK.................',
  'KIiiKKKKKKKKKKKKKKKKKK',
  'KIiiIIIIIIIIIIIIIIIIII',
  'KIiiiiiiiiiiiiiiiiiiii',
  'KIiiKKKKKKKKKKKKKKKKKK',
  'KIiiKiK...............',
  'KIiiK.KiK.............',
  'KIiiK..KiK.......KKK..',
  'KIYiK...KiK....KKiiiK.',
  'KIiiK...KiK...KiiKKiK.',
  'KIiiK...KiK...KiK.KiK.',
  'KIiiK...KiiK..KiiKiK..',
  'KIiiK....KiiKKiiK.KK..',
  '.KKK......KKiiiKK.....',
  '...........KKKK.......',
], 22);

// mark: 48 x 48
function markGrid() {
  const g = new Grid(48, 48);
  g.stamp(BRACKET, P, 4, 12);
  g.blit(lantern(), 18, 2);
  return g;
}

const FAV = check('fav', [
  '.......KK.......',
  '......KZYK......',
  '.....KZYYyK.....',
  '....KZYYYYyK....',
  '...KyyyyyyyyK...',
  '...KabbbbbbaK...',
  '...KbbeFFebbK...',
  '...KbeFFFFebK...',
  '...KbbeFFebbK...',
  '...KbbbFFbbbK...',
  '...KbbeFFebbK...',
  '...KabbbbbbaK...',
  '...KKKKKKKKKK...',
  '....KyYYYYyK....',
  '......KYyK......',
  '.......KK.......',
], 16);

// small lantern for the icon (16 x 26)
function smallLantern() {
  const top = check('stop', [
    '.......KK.......',
    '......KZYK......',
    '......KYyK......',
    '.....KKYYKK.....',
    '....KZYYYYyK....',
    '....KyyyyyyK....',
    '..KKKKKKKKKKKK..',
    '.KZYYYYYYYYYYyK.',
    'KyyyyyyyyyyyyyyK',
    'KzzzzzzzzzzzzzzK',
  ], 16);
  const pane = [
    'bbbbbbbb',
    'ccciiccc',
    'cciFFicc',
    'cifFFfic',
    'cifFFfic',
    'cciFFicc',
    'ccifficc',
    'cciffi cc'.replace(' ', ''),
    'cieeeeic',
    'cciiiicc',
    'bbbbbbbb',
  ];
  const bottom = check('sbot', [
    '.KzzzzzzzzzzzzK.',
    '.KYYYYYYYYYYyyK.',
    '..KKyYYYYYyyKK..',
    '....KKyYYyKK....',
    '......KYyK......',
    '.......KK.......',
  ], 16);
  const g = new Grid(16, 10 + pane.length + bottom.length);
  g.stamp(top, P, 0, 0);
  pane.forEach((row, r) => {
    const y = 10 + r;
    const wide = r < 5;
    if (wide) g.stamp(['KSi' + row + 'iSK'], P, 1, y);
    else g.stamp(['Ki' + row + 'iK'], P, 2, y);
  });
  g.stamp(bottom, P, 0, 10 + pane.length);
  return g;
}

// ---- wordmark: engraved Victorian serif, 2px stems, 1px hairlines -------------
const ROMAN = {
  P: ['#######..', '.##...##.', '.##....##', '.##....##', '.##....##', '.##...##.', '.######..', '.##......', '.##......', '.##......', '.##......', '.##......', '####.....'],
  o: ['', '', '', '', '', '..####..', '.##..##.', '##....##', '##....##', '##....##', '##....##', '.##..##.', '..####..'],
  r: ['', '', '', '', '', '###.##.', '.####..', '.##....', '.##....', '.##....', '.##....', '.##....', '####...'],
  c: ['', '', '', '', '', '..####.', '.##..##', '##.....', '##.....', '##.....', '##.....', '.##...#', '..####.'],
  h: ['###......', '.##......', '.##......', '.##......', '.##......', '.##.###..', '.###..##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '####.####'],
  l: ['###.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####'],
  i: ['', '.**.', '.**.', '', '', '###.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####'],
  g: ['', '', '', '', '', '..####.#', '.##..###', '##....##', '##....##', '##....##', '##....##', '.##..###', '..######', '......##', '......##', '##...##.', '.#####..'],
  t: ['', '', '.##...', '.##...', '.##...', '######', '.##...', '.##...', '.##...', '.##...', '.##...', '.##..#', '..###.'],
};
function drawRoman(g, x0, y0, paint) {
  let x = x0;
  for (const ch of 'Porchlight') {
    const gl = ROMAN[ch];
    gl.forEach((row, y) => [...row].forEach((p, i) => p !== '.' && paint(x + i, y0 + y, p)));
    x += Math.max(...gl.map((r) => r.length)) + 2;
  }
  return x - 2 - x0;
}
const ROMAN_W = (() => {
  const g = new Grid(200, 20);
  return drawRoman(g, 0, 0, () => {});
})();

function logo() {
  const g = new Grid(160, 50);
  g.blit(markGrid(), 2, 1);
  const X = 59;
  const Y = 19;
  drawRoman(g, X, Y, (x, y, p) => g.set(x, y, p === '*' ? P.c : '#231a16'));
  return g;
}

// ---- scene ----------------------------------------------------------------------
const S = {
  ink: '#0b0808',
  mortar: '#140c0b',
  brick1: '#2e1712',
  brick2: '#361b14',
  brick3: '#27140f',
  brick4: '#3d1f16',
  brickHi: '#43241a',
  stone: '#232020',
  stoneHi: '#302b29',
  stoneLo: '#141212',
  brass: '#7a5a28',
  brassHi: '#9c7533',
  brassLo: '#4a3416',
  engrave: '#24160a',
  sand: '#3a3330',
  sandHi: '#4a423d',
  sandLo: '#221d1b',
  door: '#0e1714',
  doorHi: '#18251f',
  doorLo: '#070c0a',
};
const RAMPS = {
  [S.mortar]: ['#1d1210', '#2b1914', '#3f2318', '#5a321e'],
  [S.brick1]: ['#43201a', '#5e2c1e', '#843f24', '#b05a2e'],
  [S.brick2]: ['#4d241b', '#6b3320', '#934826', '#c06532'],
  [S.brick3]: ['#391c15', '#51261a', '#73361f', '#984a26'],
  [S.brick4]: ['#55291d', '#753a23', '#a2532b', '#d07538'],
  [S.brickHi]: ['#5c2e21', '#7f4128', '#ad5c31', '#df8240'],
  [S.stone]: ['#302a27', '#463a31', '#64513d', '#88704f'],
  [S.stoneHi]: ['#3f3631', '#5a4a3b', '#806749', '#ad8c60'],
  [S.stoneLo]: ['#1c1816', '#29211c', '#3a2d23', '#4f3c2c'],
  [S.brass]: ['#8c6830', '#a77d38', '#c79a45', '#e7bb58'],
  [S.brassHi]: ['#b08640', '#cfa152', '#ebc06a', '#ffdd8a'],
  [S.brassLo]: ['#58401c', '#6d4f22', '#86622a', '#a07834'],
  [S.engrave]: ['#2c1a0b', '#341f0d', '#3e2510', '#4a2c12'],
  [S.sand]: ['#4d4038', '#6a5545', '#917256', '#c09a6c'],
  [S.sandHi]: ['#5e4f45', '#806853', '#ab8a64', '#dcb680'],
  [S.sandLo]: ['#2c2421', '#3b2f28', '#4f3d31', '#6a503c'],
  [S.door]: ['#14201b', '#1c2a22', '#28372a', '#384733'],
  [S.doorHi]: ['#1f3029', '#2b3f33', '#3c523f', '#53684c'],
  [S.doorLo]: ['#0b120f', '#111a15', '#18231b', '#223024'],
};

function brickWall(g, x0, y0, w, h, seed = 1) {
  g.rect(x0, y0, w, h, S.mortar);
  const tones = [S.brick1, S.brick2, S.brick3, S.brick1, S.brick2, S.brick4];
  for (let row = 0; row * 5 < h; row++) {
    const y = y0 + row * 5;
    const off = row % 2 ? -6 : 0;
    for (let bx = off; bx < w; bx += 13) {
      const k = Math.abs((row * 7 + Math.floor((bx + 20) / 13) * 13 + seed * 5) % tones.length);
      const tone = tones[k];
      g.rect(x0 + bx, y, 12, 4, tone);
      // a lighter top edge on some bricks, a chip on a few
      if ((row + bx) % 3 === 0) g.hline(x0 + bx + 1, y, 10, S.brickHi);
      if ((row * 5 + bx) % 17 === 0) g.set(x0 + bx + 3, y + 3, S.mortar);
    }
  }
}

function hero() {
  const g = new Grid(320, 160);
  brickWall(g, 0, 0, 320, 146);
  // stone plinth
  g.rect(0, 144, 320, 16, S.stone);
  g.hline(0, 144, 320, S.stoneHi).hline(0, 145, 320, S.stoneHi);
  for (let x = 0; x < 320; x += 41) g.vline(x, 146, 14, S.stoneLo);
  g.hline(0, 159, 320, S.stoneLo);

  // brass plaque
  const PX = 136;
  const PY = 50;
  const PW = 162;
  const PH = 62;
  g.rect(PX + 2, PY + PH, PW, 2, S.ink); // shadow on the brick
  g.rect(PX + PW, PY + 2, 2, PH, S.ink);
  for (let y = PY; y < PY + PH; y++) for (let x = PX; x < PX + PW; x++) {
    const corner = (x - PX < 2 && y - PY < 2) || (PX + PW - 1 - x < 2 && y - PY < 2) || (x - PX < 2 && PY + PH - 1 - y < 2) || (PX + PW - 1 - x < 2 && PY + PH - 1 - y < 2);
    if (corner && (x - PX + y - PY) % 1 === 0 && Math.min(x - PX, PX + PW - 1 - x) + Math.min(y - PY, PY + PH - 1 - y) < 2) continue;
    g.set(x, y, S.brass);
  }
  g.hline(PX + 2, PY, PW - 4, S.brassHi).hline(PX + 1, PY + 1, PW - 2, S.brassHi);
  g.vline(PX, PY + 2, PH - 4, S.brassHi).vline(PX + 1, PY + 1, PH - 2, S.brassHi);
  g.hline(PX + 2, PY + PH - 1, PW - 4, S.brassLo).hline(PX + 1, PY + PH - 2, PW - 2, S.brassLo);
  g.vline(PX + PW - 1, PY + 2, PH - 4, S.brassLo).vline(PX + PW - 2, PY + 1, PH - 2, S.brassLo);
  // inset rule
  g.hline(PX + 5, PY + 5, PW - 10, S.brassLo).hline(PX + 5, PY + PH - 6, PW - 10, S.brassHi);
  g.vline(PX + 5, PY + 5, PH - 10, S.brassLo).vline(PX + PW - 6, PY + 5, PH - 10, S.brassHi);
  // screws
  for (const [sx, sy] of [[PX + 9, PY + 9], [PX + PW - 12, PY + 9], [PX + 9, PY + PH - 12], [PX + PW - 12, PY + PH - 12]]) {
    g.stamp(['.hh.', 'hlKh', 'hKll', '.ll.'], { h: S.brassHi, l: S.brassLo, K: S.engrave }, sx, sy);
  }
  // engraved name: a dark cut with a bright lower lip
  const nx = PX + Math.round((PW - ROMAN_W) / 2);
  const ny = PY + 13;
  const cut = new Set();
  drawRoman(g, nx, ny, (x, y) => cut.add(`${x},${y}`));
  for (const k of cut) {
    const [x, y] = k.split(',').map(Number);
    g.set(x, y, S.engrave);
    if (!cut.has(`${x},${y + 1}`)) g.set(x, y + 1, S.brassHi);
  }
  // tagline engraved smaller, centred, two lines
  const lines = ['A light left on over', 'your own front door.'];
  lines.forEach((t, k) => {
    const w = measureText(t);
    const tx = PX + Math.round((PW - w) / 2);
    const ty = PY + 34 + k * 11;
    drawText(g, t, tx, ty + 1, S.brassHi);
    drawText(g, t, tx, ty, S.engrave);
  });

  // the front door on the left: stone surround, black-green door, step
  g.rect(0, 4, 36, 10, S.sand);
  g.hline(0, 4, 36, S.sandHi).hline(0, 13, 36, S.sandLo);
  g.rect(14, 2, 8, 13, S.sand); // keystone
  g.hline(14, 2, 8, S.sandHi).vline(21, 3, 12, S.sandLo).vline(14, 3, 12, S.sandHi);
  g.rect(22, 14, 12, 130, S.sand); // pilaster
  g.vline(22, 14, 130, S.sandLo).vline(23, 14, 130, S.sandHi).vline(33, 14, 130, S.sandLo);
  for (let y = 30; y < 144; y += 26) g.hline(24, y, 9, S.sandLo);
  g.rect(0, 14, 22, 130, S.door);
  g.vline(21, 14, 130, S.doorLo);
  for (const [py, ph] of [[20, 50], [78, 58]]) {
    g.rect(3, py, 15, ph, S.doorLo);
    g.rect(4, py + 1, 13, ph - 2, S.door);
    g.hline(3, py + ph - 1, 15, S.doorHi).vline(17, py, ph, S.doorHi);
    g.rect(6, py + 3, 9, ph - 6, S.doorHi);
    g.rect(6, py + 4, 8, ph - 7, S.door);
  }
  // brass letter plate and knob on the door
  g.rect(4, 72, 13, 3, S.brass);
  g.hline(4, 72, 13, S.brassHi).hline(5, 73, 11, S.engrave);
  g.stamp(['.hh', 'hHl', '.ll'], { h: S.brassHi, H: '#ffe7a8', l: S.brassLo }, 16, 98);
  // doorstep
  g.rect(0, 140, 40, 6, S.sand);
  g.hline(0, 140, 40, S.sandHi).hline(0, 145, 40, S.sandLo);
  g.vline(39, 140, 6, S.sandLo);

  // light: the lantern hangs at x 40..88
  const LX = 62;
  const LY = 58;
  const pool = Grid.pool({ cx: LX, cy: LY + 6, rx: 104, ry: 84, thresholds: [1, 0.72, 0.5, 0.3], spread: 0.08 });
  g.relight((x, y) => {
    let l = pool(x, y);
    if (y < 16 && Math.abs(x + 0.5 - LX) < 8 + (16 - y)) l -= 1; // the roof shades the wall above
    return Math.max(0, l);
  }, RAMPS);
  // shadow of the lantern cast down-right? the lamp is the light: no cast shadow,
  // but the bracket throws a soft one on the bricks below it
  g.stamp(BRACKET, P, 36, 46);
  g.blit(lantern(), 50, 36);
  // moths
  const moth = { A: '#e8d9b8', B: '#9c8566' };
  g.stamp(['A.A', '.B.'], moth, 90, 40);
  g.stamp(['A.A.A', '.ABA.', '..B..'], moth, 50, 24);
  g.stamp(['A.A', '.B.'], moth, 82, 92);
  return g;
}

function icon() {
  const g = new Grid(32, 32);
  brickWall(g, 0, 0, 32, 32, 3);
  const pool = Grid.pool({ cx: 16, cy: 17, rx: 18, ry: 17, thresholds: [1, 0.72, 0.48, 0.28], spread: 0.12 });
  g.relight(pool, RAMPS);
  g.blit(smallLantern(), 8, 3);
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
  'mark.svg': svg({ w: 480, h: 480, vb: '0 0 48 48', crisp: true, body: mark.toPaths() }),
  'favicon.svg': svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: new Grid(16, 16).stamp(FAV, P).toPaths() }),
  'favicon-32.svg': svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: new Grid(32, 32).blit(smallLantern(), 8, 2).toPaths() }),
  'logo.svg': svg({ w: 640, h: 200, vb: '0 0 160 50', crisp: true, body: logo().toPaths() }),
  'icon.svg': svg({ w: 512, h: 512, vb: '0 0 32 32', crisp: true, body: icon().toPaths() }),
  'hero.svg': svg({ w: 1280, h: 640, vb: '0 0 320 160', crisp: true, body: hero().toPaths() }),
  'notes.md': `# 04 Lantern keyhole (pixel)

A brass-and-iron carriage lantern on a scrolled wall bracket, set into red-brown brick; its glazing bars frame a keyhole-shaped pane, so the brightest light in the lantern comes through a keyhole. The name is engraved on a brass house plaque beside it.
Palette: brick #2e1712 / #361b14 lit to #c06532, mortar #140c0b, iron #2a2626, brass #6e4f22 / #b8893f / #e8c071, glass #c4652a / #e8913a / #ffbe5c, keyhole #fff4d4 / #ffffff.
Type: hand-drawn pixel roman with 2px stems and hairline serifs, cut into the plaque with a bright lower lip; tagline in a 5px pixel face. Mark drawn at 48 x 48.
`,
});
