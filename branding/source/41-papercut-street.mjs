// 41 Papercut street: a hillside of small paper houses in rows, every one
// dark except the one whose porch light is on.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '41-papercut-street';
const f = (n) => Math.round(n * 10) / 10;

const P = {
  sky: '#3c7892',
  halo2: '#43819b',
  halo1: '#4c8da6',
  l1: '#336982',
  l2: '#2a5a72',
  l3: '#214a60',
  l4: '#193b4f',
  l5: '#112c3e',
  l6: '#0a1e2d',
  ink: '#06131d',
  cream: '#f5e8c8',
  amber1: '#f9cb6c',
  amber2: '#ec9f4b',
  amber3: '#a8763f',
  amber4: '#575c4c',
  beam3: '#27434c',
  beam2: '#56604e',
  beam1: '#a48a50',
  path: '#2f5a6c',
};
// Unlit glass: a little lighter than the wall it is cut into.
const PANE = { l1: '#3a7189', l2: '#316379', l3: '#285368', l4: '#204457', l5: '#183648' };

// ---- cutting helpers ---------------------------------------------------------
// Catmull-Rom through points, as cubic Beziers.
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
// A hand-cut ridge through anchor points, with small knife wobble between them.
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
// Height of a ridge (through its anchors, cosine-eased like ridge()) at x.
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
// A straight-edged shape cut by hand: every corner lands a hair off.
function cut(pts, seed = 1, j = 0.7) {
  const r = rng(seed * 7 + 3);
  return 'M' + pts.map(([x, y]) => `${f(x + (r() - 0.5) * 2 * j)} ${f(y + (r() - 0.5) * 2 * j)}`).join('L') + 'Z';
}
const box = (x, y, w, h) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
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
function star(x, y, s) {
  return `M${f(x)} ${f(y - s)}L${f(x + s * 0.28)} ${f(y - s * 0.28)}L${f(x + s)} ${f(y)}L${f(x + s * 0.28)} ${f(y + s * 0.28)}L${f(x)} ${f(y + s)}L${f(x - s * 0.28)} ${f(y + s * 0.28)}L${f(x - s)} ${f(y)}L${f(x - s * 0.28)} ${f(y - s * 0.28)}Z`;
}
function pine(x, base, h, w, seed) {
  const r = rng(seed);
  const tiers = 4 + Math.floor(r() * 2);
  const right = [];
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers;
    const y = base - h + h * 0.86 * t;
    const tip = (w / 2) * (0.3 + 0.7 * t) * (0.92 + 0.16 * r());
    right.push([x + tip, y]);
    if (i < tiers) right.push([x + tip * 0.42, y - h * 0.035]);
  }
  const tw = Math.max(1.5, w * 0.06);
  right.push([x + tw, base - h * 0.1], [x + tw, base]);
  const left = right.map(([px, py], i) => [x - (px - x) * (0.94 + 0.12 * rng(seed + i)()), py + (i % 2 ? 1 : -1) * h * 0.01]).reverse();
  const pts = [[x + (r() - 0.5) * 1.5, base - h], ...right, ...left];
  return 'M' + pts.map(([a, b]) => `${f(a)} ${f(b)}`).join('L') + 'Z';
}
// A round garden tree on a short trunk.
function tree(x, base, rx, ry, seed) {
  const cy = base - ry * 1.55;
  return blob(x, cy, rx, ry, seed, 11, 0.05) + cut([[x - rx * 0.1, cy + ry * 0.6], [x + rx * 0.1, cy + ry * 0.6], [x + rx * 0.13, base + 6], [x - rx * 0.13, base + 6]], seed, 0.4);
}
function grassEdge(x0, x1, y, bottom, seed, blade = 14) {
  const r = rng(seed);
  const pts = [[x0, y]];
  let x = x0;
  const by = (x) => y + Math.sin(x / 130 + seed) * blade * 0.35;
  while (x < x1) {
    if (r() < 0.3) {
      const lean = (r() - 0.5) * 6;
      const w = blade * 0.9;
      for (const [dx, k] of [[0.2, 0.7], [0.5, 1.1], [0.8, 0.8]]) {
        pts.push([x + w * dx + lean, by(x) - blade * k * (0.8 + r() * 0.4)]);
        pts.push([x + w * dx + w * 0.16, by(x) + 1]);
      }
      x += w;
    } else {
      x += blade * (1.2 + r() * 1.6);
      pts.push([x, by(x) + (r() - 0.5) * 2]);
    }
  }
  return 'M' + pts.map(([a, b]) => `${f(a)} ${f(b)}`).join('L') + `L${x1} ${bottom}L${x0} ${bottom}Z`;
}
// A crescent: a disc with a bite taken out by a second, offset disc.
function crescent(cx, cy, r, bite = 0.62, tilt = -0.5) {
  const a0 = tilt - 1.25;
  const a1 = tilt + 1.25;
  const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
  const p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
  const r2 = r * (1 / bite) * 0.72;
  return `M${f(p0[0])} ${f(p0[1])}A${f(r)} ${f(r)} 0 1 0 ${f(p1[0])} ${f(p1[1])}A${f(r2)} ${f(r2)} 0 0 1 ${f(p0[0])} ${f(p0[1])}Z`;
}

const SHADOW = (id, dy, sd, op) =>
  `<filter id="${id}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#020a13" flood-opacity="${op}"/></filter>`;
const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.085 0"/></filter>`;

// ---- the dark houses ---------------------------------------------------------
// Each returns { body, panes, door }: the body joins the hill it stands on (it
// runs on below the base), panes and door are cut into it.
function win(x, y, w, h, g) {
  const pw = (w - g) / 2;
  const ph = (h - g) / 2;
  return box(x, y, pw, ph) + box(x + pw + g, y, pw, ph) + box(x, y + ph + g, pw, ph) + box(x + pw + g, y + ph + g, pw, ph);
}
function chimney(x, yTop, w, yFoot, s, seed) {
  return cut([[x, yFoot], [x, yTop], [x + w, yTop], [x + w, yFoot]], seed, 0.4 * s) + box(x - 1.6 * s, yTop - 3 * s, w + 3.2 * s, 3.4 * s);
}
function dwelling(type, cx, base, s, seed) {
  const down = base + 30 * s;
  const g = Math.max(1, 1.9 * s);
  let body = '';
  let panes = '';
  let door = '';
  if (type === 'front') {
    const x0 = cx - 50 * s, x1 = cx + 50 * s, top = base - 70 * s, apex = top - 46 * s, e = 8 * s;
    body = cut([[x0, down], [x0, top], [x0 - e, top + 1.5 * s], [cx, apex], [x1 + e, top + 1.5 * s], [x1, top], [x1, down]], seed, 0.7 * s);
    body += chimney(cx + 20 * s, apex + 2 * s, 13 * s, apex + 34 * s, s, seed);
    panes = win(x0 + 13 * s, top + 16 * s, 21 * s, 25 * s, g) + win(x1 - 34 * s, top + 16 * s, 21 * s, 25 * s, g) + box(cx - 6 * s, apex + 27 * s, 12 * s, 12 * s);
    door = box(cx - 9 * s, base - 33 * s, 18 * s, 33 * s);
  } else if (type === 'side') {
    const x0 = cx - 68 * s, x1 = cx + 68 * s, top = base - 56 * s, rt = top - 38 * s, e = 7 * s, inset = 20 * s;
    body = cut([[x0, down], [x0, top], [x0 - e, top + 1.5 * s], [x0 + inset, rt], [x1 - inset, rt], [x1 + e, top + 1.5 * s], [x1, top], [x1, down]], seed, 0.7 * s);
    body += chimney(x1 - inset - 26 * s, rt - 13 * s, 13 * s, rt + 4 * s, s, seed);
    const dx = cx - 22 * s;
    body += cut([[dx - 13 * s, top - 3 * s], [dx - 13 * s, top - 21 * s], [dx - 16 * s, top - 21 * s], [dx, top - 35 * s], [dx + 16 * s, top - 21 * s], [dx + 13 * s, top - 21 * s], [dx + 13 * s, top - 3 * s]], seed + 1, 0.5 * s);
    panes = win(x0 + 14 * s, top + 14 * s, 20 * s, 24 * s, g) + win(x0 + 46 * s, top + 14 * s, 20 * s, 24 * s, g) + win(x1 - 34 * s, top + 14 * s, 20 * s, 24 * s, g) + box(dx - 6 * s, top - 19 * s, 12 * s, 11 * s);
    door = box(cx + 20 * s, base - 33 * s, 18 * s, 33 * s);
  } else if (type === 'tall') {
    const x0 = cx - 37 * s, x1 = cx + 37 * s, top = base - 106 * s, apex = top - 42 * s, e = 7 * s;
    body = cut([[x0, down], [x0, top], [x0 - e, top + 1.5 * s], [cx, apex], [x1 + e, top + 1.5 * s], [x1, top], [x1, down]], seed, 0.7 * s);
    body += chimney(cx - 28 * s, apex + 12 * s, 12 * s, apex + 40 * s, s, seed);
    panes = win(x0 + 11 * s, top + 14 * s, 18 * s, 23 * s, g) + win(x1 - 29 * s, top + 14 * s, 18 * s, 23 * s, g) + win(x0 + 11 * s, top + 54 * s, 18 * s, 23 * s, g);
    panes += `M${f(cx - 6.5 * s)} ${f(apex + 28 * s)}a${f(6.5 * s)} ${f(6.5 * s)} 0 1 0 ${f(13 * s)} 0a${f(6.5 * s)} ${f(6.5 * s)} 0 1 0 ${f(-13 * s)} 0Z`;
    door = box(x1 - 29 * s, base - 34 * s, 18 * s, 34 * s);
  } else if (type === 'salt') {
    const x0 = cx - 58 * s, x1 = cx + 58 * s, e = 7 * s;
    const hi = base - 80 * s, lo = base - 44 * s, ax = x0 + 40 * s, ay = base - 114 * s;
    body = cut([[x0, down], [x0, hi], [x0 - e, hi + 2 * s], [ax, ay], [x1 + e, lo + 1.5 * s], [x1, lo], [x1, down]], seed, 0.7 * s);
    body += chimney(ax + 8 * s, ay - 6 * s, 13 * s, ay + 22 * s, s, seed);
    panes = win(x0 + 12 * s, hi + 12 * s, 20 * s, 24 * s, g) + win(x0 + 46 * s, hi + 34 * s, 20 * s, 24 * s, g) + win(x1 - 32 * s, lo + 10 * s, 18 * s, 20 * s, g);
    door = box(x0 + 14 * s, base - 33 * s, 18 * s, 33 * s);
  } else {
    // cottage: low walls under a big roof
    const x0 = cx - 48 * s, x1 = cx + 48 * s, top = base - 44 * s, apex = top - 62 * s, e = 9 * s;
    body = cut([[x0, down], [x0, top], [x0 - e, top + 2 * s], [cx, apex], [x1 + e, top + 2 * s], [x1, top], [x1, down]], seed, 0.7 * s);
    body += chimney(cx + 24 * s, apex + 14 * s, 13 * s, apex + 48 * s, s, seed);
    panes = win(x0 + 12 * s, top + 10 * s, 20 * s, 20 * s, g) + win(x1 - 32 * s, top + 10 * s, 20 * s, 20 * s, g);
    panes += `M${f(cx - 8 * s)} ${f(apex + 36 * s)}a${f(8 * s)} ${f(8 * s)} 0 1 0 ${f(16 * s)} 0a${f(8 * s)} ${f(8 * s)} 0 1 0 ${f(-16 * s)} 0Z`;
    door = box(cx - 8 * s, base - 30 * s, 16 * s, 30 * s);
  }
  return { body, panes, door };
}
// A row of houses and trees standing on a ridge: one sheet of paper.
function row(anchors, bottom, items, seed) {
  let body = hill(anchors, bottom, { seed, jit: 1.6 });
  let panes = '';
  let doors = '';
  for (const it of items) {
    const y = ridgeY(anchors, it.x) + (it.dy ?? 3);
    if (it.pine) body += pine(it.x, y + 4, it.pine, it.pine * 0.46, it.x + seed);
    else if (it.tree) body += tree(it.x, y + 4, it.tree, it.tree * 1.12, it.x + seed);
    else if (it.steeple) {
      const s = it.steeple;
      body += cut([[it.x - 7 * s, y + 20], [it.x - 7 * s, y - 44 * s], [it.x, y - 78 * s], [it.x + 7 * s, y - 44 * s], [it.x + 7 * s, y + 20]], seed, 0.4);
      body += cut([[it.x + 6 * s, y + 20], [it.x + 6 * s, y - 20 * s], [it.x + 22 * s, y - 32 * s], [it.x + 40 * s, y - 20 * s], [it.x + 40 * s, y + 20]], seed + 2, 0.4);
    } else {
      const d = dwelling(it.type, it.x, y, it.s, it.x + seed);
      body += d.body;
      panes += d.panes;
      doors += d.door;
    }
  }
  return { body, panes, doors };
}

// ---- the lit house -------------------------------------------------------------
function litHouse(cx, base, s = 1) {
  const W = 204 * s;
  const x0 = cx - W / 2;
  const x1 = cx + W / 2;
  const top = base - 150 * s;
  const apex = top - 84 * s;
  const e = 13 * s;
  const foot = base + 5 * s;
  const wall = cut([[x0, foot], [x0, top], [x0 - e, top + 2 * s], [cx, apex], [x1 + e, top + 2 * s], [x1, top], [x1, foot]], 41, 0.8 * s);
  const body = wall + chimney(cx - 64 * s, apex + 24 * s, 20 * s, apex + 72 * s, s * 1.4, 5);
  const g = 2.6 * s;
  const panes =
    win(x0 + 22 * s, top + 22 * s, 36 * s, 42 * s, g) +
    win(x1 - 58 * s, top + 22 * s, 36 * s, 42 * s, g) +
    win(x0 + 16 * s, base - 80 * s, 32 * s, 44 * s, g) +
    win(x1 - 48 * s, base - 80 * s, 32 * s, 44 * s, g) +
    `M${f(cx - 12 * s)} ${f(apex + 46 * s)}a${f(12 * s)} ${f(12 * s)} 0 1 0 ${f(24 * s)} 0a${f(12 * s)} ${f(12 * s)} 0 1 0 ${f(-24 * s)} 0Z`;
  const dw = 42 * s;
  const dh = 68 * s;
  const door = box(cx - dw / 2, base - dh, dw, dh);
  const transom = box(cx - dw / 2 + 4 * s, base - dh + 4 * s, dw - 8 * s, 9 * s);
  // the lamp: a small lantern on a bracket over the door
  const lx = cx;
  const ly = base - 100 * s;
  const lampFrame =
    box(lx - 1.2 * s, ly - 21 * s, 2.4 * s, 8 * s) +
    cut([[lx - 9 * s, ly - 9 * s], [lx, ly - 15 * s], [lx + 9 * s, ly - 9 * s]], 9, 0.3 * s) +
    cut([[lx - 7 * s, ly - 9 * s], [lx + 7 * s, ly - 9 * s], [lx + 5 * s, ly + 9 * s], [lx - 5 * s, ly + 9 * s]], 10, 0.3 * s) +
    box(lx - 3.4 * s, ly + 9 * s, 6.8 * s, 2.6 * s);
  const lamp = cut([[lx - 4.8 * s, ly - 6.6 * s], [lx + 4.8 * s, ly - 6.6 * s], [lx + 3.4 * s, ly + 6.8 * s], [lx - 3.4 * s, ly + 6.8 * s]], 11, 0.2 * s);
  // the light falls from the lamp onto the doorstep: three cut beams, widest and dullest outside
  const beam = (halfTop, halfFoot, seed) =>
    cut([[lx - halfTop * s, ly - 4 * s], [lx + halfTop * s, ly - 4 * s], [lx + halfFoot * s, base + 6 * s], [lx - halfFoot * s, base + 6 * s]], seed, 0.9 * s);
  const beams = [beam(15, 74, 61), beam(10, 55, 62), beam(5, 37, 63)];
  return { wall, body, panes, door, transom, lampFrame, lamp, beams, lx, ly, x0, x1, top, apex, dw, dh };
}
// A cat sitting on the step, seen from behind, tail curled round.
function cat(x, y, s = 1) {
  const p = (px, py) => `${f(x + px * s)} ${f(y + py * s)}`;
  return (
    `M${p(-7, 0)}C${p(-10, -8)} ${p(-7, -15)} ${p(-3, -17)}C${p(-5, -19)} ${p(-5.5, -22)} ${p(-5, -24)}L${p(-5.4, -29.5)}L${p(-1.6, -26.6)}` +
    `L${p(1.6, -26.6)}L${p(5.4, -29.5)}L${p(5, -24)}C${p(5.5, -22)} ${p(5, -19)} ${p(3, -17)}C${p(8, -14)} ${p(9.5, -7)} ${p(8, 0)}Z` +
    `M${p(6, 0)}C${p(15, 1)} ${p(18, -6)} ${p(13.5, -10.5)}C${p(12, -12)} ${p(10.4, -10.4)} ${p(11.8, -9)}C${p(14.4, -6.4)} ${p(12.4, -2.6)} ${p(6, -2.8)}Z`
  );
}

// ---- hero ----------------------------------------------------------------------
function hero() {
  const W = 1280;
  const H = 640;
  const defs = SHADOW('s', 4, 2.4, 0.55) + SHADOW('t', 3, 1.5, 0.5) + GRAIN;
  let b = `<rect width="${W}" height="${H}" fill="${P.sky}"/>`;

  // crescent moon with cut halo rings, and stars
  const MX = 1128;
  const MY = 112;
  b += `<g filter="url(#s)"><path fill="${P.halo2}" d="${blob(MX, MY, 108, 108, 3, 22, 0.008)}"/></g>`;
  b += `<g filter="url(#s)"><path fill="${P.halo1}" d="${blob(MX, MY, 72, 72, 4, 18, 0.01)}"/></g>`;
  b += `<g filter="url(#s)"><path fill="${P.cream}" d="${crescent(MX, MY, 38)}"/></g>`;
  const stars = [
    [96, 84, 6], [176, 196, 4.5], [248, 58, 5], [300, 232, 4], [64, 250, 4], [986, 228, 4.5], [1010, 52, 5.5], [1236, 246, 5],
    [1254, 40, 4], [914, 268, 3.5], [352, 150, 3.5], [1182, 262, 3.5],
  ];
  b += `<g filter="url(#t)" fill="${P.cream}">${stars.map(([x, y, s]) => `<path d="${star(x, y, s)}"/>`).join('')}</g>`;

  // the rows, far to near
  const layer = (fill, pane, doorFill, r) =>
    `<g filter="url(#s)" fill="${fill}"><path d="${r.body}"/></g><path fill="${pane}" d="${r.panes}"/><path fill="${doorFill}" d="${r.doors}"/>`;

  const A1 = [[-20, 318], [200, 300], [430, 322], [660, 304], [900, 318], [1100, 294], [1300, 308]];
  const r1 = row(A1, H, [
    { type: 'front', x: 62, s: 0.38 }, { type: 'side', x: 128, s: 0.36 }, { pine: 30, x: 180 }, { type: 'tall', x: 222, s: 0.38 },
    { type: 'cottage', x: 318, s: 0.38 }, { pine: 26, x: 366 }, { type: 'front', x: 424, s: 0.36 },
    { pine: 30, x: 838 }, { type: 'front', x: 886, s: 0.38 }, { steeple: 0.95, x: 990 },
    { type: 'side', x: 1092, s: 0.38 }, { pine: 30, x: 1150 }, { type: 'cottage', x: 1196, s: 0.4 }, { type: 'tall', x: 1256, s: 0.36 },
  ], 3);
  b += layer(P.l1, PANE.l1, P.l2, r1);

  const A2 = [[-20, 370], [180, 354], [400, 372], [640, 350], [880, 368], [1100, 348], [1300, 362]];
  const r2 = row(A2, H, [
    { type: 'side', x: 46, s: 0.62 }, { tree: 17, x: 124 }, { type: 'tall', x: 176, s: 0.64 }, { pine: 52, x: 238 },
    { type: 'cottage', x: 300, s: 0.66 }, { type: 'salt', x: 404, s: 0.62 }, { tree: 18, x: 842 },
    { type: 'front', x: 900, s: 0.64 }, { pine: 56, x: 968 }, { type: 'side', x: 1044, s: 0.62 }, { type: 'tall', x: 1148, s: 0.66 },
    { tree: 18, x: 1206 }, { type: 'front', x: 1262, s: 0.64 },
  ], 5);
  b += layer(P.l2, PANE.l2, P.l3, r2);

  const A3 = [[-20, 440], [200, 422], [420, 438], [640, 418], [860, 434], [1080, 416], [1300, 430]];
  const r3 = row(A3, H, [
    { type: 'front', x: 70, s: 0.98 }, { pine: 84, x: 158 }, { type: 'tall', x: 238, s: 1 }, { tree: 26, x: 316 },
    { type: 'side', x: 412, s: 0.96 }, { pine: 74, x: 776 }, { type: 'salt', x: 866, s: 1 }, { tree: 28, x: 958 },
    { type: 'cottage', x: 1048, s: 1.04 }, { pine: 90, x: 1136 }, { type: 'front', x: 1224, s: 1 },
  ], 7);
  b += layer(P.l3, PANE.l3, P.l4, r3);

  // the lit row
  const A4 = [[-20, 516], [200, 502], [420, 510], [600, 498], [800, 508], [1040, 496], [1300, 510]];
  const CX = 600;
  const BASE = 498;
  const r4 = row(A4, H, [
    { type: 'side', x: 138, s: 1.32 }, { tree: 34, x: 280 }, { type: 'tall', x: 380, s: 1.34 },
    { pine: 104, x: 782 }, { type: 'cottage', x: 896, s: 1.5 }, { tree: 36, x: 1010 }, { type: 'front', x: 1128, s: 1.38 },
    { pine: 84, x: 1244 },
  ], 9);
  b += layer(P.l4, PANE.l4, P.l5, r4);

  // light on the ground in front of the lit house, and the path down the hill
  b += `<g filter="url(#t)"><path fill="${P.amber4}" d="${blob(CX + 4, BASE + 21, 150, 21, 31, 22, 0.012)}"/></g>`;
  const pathD =
    smooth([[CX - 34, BASE + 26], [CX - 22, BASE + 54], [CX + 10, BASE + 88], [CX + 50, BASE + 132]]) +
    'L' + smooth([[CX + 184, BASE + 132], [CX + 108, BASE + 88], [CX + 68, BASE + 54], [CX + 50, BASE + 26]]).slice(1) + 'Z';
  b += `<g filter="url(#t)"><path fill="${P.amber4}" d="${pathD}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber3}" d="${blob(CX + 2, BASE + 19, 96, 13, 32, 18, 0.012)}"/></g>`;

  // the lit house: its own darker sheet
  const hs = litHouse(CX, BASE);
  b += `<g filter="url(#s)" fill="${P.l5}"><path d="${hs.body}"/></g>`;
  b += `<path fill="${PANE.l5}" d="${hs.panes}"/>`;
  b += `<clipPath id="wall"><path d="${hs.wall}"/></clipPath><g clip-path="url(#wall)">`;
  b += `<g filter="url(#t)"><path fill="${P.beam3}" d="${hs.beams[0]}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.beam2}" d="${hs.beams[1]}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.beam1}" d="${hs.beams[2]}"/></g>`;
  b += `</g>`;
  b += `<g filter="url(#t)" fill="${P.ink}"><path d="${hs.door}"/></g><path fill="${P.amber1}" d="${hs.transom}"/>`;
  // the stoop and its steps
  b += `<g filter="url(#t)"><path fill="${P.amber2}" d="${cut([[CX - 54, BASE - 5], [CX + 54, BASE - 5], [CX + 54, BASE + 3], [CX - 54, BASE + 3]], 51, 0.5)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber1}" d="${cut([[CX - 42, BASE + 3], [CX + 42, BASE + 3], [CX + 42, BASE + 10], [CX - 42, BASE + 10]], 52, 0.5)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber2}" d="${cut([[CX - 48, BASE + 10], [CX + 48, BASE + 10], [CX + 48, BASE + 17], [CX - 48, BASE + 17]], 53, 0.5)}"/></g>`;
  b += `<g filter="url(#t)"><circle fill="${P.beam1}" cx="${hs.lx}" cy="${hs.ly}" r="19"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.ink}" d="${hs.lampFrame}"/></g><path fill="${P.amber1}" d="${hs.lamp}"/>`;
  b += `<g filter="url(#t)"><path fill="${P.ink}" d="${cat(CX + 39, BASE - 5, 0.92)}"/></g>`;

  // the front row: rooftops close to us
  const A5 = [[-20, 604], [200, 610], [420, 624], [660, 634], [900, 624], [1100, 608], [1300, 602]];
  const r5 = row(A5, H + 40, [
    { type: 'front', x: 124, s: 2.1, dy: 150 }, { type: 'cottage', x: 372, s: 1.7, dy: 96 }, { type: 'cottage', x: 962, s: 2, dy: 124 },
    { type: 'front', x: 1190, s: 2, dy: 150 },
  ], 13);
  b += layer(P.l5, PANE.l5, P.l6, r5);
  b += `<g filter="url(#s)" fill="${P.l6}"><path d="${grassEdge(-10, 1290, 630, H, 31, 15)}"/></g>`;

  // type, cut from cream paper
  b += `<g filter="url(#t)" fill="${P.cream}" text-anchor="middle">`;
  b += `<text x="640" y="150" font-family="Rockwell" font-weight="700" font-size="112" letter-spacing="1">Porchlight</text>`;
  b += `<text x="640" y="204" font-family="Avenir Next" font-weight="500" font-size="28" letter-spacing="1.8" fill="#d5e3e6">Know what’s on your doorstep.</text>`;
  b += `</g>`;

  b += `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.9"/>`;
  return svg({ w: W, h: H, defs, body: b });
}

// ---- mark: three paper houses in a round of night sky, the middle one lit -------
function roundScene(id, { clip = true } = {}) {
  // 200 x 200 space; disc r 94 at 100,100
  const defs =
    SHADOW(`${id}s`, 2.4, 1.3, 0.55) +
    (clip ? `<clipPath id="${id}c"><circle cx="100" cy="100" r="94"/></clipPath>` : '') +
    `<clipPath id="${id}w"><path d="M60 170V96L100 60L140 96V170Z"/></clipPath>`;
  let b = clip ? `<g clip-path="url(#${id}c)">` : '<g>';
  b += `<rect x="0" y="0" width="200" height="200" fill="${P.sky}"/>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.halo1}" cx="148" cy="48" r="27"/></g>`;
  b += `<g filter="url(#${id}s)"><path fill="${P.cream}" d="${crescent(148, 48, 14)}"/></g>`;
  b += `<g filter="url(#${id}s)" fill="${P.cream}"><path d="${star(50, 46, 5)}"/><path d="${star(84, 26, 3.4)}"/></g>`;
  // back houses, one each side
  b += `<g filter="url(#${id}s)" fill="${P.l2}"><path d="M-6 200V118L6 106L32 82L58 106V200Z"/><path d="M42 98V84h9v22Z"/></g>`;
  b += `<path fill="${PANE.l2}" d="${win(16, 116, 15, 17, 1.6)}"/>`;
  b += `<g filter="url(#${id}s)" fill="${P.l3}"><path d="M138 200V114L152 100L172 80L192 100L206 114V200Z"/><path d="M154 94V78h9v10Z"/></g>`;
  b += `<path fill="${PANE.l3}" d="${win(166, 112, 15, 17, 1.6)}"/>`;
  // ground
  b += `<g filter="url(#${id}s)" fill="${P.l4}"><path d="M-6 166Q50 158 100 160T206 164V206H-6Z"/></g>`;
  b += `<path fill="${P.amber4}" d="M34 172a66 9 0 0 1 132 0a66 9 0 0 1 -132 0Z"/>`;
  // the lit house in front
  b += `<g filter="url(#${id}s)" fill="${P.l5}"><path d="M60 170V96H53L100 56L147 96H140V170Z"/><path d="M119 80V60h12v30Z"/></g>`;
  b += `<g clip-path="url(#${id}w)"><path fill="${P.beam3}" d="M88 106h24l32 66h-88Z"/><path fill="${P.beam2}" d="M92 106h16l22 66h-60Z"/><path fill="${P.beam1}" d="M96 106h8l12 66h-32Z"/></g>`;
  b += `<path fill="${P.ink}" d="M89 170V128h22v42Z"/><path fill="${P.amber1}" d="M92 131h16v5h-16Z"/>`;
  b += `<circle fill="${P.beam1}" cx="100" cy="107" r="13"/>`;
  b += `<path fill="${P.ink}" d="M93.5 102l6.5 -4.6l6.5 4.6ZM94.6 102h10.8l-1.6 11.6h-7.6Z"/><path fill="${P.amber1}" d="M96.6 103.6h6.8l-1.1 8.4h-4.6Z"/>`;
  // lit steps
  b += `<path fill="${P.amber2}" d="M80 167h40v5h-40Z"/><path fill="${P.amber1}" d="M85 172h30v5h-30Z"/><path fill="${P.amber2}" d="M82 177h36v5h-36Z"/>`;
  b += `</g>`;
  return { defs, body: b };
}
function markSvg() {
  const a = roundScene('m');
  return svg({ w: 512, h: 512, vb: '0 0 200 200', defs: a.defs, body: a.body });
}
function iconSvg() {
  const a = roundScene('i', { clip: false });
  const defs = a.defs + GRAIN + `<clipPath id="tile"><rect width="200" height="200" rx="44"/></clipPath>`;
  const b = `<g clip-path="url(#tile)">${a.body}<rect width="200" height="200" filter="url(#grain)" opacity="0.8"/></g>`;
  return svg({ w: 512, h: 512, vb: '0 0 200 200', defs, body: b });
}

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { s: P.sky, m: P.cream, b: P.l2, c: P.l3, h: P.l5, g: P.l4, A: P.amber1, a: P.amber2, r: P.beam1, q: P.beam2, k: P.ink };
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
  '.ssssssssssssss.',
  'ssssssssssssmmss',
  'ssssssshhsssmmss',
  'sssssshhhhssssss',
  'sbbssshhhhhscccs',
  'bbbbshhhhhhhcccc',
  'bbbbhhhhAAhhhccc',
  'bbbbshhhAAhhsccc',
  'bbbbshhqrrqhsccc',
  'bbbbshhqkkqhsccc',
  'bbbbshqrkkrqsccc',
  'bbbbshqrkkrqsccc',
  'gggggaaAAAAaaggg',
  '.ggggggaaaagggg.',
  '..gggggggggggg..',
];
const FAV32 = [
  '.....ssssssssssssssssssssss.....',
  '...ssssssssssssssssssssssssss...',
  '..ssssssssssssssssssssssmmssss..',
  '.ssssssssssssssssssssssssmmmsss.',
  '.sssssssssssssssssssssssssmmmss.',
  'ssssssssssssssssssssssssssmmmsss',
  'sssssssssssssssshhssssssssmmmsss',
  'ssssssssssssssshhhhsshhssmmmssss',
  'sssssssssssssshhhhhhshhsmmssssss',
  'sssssbbssssshhhhhhhhhhhssssccsss',
  'ssssbbbbssshhhhhhhhhhhhhssccccss',
  'sssbbbbbbshhhhhhhhhhhhhhhccccccs',
  'ssbbbbbbbhhhhhhhhhhhhhhhhhcccccc',
  'sbbbbbbbbsshhhhhrrrrhhhhhscccccc',
  'bbbbbbbbbsshhhhrrkkrrhhhhscccccc',
  'bbbbbbbbbsshhhhrkAAkrhhhhscccccc',
  'bbbbbbbbbsshhhhrkAAkrhhhhscccccc',
  'bbbbbbbbbsshhhhqrrrrqhhhhscccccc',
  'bbbbbbbbbsshhhqqrrrrqqhhhscccccc',
  'bbbbbbbbbsshhhqkkkkkkqhhhscccccc',
  'bbbbbbbbbsshhhqkAAAAkqhhhscccccc',
  'bbbbbbbbbsshhqqkkkkkkqqhhscccccc',
  'bbbbbbbbbsshhqrkkkkkkrqhhscccccc',
  'bbbbbbbbbsshhqrkkkkkkrqhhscccccc',
  'bbbbbbbbbsshqqrkkkkkkrqqhscccccc',
  'bbbbbbbbbsshqrrkkkkkkrrqhscccccc',
  'gggggggggggaaaaaaaaaaaaagggggggg',
  'ggggggggggggaAAAAAAAAAAagggggggg',
  '.gggggggggggaaaaaaaaaaaaggggggg.',
  '..ggggggggggggggggggggggggggggg.',
  '...gggggggggggggggggggggggggg...',
  '.....gggggggggggggggggggggg.....',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- logo -----------------------------------------------------------------------
function logoSvg(dark) {
  const a = roundScene(dark ? 'ld' : 'll');
  let b = nest({ x: 14, y: 12, w: 176, h: 176, vb: '0 0 200 200', body: `<defs>${a.defs}</defs>` + a.body });
  b += `<text x="208" y="118" font-family="Rockwell" font-weight="700" font-size="78" letter-spacing="0.5" fill="${dark ? P.cream : P.l5}">Porchlight</text>`;
  b += `<text x="211" y="156" font-family="Avenir Next" font-weight="500" font-size="20.5" letter-spacing="1.3" fill="${dark ? '#9fc0cc' : P.l1}">Know what’s on your doorstep.</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 41 Papercut street

A hillside town cut from paper: five rows of small houses, each row one sheet, stepping from pale blue-teal at the back to navy in front, every window dark. One house has its porch light on. The lantern over its door throws three cut beams of warmer paper down the wall onto the doorstep, the steps are cut from amber, and a cat sits beside the door. A crescent moon with two cut halo rings sits over the roofs.
Palette: sky #3c7892, rows #336982 / #2a5a72 / #214a60 / #193b4f / #112c3e / #0a1e2d, amber #f9cb6c / #ec9f4b / #a8763f, the beam on the wall #a48a50 / #56604e / #27434c, cream #f5e8c8.
Type: Rockwell Bold for the name, cut from cream paper; Avenir Next Medium, tracked, for the line under it.
Tagline: Know what's on your doorstep.
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
