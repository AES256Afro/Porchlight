// 42 Papercut garden: a shadow box. Layers of cut leaves frame the view down
// a garden path to the front door and its lamp.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '42-papercut-garden';
const f = (n) => Math.round(n * 10) / 10;

const P = {
  // the frame, nearest first
  f5: '#0f0918',
  f4: '#1c122b',
  f3: '#2a1b3d',
  f2: '#372551',
  f1: '#1a4f41',
  // the garden
  lawn: '#1c5142',
  lawn2: '#184638',
  hedge: '#174438',
  pot: '#6e4b3c',
  // the house front
  wall: '#1c4a4c',
  ring5: '#27554f',
  ring4: '#3f654f',
  ring3: '#6d774b',
  ring2: '#ad8d49',
  ring1: '#e7aa4e',
  trim: '#3f2d4f',
  door: '#22152f',
  panel: '#2c1d3b',
  ink: '#150d1e',
  // light
  hot: '#fff0c2',
  amber1: '#f9ca63',
  amber2: '#eba34b',
  amber3: '#b9853f',
  stone1: '#8c7c47',
  stone2: '#5f6843',
  stone3: '#3f5a42',
  cream: '#f6e9cb',
};

// ---- cutting helpers ---------------------------------------------------------
function smooth(pts, closed = false) {
  const n = pts.length;
  const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? 'Z' : '');
}
function blobPts(cx, cy, rx, ry, seed, n = 9, jit = 0.08) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.2;
    const k = 1 + (r() - 0.5) * 2 * jit;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
const blob = (cx, cy, rx, ry, seed, n, jit) => smooth(blobPts(cx, cy, rx, ry, seed, n, jit), true);
function cut(pts, seed = 1, j = 0.7) {
  const r = rng(seed * 7 + 3);
  return 'M' + pts.map(([x, y]) => `${f(x + (r() - 0.5) * 2 * j)} ${f(y + (r() - 0.5) * 2 * j)}`).join('L') + 'Z';
}
const box = (x, y, w, h) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
const disc = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

// A leaf cut in two knife strokes, from its stalk at (x, y) along `ang`.
function leaf(x, y, ang, L, Wd, bend = 0) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const p = (t, w) => {
    const side = w + bend * L * t * t;
    return `${f(x + c * L * t - s * side)} ${f(y + s * L * t + c * side)}`;
  };
  return `M${p(0, 0)}C${p(0.16, Wd)} ${p(0.6, Wd * 0.92)} ${p(1, 0)}C${p(0.6, -Wd * 0.92)} ${p(0.16, -Wd)} ${p(0, 0)}Z`;
}
// The slit down a leaf's middle.
function vein(x, y, ang, L, bend = 0) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const p = (t) => `${f(x + c * L * t - s * bend * L * t * t)} ${f(y + s * L * t + c * bend * L * t * t)}`;
  return `M${p(0.1)}Q${p(0.45)} ${p(0.8)}`;
}
// A spray: a stem through `pts` with leaves alternating along it.
function spray(pts, { n, L, Wd, seed, w = 5, lean = 0.9, tip = true }) {
  const r = rng(seed);
  const at = (t) => {
    const u = t * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(u));
    const k = u - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
  };
  let leaves = '';
  let veins = '';
  for (let i = 0; i < n; i++) {
    const t = 0.1 + (0.86 * i) / (n - 1);
    const [x, y] = at(t);
    const [x2, y2] = at(Math.min(1, t + 0.04));
    const dir = Math.atan2(y2 - y, x2 - x);
    const side = i % 2 ? 1 : -1;
    const a = dir + side * (lean + (r() - 0.5) * 0.3);
    const len = L * (1 - 0.35 * t) * (0.88 + r() * 0.24);
    const bend = -side * 0.12;
    leaves += leaf(x, y, a, len, Wd * (1 - 0.3 * t), bend);
    veins += vein(x, y, a, len, bend);
  }
  if (tip) {
    const [x, y] = at(1);
    const [x0, y0] = at(0.94);
    const a = Math.atan2(y - y0, x - x0);
    leaves += leaf(x, y, a, L * 0.62, Wd * 0.66);
    veins += vein(x, y, a, L * 0.62);
  }
  const stem = `<path d="${smooth(pts)}" fill="none" stroke-width="${w}" stroke-linecap="round"/>`;
  return { leaves, veins, stem };
}
// One sheet of the frame: the whole picture with a leafy hole cut in it. The leaves
// lean one way round the hole, like a wreath; `turn` (1 or -1) says which way.
function frame({ cx, cy, rx, ry, seed, n, L, Wd, turn = 1, W = 1280, H = 640 }) {
  const pts = blobPts(cx, cy, rx, ry, seed, 16, 0.03);
  const r = rng(seed + 100);
  let leaves = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.1;
    const lean = 0.5 + r() * 0.5;
    const len = L * (0.78 + r() * 0.44);
    const wd = Wd * (0.9 + r() * 0.25);
    const bx = cx + Math.cos(a) * (rx + 12);
    const by = cy + Math.sin(a) * (ry + 12);
    if (by < -L || by > H + L) continue;
    leaves += leaf(bx, by, a + Math.PI + turn * lean, len, wd, turn * 0.1);
  }
  const sheet = `M-40 -40H${W + 40}V${H + 40}H-40Z` + smooth(pts, true);
  return { sheet, leaves };
}

const SHADOW = (id, dy, sd, op) =>
  `<filter id="${id}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#06030a" flood-opacity="${op}"/></filter>`;
const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.085 0"/></filter>`;

// ---- the house front ----------------------------------------------------------
// A door with a fanlight. (x, y) is the foot of the door's middle; w, h the leaf.
function doorway(x, y, w, h, s = 1) {
  const r = w / 2;
  const top = y - h;
  const t = 9 * s;
  const surround = `M${f(x - r - t)} ${f(y)}V${f(top)}a${f(r + t)} ${f(r + t)} 0 0 1 ${f(w + 2 * t)} 0V${f(y)}Z`;
  const leafD = box(x - r, top + 4 * s, w, h - 4 * s);
  const fan = `M${f(x - r + 3 * s)} ${f(top - 2 * s)}a${f(r - 3 * s)} ${f(r - 3 * s)} 0 0 1 ${f(w - 6 * s)} 0Z`;
  let ribs = '';
  for (const a of [-60, -30, 0, 30, 60]) {
    const q = ((a - 90) * Math.PI) / 180;
    ribs += `M${f(x)} ${f(top - 2 * s)}L${f(x + Math.cos(q) * (r - 3 * s))} ${f(top - 2 * s + Math.sin(q) * (r - 3 * s))}`;
  }
  const hub = `M${f(x - 9 * s)} ${f(top - 2 * s)}a${f(9 * s)} ${f(9 * s)} 0 0 1 ${f(18 * s)} 0Z`;
  const pw = w / 2 - 12 * s;
  const panels =
    box(x - r + 8 * s, top + 16 * s, pw, h * 0.36) + box(x + 4 * s, top + 16 * s, pw, h * 0.36) +
    box(x - r + 8 * s, top + 24 * s + h * 0.36, pw, h * 0.38) + box(x + 4 * s, top + 24 * s + h * 0.36, pw, h * 0.38);
  const knob = disc(x + r - 9 * s, top + 22 * s + h * 0.4, 3.2 * s);
  return { surround, leafD, fan, ribs, hub, panels, knob };
}
// A lantern hung from a scrolled wall bracket. (x, y) is the middle of its glass.
function lantern(x, y, s = 1) {
  const frameD =
    // arm from the wall on the right, and the hook
    `M${f(x + 30 * s)} ${f(y - 44 * s)}h${f(5 * s)}v${f(40 * s)}h${f(-5 * s)}Z` +
    `M${f(x - 2 * s)} ${f(y - 40 * s)}h${f(34 * s)}v${f(4.4 * s)}h${f(-34 * s)}Z` +
    `M${f(x + 10 * s)} ${f(y - 36 * s)}q${f(18 * s)} ${f(2 * s)} ${f(21 * s)} ${f(22 * s)}h${f(-4 * s)}q${f(-3 * s)} ${f(-16 * s)} ${f(-17 * s)} ${f(-18 * s)}Z` +
    box(x - 1.6 * s, y - 38 * s, 3.2 * s, 12 * s) +
    // cap, body, foot
    cut([[x - 15 * s, y - 16 * s], [x, y - 28 * s], [x + 15 * s, y - 16 * s]], 3, 0.4 * s) +
    cut([[x - 12 * s, y - 16 * s], [x + 12 * s, y - 16 * s], [x + 8.6 * s, y + 18 * s], [x - 8.6 * s, y + 18 * s]], 4, 0.4 * s) +
    box(x - 5.4 * s, y + 18 * s, 10.8 * s, 4 * s) + disc(x, y + 25 * s, 2.6 * s);
  const glass = cut([[x - 8.8 * s, y - 12.6 * s], [x + 8.8 * s, y - 12.6 * s], [x + 6.2 * s, y + 14.6 * s], [x - 6.2 * s, y + 14.6 * s]], 5, 0.3 * s);
  const flame = `M${f(x)} ${f(y - 8 * s)}q${f(5 * s)} ${f(8 * s)} 0 ${f(15 * s)}q${f(-5 * s)} ${f(-7 * s)} 0 ${f(-15 * s)}Z`;
  return { frameD, glass, flame };
}
function win(x, y, w, h, g) {
  const pw = (w - g) / 2;
  const ph = (h - 2 * g) / 3;
  let d = '';
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) d += box(x + i * (pw + g), y + j * (ph + g), pw, ph);
  return d;
}
// An owl on its branch, seen from the front. (x, y) is where its feet grip.
function owl(x, y, s = 1) {
  const p = (px, py) => `${f(x + px * s)} ${f(y + py * s)}`;
  const body =
    `M${p(-13, -2)}C${p(-17, -16)} ${p(-17, -30)} ${p(-14, -40)}L${p(-15, -50)}L${p(-7, -45)}C${p(-3, -47)} ${p(3, -47)} ${p(7, -45)}L${p(15, -50)}L${p(14, -40)}` +
    `C${p(17, -30)} ${p(17, -16)} ${p(13, -2)}C${p(7, 3)} ${p(-7, 3)} ${p(-13, -2)}Z`;
  const eyes = disc(x - 6 * s, y - 35 * s, 3.4 * s) + disc(x + 6 * s, y - 35 * s, 3.4 * s);
  return { body, eyes };
}

// ---- hero ----------------------------------------------------------------------
// A clipped bay tree in a pot.
function bay(x, foot, s = 1) {
  const pot = cut([[x - 13 * s, foot - 24 * s], [x + 13 * s, foot - 24 * s], [x + 10 * s, foot], [x - 10 * s, foot]], x, 0.5) + box(x - 15 * s, foot - 28 * s, 30 * s, 5 * s);
  const stem = box(x - 2 * s, foot - 58 * s, 4 * s, 32 * s);
  const ball = blob(x, foot - 74 * s, 22 * s, 22 * s, x + 3, 12, 0.04);
  return { pot, stem, ball };
}
function hero() {
  const W = 1280;
  const H = 640;
  const defs = SHADOW('s', 5, 3, 0.6) + SHADOW('t', 3, 1.5, 0.5) + SHADOW('u', 7, 4.5, 0.6) + GRAIN;
  const CX = 904;
  const CY = 318;
  let b = `<rect width="${W}" height="${H}" fill="${P.wall}"/>`;

  // the lamp's light on the wall: rings of warmer paper
  const LX = 996;
  const LY = 266;
  const rings = [[236, P.ring5, 21], [178, P.ring4, 22], [126, P.ring3, 23], [82, P.ring2, 24], [44, P.ring1, 25]];
  for (const [r, fill, seed] of rings) b += `<g filter="url(#t)"><path fill="${fill}" d="${blob(LX - 8, LY + 10, r, r * 0.96, seed, 20, 0.014)}"/></g>`;

  // windows either side, dark
  const FLOOR = 404;
  for (const wx of [672, 1066]) {
    b += `<g filter="url(#t)"><path fill="${P.trim}" d="${cut([[wx - 8, 240], [wx + 76, 240], [wx + 76, 352], [wx - 8, 352]], wx, 0.6)}"/></g>`;
    b += `<path fill="${P.door}" d="${win(wx, 248, 68, 96, 4)}"/>`;
    b += `<g filter="url(#t)"><path fill="${P.trim}" d="${box(wx - 14, 352, 96, 9)}"/></g>`;
  }
  // the door
  const DX = 872;
  const dr = doorway(DX, FLOOR, 84, 132);
  b += `<g filter="url(#t)"><path fill="${P.trim}" d="${dr.surround}"/></g>`;
  b += `<path fill="${P.door}" d="${dr.leafD}"/><path fill="${P.panel}" d="${dr.panels}"/>`;
  b += `<path fill="${P.amber1}" d="${dr.fan}"/><path d="${dr.ribs}" stroke="${P.trim}" stroke-width="3.4" fill="none"/><path fill="${P.trim}" d="${dr.hub}"/>`;
  b += `<path fill="${P.amber2}" d="${dr.knob}"/>`;
  // the lamp
  const lt = lantern(LX, LY);
  b += `<g filter="url(#t)"><path fill="${P.ink}" d="${lt.frameD}"/></g><path fill="${P.amber1}" d="${lt.glass}"/><path fill="${P.hot}" d="${lt.flame}"/>`;

  // the lawn, then the porch floor and steps lying on it
  b += `<g filter="url(#s)"><path fill="${P.lawn}" d="${smooth([[560, 440], [700, 430], [840, 436], [1000, 434], [1120, 428], [1260, 438]])}L1260 680L560 680Z"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber3}" d="${cut([[630, FLOOR - 2], [1180, FLOOR - 2], [1180, FLOOR + 9], [630, FLOOR + 9]], 31, 0.6)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber2}" d="${cut([[772, FLOOR - 3], [1016, FLOOR - 3], [1016, FLOOR + 9], [772, FLOOR + 9]], 32, 0.6)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber1}" d="${cut([[786, FLOOR + 9], [1002, FLOOR + 9], [1002, FLOOR + 22], [786, FLOOR + 22]], 33, 0.6)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber2}" d="${cut([[776, FLOOR + 22], [1012, FLOOR + 22], [1012, FLOOR + 35], [776, FLOOR + 35]], 34, 0.6)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber3}" d="${cut([[766, FLOOR + 35], [1022, FLOOR + 35], [1022, FLOOR + 48], [766, FLOOR + 48]], 35, 0.6)}"/></g>`;
  // two bay trees in pots beside the steps
  for (const bx of [744, 1042]) {
    const t = bay(bx, FLOOR - 2, 1.05);
    b += `<g filter="url(#t)"><path fill="${P.pot}" d="${t.pot}"/><path fill="${P.ink}" d="${t.stem}"/><path fill="${P.hedge}" d="${t.ball}"/></g>`;
  }
  // stepping stones down the path, dimmer the further from the lamp
  const stones = [[902, 474, 56, 9, P.stone1], [884, 500, 72, 11, P.stone1], [908, 530, 90, 13, P.stone2], [878, 566, 112, 16, P.stone2], [912, 610, 136, 20, P.stone3]];
  stones.forEach(([x, y, rx, ry, fill], i) => (b += `<g filter="url(#t)"><path fill="${fill}" d="${blob(x, y, rx, ry, 40 + i, 12, 0.05)}"/></g>`));
  // the frame: four sheets, each with a leafy hole, nearer and darker
  const sheets = [
    [frame({ cx: CX, cy: CY, rx: 262, ry: 226, seed: 11, n: 40, L: 52, Wd: 14, turn: 1 }), P.f1, 's'],
    [frame({ cx: CX, cy: CY + 4, rx: 322, ry: 274, seed: 12, n: 34, L: 64, Wd: 17, turn: -1 }), P.f2, 's'],
    [frame({ cx: CX + 4, cy: CY, rx: 382, ry: 320, seed: 13, n: 28, L: 76, Wd: 20, turn: 1 }), P.f3, 'u'],
    [frame({ cx: CX + 8, cy: CY, rx: 442, ry: 372, seed: 14, n: 22, L: 88, Wd: 23, turn: -1 }), P.f4, 'u'],
  ];
  for (const [fr, fill, sh] of sheets) b += `<g filter="url(#${sh})" fill="${fill}"><path fill-rule="evenodd" d="${fr.sheet}"/><path d="${fr.leaves}"/></g>`;
  // the nearest sprays, almost black
  const sprays = [
    spray([[1300, 262], [1246, 160], [1166, 84], [1060, 44], [950, 46]], { n: 11, L: 84, Wd: 21, seed: 71 }),
    spray([[392, 690], [486, 612], [590, 566], [706, 548]], { n: 9, L: 86, Wd: 22, seed: 72 }),
    spray([[1300, 474], [1256, 546], [1190, 600], [1104, 630]], { n: 8, L: 76, Wd: 20, seed: 73 }),
  ];
  for (const sp of sprays) {
    b += `<g filter="url(#u)" fill="${P.f5}" stroke="${P.f5}">${sp.stem}<path stroke="none" d="${sp.leaves}"/></g>`;
    b += `<path d="${sp.veins}" stroke="#1f152e" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
  }

  // an owl keeping watch from the top spray
  const ow = owl(1203, 118, 0.95);
  b += `<g filter="url(#t)"><path fill="${P.f5}" d="${ow.body}"/></g><path fill="${P.amber1}" d="${ow.eyes}"/>`;

  // fireflies that have wandered out past the frame
  const flies = [[566, 176, 1], [600, 470, 0.8], [330, 150, 0.8], [468, 528, 1], [214, 500, 0.7], [140, 214, 0.7], [706, 76, 0.8], [470, 96, 0.6]];
  for (const [x, y, s] of flies) b += `<g filter="url(#t)"><circle cx="${x}" cy="${y}" r="${f(9 * s)}" fill="#4d3a4c"/></g><circle cx="${x}" cy="${y}" r="${f(4.6 * s)}" fill="${P.amber3}"/><circle cx="${x}" cy="${y}" r="${f(2.4 * s)}" fill="${P.amber1}"/>`;

  // type, cut from cream paper
  b += `<g filter="url(#t)" fill="${P.cream}">`;
  b += `<text x="62" y="318" font-family="Iowan Old Style" font-weight="900" font-size="95" letter-spacing="0.5">Porchlight</text>`;
  b += `<text x="66" y="368" font-family="Avenir Next" font-weight="500" font-size="27" letter-spacing="1.5" fill="#d8cfdc">Keep watch over what’s yours.</text>`;
  b += `</g>`;

  b += `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.9"/>`;
  return svg({ w: W, h: H, defs, body: b });
}

// ---- mark: the lit door seen through a ring of leaves -----------------------------
function ringLeaves(cx, cy, r0, n, L, Wd, twist, seed, inward = false) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.06;
    const base = [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0];
    const ang = (inward ? a + Math.PI : a) + twist;
    d += leaf(base[0], base[1], ang, L * (0.94 + r() * 0.12), Wd, 0.08 * Math.sign(twist));
  }
  return d;
}
// The door, lamp and steps inside a disc of radius r at (cx, cy).
function litDoor(id, cx, cy, r) {
  const k = r / 50;
  const fy = cy + 30 * k;
  const dx = cx - 9 * k;
  const lx = cx + 24 * k;
  const ly = cy - 8 * k;
  let b = `<clipPath id="${id}v"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><g clip-path="url(#${id}v)">`;
  b += `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="${P.ring4}"/>`;
  b += `<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(44 * k)}" fill="${P.ring3}"/><circle cx="${f(lx)}" cy="${f(ly)}" r="${f(29 * k)}" fill="${P.ring2}"/><circle cx="${f(lx)}" cy="${f(ly)}" r="${f(15 * k)}" fill="${P.ring1}"/>`;
  // door with fanlight
  const dw = 30 * k;
  const dh = 40 * k;
  b += `<path fill="${P.trim}" d="M${f(dx - dw / 2 - 4 * k)} ${f(fy)}V${f(fy - dh)}a${f(dw / 2 + 4 * k)} ${f(dw / 2 + 4 * k)} 0 0 1 ${f(dw + 8 * k)} 0V${f(fy)}Z"/>`;
  b += `<path fill="${P.door}" d="${box(dx - dw / 2, fy - dh + 2 * k, dw, dh - 2 * k)}"/>`;
  b += `<path fill="${P.amber1}" d="M${f(dx - dw / 2 + 1.5 * k)} ${f(fy - dh - 1.5 * k)}a${f(dw / 2 - 1.5 * k)} ${f(dw / 2 - 1.5 * k)} 0 0 1 ${f(dw - 3 * k)} 0Z"/>`;
  // lamp
  b += `<path fill="${P.ink}" d="M${f(lx - 7 * k)} ${f(ly - 7 * k)}L${f(lx)} ${f(ly - 13 * k)}L${f(lx + 7 * k)} ${f(ly - 7 * k)}ZM${f(lx - 5.6 * k)} ${f(ly - 7 * k)}h${f(11.2 * k)}l${f(-1.8 * k)} ${f(15 * k)}h${f(-7.6 * k)}Z"/>`;
  b += `<path fill="${P.hot}" d="M${f(lx - 3.6 * k)} ${f(ly - 5 * k)}h${f(7.2 * k)}l${f(-1.2 * k)} ${f(11 * k)}h${f(-4.8 * k)}Z"/>`;
  // floor and steps
  b += `<path fill="${P.amber2}" d="${box(cx - r, fy, 2 * r, 6 * k)}"/><path fill="${P.amber1}" d="${box(cx - 34 * k, fy + 6 * k, 68 * k, 7 * k)}"/><path fill="${P.lawn}" d="${box(cx - r, fy + 13 * k, 2 * r, 20 * k)}"/>`;
  b += `<path fill="${P.amber3}" d="${box(cx - 40 * k, fy + 13 * k, 80 * k, 7 * k)}"/>`;
  b += `</g>`;
  return b;
}
function markBody(id) {
  const defs = SHADOW(`${id}s`, 2.4, 1.4, 0.55);
  let b = '';
  b += `<g filter="url(#${id}s)"><path fill="#2e7c66" d="${ringLeaves(100, 100, 60, 13, 38, 12.5, 0.62, 5)}"/></g>`;
  b += `<g filter="url(#${id}s)"><circle cx="100" cy="100" r="70" fill="${P.f2}"/></g>`;
  b += litDoor(id, 100, 100, 52);
  b += `<g filter="url(#${id}s)" fill="${P.f1}"><path fill-rule="evenodd" d="${disc(100, 100, 63)}${disc(100, 100, 50)}"/><path d="${ringLeaves(100, 100, 56, 14, 20, 6.6, 0.8, 6, true)}"/></g>`;
  return { defs, body: b };
}
function markSvg() {
  const m = markBody('m');
  return svg({ w: 512, h: 512, vb: '0 0 200 200', defs: m.defs, body: m.body });
}
function iconSvg() {
  // the wreath on a plum tile, with a second ring of darker leaves behind it
  const m = markBody('i');
  const defs = m.defs + GRAIN + `<clipPath id="tile"><rect width="200" height="200" rx="44"/></clipPath>`;
  let b = `<g clip-path="url(#tile)"><rect width="200" height="200" fill="${P.f4}"/>`;
  b += `<g filter="url(#is)"><path fill="${P.f2}" d="${ringLeaves(100, 100, 74, 12, 52, 17, -0.6, 9)}"/></g>`;
  b += `<g transform="translate(100 100) scale(0.93) translate(-100 -100)">${m.body}</g>`;
  b += `<rect width="200" height="200" filter="url(#grain)" opacity="0.8"/></g>`;
  return svg({ w: 512, h: 512, vb: '0 0 200 200', defs, body: b });
}

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { p: P.f3, P: P.f2, g: '#2e7c66', G: P.f1, w: P.ring3, r: P.ring2, R: P.ring1, k: P.door, A: P.amber1, a: P.amber2, h: P.hot, t: P.trim };
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
  '..gg.pppppp.gg..',
  '.gggppppppppggg.',
  'ggppppwwwwppppgg',
  'gpppwwwwwwwwpppg',
  '.ppwwwAAAAwwwpp.',
  'pppwwAAAAAAwwRpp',
  'ppwwwAkkkkAwRhRp',
  'ppwwwAkkkkAwwRpp',
  'ppwwwAkkkkAwwwpp',
  'ppwwwAkkkkAwwwpp',
  'pppwwAkkkkAwwppp',
  '.ppaaaaaaaaaapp.',
  'gpppAAAAAAAApppg',
  'ggppppppppppppgg',
  '.gggppppppppggg.',
  '..gg.pppppp.gg..',
];
const FAV32 = [
  '....ggg....pppppppppp....ggg....',
  '...ggggg.pppppppppppppp.ggggg...',
  '..ggggggpppppppppppppppgggggggg.',
  '.gggggpppppppGGGGGGpppppppggggg.',
  'ggggppppppGGGGGGGGGGGGppppppgggg',
  'gggppppGGGGGwwwwwwwwGGGGGppppggg',
  'gggpppGGGGwwwwwwwwwwwwGGGGpppggg',
  '.gpppGGGwwwwwwwwwwwwwwwwGGGpppg.',
  '..ppGGGwwwwwwwwwwwwrrrrwwGGGpp..',
  '.pppGGwwwwwAAAAwwwrrrrrrwwGGppp.',
  '.ppGGGwwwwAAAAAAwrrrkkrrrwGGGpp.',
  'pppGGwwwwtAAAAAAtrrkkkkrrwwGGppp',
  'pppGGwwwwtttttttrrRkhhkRrwwGGppp',
  'pppGGwwwwtkkkkktrrRkhhkRrwwGGppp',
  'pppGGwwwwtkkkkktrrRkhhkRrwwGGppp',
  'pppGGwwwwtkkkkktwrrRkkRrrwwGGppp',
  'pppGGwwwwtkkkkktwrrrRRrrwwwGGppp',
  'pppGGwwwwtkkkkktwwrrrrrwwwwGGppp',
  'pppGGwwwwtkkkkatwwwrrrwwwwwGGppp',
  'pppGGwwwwtkkkkktwwwwwwwwwwwGGppp',
  'pppGGwwwwtkkkkktwwwwwwwwwwwGGppp',
  '.ppGGGaaaaaaaaaaaaaaaaaaaaGGGpp.',
  '.pppGGaaAAAAAAAAAAAAAAAAaaGGppp.',
  '..ppGGGGaaaaaaaaaaaaaaaaGGGGpp..',
  '.gpppGGGGGGGGGGGGGGGGGGGGGGpppg.',
  'gggpppGGGGGGGGGGGGGGGGGGGGpppggg',
  'gggppppGGGGGGGGGGGGGGGGGGppppggg',
  'ggggppppppGGGGGGGGGGGGppppppgggg',
  '.gggggpppppppGGGGGGpppppppggggg.',
  '..ggggggpppppppppppppppgggggggg.',
  '...ggggg.pppppppppppppp.ggggg...',
  '....ggg....pppppppppp....ggg....',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- logo -----------------------------------------------------------------------
function logoSvg(dark) {
  const m = markBody(dark ? 'ld' : 'll');
  let b = nest({ x: 8, y: 8, w: 184, h: 184, vb: '0 0 200 200', body: `<defs>${m.defs}</defs>` + m.body });
  b += `<text x="204" y="120" font-family="Iowan Old Style" font-weight="900" font-size="76" fill="${dark ? P.cream : P.f3}">Porchlight</text>`;
  b += `<text x="207" y="158" font-family="Avenir Next" font-weight="500" font-size="20.5" letter-spacing="1.2" fill="${dark ? '#b9a9c4' : '#2a6a58'}">Keep watch over what’s yours.</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 42 Papercut garden

A shadow box. Four sheets of paper, each with a leafy hole cut in it, step from green through plum to near black as they come toward you, and the darkest sprays of leaves hang in front of them all. Through the hole: stepping stones across the lawn, two bay trees in pots, and the front door with its fanlight lit and a lantern beside it, whose light is five rings of warmer paper on the wall. An owl keeps watch from the top branch, and a few fireflies have wandered out past the frame.
Palette: plum frame #1c122b / #2a1b3d / #372551, leaf green #1a4f41, lawn #1c5142, wall #1c4a4c, light on the wall #27554f / #3f654f / #6d774b / #ad8d49 / #e7aa4e, amber #f9ca63 / #eba34b, cream #f6e9cb.
Type: Iowan Old Style Black for the name, cut from cream paper; Avenir Next Medium, tracked, for the line under it.
Tagline: Keep watch over what's yours.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(),
  'logo.svg': logoSvg(false),
  'logo-dark.svg': logoSvg(true),
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
