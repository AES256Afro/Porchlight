// 06 Light switch (pixel): the switch by the front door, seen from the dark
// hall. Toggle up, the pilot jewel lit, the porch light glowing through the
// door's glass and laying the window's shape across the floor.
import { Grid, drawText, measureText, bayer } from '../lib/pixel.mjs';
import { svg, writeConcept } from '../lib/svg.mjs';

const SLUG = '06-light-switch-pixel';

function check(name, rows, w) {
  rows.forEach((r, i) => {
    if ([...r].length !== w) throw new Error(`${name} row ${i} is ${[...r].length} wide, want ${w}: "${r}"`);
  });
  return rows;
}

// ---- palette -------------------------------------------------------------
const C = {
  // brass plate
  k: '#3a2a10', // outline
  s: '#7a5a22', // shadow bevel
  b: '#b38a3c', // face
  H: '#d9b562', // lit face
  h: '#f4dd9c', // highlight bevel
  x: '#140d06', // slot
  // ivory toggle
  v: '#f3ebd6',
  u: '#cfc3a2',
  q: '#8f8468',
  // pilot jewel
  r: '#d8742a',
  a: '#ffc25a',
  A: '#fff4d2',
};
const W = { w0: '#18211d', w1: '#223029', w2: '#2b3b33', w3: '#3b5145', w4: '#5a7563' }; // sage wallpaper
const R = { r0: '#3a382e', r1: '#585542', r2: '#787259', r3: '#9d9577' }; // cream trim at night
const M = { m0: '#2c2210', m1: '#463517', m2: '#5d461d', m3: '#755924' }; // mustard wainscot
const D = { d0: '#21140c', d1: '#352114', d2: '#472c1a', d3: '#5c3922' }; // door wood
const F = { f0: '#150e0a', f1: '#241912', f2: '#2f2118', f3: '#3a291d' }; // floor
const RUG = { g0: '#2a0f10', g1: '#431a19', g2: '#5c2622', g3: '#8a6a3c' };
const G = { g1: '#c4632a', g2: '#ee983c', g3: '#ffc766', g4: '#ffe6a6', g5: '#fff8e2', i0: '#2a1a0e' }; // glass light

// ---- switch plate builder ----------------------------------------------------
const TOGGLE = check('toggle', [
  '..vv..',
  '.vvvv.',
  '.vvvu.',
  '.vvvu.',
  '.vvuq.',
  '.vuuq.',
  '.vuuq.',
  'kxuuxk',
  'kxqqxk',
  'kxxxxk',
  'kxxxxk',
  '.kkkk.',
], 6);
const TOGGLE_S = check('toggleS', [
  '..vv..',
  '.vvvu.',
  '.vvuq.',
  '.vuuq.',
  'kxuuxk',
  'kxxxxk',
  'kxxxxk',
  '.kkkk.',
], 6);
const JEWEL4 = check('jewel4', ['.rr.', 'raar', 'raAr', '.rr.'], 4);
const JEWEL6 = check('jewel6', ['..rr..', '.raar.', 'raAAar', 'raAAar', '.raar.', '..rr..'], 6);
const SCREW = check('screw', ['.hh.', 'kkkk', '.ss.'], 4);
// 3x5 capitals for the engraved label
const CAPS = {
  P: ['###', '#.#', '###', '#..', '#..'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  R: ['###', '#.#', '##.', '#.#', '#.#'],
  C: ['###', '#..', '#..', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
};

function plate(g, x0, y0, w, h, { jewel = JEWEL4, toggle = TOGGLE, screws = true, label = false, glow = 6 } = {}) {
  // body with 1px rounded corners and bevels
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      if (corner) continue;
      let c = C.b;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c = C.k;
      else if (y === 1 || x === 1) c = C.h;
      else if (y === h - 2 || x === w - 2) c = C.s;
      g.set(x0 + x, y0 + y, c);
    }
  const cx = x0 + w / 2; // centre line (between two columns when w is even)
  let y = y0 + 2;
  if (screws) {
    g.stamp(SCREW, C, Math.round(cx - 2), y);
    y += 4;
  } else y += 1;
  const jw = jewel[0].length;
  const jy = y;
  // warm halo on the brass around the jewel
  const jcx = cx;
  const jcy = jy + jewel.length / 2;
  for (let yy = y0 + 2; yy < y0 + h - 2; yy++)
    for (let xx = x0 + 2; xx < x0 + w - 2; xx++) {
      if (g.get(xx, yy) !== C.b) continue;
      const d = Math.hypot(xx + 0.5 - jcx, (yy + 0.5 - jcy) * 1.15) / glow;
      if (d < 0.55 || (d < 1 && bayer(xx, yy) > (d - 0.55) / 0.45)) g.set(xx, yy, C.H);
    }
  g.stamp(jewel, C, Math.round(cx - jw / 2), jy);
  y += jewel.length + 1;
  g.stamp(toggle, C, Math.round(cx - 3), y);
  y += toggle.length + 1;
  if (label) {
    const text = 'PORCH';
    const tw = text.length * 4 - 1;
    const lx = Math.round(cx - (tw + 2) / 2);
    g.rect(lx, y, tw + 2, 7, C.s);
    g.hline(lx, y + 6, tw + 2, C.h);
    g.vline(lx + tw + 1, y, 7, C.h);
    g.rect(lx + 1, y + 1, tw, 5, C.H);
    let tx = lx + 1;
    for (const ch of text) {
      CAPS[ch].forEach((row, j) => [...row].forEach((p, i) => p === '#' && g.set(tx + i, y + 1 + j, C.k)));
      tx += 4;
    }
    y += 8;
  }
  if (screws) g.stamp(SCREW, C, Math.round(cx - 2), y0 + h - 5);
}

// ---- rounded friendly pixel hand: 2px stems, round bowls ----------------------
const ROUND = {
  P: ['######..', '#######.', '##...###', '##....##', '##....##', '##...###', '#######.', '######..', '##......', '##......', '##......', '##......', '##......'],
  o: ['', '', '', '', '..####..', '.######.', '###..###', '##....##', '##....##', '##....##', '###..###', '.######.', '..####..'],
  r: ['', '', '', '', '##.###', '######', '###...', '##....', '##....', '##....', '##....', '##....', '##....'],
  c: ['', '', '', '', '..#####', '.######', '###....', '##.....', '##.....', '##.....', '###....', '.######', '..#####'],
  h: ['##......', '##......', '##......', '##......', '##.###..', '#######.', '###..###', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##'],
  l: ['##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '###', '.##'],
  i: ['', '**', '**', '', '##', '##', '##', '##', '##', '##', '##', '##', '##'],
  g: ['', '', '', '', '..######', '.#######', '###..###', '##....##', '##....##', '##....##', '###..###', '.#######', '..######', '......##', '##...###', '.######.'],
  t: ['', '.##..', '.##..', '.##..', '#####', '#####', '.##..', '.##..', '.##..', '.##..', '.##..', '.###.', '..###'],
};
const GAP = 2;
function glyphW(gl) {
  return Math.max(...gl.map((r) => r.length));
}
function wordWidth(word) {
  return [...word].reduce((s, ch) => s + glyphW(ROUND[ch]), 0) + GAP * (word.length - 1);
}
function drawWord(word, paint) {
  let x = 0;
  for (const ch of word) {
    const gl = ROUND[ch];
    gl.forEach((row, y) => [...row].forEach((p, i) => p !== '.' && paint(x + i, y, p)));
    x += glyphW(gl) + GAP;
  }
}

// ---- mark: plate 22 x 30 on a 32 grid ------------------------------------------
function markGrid() {
  const g = new Grid(32, 32);
  plate(g, 5, 1, 22, 30, { jewel: JEWEL4, toggle: TOGGLE, glow: 7 });
  // a few warm pixels escaping past the plate edge, level with the jewel
  for (const [x, y, c] of [[2, 9, G.g2], [1, 9, G.g1], [3, 6, G.g1], [3, 12, G.g1]]) {
    g.set(x, y, c).set(31 - x, y, c);
  }
  return g;
}

// ---- favicon 16 -----------------------------------------------------------------
const FAV16 = check('fav16', [
  '................',
  '...kkkkkkkkkk...',
  '...khhhhhhhhk...',
  '...khbbrrbbsk...',
  '...khbraarbsk...',
  '...khbbrrbbsk...',
  '...khbbvvbbsk...',
  '...khbbvubbsk...',
  '...khbkvukbsk...',
  '...khbkxxkbsk...',
  '...khbkxxkbsk...',
  '...khbbkkbbsk...',
  '...khbbbbbbsk...',
  '...kssssssssk...',
  '...kkkkkkkkkk...',
  '................',
], 16);

// ---- wallpaper ------------------------------------------------------------------
function wallpaper(g, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const col = Math.floor(x / 8);
      const yy = (y + (col % 2) * 4) % 8;
      const xx = x % 8;
      let c = W.w2;
      if (xx === 4 && yy === 3) c = W.w4;
      else if ((xx === 3 || xx === 5) && yy === 3) c = W.w3;
      else if (xx === 4 && (yy === 2 || yy === 4)) c = W.w3;
      else if (xx === 0) c = W.w1; // a faint stripe between motif columns
      g.set(x, y, c);
    }
}

// ---- hero: 256 x 128 at x5 ----------------------------------------------------------
function hero() {
  const g = new Grid(256, 128, W.w2);
  wallpaper(g, 0, 0, 256, 84);
  // chair rail, wainscot (beadboard), baseboard
  g.rect(0, 84, 256, 3, R.r2);
  g.hline(0, 84, 256, R.r3).hline(0, 86, 256, R.r0);
  for (let y = 87; y < 103; y++) for (let x = 0; x < 256; x++) g.set(x, y, x % 5 === 0 ? M.m0 : x % 5 === 1 ? M.m3 : M.m2);
  g.hline(0, 87, 256, M.m0);
  g.rect(0, 103, 256, 6, R.r1);
  g.hline(0, 103, 256, R.r3).hline(0, 104, 256, R.r2).hline(0, 108, 256, R.r0);
  // floor
  const edges = [109, 111, 114, 118, 123, 128];
  for (let k = 0; k < edges.length - 1; k++) {
    const y = edges[k];
    const hh = edges[k + 1] - y;
    g.rect(0, y, 256, hh, F.f2);
    g.hline(0, y, 256, F.f3);
    g.hline(0, y + hh - 1, 256, F.f0);
    for (let x = (k * 41) % 70 + 10; x < 256; x += 70 + k * 9) g.vline(x, y, hh, F.f0);
  }
  // runner rug from the door toward us
  for (let y = 110; y < 128; y++) {
    const t = (y - 110) / 17;
    const a = Math.round(16 - t * 10);
    const b = Math.round(64 + t * 8);
    for (let x = a; x <= b; x++) {
      const e = x === a || x === b;
      const band = x === a + 2 || x === b - 2 || y === 112;
      g.set(x, y, e ? RUG.g0 : band ? RUG.g3 : (x + y) % 4 === 0 ? RUG.g2 : RUG.g1);
    }
  }

  // door casing
  g.rect(6, 2, 70, 107, R.r2);
  g.hline(6, 2, 70, R.r3).vline(6, 2, 107, R.r3).vline(75, 2, 107, R.r0);
  g.rect(9, 5, 64, 104, R.r1);
  g.vline(9, 5, 104, R.r0).hline(9, 5, 64, R.r0);
  // door leaf
  g.rect(12, 8, 58, 100, D.d2);
  g.hline(12, 8, 58, D.d0).vline(12, 8, 100, D.d0).vline(69, 8, 100, D.d1);
  // glass, 2 x 3 panes, glowing from the porch light outside (hot top right)
  const GX = 18, GY = 14, GW = 46, GH = 44;
  g.rect(GX - 2, GY - 2, GW + 4, GH + 4, D.d1);
  g.hline(GX - 2, GY - 2, GW + 4, D.d0).vline(GX - 2, GY - 2, GH + 4, D.d0);
  g.hline(GX - 2, GY + GH + 1, GW + 4, D.d3).vline(GX + GW + 1, GY - 2, GH + 4, D.d3);
  const lampX = GX + GW - 8, lampY = GY + 6;
  for (let y = GY; y < GY + GH; y++)
    for (let x = GX; x < GX + GW; x++) {
      const d = Math.hypot((x + 0.5 - lampX) / 52, (y + 0.5 - lampY) / 50);
      const v = Math.max(0, 1 - d) * 4.2; // 0..~4 across g1..g5
      const n = Math.floor(v) + (v - Math.floor(v) > bayer(x, y) ? 1 : 0);
      g.set(x, y, [G.g1, G.g1, G.g2, G.g3, G.g4, G.g5][Math.min(5, n)]);
    }
  // outside, seen through the glass: the lamp on its bracket, a porch post and rail
  g.stamp(check('lampOut', ['..kk..', '.kkkk.', 'k5555k', 'k5555k', 'k5555k', '.kkkk.', '..kk..'], 6), { k: G.i0, 5: G.g5 }, lampX - 3, lampY - 3);
  g.hline(lampX + 3, lampY, 5, G.i0);
  g.rect(GX + 4, GY + 20, 3, GH - 20, '#6a3518');
  g.rect(GX, GY + 30, GW, 2, '#7a3e1a');
  for (let x = GX + 10; x < GX + GW; x += 6) g.rect(x, GY + 32, 1, GH - 32, '#8a4a1e');
  // muntins over the glass
  g.rect(GX + 22, GY, 2, GH, D.d2);
  g.vline(GX + 22, GY, GH, D.d1);
  g.rect(GX, GY + 14, GW, 2, D.d2).rect(GX, GY + 29, GW, 2, D.d2);
  g.hline(GX, GY + 14, GW, D.d1).hline(GX, GY + 29, GW, D.d1);
  // the frame and muntins catch light on their inner edges
  g.vline(GX + 23, GY, GH, D.d3);
  g.hline(GX, GY + 15, GW, D.d3).hline(GX, GY + 30, GW, D.d3);
  // lower panels
  for (const px of [18, 44]) {
    g.rect(px, 66, 20, 36, D.d1);
    g.rect(px + 1, 67, 19, 35, D.d3);
    g.rect(px + 2, 68, 17, 33, D.d2);
    g.rect(px + 4, 70, 13, 29, D.d1);
    g.rect(px + 5, 71, 12, 28, D.d2);
  }
  // deadbolt thumb turn and latch knob (brass), plus a hanging chain
  g.stamp(['.kk.', 'kbhk', 'khbk', 'kbsk', '.kk.'], C, 63, 60);
  g.stamp(['.kkk.', 'khhbk', 'khbbk', 'kbbsk', '.kkk.'], C, 62, 72);
  for (const [x, y] of [[66, 52], [66, 54], [65, 56], [64, 58]]) g.set(x, y, C.b).set(x, y + 1, C.s);
  g.rect(65, 50, 3, 2, C.s);
  // threshold
  g.rect(8, 107, 66, 2, C.s);
  g.hline(8, 107, 66, C.H);

  // the porch light falling through the glass onto the rug and floor
  const FLOORRAMP = {
    [F.f0]: ['#2a170c', '#47270f', '#6a3c16'],
    [F.f1]: ['#3a2212', '#5e3617', '#8a521f'],
    [F.f2]: ['#45291a', '#6e411f', '#a26228'],
    [F.f3]: ['#52321f', '#835026', '#bc7a30'],
    [RUG.g0]: ['#3c1611', '#5a2414', '#7a3418'],
    [RUG.g1]: ['#5a2219', '#84381d', '#b45526'],
    [RUG.g2]: ['#743020', '#a24a26', '#d0702e'],
    [RUG.g3]: ['#a57d43', '#c99a52', '#f0c06a'],
  };
  const patch = (x, y) => {
    if (y < 110) return 0;
    const t = (y - 110) / 17;
    const a = 22 - t * 18;
    const b = 60 - t * 6;
    const m = (a + b) / 2;
    const inside = x + 0.5 > a && x + 0.5 < b;
    if (!inside) {
      const near = x + 0.5 > a - 2 && x + 0.5 < b + 2;
      return near && bayer(x, y) < 0.5 ? 1 : 0;
    }
    if (Math.abs(x + 0.5 - m) < 1 + t) return 1; // muntin shadow
    if (y === 115 || y === 121) return 1;
    const edge = x + 0.5 < a + 1.5 || x + 0.5 > b - 1.5;
    return edge ? 2 : 3;
  };
  g.relight(patch, FLOORRAMP, { x: 0, y: 109, w: 100, h: 19 });
  // a faint warm bounce on the baseboard and wainscot just above the patch
  const bounce = Grid.pool({ cx: 34, cy: 112, rx: 40, ry: 12, thresholds: [1, 0.6], spread: 0.15 });
  g.relight(bounce, {
    [R.r0]: ['#463b2c', '#5a4730'],
    [R.r1]: ['#6a5b44', '#836a48'],
    [R.r2]: ['#8a7858', '#a68a5c'],
    [R.r3]: ['#b09a72', '#c9a874'],
  }, { x: 0, y: 100, w: 90, h: 9 });

  // the switch plate, a key hook below it
  const PX = 84, PY = 40;
  plate(g, PX, PY, 26, 38, { jewel: JEWEL6, toggle: TOGGLE, label: true, glow: 6.5 });
  // the plate's shadow on the wallpaper (light-from-glass side is the left)
  g.vline(PX + 26, PY + 2, 36, W.w0).hline(PX + 2, PY + 38, 25, W.w0);
  // warm spill from the jewel onto the wall around the plate
  // key hook on the chair rail, a key ring with two keys and a paper tag
  g.stamp(check('hook', ['.kk.', 'khbk', '.kb.', '..b.', '..b.', 'b.b.', '.bb.'], 4), C, 95, 84);
  // a key hanging from the hook, and a paper tag on a red thread
  const STEEL = { e: '#7f868b', E: '#d3d8db', d: '#4b5155' };
  g.stamp(check('key', ['.ee.', 'e..e', 'e..e', '.ee.', '.E..', '.Ed.', '.E..', '.Edd', '.E..', '.Edd', '.e..'], 4), STEEL, 95, 89);
  g.stamp(check('tag', ['r....', '.r...', '.ggg.', 'gwwwg', 'gwkwg', 'gwwwg', '.ggg.'], 5), { r: '#9a3426', g: '#8f8164', w: '#d6c89c', k: '#5a5040' }, 98, 91);

  // type
  const word = new Grid(100, 20);
  const CREAM = '#f3e5c2';
  let dot = null;
  drawWord('Porchlight', (x, y, p) => {
    if (p === '*') {
      word.set(2 + x, 2 + y, C.a);
      dot = dot || [2 + x, 2 + y];
    } else word.set(2 + x, 2 + y, CREAM);
  });
  word.outline([CREAM, C.a], W.w0);
  if (dot) {
    const [dx, dy] = dot;
    word.set(dx, dy, C.A);
  }
  const ww = wordWidth('Porchlight');
  const tag1 = 'A light left on over';
  const tag2 = 'your own front door.';
  const blockW = Math.max(ww, measureText(tag1), measureText(tag2));
  const TX = Math.round(118 + (256 - 118 - blockW) / 2);
  // shadow for the wordmark, one pixel down and right
  const shadow = new Grid(100, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 100; x++) if (word.get(x, y) != null) shadow.set(x + 1, y + 1, W.w0);
  g.blit(shadow, TX - 2, 26);
  g.blit(word, TX - 2, 26);
  drawText(g, tag1, TX, 50, '#c8bb93', { shadow: W.w0 });
  drawText(g, tag2, TX, 62, '#c8bb93', { shadow: W.w0 });
  return g;
}

// ---- icon: 32 x 32, the plate on a tile of wallpaper ---------------------------------
function iconGrid() {
  const g = new Grid(32, 32);
  const span = (y) => (y === 0 || y === 31 ? 3 : y === 1 || y === 30 ? 1 : y === 2 || y === 29 ? 1 : 0);
  const paper = new Grid(32, 32);
  wallpaper(paper, 0, 0, 32, 32);
  for (let y = 0; y < 32; y++) {
    const a = span(y);
    for (let x = a; x < 32 - a; x++) g.set(x, y, paper.get(x, y));
  }
  // warm light on the paper around the plate's jewel
  const pool = Grid.pool({ cx: 16, cy: 11, rx: 15, ry: 14, thresholds: [1, 0.6], spread: 0.16 });
  g.relight(pool, { [W.w1]: ['#2c3226', '#3a3a28'], [W.w2]: ['#36402f', '#4a4a33'], [W.w3]: ['#4a5640', '#625e40'], [W.w4]: ['#6c7a58', '#887c52'] });
  plate(g, 8, 4, 16, 24, { jewel: JEWEL4, toggle: TOGGLE_S, screws: true, glow: 6 });
  g.vline(24, 6, 22, W.w0).hline(10, 28, 15, W.w0);
  // tile edge
  for (let y = 0; y < 32; y++) {
    const a = span(y);
    g.set(a, y, W.w0).set(31 - a, y, W.w0);
  }
  g.hline(3, 0, 26, W.w0).hline(3, 31, 26, W.w0);
  for (const [x, y] of [[1, 1], [2, 1], [29, 1], [30, 1], [1, 30], [2, 30], [29, 30], [30, 30]]) g.set(x, y, W.w0);
  return g;
}

// ---- logo: 160 x 50 at x4 ---------------------------------------------------------------
function logoGrid() {
  const g = new Grid(160, 50);
  g.blit(markGrid(), 16, 9);
  const INK = '#1f2f28';
  const ww = wordWidth('Porchlight');
  const X = 58;
  const Y = 16;
  drawWord('Porchlight', (x, y, p) => g.set(X + x, Y + y, p === '*' ? C.r : INK));
  // the dot of the i is a little pilot light
  const ix = X + [...'Porchl'].reduce((s, ch) => s + glyphW(ROUND[ch]) + GAP, 0);
  g.set(ix, Y + 1, C.a).set(ix + 1, Y + 1, C.a).set(ix, Y + 2, C.a).set(ix, Y + 1, C.A);
  if (X + ww > 158) throw new Error('logo overflow');
  return g;
}

const crisp = (grid, w, h, vb) => svg({ w, h, vb, crisp: true, body: grid.toPaths() });
const mark = markGrid();
writeConcept(SLUG, {
  'mark.svg': crisp(mark, 512, 512, '0 0 32 32'),
  'favicon.svg': crisp(new Grid(16, 16).stamp(FAV16, C), 16, 16, '0 0 16 16'),
  'favicon-32.svg': crisp(mark, 32, 32, '0 0 32 32'),
  'logo.svg': crisp(logoGrid(), 640, 200, '0 0 160 50'),
  'icon.svg': crisp(iconGrid(), 512, 512, '0 0 32 32'),
  'hero.svg': crisp(hero(), 1280, 640, '0 0 256 128'),
  'notes.md': `# 06 Light switch (pixel)

The switch by the front door, seen from the dark hall: a brass plate with the toggle up, its pilot jewel lit to say the porch light is on, and the light outside coming through the door's glass and laying the window's shape across the rug. Porchlight is the switch you leave on.
Palette: brass #3a2a10 / #b38a3c / #f4dd9c, ivory #f3ebd6, jewel #d8742a / #ffc25a, sage wallpaper #2b3b33 / #5a7563, mustard wainscot #5d461d, door #472c1a, glass #c4632a to #fff8e2.
Type: hand-drawn rounded pixel wordmark (2px stems, round bowls), the i's dot is the pilot light; engraved 3x5 capitals on the label; 5px pixel face for the tagline.
`,
});
