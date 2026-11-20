// 43 Papercut snow: a winter night in pale layers. White drifts, white birches,
// one dark house, its porch light on, and a line of footprints to the door.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '43-papercut-snow';
const f = (n) => Math.round(n * 10) / 10;

const P = {
  sky: '#557fa2',
  halo2: '#5f89ab',
  halo1: '#6b95b5',
  moon: '#fbf6e4',
  far: '#a7c2d6',
  farTree: '#8eafc8',
  mid: '#c1d6e4',
  near: '#d9e7ef',
  front: '#ecf3f6',
  drift: '#fafcfc',
  white: '#fdfdfb',
  pine: '#4a7495',
  pine2: '#3f6889',
  house: '#1f3d5b',
  pane: '#152c44',
  ink: '#132a41',
  door: '#a9483a',
  smoke: '#7da2be',
  birchMark: '#2a4a69',
  print: '#a6c0d4',
  print2: '#8fb0c9',
  ring3: '#33526d',
  ring2: '#6d7069',
  ring1: '#b6935a',
  amber1: '#f9c865',
  amber2: '#ec9f4a',
  pool3: '#f1e2c2',
  pool2: '#f5d39a',
  pool1: '#f7c574',
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
function ridge(anchors, { step = 34, jit = 2, seed = 1 } = {}) {
  const r = rng(seed);
  const pts = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [x0, y0] = anchors[k];
    const [x1, y1] = anchors[k + 1];
    const n = Math.max(1, Math.round(Math.abs(x1 - x0) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const e = (1 - Math.cos(Math.PI * t)) / 2;
      const wob = i === 0 ? 0 : (r() - 0.5) * 2 * jit;
      pts.push([x0 + (x1 - x0) * t + (i === 0 ? 0 : (r() - 0.5) * step * 0.25), y0 + (y1 - y0) * e + wob]);
    }
  }
  pts.push(anchors[anchors.length - 1]);
  return pts;
}
function hill(anchors, bottom, opts) {
  const pts = ridge(anchors, opts);
  return smooth(pts) + `L${f(pts[pts.length - 1][0])} ${bottom}L${f(pts[0][0])} ${bottom}Z`;
}
function ridgeY(anchors, x) {
  for (let k = 0; k < anchors.length - 1; k++) {
    const [x0, y0] = anchors[k];
    const [x1, y1] = anchors[k + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + ((y1 - y0) * (1 - Math.cos(Math.PI * t))) / 2;
    }
  }
  return anchors[anchors.length - 1][1];
}
function cut(pts, seed = 1, j = 0.7) {
  const r = rng(seed * 7 + 3);
  return 'M' + pts.map(([x, y]) => `${f(x + (r() - 0.5) * 2 * j)} ${f(y + (r() - 0.5) * 2 * j)}`).join('L') + 'Z';
}
const box = (x, y, w, h) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
const disc = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
function blob(cx, cy, rx, ry, seed, n = 9, jit = 0.08) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.2;
    const k = 1 + (r() - 0.5) * 2 * jit;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smooth(pts, true);
}
// A pine as stacked tiers, and the snow lying on each tier.
function pine(x, base, h, w, seed) {
  const r = rng(seed);
  const tiers = 4;
  let body = '';
  let snow = '';
  const trunkW = Math.max(2, w * 0.09);
  body += box(x - trunkW / 2, base - h * 0.12, trunkW, h * 0.14);
  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers;
    const top = base - h + h * 0.78 * t0 - (i ? h * 0.07 : 0);
    const bot = base - h + h * 0.78 * ((i + 1) / tiers) + h * 0.1;
    const hw = (w / 2) * (0.38 + 0.62 * ((i + 1) / tiers)) * (0.94 + r() * 0.12);
    const dx = (r() - 0.5) * 1.5;
    body += `M${f(x + dx)} ${f(top)}L${f(x + hw)} ${f(bot)}L${f(x + hw * 0.3)} ${f(bot - (bot - top) * 0.1)}L${f(x - hw * 0.3)} ${f(bot - (bot - top) * 0.1)}L${f(x - hw)} ${f(bot)}Z`;
    const hh = bot - top;
    snow += `M${f(x + dx)} ${f(top - 1)}L${f(x + hw * 0.56)} ${f(top + hh * 0.58)}L${f(x + hw * 0.26)} ${f(top + hh * 0.46)}L${f(x + hw * 0.04)} ${f(top + hh * 0.62)}L${f(x - hw * 0.22)} ${f(top + hh * 0.44)}L${f(x - hw * 0.6)} ${f(top + hh * 0.62)}Z`;
  }
  return { body, snow };
}
// A plain far-off pine.
function farPine(x, base, h, w, seed) {
  const r = rng(seed);
  const k = 0.94 + r() * 0.12;
  return `M${f(x)} ${f(base - h)}L${f(x + (w / 2) * 0.5)} ${f(base - h * 0.52)}L${f(x + (w / 2) * 0.32)} ${f(base - h * 0.54)}L${f(x + (w / 2) * k)} ${f(base)}L${f(x - (w / 2) * k)} ${f(base)}L${f(x - (w / 2) * 0.32)} ${f(base - h * 0.54)}L${f(x - (w / 2) * 0.5)} ${f(base - h * 0.52)}Z`;
}
// A birch: a white trunk with dark notches, and thin dark branches behind it.
function birch(x, foot, top, w, lean, seed, branchFrom = top) {
  const r = rng(seed);
  const at = (y) => x + (lean * (foot - y)) / (foot - top);
  const wAt = (y) => w * (0.55 + (0.45 * (y - top)) / (foot - top));
  const trunk = cut([[at(foot) - wAt(foot) / 2, foot], [at(top) - wAt(top) / 2, top], [at(top) + wAt(top) / 2, top], [at(foot) + wAt(foot) / 2, foot]], seed, 0.5);
  let marks = '';
  let y = top + 26 + r() * 30;
  let side = r() < 0.5 ? 1 : -1;
  while (y < foot - 14) {
    const ww = wAt(y);
    const cx = at(y);
    const len = ww * (0.42 + r() * 0.3);
    const hh = 2.4 + ww * 0.1 + r() * 1.6;
    const ex = cx + (side * ww) / 2;
    marks += `M${f(ex)} ${f(y - hh)}L${f(ex - side * len)} ${f(y + (r() - 0.5) * 2)}L${f(ex)} ${f(y + hh)}Z`;
    y += 22 + r() * 44;
    side = -side;
  }
  let branches = '';
  let by = branchFrom + 30 + r() * 40;
  let bs = r() < 0.5 ? 1 : -1;
  while (by < foot - (foot - top) * 0.42) {
    const len = (44 + r() * 60) * (w / 22);
    const a = (-Math.PI / 2) + bs * (0.62 + r() * 0.3);
    const x0 = at(by);
    const x1 = x0 + Math.cos(a) * len;
    const y1 = by + Math.sin(a) * len;
    const t = Math.max(1.4, w * 0.13);
    branches += `M${f(x0)} ${f(by + t)}L${f(x1)} ${f(y1)}L${f(x0)} ${f(by - t)}Z`;
    // a twig off the branch
    const mx = x0 + (x1 - x0) * 0.55;
    const my = by + (y1 - by) * 0.55;
    const a2 = a - bs * 0.75;
    branches += `M${f(mx - 1)} ${f(my + 1)}L${f(mx + Math.cos(a2) * len * 0.4)} ${f(my + Math.sin(a2) * len * 0.4)}L${f(mx + 1)} ${f(my - 1)}Z`;
    by += 46 + r() * 60;
    bs = -bs;
  }
  return { trunk, marks, branches };
}

const SHADOW = (id, dy, sd, op) =>
  `<filter id="${id}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#1d3f61" flood-opacity="${op}"/></filter>`;
const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.2  0 0 0 0 0.35  0 0 0 0.09 0"/></filter>`;

// ---- the house ------------------------------------------------------------------
function win(x, y, w, h, g) {
  const pw = (w - g) / 2;
  const ph = (h - g) / 2;
  return box(x, y, pw, ph) + box(x + pw + g, y, pw, ph) + box(x, y + ph + g, pw, ph) + box(x + pw + g, y + ph + g, pw, ph);
}
// Snow lying on a sloped roof: straight on top, scalloped where it overhangs.
function roofSnow(xa, ya, xb, yb, thick, seed, n = 7) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const drip = i === 0 || i === n ? thick * 0.5 : thick * (0.8 + r() * 0.5) * (i % 2 ? 1 : 0.78);
    pts.push([xb + (xa - xb) * t, yb + (ya - yb) * t + drip]);
  }
  return `M${f(xa)} ${f(ya)}L${f(xb)} ${f(yb)}` + 'L' + smooth(pts).slice(1) + 'Z';
}
function house(cx, base, s = 1) {
  const W = 224 * s;
  const x0 = cx - W / 2;
  const x1 = cx + W / 2;
  const top = base - 104 * s;
  const apex = top - 86 * s;
  const e = 17 * s;
  const foot = base + 40 * s;
  const wall = cut([[x0, foot], [x0, top], [x0 - e, top + 2 * s], [cx, apex], [x1 + e, top + 2 * s], [x1, top], [x1, foot]], 43, 0.8 * s);
  const chX = cx + 50 * s;
  const chTop = apex + 8 * s;
  const chimney = cut([[chX, apex + 58 * s], [chX, chTop], [chX + 24 * s, chTop], [chX + 24 * s, apex + 80 * s]], 5, 0.5 * s);
  const g = 2.8 * s;
  const panes =
    win(x0 + 24 * s, top + 24 * s, 42 * s, 46 * s, g) + win(x1 - 66 * s, top + 24 * s, 42 * s, 46 * s, g) +
    disc(cx, apex + 52 * s, 13 * s);
  const sills = box(x0 + 19 * s, top + 70 * s, 52 * s, 5 * s) + box(x1 - 71 * s, top + 70 * s, 52 * s, 5 * s);
  const dx = cx - 8 * s;
  const dw = 40 * s;
  const dh = 66 * s;
  const door = box(dx - dw / 2, base - dh, dw, dh + 6 * s);
  const doorFrame = box(dx - dw / 2 - 5 * s, base - dh - 5 * s, dw + 10 * s, dh + 11 * s);
  const doorPanes = box(dx - dw / 2 + 7 * s, base - dh + 8 * s, 11 * s, 14 * s) + box(dx + dw / 2 - 18 * s, base - dh + 8 * s, 11 * s, 14 * s);
  // the hood over the door
  const hy = base - dh - 12 * s;
  const hood = cut([[dx - 38 * s, hy], [dx, hy - 22 * s], [dx + 38 * s, hy], [dx + 38 * s, hy + 6 * s], [dx - 38 * s, hy + 6 * s]], 7, 0.5 * s);
  const hoodSnow = roofSnow(dx, hy - 26 * s, dx - 42 * s, hy - 2 * s, 7 * s, 8, 4) + roofSnow(dx, hy - 26 * s, dx + 42 * s, hy - 2 * s, 7 * s, 9, 4);
  // snow on the roof and the chimney
  const snow =
    roofSnow(cx, apex - 7 * s, x0 - e - 5 * s, top - 2 * s, 17 * s, 11, 8) + roofSnow(cx, apex - 7 * s, x1 + e + 5 * s, top - 2 * s, 17 * s, 12, 8) +
    `M${f(chX - 4 * s)} ${f(chTop + 5 * s)}Q${f(chX - 5 * s)} ${f(chTop - 9 * s)} ${f(chX + 12 * s)} ${f(chTop - 9 * s)}Q${f(chX + 29 * s)} ${f(chTop - 9 * s)} ${f(chX + 28 * s)} ${f(chTop + 5 * s)}Z` +
    box(x0 + 19 * s, top + 67 * s, 52 * s, 4 * s) + box(x1 - 71 * s, top + 67 * s, 52 * s, 4 * s);
  // the lamp, on the wall between the door and the right-hand window
  const lx = cx + 33 * s;
  const ly = base - 46 * s;
  const lampFrame =
    box(lx - 1.2 * s, ly - 20 * s, 2.4 * s, 8 * s) +
    cut([[lx - 9 * s, ly - 9 * s], [lx, ly - 15 * s], [lx + 9 * s, ly - 9 * s]], 9, 0.3 * s) +
    cut([[lx - 7 * s, ly - 9 * s], [lx + 7 * s, ly - 9 * s], [lx + 5 * s, ly + 9 * s], [lx - 5 * s, ly + 9 * s]], 10, 0.3 * s) +
    box(lx - 3.4 * s, ly + 9 * s, 6.8 * s, 2.6 * s);
  const lamp = cut([[lx - 4.8 * s, ly - 6.6 * s], [lx + 4.8 * s, ly - 6.6 * s], [lx + 3.4 * s, ly + 6.8 * s], [lx - 3.4 * s, ly + 6.8 * s]], 11, 0.2 * s);
  return { wall, chimney, panes, sills, door, doorFrame, doorPanes, hood, hoodSnow, snow, lampFrame, lamp, lx, ly, dx, dw, dh, chX, chTop, x0, x1, top, apex };
}
// A footprint: a long oval for the sole and a small one for the heel.
function footprint(x, y, ang, len) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const el = (cx, cy, rx, ry) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = Math.cos(a) * rx;
      const py = Math.sin(a) * ry;
      pts.push([cx + px * c - py * s, cy + px * s + py * c]);
    }
    return smooth(pts, true);
  };
  return el(x + c * len * 0.16, y + s * len * 0.16, len * 0.36, len * 0.2) + el(x - c * len * 0.4, y - s * len * 0.4, len * 0.17, len * 0.15);
}

// ---- hero ----------------------------------------------------------------------
function hero() {
  const W = 1280;
  const H = 640;
  const defs = SHADOW('s', 4, 2.6, 0.34) + SHADOW('t', 2.5, 1.4, 0.32) + SHADOW('d', 3, 1.6, 0.55) + GRAIN;
  let b = `<rect width="${W}" height="${H}" fill="${P.sky}"/>`;

  // moon and its halo rings
  const MX = 344;
  const MY = 96;
  b += `<g filter="url(#s)"><path fill="${P.halo2}" d="${blob(MX, MY, 112, 112, 3, 22, 0.008)}"/></g>`;
  b += `<g filter="url(#s)"><path fill="${P.halo1}" d="${blob(MX, MY, 76, 76, 4, 18, 0.01)}"/></g>`;
  b += `<g filter="url(#s)"><circle fill="${P.moon}" cx="${MX}" cy="${MY}" r="41"/></g>`;

  // far hills with their pines
  const A1 = [[-20, 322], [220, 300], [470, 326], [700, 304], [940, 322], [1140, 296], [1300, 314]];
  let farTrees = '';
  for (const [x, h] of [[150, 44], [176, 32], [202, 40], [664, 40], [690, 54], [716, 34], [742, 44], [1096, 42], [1122, 56], [1150, 38], [1238, 46], [1262, 34]]) {
    farTrees += farPine(x, ridgeY(A1, x) + 6, h, h * 0.52, x);
  }
  b += `<g filter="url(#s)"><path fill="${P.farTree}" d="${farTrees}"/></g>`;
  b += `<g filter="url(#s)"><path fill="${P.far}" d="${hill(A1, H, { seed: 3, jit: 1.6 })}"/></g>`;

  // smoke from the chimney: paper curls, behind the house
  const CX = 420;
  const BASE = 352;
  const hs = house(CX, BASE);
  const sx = hs.chX + 12;
  const sy = hs.chTop - 12;
  b += `<g filter="url(#t)" fill="${P.smoke}"><path d="${blob(sx + 5, sy - 13, 11, 9, 21, 8, 0.06)}"/><path d="${blob(sx + 22, sy - 37, 16, 12, 22, 9, 0.06)}"/><path d="${blob(sx + 50, sy - 60, 22, 15, 23, 9, 0.06)}"/></g>`;

  // the house, dark against everything
  b += `<g filter="url(#d)" fill="${P.house}"><path d="${hs.wall}"/><path d="${hs.chimney}"/></g>`;
  b += `<clipPath id="wall"><path d="${hs.wall}"/></clipPath><g clip-path="url(#wall)">`;
  b += `<path fill="${P.ring3}" d="${blob(hs.lx, hs.ly + 2, 66, 62, 31, 18, 0.014)}"/>`;
  b += `<path fill="${P.ring2}" d="${blob(hs.lx, hs.ly + 2, 44, 42, 32, 16, 0.014)}"/>`;
  b += `<path fill="${P.ring1}" d="${blob(hs.lx, hs.ly + 1, 25, 24, 33, 14, 0.016)}"/>`;
  b += `</g>`;
  b += `<path fill="${P.pane}" d="${hs.panes}"/><path fill="${P.ink}" d="${hs.sills}"/>`;
  b += `<path fill="${P.ink}" d="${hs.doorFrame}"/><path fill="${P.door}" d="${hs.door}"/><path fill="${P.pane}" d="${hs.doorPanes}"/>`;
  b += `<g filter="url(#d)"><path fill="${P.ink}" d="${hs.hood}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.white}" d="${hs.snow}"/><path fill="${P.white}" d="${hs.hoodSnow}"/></g>`;
  b += `<path fill="${P.ink}" d="${hs.lampFrame}"/><path fill="${P.amber1}" d="${hs.lamp}"/>`;

  // the house hill, drifted up against the walls; pines on it
  const A2 = [[-20, 384], [160, 366], [310, 356], [420, 358], [540, 354], [700, 372], [900, 392], [1100, 376], [1300, 386]];
  let p2 = { body: '', snow: '' };
  for (const [x, h, sd] of [[224, 104, 1], [264, 74, 2], [604, 118, 3], [648, 80, 4], [690, 60, 5], [846, 88, 6], [884, 64, 7]]) {
    const p = pine(x, ridgeY(A2, x) + 8, h, h * 0.5, sd + 40);
    p2.body += p.body;
    p2.snow += p.snow;
  }
  b += `<g filter="url(#s)"><path fill="${P.pine}" d="${p2.body}"/></g><path fill="${P.white}" d="${p2.snow}"/>`;
  b += `<g filter="url(#s)"><path fill="${P.mid}" d="${hill(A2, H, { seed: 5, jit: 1.4 })}"/></g>`;
  // the light on the snow, and the lit step
  b += `<g filter="url(#t)"><path fill="${P.pool3}" d="${blob(CX + 18, BASE + 26, 128, 19, 51, 20, 0.012)}"/></g>`;
  b += `<path fill="${P.pool2}" d="${blob(CX + 14, BASE + 22, 84, 12, 52, 18, 0.012)}"/>`;
  b += `<path fill="${P.pool1}" d="${blob(CX + 8, BASE + 18, 46, 6.5, 53, 14, 0.012)}"/>`;
  b += `<g filter="url(#t)"><path fill="${P.amber2}" d="${cut([[hs.dx - 30, BASE + 3], [hs.dx + 30, BASE + 3], [hs.dx + 30, BASE + 11], [hs.dx - 30, BASE + 11]], 55, 0.5)}"/></g>`;

  // the nearer drifts
  const A3 = [[-20, 462], [200, 446], [440, 466], [700, 478], [940, 458], [1140, 446], [1300, 452]];
  let p3 = { body: '', snow: '' };
  for (const [x, h, sd] of [[1008, 136, 1], [1056, 96, 2], [1226, 112, 3]]) {
    const p = pine(x, ridgeY(A3, x) + 10, h, h * 0.5, sd + 60);
    p3.body += p.body;
    p3.snow += p.snow;
  }
  b += `<g filter="url(#s)"><path fill="${P.pine2}" d="${p3.body}"/></g><path fill="${P.white}" d="${p3.snow}"/>`;
  b += `<g filter="url(#s)"><path fill="${P.near}" d="${hill(A3, H, { seed: 7, jit: 1.6 })}"/></g>`;
  const A4 = [[-20, 548], [260, 530], [520, 554], [820, 566], [1080, 544], [1300, 536]];
  b += `<g filter="url(#s)"><path fill="${P.front}" d="${hill(A4, H, { seed: 9, jit: 1.6 })}"/></g>`;
  const A5 = [[-20, 610], [300, 596], [640, 618], [960, 606], [1300, 594]];
  b += `<g filter="url(#s)"><path fill="${P.drift}" d="${hill(A5, H + 20, { seed: 11, jit: 1.4 })}"/></g>`;

  // footprints, from where we stand to the door
  const p0 = [806, 648], p1 = [770, 540], p2c = [590, 452], p3c = [hs.dx + 4, BASE + 22];
  const bez = (t) => {
    const u = 1 - t;
    return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2c[i] + t * t * t * p3c[i]);
  };
  let prints = '';
  let printsFar = '';
  let t = 0.02;
  let side = 1;
  while (t < 0.985) {
    const [x, y] = bez(t);
    const [x2, y2] = bez(Math.min(1, t + 0.01));
    const ang = Math.atan2(y2 - y, x2 - x);
    const k = 1 - t;
    const len = 6 + 17 * k;
    const off = (3.2 + 8.5 * k) * side;
    const fp = footprint(x - Math.sin(ang) * off, y + Math.cos(ang) * off * 0.55, ang, len);
    if (y > 470) prints += fp;
    else printsFar += fp;
    t += 0.022 + 0.05 * k;
    side = -side;
  }
  b += `<path fill="${P.print}" d="${prints}"/><path fill="${P.print2}" d="${printsFar}"/>`;

  // birches in front
  const birches = [birch(196, 578, -30, 15, 10, 5), birch(128, 618, -30, 21, -14, 6), birch(52, 660, -30, 30, 12, 7), birch(1254, 640, -30, 21, -6, 8, 262)];
  for (const br of birches) {
    b += `<path fill="${P.birchMark}" d="${br.branches}"/>`;
    b += `<g filter="url(#s)"><path fill="${P.white}" d="${br.trunk}"/></g><path fill="${P.birchMark}" d="${br.marks}"/>`;
  }

  // snow falling
  const r = rng(43);
  let flakes = '';
  for (let i = 0; i < 90; i++) {
    const x = r() * W;
    const y = r() * 520;
    const s = 1.6 + r() * 2.6;
    if (x > 590 && x < 1216 && y > 70 && y < 250) continue;
    flakes += disc(x, y, s);
  }
  b += `<g filter="url(#t)"><path fill="${P.white}" d="${flakes}"/></g>`;

  // type, cut from white paper
  b += `<g filter="url(#t)" fill="${P.white}" text-anchor="end">`;
  b += `<text x="1196" y="178" font-family="Futura" font-weight="700" font-size="106" letter-spacing="-0.5">Porchlight</text>`;
  b += `<text x="1192" y="230" font-family="Futura" font-weight="500" font-size="29" letter-spacing="2.4" fill="#e6f0f6">The light stays on.</text>`;
  b += `</g>`;

  b += `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.9"/>`;
  return svg({ w: W, h: H, defs, body: b });
}

// ---- mark: the house in a snow globe ------------------------------------------------
// The scene, in a 200 x 200 space, to be clipped by a disc or a tile.
function scene(id, front = P.drift) {
  let b = `<rect width="200" height="200" fill="${P.sky}"/>`;
  b += `<circle fill="${P.halo1}" cx="150" cy="46" r="26"/><circle fill="${P.moon}" cx="150" cy="46" r="14"/>`;
  b += `<g filter="url(#${id}s)"><path fill="${P.far}" d="M-6 128Q40 108 96 122T206 112V210H-6Z"/></g>`;
  const pn = pine(42, 136, 50, 26, 3);
  b += `<g filter="url(#${id}s)"><path fill="${P.pine}" d="${pn.body}"/></g><path fill="${P.white}" d="${pn.snow}"/>`;
  // house
  b += `<g filter="url(#${id}d)" fill="${P.house}"><path d="M66 150V98H58L104 58L150 98H142V150Z"/><path d="M122 78V60h13v29Z"/></g>`;
  b += `<clipPath id="${id}w"><path d="M66 150V98L104 62L142 98V150Z"/></clipPath><g clip-path="url(#${id}w)"><circle fill="${P.ring3}" cx="121" cy="122" r="27"/><circle fill="${P.ring2}" cx="121" cy="122" r="18"/><circle fill="${P.ring1}" cx="121" cy="122" r="10"/></g>`;
  b += `<path fill="${P.pane}" d="${win(74, 106, 16, 18, 1.8)}"/>`;
  b += `<path fill="${P.ink}" d="M90 150V112h22v38Z"/><path fill="${P.door}" d="M93 150V115h16v35Z"/>`;
  b += `<path fill="${P.ink}" d="M116.5 117.5L121 114l4.500 3.500ZM117.4 117.500h7.200l-1.200 9h-4.800Z"/><path fill="${P.amber1}" d="M118.800 119h4.400l-.8 6h-2.800Z"/>`;
  // snow on the roof and chimney
  b += `<g filter="url(#${id}s)" fill="${P.white}"><path d="${roofSnow(104, 52, 52, 97, 9, 3, 6)}"/><path d="${roofSnow(104, 52, 156, 97, 9, 4, 6)}"/><path d="M119 63q0 -8 9.500 -8t9.500 8Z"/></g>`;
  // drifts
  b += `<g filter="url(#${id}s)"><path fill="${P.near}" d="M-6 150Q50 140 104 146T206 142V210H-6Z"/></g>`;
  b += `<path fill="${P.pool2}" d="M76 150a26 4.500 0 0 0 52 0a26 4.500 0 0 0 -52 0Z"/><path fill="${P.amber2}" d="M88 146h26v4h-26Z"/>`;
  b += `<g filter="url(#${id}s)"><path fill="${front}" d="M-6 172Q60 160 110 168T206 162V210H-6Z"/></g>`;
  // falling snow
  let fl = '';
  for (const [x, y, s] of [[30, 40, 3], [64, 70, 2.4], [84, 30, 2.6], [176, 92, 2.6], [24, 92, 2.2], [116, 36, 2], [170, 122, 2.2], [52, 104, 2]]) fl += disc(x, y, s);
  b += `<path fill="${P.white}" d="${fl}"/>`;
  return b;
}
const sceneDefs = (id) => SHADOW(`${id}s`, 2, 1.2, 0.34) + SHADOW(`${id}d`, 2, 1.2, 0.55);
function markBody(id) {
  const defs = sceneDefs(id) + `<clipPath id="${id}g"><circle cx="100" cy="92" r="80"/></clipPath>`;
  let b = '';
  // the stand
  b += `<path fill="${P.house}" d="M46 158h108l10 28q1 6 -6 6H42q-7 0 -6 -6Z"/><path fill="${P.pine}" d="M43 166h114l2.400 7H40.600Z"/>`;
  // the glass
  b += `<g clip-path="url(#${id}g)"><g transform="translate(8 0) scale(0.92)">${scene(id)}</g></g>`;
  b += `<circle cx="100" cy="92" r="80" fill="none" stroke="${P.house}" stroke-width="5"/>`;
  b += `<path d="M44 62A64 64 0 0 1 82 31" fill="none" stroke="${P.white}" stroke-width="4.500" stroke-linecap="round" opacity="0.85"/>`;
  return { defs, body: b };
}
function markSvg() {
  const m = markBody('m');
  return svg({ w: 512, h: 512, vb: '0 0 200 200', defs: m.defs, body: m.body });
}
function iconSvg() {
  const defs = sceneDefs('i') + GRAIN + `<clipPath id="tile"><rect width="200" height="200" rx="44"/></clipPath>`;
  const b = `<g clip-path="url(#tile)">${scene('i', P.mid)}<rect width="200" height="200" filter="url(#grain)" opacity="0.8"/></g>`;
  return svg({ w: 512, h: 512, vb: '0 0 200 200', defs, body: b });
}

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { c: P.mid, s: P.sky, m: P.moon, f: P.far, n: P.near, w: P.white, h: P.house, k: P.ink, d: P.door, A: P.amber1, a: P.amber2, r: P.ring1, p: P.pool2, t: P.pine };
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
  '..ssssssssssss..',
  '.ssssssssssmmss.',
  'ssswssswwssmmsss',
  'sssssswwwwssssws',
  'ssssswwhhwwsssss',
  'swsswwhhhhwwssss',
  'ssswwhhhhhhwwsss',
  'sswwhhhhhhhhwwss',
  'fffshhhhhhrrsfff',
  'ffffhhddhrAArfff',
  'ffffhhddhrAArfff',
  'ffffhhddhhrrhfff',
  'nnnnnnaappppnnnn',
  'cccccccccccccccc',
  '.cccccccccccccc.',
  '..cccccccccccc..',
];
const FAV32 = [
  '.....ssssssssssssssssssssss.....',
  '...ssssssssssssssssssssssssss...',
  '..ssssssssssssssssssssssmmmsss..',
  '.sssswwssssssssssssssssmmmmmmss.',
  '.sssswwssssssssswwsssssmmmmmmss.',
  'ssssssssssssssswwwwssssmmmmmmsss',
  'sssssssssssssswwwwwwssssmmmmssss',
  'ssssssssssssswwwhhwwwsssssssssss',
  'sswwssssssssswwhhhhwwwhhsssswwss',
  'sswwsssssssswwhhhhhhwwhhsssswwss',
  'sssssssssswwwhhhhhhhhwwwssssssss',
  'ssssssssswwwhhhhhhhhhhwwwsssssss',
  'sssssssswwwhhhhhhhhhhhhwwwssssss',
  'ssssssswwwhhhhhhhhhhhhhhwwwsssss',
  'sssssswwwhhhhhhhhhhhhhhhhwwwssss',
  'ffffffffshhhhhhhhhhhhhhhhsffffff',
  'fffffffffhhkkkhhhhhhrrrrhfffffff',
  'fffffffffhhkkkhkkkkrrkkrrfffffff',
  'fffffffffhhkkkhkddkrkAAkrfffffff',
  'fffffffffhhhhhhkddkrkAAkrfffffff',
  'fffffffffhhhhhhkddkrrkkrrfffffff',
  'fffffffffhhhhhhkddkhrrrrhfffffff',
  'fffffffffhhhhhhkddkhhhhhhfffffff',
  'nnnnnnnnnnnnnnaaaaaappnnnnnnnnnn',
  'nnnnnnnnnnnnpppppppppppppnnnnnnn',
  'nnnnnnnnnnnnnnnpppppppnnnnnnnnnn',
  'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
  'cccccccccccccccccccccccccccccccc',
  '.cccccccccccccccccccccccccccccc.',
  '..ccccccccccccccccccccccccccccc.',
  '...cccccccccccccccccccccccccc...',
  '.....cccccccccccccccccccccc.....',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- logo -----------------------------------------------------------------------
function logoSvg(dark) {
  const m = markBody(dark ? 'ld' : 'll');
  let b = nest({ x: 12, y: 8, w: 184, h: 184, vb: '0 0 200 200', body: `<defs>${m.defs}</defs>` + m.body });
  b += `<text x="208" y="118" font-family="Futura" font-weight="700" font-size="76" letter-spacing="-0.5" fill="${dark ? P.white : P.house}">Porchlight</text>`;
  b += `<text x="212" y="156" font-family="Futura" font-weight="500" font-size="21" letter-spacing="2.2" fill="${dark ? '#a9c6da' : P.pine}">The light stays on.</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 43 Papercut snow

A winter night cut from pale paper: five drifts of snow stepping whiter toward you, white birches in front, snow-laden pines, and snow falling. The one dark shape is the house, its roof under a thick cut of white, smoke curling from the chimney, a red door, and the porch light on, with its warm pool cut from cream paper on the snow. A line of footprints leads from where you stand to the door. The mark is the same house in a snow globe.
Palette: sky #557fa2, snow #a7c2d6 / #c1d6e4 / #d9e7ef / #ecf3f6 / #fdfdfb, pines #4a7495, house #1f3d5b, door #a9483a, amber #f9c865 / #ec9f4a, light on the snow #f1e2c2 / #f5d39a.
Type: Futura Bold for the name, cut from white paper; Futura Medium, tracked, for the line under it.
Tagline: The light stays on.
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
