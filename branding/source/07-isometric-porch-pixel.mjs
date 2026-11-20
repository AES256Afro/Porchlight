// 07 Isometric porch (pixel): a small house corner and porch on a floating
// tile of ground at night, drawn in 2:1 isometric pixel lines. The porch
// light is the only warm thing on the island.
import { Grid, drawText, measureText, bayer } from '../lib/pixel.mjs';
import { svg, writeConcept } from '../lib/svg.mjs';

const SLUG = '07-isometric-porch-pixel';

function check(name, rows, w) {
  rows.forEach((r, i) => {
    if ([...r].length !== w) throw new Error(`${name} row ${i} is ${[...r].length} wide, want ${w}: "${r}"`);
  });
  return rows;
}

// ---- palette ----------------------------------------------------------------
const K = {
  sky0: '#0f1629', sky1: '#141d34', sky2: '#1b2642', star: '#c8d2ee', star2: '#6f7ea8',
  grass: '#22342f', tuft: '#2c4038', gdark: '#1a2826', glip: '#355047',
  soilL: '#4a2c25', soilR: '#36201b', soilLine: '#5e3a2d', soilDark: '#26140f', stone: '#6a564d', root: '#2e1a14',
  wallL: '#6b402e', wallR: '#55301f', wallLine: '#5a3424', wallLineR: '#472718',
  trimL: '#a39886', trimR: '#7f7666',
  roofB: '#2d3350', roofF: '#232842', roofLine: '#191c2e', ridge: '#424a6e', fascia: '#8a8272',
  door: '#22484a', doorDark: '#173536', glassDark: '#111a2c', glassFrame: '#a39886',
  deck: '#4c3b34', deckLine: '#382b26', deckSide: '#3a2c27',
  step: '#4a4f62', stepSide: '#363a4a',
  path: '#454b5c', joint: '#2c3040',
  mail: '#7c2723', mailSide: '#5a1a18', post: '#3a2c26', flag: '#d29c3c',
  picket: '#5b6378', picketSide: '#454c5f',
  bush: '#1c302b', bushHi: '#294538',
  lampFrame: '#16161e', lamp1: '#ffbf55', lamp2: '#ffe8a8', lamp3: '#fffbe8',
  cream: '#f4e4c0',
};
// light ramps (levels 1..3)
const RAMP = {
  [K.grass]: ['#34432f', '#5a6234', '#8f8442'],
  [K.tuft]: ['#3f5034', '#6a6e3a', '#a3964a'],
  [K.gdark]: ['#28322a', '#454a2e', '#6c6436'],
  [K.glip]: ['#4a5a3c', '#787a42', '#b0a04e'],
  [K.wallL]: ['#844f33', '#b06a3c', '#d98d4a'],
  [K.wallLine]: ['#6e4029', '#935632', '#b8713c'],
  [K.trimL]: ['#c4b394', '#e2cca0', '#fbe6b8'],
  [K.door]: ['#2c5a54', '#43705c', '#668a64'],
  [K.doorDark]: ['#1f443f', '#305848', '#4a6e50'],
  [K.glassDark]: ['#1e2232', '#2e2e36', '#463c38'],
  [K.glassFrame]: ['#c4b394', '#e2cca0', '#fbe6b8'],
  [K.deck]: ['#6a4e3a', '#9a6c44', '#cf9350'],
  [K.deckLine]: ['#4e3a2e', '#704e34', '#9a6a3c'],
  [K.deckSide]: ['#4e3a30', '#6e5038', '#946a40'],
  [K.step]: ['#6a6668', '#958670', '#c4a67c'],
  [K.stepSide]: ['#4c4a52', '#6c6158', '#907a62'],
  [K.path]: ['#625f62', '#8c7e6a', '#bca27a'],
  [K.joint]: ['#3a3840', '#52483e', '#6e5c44'],
  [K.mail]: ['#9a3226', '#c4482c', '#e46a34'],
  [K.mailSide]: ['#6e2219', '#8c2e1c', '#ac3e20'],
  [K.post]: ['#4e3a2c', '#6e5034', '#94703e'],
  [K.picket]: ['#7a7a80', '#a29882', '#d0bc92'],
  [K.picketSide]: ['#5a5c66', '#7a7466', '#a2906e'],
  [K.bush]: ['#283c2c', '#3e5230', '#5c6a36'],
  [K.bushHi]: ['#36502f', '#56683a', '#808a44'],
};

// ---- a small isometric face renderer ------------------------------------------
// screen: sx = ox + 2(x - y), sy = oy + x + y - z. Each pixel keeps its world
// position and face normal so the porch light can be applied afterwards.
class Iso {
  constructor(g, ox, oy) {
    this.g = g;
    this.ox = ox;
    this.oy = oy;
    this.pos = new Array(g.w * g.h).fill(null);
  }
  p(x, y, z) {
    return [this.ox + 2 * (x - y), this.oy + x + y - z];
  }
  put(px, py, c, x, y, z, n) {
    if (!this.g.inside(px, py) || c == null) return;
    this.g.set(px, py, c);
    this.pos[py * this.g.w + px] = { x, y, z, n };
  }
  bbox(pts) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.floor(Math.min(...xs)) - 1, Math.floor(Math.min(...ys)) - 1, Math.ceil(Math.max(...xs)) + 1, Math.ceil(Math.max(...ys)) + 1];
  }
  // horizontal face at height zt
  top(zt, x0, x1, y0, y1, shade) {
    const [ax, ay, bx, by] = this.bbox([this.p(x0, y0, zt), this.p(x1, y0, zt), this.p(x0, y1, zt), this.p(x1, y1, zt)]);
    for (let py = ay; py <= by; py++)
      for (let px = ax; px <= bx; px++) {
        const a = (px + 0.5 - this.ox) / 2;
        const b = py + 0.5 - this.oy + zt;
        const x = (a + b) / 2;
        const y = (b - a) / 2;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) this.put(px, py, typeof shade === 'function' ? shade(x, y) : shade, x, y, zt, [0, 0, 1]);
      }
  }
  // vertical face on the plane y = yc (faces down-left on screen)
  left(yc, x0, x1, z0, z1, shade, zTop = null) {
    const [ax, ay, bx, by] = this.bbox([this.p(x0, yc, z0), this.p(x1, yc, z0), this.p(x0, yc, z1), this.p(x1, yc, z1)]);
    for (let py = ay; py <= by; py++)
      for (let px = ax; px <= bx; px++) {
        const x = (px + 0.5 - this.ox) / 2 + yc;
        const z = this.oy + x + yc - (py + 0.5);
        const zt = zTop ? Math.min(z1, zTop(x)) : z1;
        if (x >= x0 && x < x1 && z >= z0 && z < zt) this.put(px, py, typeof shade === 'function' ? shade(x, z) : shade, x, yc, z, [0, 1, 0]);
      }
  }
  // vertical face on the plane x = xc (faces down-right on screen)
  right(xc, y0, y1, z0, z1, shade) {
    const [ax, ay, bx, by] = this.bbox([this.p(xc, y0, z0), this.p(xc, y1, z0), this.p(xc, y0, z1), this.p(xc, y1, z1)]);
    for (let py = ay; py <= by; py++)
      for (let px = ax; px <= bx; px++) {
        const y = xc - (px + 0.5 - this.ox) / 2;
        const z = this.oy + xc + y - (py + 0.5);
        if (y >= y0 && y < y1 && z >= z0 && z < z1) this.put(px, py, typeof shade === 'function' ? shade(y, z) : shade, xc, y, z, [1, 0, 0]);
      }
  }
  // roof plane z = zr - k*(x - xr) for x in [xa, xb] (k may be negative for the back plane)
  slope(xr, zr, k, xa, xb, y0, y1, shade) {
    const pts = [this.p(xa, y0, zr - k * (xa - xr)), this.p(xb, y0, zr - k * (xb - xr)), this.p(xa, y1, zr - k * (xa - xr)), this.p(xb, y1, zr - k * (xb - xr))];
    const [ax, ay, bx, by] = this.bbox(pts);
    const len = Math.hypot(k, 1);
    for (let py = ay; py <= by; py++)
      for (let px = ax; px <= bx; px++) {
        const a = (px + 0.5 - this.ox) / 2;
        const bb = py + 0.5 - this.oy;
        // x + y - z = bb, y = x - a, z = zr - k(x - xr)
        const x = (bb + a + zr + k * xr) / (2 + k);
        const y = x - a;
        const z = zr - k * (x - xr);
        if (x >= xa && x < xb && y >= y0 && y < y1) this.put(px, py, typeof shade === 'function' ? shade(x, y, z) : shade, x, y, z, [k / len, 0, 1 / len]);
      }
  }
  box(x0, x1, y0, y1, z0, z1, { top, left, right }) {
    if (right) this.right(x1, y0, y1, z0, z1, right);
    if (left) this.left(y1, x0, x1, z0, z1, left);
    if (top) this.top(z1, x0, x1, y0, y1, top);
  }
  // light everything that faces the lamp and is near it
  light(L, { R = 15, blocked = () => false } = {}) {
    const g = this.g;
    for (let py = 0; py < g.h; py++)
      for (let px = 0; px < g.w; px++) {
        const q = this.pos[py * g.w + px];
        if (!q) continue;
        const c = g.get(px, py);
        if (!RAMP[c]) continue;
        const v = [L[0] - q.x, L[1] - q.y, (L[2] - q.z) * 0.9];
        const d = Math.hypot(...v);
        const cos = (v[0] * q.n[0] + v[1] * q.n[1] + v[2] * q.n[2]) / (d || 1);
        if (cos <= 0.02 || blocked(q)) continue;
        const I = Math.max(0, 1 - d / R) * (0.45 + 0.55 * cos);
        const t = I + (bayer(px, py) - 0.5) * 0.1;
        const lv = t > 0.5 ? 3 : t > 0.28 ? 2 : t > 0.1 ? 1 : 0;
        if (lv) g.set(px, py, RAMP[c][lv - 1]);
      }
  }
}

const hash = (x, y) => {
  let h = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---- the island ---------------------------------------------------------------
// N: tile size in world units (40 for the hero). Returns nothing; draws on iso.
function island(iso, { N = 40, depth = 12, detail = true, lampOn = true } = {}) {
  const f = N / 40; // scale world coordinates
  const S = (v) => Math.round(v * f * 2) / 2;
  // soil sides
  iso.left(N, 0, N, -depth, 0, (x, z) => {
    if (z >= -1) return K.glip;
    if (z >= -1.5) return K.gdark;
    if (Math.abs(z + 5.5) < 0.5 || Math.abs(z + 9.5) < 0.5) return K.soilLine;
    if (hash(x * 0.7, z * 0.9) > 0.93) return K.stone;
    return K.soilL;
  });
  iso.right(N, 0, N, -depth, 0, (y, z) => {
    if (z >= -1) return K.gdark;
    if (Math.abs(z + 5.5) < 0.5 || Math.abs(z + 9.5) < 0.5) return K.soilDark;
    if (hash(y * 0.7 + 50, z * 0.9) > 0.93) return K.stone;
    return K.soilR;
  });
  // grass top with path and flagstones
  const px0 = S(13), px1 = S(17);
  iso.top(0, 0, N, 0, N, (x, y) => {
    if (x >= px0 && x < px1 && y >= S(31)) {
      // flagstones: three across in alternate courses, two in between
      const row = Math.floor((y - S(31)) / 2);
      const jx = row % 2 ? (px0 + px1) / 2 : null;
      if ((y - S(31)) % 2 < 0.5) return K.joint;
      if (jx !== null && Math.abs(x - jx) < 0.3) return K.joint;
      return K.path;
    }
    if (x > N - 0.5 || y > N - 0.5) return K.glip; // lit front edges of the top
    const h = hash(x * 1.3, y * 1.3);
    if (h > 0.9) return K.tuft;
    if (h < 0.05) return K.gdark;
    return K.grass;
  });
}

function house(iso, { N = 40, detail = true } = {}) {
  const f = N / 40;
  const S = (v) => v * f;
  const X0 = S(6), X1 = S(24), Y0 = S(5), Y1 = S(21), H = S(20);
  const XR = S(15), ZR = H + S(9.5);
  // right wall: two windows and a corner board
  iso.right(X1, Y0, Y1, 0, H, (y, z) => {
    if (y > Y1 - S(1)) return K.trimR;
    for (const wy of [S(8), S(14)]) {
      if (y >= wy && y < wy + S(4) && z >= S(7) && z < S(14)) {
        if (y < wy + S(0.5) || y > wy + S(3.5) || z < S(7.5) || z > S(13.5) || Math.abs(z - S(10.5)) < S(0.3)) return K.trimR;
        return K.glassDark;
      }
    }
    return Math.floor(z) % 3 === 0 ? K.wallLineR : K.wallR; // clapboard
  });
  // front wall with door, window and the lamp's place
  iso.left(Y1, X0, X1, 0, H, (x, z) => {
    if (x < X0 + S(0.6) || x > X1 - S(1)) return K.trimL;
    // door
    if (x >= S(11) && x < S(16) && z >= S(3) && z < S(13)) {
      if (x < S(11.5) || x > S(15.5) || z > S(12.5)) return K.trimL;
      if (detail && x >= S(12.5) && x < S(14.5) && z >= S(9) && z < S(11.5)) return K.glassDark;
      if (detail && (Math.abs(z - S(6)) < S(0.3))) return K.doorDark;
      return K.door;
    }
    // window to the right of the lamp
    if (x >= S(19.5) && x < S(23) && z >= S(7) && z < S(13)) {
      if (x < S(20) || x > S(22.5) || z < S(7.5) || z > S(12.5) || Math.abs(x - S(21.25)) < S(0.25)) return K.trimL;
      return K.glassDark;
    }
    return Math.floor(z) % 3 === 0 ? K.wallLine : K.wallL;
  });
  // gable end above the front wall
  iso.left(Y1, X0, X1, H, ZR + 1, (x, z) => (Math.floor(z) % 3 === 0 ? K.wallLine : K.wallL), (x) => ZR - Math.abs(x - XR));
  // little round attic vent in the gable
  if (detail)
    iso.left(Y1 + 0.01, XR - S(1.2), XR + S(1.2), H + S(3), H + S(5.5), (x, z) => (Math.hypot(x - XR, z - H - S(4.25)) < S(1.1) ? K.glassDark : null));
  // roof: back plane, front plane, barge boards, fascia
  const tiles = (base) => (x, y, z) => (Math.abs(x - XR) < 0.6 ? K.ridge : Math.floor(Math.abs(x - XR) * 1.0) % 2 === 1 && Math.abs((x - XR) % 1) < 0.5 ? K.roofLine : base);
  iso.slope(XR, ZR, -1, S(5), XR, S(4), S(22), tiles(K.roofB));
  iso.slope(XR, ZR, 1, XR, S(25), S(4), S(22), tiles(K.roofF));
  // barge board under the gable edges (on the plane y = 22)
  iso.left(S(22), S(5), S(25), H - 1, ZR + 1, (x, z) => (z > ZR - Math.abs(x - XR) - 1.3 ? K.fascia : null), (x) => ZR + 0.01 - Math.abs(x - XR));
  // chimney on the back slope
  if (detail) {
    const cz0 = ZR - (XR - S(10));
    iso.box(S(9), S(11.5), S(8), S(10.5), cz0 - 2, ZR + S(4), { right: K.wallR, left: K.wallL, top: K.roofLine });
    iso.top(ZR + S(4), S(9), S(11.5), S(8), S(10.5), (x, y) => (x > S(9.4) && x < S(11.1) && y > S(8.4) && y < S(10.1) ? '#0c0e18' : K.trimR));
  }
}

function porch(iso, { N = 40 } = {}) {
  const f = N / 40;
  const S = (v) => v * f;
  // deck
  iso.box(S(8), S(23), S(21), S(28), 0, S(3), {
    right: K.deckSide,
    left: (x, z) => (z > S(2.4) ? K.deck : K.deckSide),
    top: (x, y) => (Math.floor(x * 1.0) % 2 === 0 && x % 1 < 0.5 ? K.deckLine : K.deck),
  });
  // steps
  iso.box(S(12.5), S(17.5), S(28), S(30), 0, S(2), { right: K.stepSide, left: K.stepSide, top: K.step });
  iso.box(S(12.5), S(17.5), S(30), S(32), 0, S(1), { right: K.stepSide, left: K.stepSide, top: K.step });
  // railing: posts and a top rail on the front edge, either side of the steps
  for (const px of [S(8), S(11.5), S(17.5), S(22)]) iso.box(px, px + S(1), S(27), S(28), S(3), S(9), { right: K.picketSide, left: K.picket, top: K.picket });
  for (const [a, b] of [[S(8), S(12.5)], [S(17.5), S(23)]]) {
    iso.box(a, b, S(27.2), S(28), S(8), S(9), { right: K.picketSide, left: K.picket, top: K.picket });
    for (let x = a + S(1.5); x < b - S(1); x += S(1.5)) iso.box(x, x + S(0.5), S(27.4), S(27.9), S(3), S(8), { left: K.picketSide, right: K.picketSide });
  }
  // canopy over the door
  iso.box(S(10.5), S(16.5), S(21), S(24), S(14), S(15), { right: K.trimR, left: K.trimL, top: K.roofF });
}

function yard(iso, { N = 40 } = {}) {
  const f = N / 40;
  const S = (v) => v * f;
  // bushes (sprites at projected positions, drawn back to front)
  const BUSH = check('bush', [
    '...hhhh...',
    '..hhbbhhb.',
    '.hhbbbbbbb',
    'hhbbbbbbbb',
    'hbbbbbbbbb',
    '.bbbbbbbb.',
    '..bbbbbb..',
  ], 10);
  const bushAt = (x, y) => {
    const [sx, sy] = iso.p(x, y, 0);
    BUSH.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch === '.') return;
        iso.put(Math.round(sx) - 5 + i, Math.round(sy) - 6 + j, ch === 'h' ? K.bushHi : K.bush, x, y, 2 + (6 - j) * 0.4, [0, 0.6, 0.8]);
      }),
    );
  };
  bushAt(S(5), S(25));
  bushAt(S(25), S(25));
  // mailbox at the end of the path
  iso.box(S(19.5), S(20.3), S(36), S(36.8), 0, S(6), { right: K.post, left: K.post, top: K.post });
  iso.box(S(18.5), S(21.5), S(35.5), S(37.5), S(6), S(8.5), { right: K.mailSide, left: K.mail, top: K.mail });
  iso.box(S(21.5), S(21.9), S(36), S(36.4), S(7), S(10), { right: K.flag, left: K.flag, top: K.flag });
  // picket fence along the front-right edge
  for (let y = S(24); y < S(39); y += S(2)) iso.box(S(38), S(39), y, y + S(1), 0, S(5), { right: K.picketSide, left: K.picket, top: K.picket });
  iso.box(S(38.2), S(38.8), S(24), S(39), S(3.5), S(4.2), { right: K.picketSide, left: K.picket, top: K.picket });
  for (let x = S(24); x < S(38); x += S(2)) iso.box(x, x + S(1), S(38), S(39), 0, S(5), { right: K.picketSide, left: K.picket, top: K.picket });
  iso.box(S(24), S(38), S(38.2), S(38.8), S(3.5), S(4.2), { right: K.picketSide, left: K.picket, top: K.picket });
}

const LAMP = check('lamp', ['.kk.', 'k12k', 'k23k', 'k12k', '.kk.', '..k.'], 4);
const LAMP_PAL = { k: K.lampFrame, 1: K.lamp1, 2: K.lamp2, 3: K.lamp3 };

// ---- block wordmarks with a 2:1 extrusion ------------------------------------------
const BLOCK_S = {
  P: ['######.', '##...##', '##...##', '##...##', '##...##', '######.', '##.....', '##.....', '##.....', '##.....', '##.....'],
  o: ['', '', '', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######'],
  r: ['', '', '', '######', '##....', '##....', '##....', '##....', '##....', '##....', '##....'],
  c: ['', '', '', '######', '##....', '##....', '##....', '##....', '##....', '##....', '######'],
  h: ['##.....', '##.....', '##.....', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##'],
  l: ['##', '##', '##', '##', '##', '##', '##', '##', '##', '##', '##'],
  i: ['**', '**', '', '##', '##', '##', '##', '##', '##', '##', '##'],
  g: ['', '', '', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '.....##', '.....##', '#######'],
  t: ['.##..', '.##..', '.##..', '#####', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '.####'],
};
const BLOCK_L = {
  P: ['#########.', '##########', '###....###', '###....###', '###....###', '##########', '#########.', '###.......', '###.......', '###.......', '###.......', '###.......', '###.......', '###.......', '###.......'],
  o: ['', '', '', '', '##########', '##########', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '##########', '##########'],
  r: ['', '', '', '', '########', '########', '###.....', '###.....', '###.....', '###.....', '###.....', '###.....', '###.....', '###.....', '###.....'],
  c: ['', '', '', '', '#########', '#########', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '#########', '#########'],
  h: ['###.......', '###.......', '###.......', '###.......', '##########', '##########', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###'],
  l: ['###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###'],
  i: ['***', '***', '', '', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###'],
  g: ['', '', '', '', '##########', '##########', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '##########', '##########', '.......###', '.......###', '##########', '##########'],
  t: ['..###..', '..###..', '..###..', '..###..', '#######', '#######', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..', '..#####', '..#####'],
};
function blockWord(font, word, gap, { face, dot, side, bottom, outline, depth }) {
  const gw = (gl) => Math.max(...gl.map((r) => r.length));
  const width = [...word].reduce((s, ch) => s + gw(font[ch]), 0) + gap * (word.length - 1);
  const rows = Math.max(...Object.values(font).map((g) => g.length));
  const D = depth;
  const g = new Grid(width + 2 * D + 4, rows + D + 4);
  const ox = 2 * D + 2;
  const oy = 1;
  const on = new Set();
  let x = 0;
  const pix = [];
  for (const ch of word) {
    const gl = font[ch];
    gl.forEach((row, y) => [...row].forEach((p, i) => p !== '.' && pix.push([ox + x + i, oy + y, p])));
    x += gw(gl) + gap;
  }
  for (const [px, py] of pix) on.add(`${px},${py}`);
  // extrusion toward the lower left at 2:1, back to front
  for (let k = 2 * D; k >= 1; k--) {
    const dx = -k;
    const dy = Math.ceil(k / 2);
    for (const [px, py] of pix) {
      const below = !on.has(`${px},${py + 1}`);
      g.set(px + dx, py + dy, below ? bottom : side);
    }
  }
  for (const [px, py, p] of pix) g.set(px, py, p === '*' ? dot : face);
  if (outline) g.outline([face, dot, side, bottom], outline);
  return { g, width: g.w, height: g.h, ox, oy };
}

// ---- hero: 320 x 160 at x4 ---------------------------------------------------------------
function hero() {
  const g = new Grid(320, 160, K.sky0);
  g.vgradient(0, 0, 320, 160, [{ y: 0, c: K.sky0 }, { y: 70, c: K.sky0 }, { y: 118, c: K.sky1 }, { y: 160, c: K.sky1 }]);
  const stars = [[12, 10, 1], [40, 22, 2], [66, 8, 1], [150, 6, 2], [176, 18, 1], [200, 8, 2], [228, 14, 1], [262, 6, 1], [300, 18, 2], [312, 40, 1],
    [20, 60, 2], [8, 96, 1], [24, 130, 1], [190, 140, 2], [214, 120, 1], [310, 132, 1], [292, 150, 2], [180, 40, 2], [96, 150, 1], [140, 154, 2]];
  for (const [x, y, c] of stars) g.set(x, y, c === 1 ? K.star : K.star2);
  for (const [x, y] of [[248, 128], [36, 40]]) g.set(x, y, K.star).set(x - 1, y, K.star2).set(x + 1, y, K.star2).set(x, y - 1, K.star2).set(x, y + 1, K.star2);

  const iso = new Iso(g, 96, 40);
  island(iso);
  house(iso);
  porch(iso);
  yard(iso);
  // floating crumbs under the island
  for (const [x, y, w] of [[88, 141, 3], [104, 146, 2], [70, 137, 2], [122, 139, 2]]) {
    g.hline(x, y, w, K.soilL).hline(x, y + 1, w, K.soilR);
  }
  // hanging roots under the front corner
  for (const [x, y, h] of [[94, 133, 3], [97, 132, 5], [101, 131, 2], [60, 115, 3], [132, 113, 4], [150, 104, 2]]) g.vline(x, y, h, K.root);

  // the lamp on the wall beside the door
  const L = [18.2, 21.6, 11];
  iso.light(L, { R: 17, blocked: (q) => q.z > 14.2 && q.y < 24.5 });
  const [lx, ly] = iso.p(18.2, 21, 11);
  g.stamp(LAMP, LAMP_PAL, Math.round(lx) - 2, Math.round(ly) - 3);
  // a halo of single pixels around the lamp
  for (const [dx, dy] of [[-4, 0], [5, 0], [0, -5], [1, -5], [-3, -3], [4, -3]]) g.set(Math.round(lx) - 1 + dx, Math.round(ly) - 1 + dy, K.lamp1);
  // moths
  g.set(Math.round(lx) - 7, Math.round(ly) - 7, K.lamp2).set(Math.round(lx) - 8, Math.round(ly) - 8, K.lamp1).set(Math.round(lx) - 6, Math.round(ly) - 8, K.lamp1);

  // type
  const word = blockWord(BLOCK_L, 'Porchlight', 3, { face: K.cream, dot: K.lamp1, side: '#4a3a5c', bottom: '#33294a', outline: '#0a0e1c', depth: 3 });
  const tx = 188;
  g.blit(word.g, tx - word.ox, 44);
  const TAG = '#b8b4c4';
  drawText(g, 'A light left on over', tx, 74, TAG, { shadow: '#0a0e1c' });
  drawText(g, 'your own front door.', tx, 86, TAG, { shadow: '#0a0e1c' });
  return g;
}

// ---- mark: an isometric house block with a lit door, 32 x 32 ------------------------
// Point-in-polygon on pixel centres, for laying down flat faces on clean
// 2:1, 1:2 and 1:1 pixel lines.
function poly(g, pts, color) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  for (let py = Math.floor(Math.min(...ys)); py <= Math.ceil(Math.max(...ys)); py++)
    for (let px = Math.floor(Math.min(...xs)); px <= Math.ceil(Math.max(...xs)); px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) g.set(px, py, typeof color === 'function' ? color(px, py) : color);
    }
}

// The mark: a house block on its patch of ground. Corners chosen so every
// edge is a clean 2:1, 1:2 or 1:1 pixel line.
function markGrid() {
  const g = new Grid(32, 32);
  const L = [5, 21], F = [17, 27], R = [27, 22];
  const L2 = [5, 12], F2 = [17, 18], R2 = [27, 13];
  const A = [22, 8], B = [10, 2];
  // ground: grass top and two soil faces
  poly(g, [[1, 21], [17, 29], [31, 22], [15, 14]], K.grass);
  poly(g, [[1, 21], [17, 29], [17, 31], [1, 23]], K.soilL);
  poly(g, [[17, 29], [31, 22], [31, 24], [17, 31]], K.soilR);
  // walls
  poly(g, [L, F, F2, L2], (x, y) => ((y - Math.floor((x - 5) / 2)) % 3 === 0 ? K.wallLine : K.wallL));
  poly(g, [F, R, R2, A, F2], (x, y) => ((y + Math.floor((x - 17) / 2)) % 3 === 0 ? K.wallLineR : K.wallR));
  // roof plane with courses parallel to the eave
  poly(g, [L2, F2, A, B], (x, y) => ((y - Math.floor((x - 5) / 2)) % 3 === 1 ? K.roofLine : K.roofF));
  return finishMark(g);
}

function finishMark(g) {
  const P = {
    o: '#0a0e1c', t: K.trimL, T: K.trimR, r: K.ridge, f: K.fascia,
    d: '#ffd27a', D: '#ffbf55', e: '#c98a3a', l: K.lamp3, k: K.lampFrame, w: K.glassDark,
    a: '#9a5a36', b: '#c27840', G: '#3f5034', H: '#6a6e3a', J: '#a3964a',
  };
  // ridge, barge and eave boards
  for (let x = 10; x <= 22; x++) g.set(x, 2 + Math.floor((x - 10) / 2), P.r);
  for (let y = 2; y <= 12; y++) g.set(5 + Math.floor((12 - y) / 2), y, P.r); // front barge (1:2)
  for (let y = 8; y <= 18; y++) g.set(17 + Math.floor((18 - y) / 2), y, P.f); // gable barge (1:2)
  for (let x = 22; x <= 27; x++) g.set(x, 8 + (x - 22), P.f); // gable barge (1:1)
  for (let x = 5; x <= 16; x++) g.set(x, 12 + Math.floor((x - 5) / 2), P.f); // eave board
  // corner boards
  for (let y = 18; y <= 27; y++) g.set(17, y, P.t);
  for (let y = 13; y <= 21; y++) g.set(5, y, P.t);
  // door on the front wall, open to a warm hall; light on the step
  const door = [[8, 15], [9, 16], [10, 16], [11, 17]]; // top-left of each door column
  for (const [x, top] of door) for (let y = top; y < top + 7; y++) g.set(x, y, y < top + 1 ? P.t : x === 8 ? P.e : P.d);
  g.set(9, 17, P.l).set(10, 17, P.l);
  g.set(12, 17, P.t).set(12, 18, P.t).set(12, 19, P.t).set(12, 20, P.t).set(12, 21, P.t).set(12, 22, P.t).set(12, 23, P.t);
  // wall near the door warmed by the lamp (hand-picked pixels)
  for (const [x, y] of [[13, 18], [14, 18], [13, 19], [14, 20], [13, 21], [15, 20], [14, 22], [15, 21], [16, 22], [13, 23]]) g.set(x, y, P.a);
  for (const [x, y] of [[13, 20], [14, 19], [14, 21], [13, 22]]) g.set(x, y, P.b);
  // the lamp beside the door
  g.stamp(['.k.', 'klk', 'kDk', '.k.'], P, 13, 16);
  // window on the gable end, stepped up one pixel every two columns
  for (let x = 19; x <= 24; x++) {
    const top = 18 - Math.floor((x - 18) / 2);
    for (let y = top; y <= top + 5; y++) {
      const frame = x === 19 || x === 24 || y === top || y === top + 5 || y === top + 3;
      g.set(x, y, frame ? P.T : P.w);
    }
  }
  g.stamp(['.T.', 'TwT', '.T.'], P, 21, 11);
  // chimney on the roof
  g.stamp(['ooo', 'tTT', 'tTT', 'tTT'], { o: '#0c0e18', t: K.wallL, T: K.wallR }, 13, 2);
  // a patch of light on the grass in front of the door
  for (const [x, y, c] of [[8, 24, 'J'], [9, 24, 'J'], [10, 25, 'J'], [11, 25, 'H'], [7, 23, 'H'], [6, 23, 'G'], [8, 25, 'H'], [9, 25, 'J'], [10, 26, 'H'], [12, 26, 'G'], [7, 24, 'G'], [11, 26, 'G'], [9, 26, 'G']]) g.set(x, y, P[c]);
  // outline the silhouette
  g.outline(g.colours(), P.o);
  return g;
}

// ---- favicon 16 (hand-drawn) -----------------------------------------------------------
// Favicon: the same cottage, redrawn for 16px with fewer, lighter values so
// the gable, the lit door and the window read in a browser tab.
// Favicon, drawn by hand for 16px: the gable faces you, the side wall and
// roof run back on 2:1 lines, the door is lit and there is light on the step.
const FAV16 = check('fav16', [
  '................',
  '................',
  '........RR......',
  '......RRrrq.....',
  '....ttrrrrrq....',
  '...twwtrrrrrq...',
  '..twwwwtrrrree..',
  '.twwwwwwtreevv..',
  '.wwwwwwwTtvvvv..',
  '.wwwwwlwTvkkvv..',
  '.wwDddwwTvkkvv..',
  '.wwDddwwTvvvvv..',
  '.wwDddwwTvvv....',
  '.wwDddwwTv......',
  '..gggg..........',
  '................',
], 16);
function favGrid() {
  const g = new Grid(16, 16).stamp(FAV16, {
    t: '#e6dcc4', T: '#b8ab90', R: '#8792c4', r: '#3d4770', q: '#2a3152', e: '#b8ab90',
    w: '#9a5a3a', v: '#5e3322', D: '#d0903e', d: '#ffd27a', l: '#fffbe8', k: '#111a2c', g: '#c98a3a',
  });
  g.outline(g.colours(), '#0a0e1c');
  return g;
}

// ---- icon: the island alone, 64 x 64 (128 at x2, 512 at x8) ----------------------------
function iconGrid() {
  const g = new Grid(64, 64);
  // rounded tile of night sky
  for (let y = 0; y < 64; y++) {
    const a = y < 4 ? [4, 2, 1, 1][y] : y > 59 ? [1, 1, 2, 4][y - 60] : 0;
    for (let x = a; x < 64 - a; x++) g.set(x, y, bayer(x, y) < y / 90 ? K.sky2 : K.sky1);
  }
  for (const [x, y] of [[8, 9], [50, 6], [57, 18], [12, 26], [54, 40]]) g.set(x, y, K.star);
  const iso = new Iso(g, 32, 16);
  island(iso, { N: 20, depth: 6, detail: false });
  house(iso, { N: 20, detail: false });
  // simple deck and steps at half scale
  iso.box(4, 11.5, 10.5, 14, 0, 1.5, { right: K.deckSide, left: K.deckSide, top: K.deck });
  iso.box(6.5, 9, 14, 15.5, 0, 0.8, { right: K.stepSide, left: K.stepSide, top: K.step });
  iso.light([9.2, 10.8, 5.8], { R: 9.5 });
  const [lx, ly] = iso.p(9.2, 10.5, 5.8);
  g.stamp(['.k.', 'k3k', 'k2k', '.k.'], { k: K.lampFrame, 3: K.lamp3, 2: K.lamp1 }, Math.round(lx) - 1, Math.round(ly) - 2);
  // tile edge
  const out = new Grid(64, 64);
  out.blit(g);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      if (g.get(x, y) == null) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => g.get(x + a, y + b) == null)) out.set(x, y, '#090d1a');
    }
  return out;
}

// ---- logo: 160 x 50 at x4 ----------------------------------------------------------------
function logoGrid() {
  const g = new Grid(160, 50);
  g.blit(markGrid(), 14, 9);
  const word = blockWord(BLOCK_S, 'Porchlight', 2, { face: '#2a3150', dot: K.lamp1, side: '#9aa0b8', bottom: '#7c8299', outline: null, depth: 2 });
  g.blit(word.g, 56 - word.ox, 17);
  return g;
}

const crisp = (grid, w, h, vb) => svg({ w, h, vb, crisp: true, body: grid.toPaths() });
const mark = markGrid();
writeConcept(SLUG, {
  'mark.svg': crisp(mark, 512, 512, '0 0 32 32'),
  'favicon.svg': crisp(favGrid(), 16, 16, '0 0 16 16'),
  'favicon-32.svg': crisp(mark, 32, 32, '0 0 32 32'),
  'logo.svg': crisp(logoGrid(), 640, 200, '0 0 160 50'),
  'icon.svg': crisp(iconGrid(), 512, 512, '0 0 64 64'),
  'hero.svg': crisp(hero(), 1280, 640, '0 0 320 160'),
  'notes.md': `# 07 Isometric porch (pixel)

A little island of your own: a house corner, a porch, a path, a mailbox and a picket fence on a floating tile of ground, drawn in 2:1 isometric pixel lines. The porch light is the only warm thing on it and lights every face that turns toward it.
Palette: night #0f1629 / #1b2642, grass #22342f, soil #4a2c25 / #36201b, terracotta walls #6b402e / #55301f, slate roof #2d3350 / #232842, trim #a39886, lamp #ffbf55 / #fffbe8.
Type: hand-drawn block pixel wordmark extruded at 2:1 to match the drawing (3px stems in the hero, 2px in the logo); 5px pixel face for the tagline.
`,
});
