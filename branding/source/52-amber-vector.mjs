// 52 Amber vector: the amber terminal without the pixels. A vector display
// draws with a beam, so everything here is a clean stroke: a wireframe house
// in perspective on a ground grid, its porch lamp the brightest thing on the
// screen, and the name typed after a prompt in a stroke alphabet.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '52-amber-vector';
const BG = '#100a04';
const HOT = '#ffd98a'; // where the beam dwells
const AMBER = '#ffb21f';
const MID = '#b8690a';
const DIM = '#5f3706';
const FAINT = '#2e1b04';
const INK = '#2a1a06'; // strokes on a light page
const f = (n) => Math.round(n * 10) / 10;

// ---- the beam ----------------------------------------------------------------------
// A stroke as the phosphor shows it: a sharp core over two wider, fainter
// passes. No blur; the bloom is drawn.
function beam(d, { w = 2, color = AMBER, glow = 1, dash = '', join = 'round' } = {}) {
  const da = dash ? ` stroke-dasharray="${dash}"` : '';
  const base = `fill="none" stroke-linecap="round" stroke-linejoin="${join}"${da}`;
  return (
    (glow ? `<path d="${d}" ${base} stroke="${color}" stroke-width="${f(w * 4.4)}" opacity="${f(0.055 * glow)}"/><path d="${d}" ${base} stroke="${color}" stroke-width="${f(w * 2.2)}" opacity="${f(0.17 * glow)}"/>` : '') +
    `<path d="${d}" ${base} stroke="${color}" stroke-width="${f(w)}"/>`
  );
}
const dots = (pts, r, color = HOT) => pts.map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${color}"/>`).join('');
const poly = (pts, close = false) => 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L') + (close ? 'Z' : '');

// ---- a stroke alphabet, as a vector terminal draws it -----------------------------------
// Each glyph: width, then polylines on a 4 x 6 grid (y down).
const A = {
  A: [4, [[0, 6], [0, 2], [2, 0], [4, 2], [4, 6]], [[0, 4], [4, 4]]],
  C: [4, [[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
  D: [4, [[0, 0], [0, 6], [2.7, 6], [4, 4.7], [4, 1.3], [2.7, 0], [0, 0]]],
  E: [3.8, [[3.8, 0], [0, 0], [0, 6], [3.8, 6]], [[0, 3], [2.9, 3]]],
  F: [3.8, [[3.8, 0], [0, 0], [0, 6]], [[0, 3], [2.9, 3]]],
  G: [4, [[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.2], [2.2, 3.2]]],
  H: [4, [[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [2, [[1, 0], [1, 6]], [[0, 0], [2, 0]], [[0, 6], [2, 6]]],
  K: [4, [[0, 0], [0, 6]], [[4, 0], [0, 3.6]], [[1.3, 2.6], [4, 6]]],
  L: [3.6, [[0, 0], [0, 6], [3.6, 6]]],
  M: [4.6, [[0, 6], [0, 0], [2.3, 2.8], [4.6, 0], [4.6, 6]]],
  N: [4, [[0, 6], [0, 0], [4, 6], [4, 0]]],
  O: [4, [[1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0]]],
  P: [4, [[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.5], [3, 3.5], [0, 3.5]]],
  R: [4, [[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.5], [3, 3.5], [0, 3.5]], [[2, 3.5], [4, 6]]],
  S: [4, [[4, 1], [3, 0], [1, 0], [0, 1], [0, 2.1], [1, 3], [3, 3], [4, 3.9], [4, 5], [3, 6], [1, 6], [0, 5]]],
  T: [4, [[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [4, [[0, 0], [0, 5], [1, 6], [3, 6], [4, 5], [4, 0]]],
  Y: [4, [[0, 0], [2, 2.9], [4, 0]], [[2, 2.9], [2, 6]]],
  '.': [0.8, [[0, 5.4], [0.8, 5.4], [0.8, 6], [0, 6], [0, 5.4]]],
  '·': [0.8, [[0, 2.7], [0.8, 2.7], [0.8, 3.3], [0, 3.3], [0, 2.7]]],
  '>': [3, [[0, 1], [3, 3], [0, 5]]],
};
// Lay out a line of text; returns the path, the vertices and the width.
function type(text, x, y, u, { gap = 1.7, space = 3.2 } = {}) {
  let cx = x;
  let d = '';
  const verts = [];
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (ch === ' ') {
      cx += space * u;
      return;
    }
    const [w, ...lines] = A[ch];
    for (const line of lines) {
      const pts = line.map(([px, py]) => [cx + px * u, y + py * u]);
      d += poly(pts);
      verts.push(...pts);
    }
    cx += w * u;
    if (i < chars.length - 1 && chars[i + 1] !== ' ') cx += gap * u;
  });
  return { d, verts, width: cx - x, right: cx };
}
// The cursor: a block the beam fills by sweeping it line by line.
function cursor(x, y, u, { color = AMBER, w = 2 } = {}) {
  const cw = 3.3 * u;
  const h = 6 * u;
  let d = poly([[x, y], [x + cw, y], [x + cw, y + h], [x, y + h]], true);
  const n = Math.max(3, Math.round(h / (w * 2.3)));
  for (let i = 1; i < n; i++) d += `M${f(x)},${f(y + (h * i) / n)}H${f(x + cw)}`;
  return d;
}

// ---- three dimensions --------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
function camera(eye, target, focal, cx, cy) {
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const view = (p) => {
    const d = sub(p, eye);
    return [dot(d, right), dot(d, up), dot(d, fwd)];
  };
  const screen = ([x, y, z]) => [cx + (focal * x) / z, cy - (focal * y) / z];
  const P = (p) => screen(view(p));
  // a segment, clipped to what is in front of the eye
  const seg = (a, b, near = 0.6) => {
    let va = view(a);
    let vb = view(b);
    if (va[2] < near && vb[2] < near) return null;
    if (va[2] < near) [va, vb] = [vb, va];
    if (vb[2] < near) {
      const t = (va[2] - near) / (va[2] - vb[2]);
      vb = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, near];
    }
    return [screen(va), screen(vb)];
  };
  return { P, seg };
}

// ---- mark: the porch as a glyph ------------------------------------------------------------
// A roof chevron (the prompt, turned upright), two posts, the floor and a step,
// and the lamp with its rays.
function glyph({ color = AMBER, hot = HOT, w = 5, glow = 1, mid = MID } = {}) {
  const roof = poly([[34, 96], [100, 44], [166, 96]]);
  const frame = `M50,97V152M150,97V152M30,152H170M62,168H138`;
  const L = [100, 112];
  let rays = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) continue;
    const r0 = 17;
    const r1 = i % 2 ? 25 : 32;
    rays += `M${f(L[0] + Math.cos(a) * r0)},${f(L[1] + Math.sin(a) * r0)}L${f(L[0] + Math.cos(a) * r1)},${f(L[1] + Math.sin(a) * r1)}`;
  }
  const lamp = poly([[100, 102], [108.5, 112], [100, 122], [91.5, 112]], true);
  return `
${beam(frame, { w: w * 0.8, color: mid, glow })}
${beam(roof, { w, color, glow, join: 'miter' })}
${beam('M100,58V101', { w: w * 0.5, color: mid, glow: 0 })}
${beam(rays, { w: w * 0.56, color, glow })}
${beam(lamp, { w: w * 0.56, color, glow })}
<circle cx="100" cy="112" r="${f(w * 0.72)}" fill="${hot}"/>`;
}
function markBody() {
  return `
<rect x="6" y="6" width="188" height="188" rx="40" fill="${BG}"/>
<rect x="6" y="6" width="188" height="188" rx="40" fill="none" stroke="${DIM}" stroke-width="2.2"/>
${glyph()}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid --------------------------------------------------------
const PIX = { K: BG, A: AMBER, a: MID, H: HOT };
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
  '.KKKKKKKKKKKKKK.',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKAAKKKKKKK',
  'KKKKKAAKKAAKKKKK',
  'KKKAAKKKKKKAAKKK',
  'KKAAKKKKKKKKAAKK',
  'KKKaKKKKKKKKaKKK',
  'KKKaKaKHHKaKaKKK',
  'KKKaKaKHHKaKaKKK',
  'KKKaKKKKKKKKaKKK',
  'KKKaKKKaaKKKaKKK',
  'KKKaKKKKKKKKaKKK',
  'KKaaaaaaaaaaaaKK',
  'KKKKKKKKKKKKKKKK',
  'KKKKKaaaaaaKKKKK',
  '.KKKKKKKKKKKKKK.',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('K'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [31, 0], [30, 0], [31, 1], [0, 31], [1, 31], [0, 30], [31, 31], [30, 31], [31, 30]]) set(x, y, '.');
  // roof: two-pixel strokes from the apex down to the eaves
  for (let i = 0; i <= 11; i++) {
    const y = 5 + Math.round(i * 0.75);
    for (const t of [0, 1]) {
      set(15 - i, y + t, 'A');
      set(16 + i, y + t, 'A');
    }
  }
  for (let y = 15; y <= 24; y++) for (const x of [6, 7, 24, 25]) set(x, y, 'a');
  for (let x = 3; x <= 28; x++) for (const y of [25, 26]) set(x, y, 'a');
  for (let x = 9; x <= 22; x++) set(x, 29, 'a');
  // lamp: a hot core and rays
  for (let y = 17; y <= 20; y++) for (let x = 14; x <= 17; x++) set(x, y, 'A');
  for (let y = 18; y <= 19; y++) for (let x = 15; x <= 16; x++) set(x, y, 'H');
  for (const x of [15, 16]) {
    set(x, 12, 'a');
    set(x, 13, 'a');
    set(x, 14, 'a');
    set(x, 22, 'A');
    set(x, 23, 'A');
  }
  for (const y of [18, 19]) {
    set(10, y, 'A');
    set(11, y, 'A');
    set(20, y, 'A');
    set(21, y, 'A');
  }
  for (const [x, y] of [[12, 15], [11, 14], [19, 15], [20, 14], [12, 22], [11, 23], [19, 22], [20, 23]]) set(x, y, 'A');
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon --------------------------------------------------------------------------------
function iconBody() {
  let grid = '';
  for (let y = 64; y <= 448; y += 48) for (let x = 64; x <= 448; x += 48) grid += `<circle cx="${x}" cy="${y}" r="2" fill="${FAINT}"/>`;
  return `
<rect width="512" height="512" rx="112" fill="${BG}"/>
${grid}
<rect x="20" y="20" width="472" height="472" rx="94" fill="none" stroke="${DIM}" stroke-width="4"/>
${nest({ x: 26, y: 20, w: 460, h: 460, vb: '0 0 200 200', body: glyph({ w: 5.6 }) })}`;
}
const iconSvg = svg({ w: 512, h: 512, vb: '0 0 512 512', body: iconBody() });

// ---- logo --------------------------------------------------------------------------------
function logo(dark) {
  const U = 6.7;
  const name = type('PORCHLIGHT', 210, 66, U);
  const ink = dark ? AMBER : INK;
  return `
${nest({ x: 14, y: 14, w: 172, h: 172, vb: '0 0 200 200', body: markBody() })}
${beam(name.d, { w: 3.4, color: ink, glow: dark ? 0.9 : 0, join: 'miter' })}
${dark ? dots(name.verts, 1.4) : ''}
${beam(cursor(name.right + U * 1.5, 66, U, { w: 1.7 }), { w: 1.7, color: dark ? AMBER : '#d98a06', glow: dark ? 1 : 0, join: 'miter' })}
 <text x="210" y="148" font-family="Menlo" font-size="19" fill="${dark ? MID : '#7a5a2a'}"><tspan fill="${dark ? AMBER : '#d98a06'}">&gt;</tspan> home security for your code.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero --------------------------------------------------------------------------------
function hero() {
  const EYE = [-7.4, 3.0, 15];
  const cam = camera(EYE, [1.6, 3.0, 0], 900, 1010, 356);
  const { P, seg } = cam;
  const HOR = 356;
  let out = '';

  // screen: a faint graticule and the edge of the tube
  let grat = '';
  for (let y = 40; y < 640; y += 40) for (let x = 40; x < 1280; x += 40) if (y < HOR - 8) grat += `<circle cx="${x}" cy="${y}" r="1" fill="${FAINT}"/>`;
  out += `<rect width="1280" height="640" fill="${BG}"/>${grat}`;

  // sky: a few stars and the moon, drawn as the display would
  const r = rng(52);
  let stars = '';
  let plus = '';
  for (let k = 0; k < 80; k++) {
    const x = 60 + r() * 1160;
    const y = 36 + r() * 300;
    if (x < 800 && y > 60 && y < 290) continue;
    if (x > 600 && x < 1215 && y > 185) continue;
    if (Math.hypot(x - 1180, y - 100) < 56) continue;
    if (x < 620 && y > 262) continue;
    if (k % 7 === 0) plus += `M${f(x - 5)},${f(y)}H${f(x + 5)}M${f(x)},${f(y - 5)}V${f(y + 5)}`;
    else stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.9 + r() * 0.9)}" fill="${k % 3 ? MID : AMBER}"/>`;
  }
  out += stars + beam(plus, { w: 1.2, color: AMBER, glow: 0.8 });
  out += beam('M1178,72A34,34 0 1 0 1212,124A27,27 0 1 1 1178,72Z', { w: 1.8, color: AMBER, glow: 0.9 });

  // ground grid, fading toward the horizon
  let gx = '';
  for (let x = -40; x <= 44; x += 2) {
    const s = seg([x, 0, 13.6], [x, 0, -70]);
    if (s) gx += poly(s);
  }
  for (let z = 13; z >= -70; z -= z > -20 ? 2 : z > -40 ? 4 : 10) {
    const s = seg([-60, 0, z], [70, 0, z]);
    if (s) gx += poly(s);
  }
  out += `
<defs>
  <linearGradient id="fade" x1="0" y1="${HOR}" x2="0" y2="640" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>
  <mask id="far" maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="640"><rect y="${HOR - 2}" width="1280" height="${640 - HOR + 2}" fill="url(#fade)"/></mask>
</defs>
<g mask="url(#far)"><path d="${gx}" fill="none" stroke="${DIM}" stroke-width="1.3"/></g>
${beam(`M0,${HOR}H1280`, { w: 1.4, color: MID, glow: 0.6 })}`;

  // faces are filled with the screen colour, so nearer ones hide what is behind
  const face = (pts3, { w = 2, color = AMBER, glow = 1, fill = BG, dotsOn = true } = {}) => {
    const pts = pts3.map(P);
    return `<path d="${poly(pts, true)}" fill="${fill}"/>${beam(poly(pts, true), { w, color, glow, join: 'round' })}${dotsOn ? dots(pts, w * 0.8) : ''}`;
  };
  const line = (pts3, opt = {}) => beam(poly(pts3.map(P)), { w: 2, ...opt });

  // a wireframe pine: a cone on a stick
  const hull = (pts) => {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of p) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    const hi = [];
    for (const q of p.reverse()) {
      while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
      hi.push(q);
    }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  };
  const cone = (x, z, r, y0, y1, n, color) => {
    const base = Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2 + 0.3) * r, y0, z + Math.sin((i / n) * Math.PI * 2 + 0.3) * r]);
    const pb = base.map(P);
    const pa = P([x, y1, z]);
    let d = poly(pb, true);
    for (const q of pb) d += poly([q, pa]);
    return `<path d="${poly(hull([...pb, pa]), true)}" fill="${BG}"/>${beam(d, { w: 1.3, color, glow: 0.6 })}`;
  };
  const pine = (x, z, r, h, n = 7, color = MID) => {
    const pa = P([x, h, z]);
    return `${beam(poly([P([x, 0, z]), P([x, 0.9, z])]), { w: 1.4, color, glow: 0.4 })}${cone(x, z, r, 0.9, h * 0.66, n, color)}${cone(x, z, r * 0.66, h * 0.44, h, n, color)}<circle cx="${f(pa[0])}" cy="${f(pa[1])}" r="1.5" fill="${AMBER}"/>`;
  };
  out += pine(-18.5, -42, 2.7, 7.0, 8) + pine(-10.5, -33, 2.0, 5.2) + pine(-7.5, -46, 2.2, 5.4);

  // path from the steps toward the viewer
  const pathL = seg([-0.95, 0, 2.7], [-2.4, 0, 13.6]);
  const pathR = seg([0.95, 0, 2.7], [0.6, 0, 13.6]);
  out += `<path d="${poly([pathL[0], pathL[1], pathR[1], pathR[0]], true)}" fill="${BG}"/>`;
  out += beam(poly(pathL) + poly(pathR), { w: 1.6, color: MID, glow: 0.7 });
  let stones = '';
  for (let k = 0; k < 6; k++) {
    const z = 3.6 + k * 1.7;
    const t = (z - 2.7) / 10.9;
    const xl = -0.95 + (-2.4 + 0.95) * t;
    const xr = 0.95 + (0.6 - 0.95) * t;
    const s = seg([xl + 0.25, 0, z], [xr - 0.25, 0, z]);
    if (s) stones += poly(s);
  }
  out += beam(stones, { w: 1.3, color: DIM, glow: 0 });

  // ---- the house ----
  const W = 4; // half width
  const D = -6.4; // depth
  const EV = 3.2; // eaves
  const RG = 5.5; // ridge
  // chimney, behind the ridge
  out += face([[1.5, 4.0, -3], [2.4, 4.0, -3], [2.4, 6.5, -3], [1.5, 6.5, -3]], { w: 1.7, color: MID, glow: 0.6 });
  out += face([[1.5, 4.0, -3], [1.5, 4.0, -3.9], [1.5, 6.5, -3.9], [1.5, 6.5, -3]], { w: 1.7, color: MID, glow: 0.6 });
  // left wall and its window
  out += face([[-W, 0, 0], [-W, 0, D], [-W, EV, D], [-W, EV, 0]], { w: 1.9, color: MID, glow: 0.8 });
  out += line([[-W, 1.3, -2.2], [-W, 2.4, -2.2], [-W, 2.4, -3.8], [-W, 1.3, -3.8], [-W, 1.3, -2.2]], { w: 1.5, color: MID, glow: 0.5 });
  out += line([[-W, 1.3, -3.0], [-W, 2.4, -3.0]], { w: 1.2, color: DIM, glow: 0 });
  // roof, left slope
  out += face([[-W - 0.45, EV - 0.25, 0.5], [-W - 0.45, EV - 0.25, D - 0.3], [0, RG, D - 0.3], [0, RG, 0.5]], { w: 2, color: AMBER, glow: 0.9 });
  let courses = '';
  for (let k = 1; k <= 4; k++) {
    const t = k / 5;
    const s = seg([(-W - 0.45) * (1 - t), EV - 0.25 + (RG - EV + 0.25) * t, 0.5], [(-W - 0.45) * (1 - t), EV - 0.25 + (RG - EV + 0.25) * t, D - 0.3]);
    courses += poly(s);
  }
  out += beam(courses, { w: 1.2, color: DIM, glow: 0 });
  // front wall with its gable
  out += face([[-W, 0, 0], [W, 0, 0], [W, EV, 0], [0, RG - 0.25, 0], [-W, EV, 0]], { w: 2, color: AMBER, glow: 0.9, dotsOn: false });
  // the front edge of the roof
  out += line([[-W - 0.45, EV - 0.25, 0.5], [0, RG, 0.5], [W + 0.45, EV - 0.25, 0.5]], { w: 2.4, color: AMBER });
  out += dots([P([-W - 0.45, EV - 0.25, 0.5]), P([0, RG, 0.5]), P([W + 0.45, EV - 0.25, 0.5])], 2);
  // gable vent
  out += line([[0, 4.55, 0], [0.32, 4.2, 0], [0, 3.85, 0], [-0.32, 4.2, 0], [0, 4.55, 0]], { w: 1.5, color: MID, glow: 0.5 });
  // windows and door
  const win = (x0, x1) =>
    line([[x0, 1.25, 0], [x1, 1.25, 0], [x1, 2.3, 0], [x0, 2.3, 0], [x0, 1.25, 0]], { w: 1.7, color: MID, glow: 0.6 }) +
    line([[(x0 + x1) / 2, 1.25, 0], [(x0 + x1) / 2, 2.3, 0]], { w: 1.2, color: DIM, glow: 0 }) +
    line([[x0, 1.8, 0], [x1, 1.8, 0]], { w: 1.2, color: DIM, glow: 0 });
  out += win(-2.85, -1.5) + win(2.05, 3.35);
  out += line([[-0.7, 0.35, 0], [-0.7, 2.42, 0], [0.7, 2.42, 0], [0.7, 0.35, 0]], { w: 2.1, color: AMBER });
  out += line([[-0.42, 1.5, 0], [0.42, 1.5, 0], [0.42, 2.14, 0], [-0.42, 2.14, 0], [-0.42, 1.5, 0]], { w: 1.2, color: MID, glow: 0.4 });
  out += line([[-0.42, 0.62, 0], [0.42, 0.62, 0], [0.42, 1.28, 0], [-0.42, 1.28, 0], [-0.42, 0.62, 0]], { w: 1.2, color: MID, glow: 0.4 });
  const knob = P([0.5, 1.38, 0]);
  out += `<circle cx="${f(knob[0])}" cy="${f(knob[1])}" r="1.8" fill="${HOT}"/>`;

  // porch floor and step
  const FL = 0.35;
  const PZ = 2.1;
  out += face([[-W, 0, PZ], [W, 0, PZ], [W, FL, PZ], [-W, FL, PZ]], { w: 1.8, color: MID, glow: 0.7 });
  out += face([[-W, 0, 0], [-W, 0, PZ], [-W, FL, PZ], [-W, FL, 0]], { w: 1.8, color: MID, glow: 0.7 });
  out += face([[-W, FL, 0], [W, FL, 0], [W, FL, PZ], [-W, FL, PZ]], { w: 1.9, color: AMBER, glow: 0.8 });
  let boards = '';
  for (let x = -3.2; x < W; x += 0.8) boards += poly([P([x, FL, 0.04]), P([x, FL, PZ])]);
  out += beam(boards, { w: 1, color: DIM, glow: 0 });
  // the pool of light on the boards
  const ring = (c, r, n = 40) => Array.from({ length: n + 1 }, (_, i) => P([c[0] + Math.cos((i / n) * Math.PI * 2) * r, c[1], c[2] + Math.sin((i / n) * Math.PI * 2) * r]));
  const LX = 1.36;
  out += beam(poly(ring([LX, FL, 0.95], 0.52)), { w: 1.5, color: AMBER, glow: 0.8 });
  out += beam(poly(ring([LX, FL, 0.95], 0.9)), { w: 1.4, color: AMBER, glow: 0.5, dash: '7 6' });
  // step
  out += face([[-1.15, 0, 2.75], [1.15, 0, 2.75], [1.15, 0.18, 2.75], [-1.15, 0.18, 2.75]], { w: 1.6, color: MID, glow: 0.6 });
  out += face([[-1.15, 0.18, PZ], [1.15, 0.18, PZ], [1.15, 0.18, 2.75], [-1.15, 0.18, 2.75]], { w: 1.6, color: MID, glow: 0.6 });

  // the lamp, on the wall beside the door: the brightest thing on the screen
  const LP = P([LX, 1.84, 0.16]);
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const r0 = 18;
    const r1 = i % 2 ? 31 : 52;
    rays += `M${f(LP[0] + Math.cos(a) * r0)},${f(LP[1] + Math.sin(a) * r0)}L${f(LP[0] + Math.cos(a) * r1)},${f(LP[1] + Math.sin(a) * r1)}`;
  }
  out += beam(rays, { w: 2.1, color: AMBER, glow: 1.3 });
  out += beam(poly([[LP[0], LP[1] - 11], [LP[0] + 8, LP[1]], [LP[0], LP[1] + 11], [LP[0] - 8, LP[1]]], true), { w: 2, color: AMBER, glow: 1.2 });
  out += `<circle cx="${f(LP[0])}" cy="${f(LP[1])}" r="24" fill="${AMBER}" opacity="0.08"/><circle cx="${f(LP[0])}" cy="${f(LP[1])}" r="10" fill="${AMBER}" opacity="0.2"/><circle cx="${f(LP[0])}" cy="${f(LP[1])}" r="4.2" fill="${HOT}"/>`;

  // posts and the porch roof, nearest of all
  const posts = [-3.8, 3.8];
  for (const x of posts) out += line([[x, FL, PZ - 0.2], [x, 2.62, PZ - 0.2]], { w: 2.2, color: AMBER, glow: 0.8 });
  out += face([[-W - 0.3, 2.98, 0], [W + 0.3, 2.98, 0], [W + 0.3, 2.62, PZ + 0.1], [-W - 0.3, 2.62, PZ + 0.1]], { w: 2.2, color: AMBER, glow: 1 });
  out += face([[-W - 0.3, 2.62, PZ + 0.1], [W + 0.3, 2.62, PZ + 0.1], [W + 0.3, 2.44, PZ + 0.1], [-W - 0.3, 2.44, PZ + 0.1]], { w: 1.8, color: AMBER, glow: 0.8 });

  // the words
  const U = 11;
  const TX = 74;
  const TY = 84;
  const prompt = type('>', TX, TY, U);
  const name = type('PORCHLIGHT', TX + U * 5.6, TY, U);
  out += beam(prompt.d, { w: 4.2, color: MID, glow: 0.8, join: 'miter' });
  out += beam(name.d, { w: 4.4, color: AMBER, glow: 0.9, join: 'miter' }) + dots(name.verts, 2.1);
  out += beam(cursor(name.right + U * 1.6, TY, U, { w: 2.4 }), { w: 2.4, color: AMBER, glow: 1, join: 'miter' });
  const tag = type('HOME SECURITY FOR YOUR CODE.', TX, TY + U * 6 + 36, 4.5);
  out += beam(tag.d, { w: 2.3, color: AMBER, glow: 0.7, join: 'miter' });
  const small = type('KEYS · PACKAGES · DOMAINS · THIS MAC', TX, TY + U * 6 + 36 + 27 + 30, 2.5, { space: 3 });
  out += beam(small.d, { w: 1.4, color: MID, glow: 0, join: 'miter' });

  // the edge of the tube
  out += `<rect x="14" y="14" width="1252" height="612" rx="30" fill="none" stroke="${DIM}" stroke-width="1.6"/>`;
  return out;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 52 Amber vector

The amber terminal without the pixels. A vector display draws with a beam, so everything is a clean stroke: a wireframe house in perspective on a ground grid that fades toward the horizon, wireframe pines, and the porch lamp, the brightest thing on the screen, with its rays and a ring of light on the boards. The name is typed after a prompt in a stroke alphabet drawn for this concept, followed by a cursor the beam fills line by line. The glow is two wider, fainter passes under each stroke, not a blur. The mark is the porch as a glyph: the prompt turned upright as a roof, two posts, a step and the lamp.
Palette: screen #100a04, amber #ffb21f, beam dwell #ffd98a, mid #b8690a, dim #5f3706, graticule #2e1b04; strokes on a light page #2a1a06.
Type: a stroke alphabet of straight segments drawn for this concept (name and tagline); Menlo for the small line of the logo.
Tagline: Home security for your code.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logoSvg,
  'logo-dark.svg': logoDarkSvg,
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
