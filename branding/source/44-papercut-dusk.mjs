// 44 Papercut dusk: the sun going down behind a town cut from coral, plum and
// indigo paper, birds on a wire, and the first porch light of the evening.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '44-papercut-dusk';
const f = (n) => Math.round(n * 10) / 10;

const P = {
  sky: '#e8866b',
  band3: '#ed9872',
  band2: '#f2aa7b',
  band1: '#f7bd87',
  sun: '#fde2aa',
  cloud: '#db7062',
  cloud2: '#f4ae82',
  far: '#c05c72',
  mid: '#963f6b',
  near: '#672f60',
  front: '#3e2252',
  fore: '#281846',
  ink: '#190f30',
  ring3: '#61335e',
  ring2: '#a2565c',
  ring1: '#ec9d58',
  amber1: '#ffd97c',
  amber2: '#f6ab52',
  amber3: '#c9773f',
  hot: '#fff4cc',
  type: '#2c1b4c',
};
// Unlit glass, a little lighter than the wall it is cut into.
const PANE = { mid: '#a64a72', near: '#793a6c', front: '#51305f' };

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
// A long evening cloud: one slow knife stroke out and one back.
function cloud(x, y, w, h, seed) {
  const r = rng(seed);
  const k = 0.3 + r() * 0.4;
  return `M${f(x - w)} ${f(y)}Q${f(x - w * k)} ${f(y - h * 1.5)} ${f(x + w * 0.2)} ${f(y - h * 0.9)}T${f(x + w)} ${f(y)}Q${f(x + w * 0.3)} ${f(y + h * 1.1)} ${f(x - w * 0.2)} ${f(y + h * 0.7)}T${f(x - w)} ${f(y)}Z`;
}

const SHADOW = (id, dy, sd, op) =>
  `<filter id="${id}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#3d1232" flood-opacity="${op}"/></filter>`;
const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0.085 0"/></filter>`;

// ---- buildings -----------------------------------------------------------------
function win(x, y, w, h, g) {
  const pw = (w - g) / 2;
  const ph = (h - g) / 2;
  return box(x, y, pw, ph) + box(x + pw + g, y, pw, ph) + box(x, y + ph + g, pw, ph) + box(x + pw + g, y + ph + g, pw, ph);
}
// A television aerial on a mast.
function aerial(x, y, h) {
  return box(x - 1, y - h, 2, h) + box(x - 9, y - h + 3, 18, 1.8) + box(x - 7, y - h + 9, 14, 1.8) + box(x - 5, y - h + 15, 10, 1.8);
}
// Each building returns { body, panes }. o: { chim, aerial, dormer, panes }
function building(it, seed) {
  const { type, x: cx, base, w } = it;
  const down = base + 140;
  let body = '';
  let panes = '';
  const g = Math.max(1.4, w * 0.018);
  if (type === 'gable') {
    const wallH = it.wall ?? w * 0.42;
    const roofH = it.roof ?? w * 0.42;
    const x0 = cx - w / 2, x1 = cx + w / 2, top = base - wallH, apex = top - roofH, e = w * 0.07;
    body = cut([[x0, down], [x0, top], [x0 - e, top + 2], [cx, apex], [x1 + e, top + 2], [x1, top], [x1, down]], seed, 0.8);
    if (it.chim) {
      const c = cx + it.chim * w * 0.24;
      const cw = w * 0.11;
      const cy = apex + roofH * 0.14;
      body += cut([[c - cw / 2, apex + roofH * 0.7], [c - cw / 2, cy], [c + cw / 2, cy], [c + cw / 2, apex + roofH * 0.7]], seed + 1, 0.5) + box(c - cw / 2 - 2, cy - 4, cw + 4, 4.4);
      if (it.pots) body += box(c - cw * 0.3, cy - 12, cw * 0.22, 9) + box(c + cw * 0.08, cy - 10, cw * 0.22, 7);
      if (it.aerial) body += aerial(c, cy - 4, it.aerial);
    }
    if (it.panes !== false) {
      const pw = w * 0.17, ph = wallH * 0.42;
      panes = win(x0 + w * 0.14, top + wallH * 0.2, pw, ph, g) + win(x1 - w * 0.14 - pw, top + wallH * 0.2, pw, ph, g);
      panes += it.round ? disc(cx, apex + roofH * 0.58, w * 0.06) : box(cx - w * 0.055, apex + roofH * 0.5, w * 0.11, w * 0.11);
    }
  } else if (type === 'side') {
    const wallH = it.wall ?? w * 0.3;
    const roofH = it.roof ?? w * 0.26;
    const x0 = cx - w / 2, x1 = cx + w / 2, top = base - wallH, rt = top - roofH, e = w * 0.045, inset = w * 0.16;
    body = cut([[x0, down], [x0, top], [x0 - e, top + 2], [x0 + inset, rt], [x1 - inset, rt], [x1 + e, top + 2], [x1, top], [x1, down]], seed, 0.8);
    if (it.chim) {
      const c = cx + it.chim * w * 0.22;
      const cw = w * 0.08;
      body += cut([[c - cw / 2, rt + 4], [c - cw / 2, rt - roofH * 0.5], [c + cw / 2, rt - roofH * 0.5], [c + cw / 2, rt + 4]], seed + 1, 0.5) + box(c - cw / 2 - 2, rt - roofH * 0.5 - 4, cw + 4, 4.4);
      if (it.aerial) body += aerial(c, rt - roofH * 0.5 - 4, it.aerial);
    }
    if (it.dormer) {
      const dx = cx + it.dormer * w * 0.14;
      const dw = w * 0.1;
      body += cut([[dx - dw, top - 2], [dx - dw, top - roofH * 0.56], [dx - dw * 1.3, top - roofH * 0.56], [dx, top - roofH * 1.02], [dx + dw * 1.3, top - roofH * 0.56], [dx + dw, top - roofH * 0.56], [dx + dw, top - 2]], seed + 2, 0.5);
      panes += box(dx - dw * 0.5, top - roofH * 0.5, dw, roofH * 0.34);
    }
    if (it.panes !== false) {
      const pw = w * 0.11, ph = wallH * 0.5;
      for (const k of [0.1, 0.32, 0.56, 0.79]) panes += win(x0 + w * k, top + wallH * 0.2, pw, ph, g);
    }
  } else if (type === 'flat') {
    const h = it.h;
    const x0 = cx - w / 2;
    body = cut([[x0, down], [x0, base - h], [x0 + w, base - h], [x0 + w, down]], seed, 0.8) + box(x0 - 3, base - h - 5, w + 6, 6);
    if (it.tank) body += box(cx + w * 0.1, base - h - 22, w * 0.22, 18) + box(cx + w * 0.07, base - h - 26, w * 0.28, 5);
    if (it.aerial) body += aerial(cx - w * 0.25, base - h - 4, it.aerial);
    if (it.panes !== false) {
      const pw = w * 0.14, ph = Math.min(h * 0.24, 26);
      for (const k of [0.14, 0.43, 0.72]) for (const j of [0.14, 0.52]) if (base - h + h * j + ph < base + 20) panes += win(x0 + w * k, base - h + h * j, pw, ph, g);
    }
  } else if (type === 'spire') {
    const x0 = cx - w / 2;
    const h = it.h;
    body = cut([[x0, down], [x0, base - h], [x0 - 3, base - h], [cx, base - h - it.spire], [x0 + w + 3, base - h], [x0 + w, base - h], [x0 + w, down]], seed, 0.6);
    body += box(cx - 1, base - h - it.spire - 12, 2, 13) + box(cx - 5, base - h - it.spire - 8, 10, 2);
    // the nave beside it
    body += cut([[x0 + w, down], [x0 + w, base - h * 0.42], [x0 + w + w * 1.1, base - h * 0.68], [x0 + w + w * 2.2, base - h * 0.42], [x0 + w + w * 2.2, down]], seed + 3, 0.6);
  } else if (type === 'tower') {
    // a water tower on legs
    const h = it.h;
    body = box(cx - w / 2, base - h, w, h * 0.34) + `M${f(cx - w / 2 - 3)} ${f(base - h)}L${f(cx)} ${f(base - h - w * 0.36)}L${f(cx + w / 2 + 3)} ${f(base - h)}Z`;
    body += `M${f(cx - w * 0.42)} ${f(base - h * 0.66)}l${f(-w * 0.1)} ${f(h * 0.8)}h3l${f(w * 0.1)} ${f(-h * 0.8)}ZM${f(cx + w * 0.42)} ${f(base - h * 0.66)}l${f(w * 0.1)} ${f(h * 0.8)}h-3l${f(-w * 0.1)} ${f(-h * 0.8)}Z` + box(cx - 1.5, base - h * 0.66, 3, h * 0.8);
  }
  return { body, panes };
}
function layer(items, base, seed) {
  let body = box(-40, base, 1360, 400);
  let panes = '';
  items.forEach((it, i) => {
    const bd = building({ base, ...it }, seed * 31 + i);
    body += bd.body;
    panes += bd.panes;
  });
  return { body, panes };
}
// A far skyline: a run of small roofs, generated, with gaps left for landmarks.
function farTown(base, seed, skip) {
  const r = rng(seed);
  let d = box(-40, base, 1360, 400);
  let x = -10;
  while (x < 1290) {
    const w = 26 + r() * 46;
    const h = 12 + r() * 34;
    const kind = r();
    const cx = x + w / 2;
    if (!skip.some(([a, b]) => cx > a && cx < b)) {
      if (kind < 0.55) d += `M${f(x)} ${f(base + 4)}V${f(base - h)}L${f(cx)} ${f(base - h - w * 0.36)}L${f(x + w)} ${f(base - h)}V${f(base + 4)}Z`;
      else if (kind < 0.8) d += box(x, base - h, w, h + 4);
      else d += `M${f(x)} ${f(base + 4)}V${f(base - h)}L${f(x + w * 0.3)} ${f(base - h - w * 0.3)}H${f(x + w * 0.7)}L${f(x + w)} ${f(base - h)}V${f(base + 4)}Z`;
      if (r() < 0.35) d += box(cx + w * 0.12, base - h - w * 0.3 - 4, 5, w * 0.3);
    } else {
      r();
    }
    x += w + (r() < 0.25 ? 6 + r() * 14 : 0);
  }
  return d;
}

// ---- birds ---------------------------------------------------------------------
// A bird sitting on the wire, seen from the side. dir 1 faces right.
function perched(x, y, s = 1, dir = 1) {
  const p = (px, py) => `${f(x + dir * px * s)} ${f(y + py * s)}`;
  return (
    `M${p(-7.5, -1)}C${p(-8, -8)} ${p(-2, -12)} ${p(3, -11.5)}C${p(3.5, -15)} ${p(9, -15.5)} ${p(10, -12)}L${p(13.5, -11)}L${p(10.2, -9.6)}C${p(10, -5)} ${p(6, -0.5)} ${p(1, 0)}Z` +
    `M${p(-6, -3)}L${p(-15, 5)}L${p(-12.5, 6)}L${p(-3, -1)}Z`
  );
}
// A bird on the wing: two curved strokes.
function flying(x, y, s = 1) {
  const p = (px, py) => `${f(x + px * s)} ${f(y + py * s)}`;
  return `M${p(-14, -3)}Q${p(-7, -9)} ${p(0, 0)}Q${p(7, -10)} ${p(15, -5)}Q${p(7, -5.5)} ${p(0.5, 4)}Q${p(-6, -4.500)} ${p(-14, -3)}Z`;
}

// ---- the lit house ---------------------------------------------------------------
function litHouse(cx, base, s = 1) {
  const W = 206 * s;
  const x0 = cx - W / 2;
  const x1 = cx + W / 2;
  const top = base - 162 * s;
  const apex = top - 84 * s;
  const e = 14 * s;
  const wall = cut([[x0, base + 80 * s], [x0, top], [x0 - e, top + 2 * s], [cx, apex], [x1 + e, top + 2 * s], [x1, top], [x1, base + 80 * s]], 44, 0.8 * s);
  const cxm = cx + 54 * s;
  const chimney =
    cut([[cxm, apex + 76 * s], [cxm, apex + 16 * s], [cxm + 24 * s, apex + 16 * s], [cxm + 24 * s, apex + 100 * s]], 5, 0.5 * s) +
    box(cxm - 3 * s, apex + 11 * s, 30 * s, 6 * s) + box(cxm + 3 * s, apex - 1 * s, 6 * s, 12 * s) + box(cxm + 14 * s, apex + 2 * s, 6 * s, 9 * s);
  const g = 2.6 * s;
  const panes =
    win(x0 + 24 * s, top + 18 * s, 38 * s, 42 * s, g) + win(x1 - 62 * s, top + 18 * s, 38 * s, 42 * s, g) +
    win(x0 + 18 * s, base - 82 * s, 34 * s, 46 * s, g) + disc(cx, apex + 48 * s, 12.5 * s);
  const dx = cx - 8 * s;
  const dw = 44 * s;
  const dh = 72 * s;
  const doorFrame = box(dx - dw / 2 - 5 * s, base - dh - 5 * s, dw + 10 * s, dh + 5 * s);
  const door = box(dx - dw / 2, base - dh, dw, dh);
  const transom = box(dx - dw / 2 + 4 * s, base - dh + 4 * s, dw - 8 * s, 10 * s);
  const lx = cx + 50 * s;
  const ly = base - 50 * s;
  const lampFrame =
    box(lx - 1.3 * s, ly - 23 * s, 2.6 * s, 9 * s) + box(lx - 1.3 * s, ly - 24 * s, 16 * s, 2.6 * s) +
    cut([[lx - 10 * s, ly - 10 * s], [lx, ly - 17 * s], [lx + 10 * s, ly - 10 * s]], 9, 0.3 * s) +
    cut([[lx - 8 * s, ly - 10 * s], [lx + 8 * s, ly - 10 * s], [lx + 5.6 * s, ly + 10 * s], [lx - 5.6 * s, ly + 10 * s]], 10, 0.3 * s) +
    box(lx - 3.8 * s, ly + 10 * s, 7.6 * s, 3 * s);
  const lamp = cut([[lx - 5.6 * s, ly - 7.4 * s], [lx + 5.6 * s, ly - 7.4 * s], [lx + 3.9 * s, ly + 7.6 * s], [lx - 3.9 * s, ly + 7.6 * s]], 11, 0.2 * s);
  return { wall, chimney, panes, doorFrame, door, transom, lampFrame, lamp, lx, ly, dx, dw, dh, x0, x1, top, apex };
}
// A run of pointed pickets with two rails, from x0 to x1.
function fence(x0, x1, top, bottom, seed) {
  const r = rng(seed);
  let d = '';
  for (let x = x0; x < x1 - 6; x += 15) {
    const t = top + (r() - 0.5) * 3;
    d += `M${f(x)} ${bottom}V${f(t + 6)}L${f(x + 4.500)} ${f(t)}L${f(x + 9)} ${f(t + 6)}V${bottom}Z`;
  }
  return d + box(x0 - 4, top + 13, x1 - x0 + 4, 4.500) + box(x0 - 4, top + 29, x1 - x0 + 4, 4.500);
}

// ---- hero ----------------------------------------------------------------------
function hero() {
  const W = 1280;
  const H = 640;
  const defs = SHADOW('s', 4, 2.6, 0.36) + SHADOW('t', 2.6, 1.4, 0.34) + GRAIN;
  let b = `<rect width="${W}" height="${H}" fill="${P.sky}"/>`;

  // the sun going down, in rings of paler paper
  const SX = 934;
  const SY = 402;
  for (const [r, fill, seed] of [[318, P.band3, 21], [228, P.band2, 22], [150, P.band1, 23]]) b += `<g filter="url(#s)"><path fill="${fill}" d="${blob(SX, SY, r, r, seed, 24, 0.008)}"/></g>`;
  b += `<g filter="url(#s)"><circle fill="${P.sun}" cx="${SX}" cy="${SY}" r="80"/></g>`;
  // evening clouds
  const clouds = [
    [826, 104, 136, 8, P.cloud, 1], [1140, 78, 100, 7, P.cloud, 2], [1150, 262, 120, 8, P.cloud2, 3], [712, 286, 100, 7, P.cloud2, 4],
    [226, 300, 150, 8, P.cloud, 5], [470, 372, 110, 7, P.band3, 6], [86, 392, 96, 6, P.band3, 7], [1016, 172, 80, 6, P.cloud, 8],
  ];
  for (const [x, y, w, h, fill, seed] of clouds) b += `<g filter="url(#t)"><path fill="${fill}" d="${cloud(x, y, w, h, seed)}"/></g>`;

  // far town, with a church and a water tower against the sun's rings
  const far = farTown(424, 5, [[640, 720], [1096, 1190]]);
  const church = building({ type: 'spire', x: 1118, base: 424, w: 22, h: 62, spire: 54 }, 3);
  const tower = building({ type: 'tower', x: 680, base: 424, w: 34, h: 70 }, 4);
  b += `<g filter="url(#s)" fill="${P.far}"><path d="${far}"/><path d="${church.body}"/><path d="${tower.body}"/></g>`;

  // middle rows of roofs
  const L2 = layer([
    { type: 'gable', x: 64, w: 120, chim: 1 }, { type: 'side', x: 214, w: 150, chim: -1, dormer: 1 }, { type: 'gable', x: 372, w: 104, chim: 1, round: true },
    { type: 'flat', x: 500, w: 96, h: 74, tank: true }, { type: 'gable', x: 622, w: 116, chim: -1, aerial: 30 }, { type: 'side', x: 780, w: 156, chim: 1, dormer: -1 },
    { type: 'gable', x: 930, w: 106, chim: 1, round: true }, { type: 'flat', x: 1046, w: 90, h: 86, aerial: 26 }, { type: 'gable', x: 1162, w: 122, chim: -1 },
    { type: 'side', x: 1290, w: 130, chim: -1 },
  ], 478, 2);
  b += `<g filter="url(#s)" fill="${P.mid}"><path d="${L2.body}"/></g><path fill="${PANE.mid}" d="${L2.panes}"/>`;

  // the wire and its birds, strung between two poles further back
  const wire = (x0, y0, x1, y1, sag) => `M${x0} ${y0}Q${(x0 + x1) / 2} ${(y0 + y1) / 2 + sag * 2} ${x1} ${y1}`;
  const onWire = (x0, y0, x1, y1, sag, t) => {
    const u = 1 - t;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2 + sag * 2;
    return [u * u * x0 + 2 * u * t * mx + t * t * x1, u * u * y0 + 2 * u * t * my + t * t * y1];
  };
  const PL = [596, 286];
  const PR = [1236, 250];
  b += `<g filter="url(#t)" fill="${P.near}"><path d="${box(PL[0] - 4, PL[1] - 14, 8, 300)}${box(PL[0] - 26, PL[1] - 4, 52, 5)}${box(PL[0] - 24, PL[1] - 10, 4, 7)}${box(PL[0] + 20, PL[1] - 10, 4, 7)}"/><path d="${box(PR[0] - 4, PR[1] - 14, 8, 300)}${box(PR[0] - 26, PR[1] - 4, 52, 5)}${box(PR[0] - 24, PR[1] - 10, 4, 7)}${box(PR[0] + 20, PR[1] - 10, 4, 7)}"/></g>`;
  b += `<g fill="none" stroke="${P.near}" stroke-width="2.2"><path d="${wire(PL[0] - 22, PL[1] - 9, PR[0] - 22, PR[1] - 9, 26)}"/><path d="${wire(PL[0] + 22, PL[1] - 9, PR[0] + 22, PR[1] - 9, 30)}"/><path d="${wire(-30, 330, PL[0] - 22, PL[1] - 9, 16)}"/><path d="${wire(-30, 344, PL[0] + 22, PL[1] - 9, 18)}"/><path d="${wire(PR[0] - 22, PR[1] - 9, 1320, 262, 6)}"/></g>`;
  let birds = '';
  for (const [t, s, dir] of [[0.3, 1.25, 1], [0.37, 1.15, 1], [0.49, 1.3, -1], [0.56, 1.2, 1], [0.74, 1.25, -1]]) {
    const [x, y] = onWire(PL[0] - 22, PL[1] - 9, PR[0] - 22, PR[1] - 9, 26, t);
    birds += perched(x, y + 1, s, dir);
  }
  birds += flying(856, 206, 1.1) + flying(912, 178, 0.8) + flying(1184, 168, 0.9);
  b += `<g filter="url(#t)"><path fill="${P.front}" d="${birds}"/></g>`;

  // nearer rows
  const L3 = layer([
    { type: 'side', x: 86, w: 190, chim: 1, dormer: -1 }, { type: 'gable', x: 520, w: 150, chim: 1, pots: true }, { type: 'side', x: 700, w: 196, chim: -1, dormer: 1, aerial: 34 },
    { type: 'gable', x: 880, w: 140, chim: -1, round: true, pots: true }, { type: 'flat', x: 1024, w: 110, h: 96, tank: true }, { type: 'gable', x: 1174, w: 160, chim: 1, pots: true },
  ], 540, 3);
  b += `<g filter="url(#s)" fill="${P.near}"><path d="${L3.body}"/></g><path fill="${PANE.near}" d="${L3.panes}"/>`;

  const L4 = layer([
    { type: 'gable', x: 44, w: 170, wall: 60, roof: 70, chim: 1, pots: true }, { type: 'side', x: 590, w: 220, wall: 40, roof: 52, chim: 1, dormer: -1 },
    { type: 'gable', x: 808, w: 176, wall: 44, roof: 76, chim: -1, round: true, pots: true, aerial: 38 }, { type: 'side', x: 1010, w: 200, wall: 34, roof: 50, chim: -1, dormer: 1 },
    { type: 'gable', x: 1206, w: 180, wall: 54, roof: 78, chim: 1, pots: true },
  ], 612, 4);
  const CX = 318;
  const BASE = 588;
  const hs = litHouse(CX, BASE);
  b += `<g filter="url(#s)" fill="${P.front}"><path d="${L4.body}"/><path d="${hs.wall}"/><path d="${hs.chimney}"/></g><path fill="${PANE.front}" d="${L4.panes}"/>`;

  // the porch light: rings of warmer paper on the wall
  b += `<clipPath id="wall"><path d="${hs.wall}"/></clipPath><g clip-path="url(#wall)">`;
  b += `<g filter="url(#t)"><path fill="${P.ring3}" d="${blob(hs.lx - 4, hs.ly + 4, 92, 88, 31, 20, 0.012)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.ring2}" d="${blob(hs.lx - 2, hs.ly + 3, 62, 60, 32, 18, 0.012)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.ring1}" d="${blob(hs.lx, hs.ly + 2, 34, 33, 33, 16, 0.014)}"/></g>`;
  b += `</g>`;
  b += `<path fill="${PANE.front}" d="${hs.panes}"/>`;
  b += `<g filter="url(#t)"><path fill="${P.ink}" d="${hs.doorFrame}"/></g><path fill="${P.fore}" d="${hs.door}"/><path fill="${P.amber1}" d="${hs.transom}"/>`;
  b += `<g filter="url(#t)"><path fill="${P.ink}" d="${hs.lampFrame}"/></g><path fill="${P.amber1}" d="${hs.lamp}"/><path fill="${P.hot}" d="${disc(hs.lx, hs.ly + 1, 2.6)}"/>`;

  // the porch floor and its steps, and the path to the gate
  const gx0 = hs.dx - 66;
  const gx1 = hs.dx + 96;
  b += `<g filter="url(#t)"><path fill="#b8683f" d="${cut([[hs.dx - 40, BASE + 24], [hs.dx + 56, BASE + 24], [gx1 - 18, 650], [gx0 + 18, 650]], 50, 0.6)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber3}" d="${cut([[hs.dx - 46, BASE - 3], [hs.dx + 96, BASE - 3], [hs.dx + 96, BASE + 6], [hs.dx - 46, BASE + 6]], 51, 0.5)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber1}" d="${cut([[hs.dx - 36, BASE + 6], [hs.dx + 50, BASE + 6], [hs.dx + 50, BASE + 15], [hs.dx - 36, BASE + 15]], 52, 0.5)}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.amber2}" d="${cut([[hs.dx - 42, BASE + 15], [hs.dx + 56, BASE + 15], [hs.dx + 56, BASE + 24], [hs.dx - 42, BASE + 24]], 53, 0.5)}"/></g>`;
  // the garden fence along the front, with the gateway open
  const gate = (x) => box(x - 6, 596, 12, 60) + `M${x - 8} 597L${x} 587L${x + 8} 597Z`;
  b += `<g filter="url(#s)" fill="${P.fore}"><path d="${fence(-12, gx0, 606, 650, 3)}"/><path d="${fence(gx1 + 8, 1296, 606, 650, 4)}"/><path d="${gate(gx0)}${gate(gx1)}"/></g>`;

  // type, cut from indigo paper
  b += `<g filter="url(#t)" fill="${P.type}">`;
  b += `<text x="64" y="176" font-family="Kayo" font-size="112" letter-spacing="-1">Porchlight</text>`;
  b += `<text x="70" y="232" font-family="Optima" font-weight="700" font-size="31" letter-spacing="1.2">Leave the light on.</text>`;
  b += `</g>`;

  b += `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.9"/>`;
  return svg({ w: W, h: H, defs, body: b, fonts: FONTS });
}
const FONTS = { Kayo: 'Optima-ExtraBlack' };

// ---- mark: a half-disc of sunset with roofs across it and one light on ---------------
function dome(id, { tile = false } = {}) {
  // 200 x 200 space
  const defs =
    SHADOW(`${id}s`, 2, 1.2, 0.36) +
    (tile ? '' : `<clipPath id="${id}c"><path d="M8 152A92 92 0 0 1 192 152Z"/></clipPath>`) +
    `<clipPath id="${id}w"><path d="M106 160V118L139 90L172 118V160Z"/></clipPath>`;
  const cy = tile ? 150 : 152;
  let b = tile ? '<g>' : `<g clip-path="url(#${id}c)">`;
  b += `<rect width="200" height="200" fill="${P.sky}"/>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.band3}" cx="76" cy="${cy}" r="${tile ? 104 : 74}"/></g>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.band1}" cx="76" cy="${cy}" r="${tile ? 74 : 53}"/></g>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.sun}" cx="76" cy="${cy}" r="${tile ? 46 : 33}"/></g>`;
  if (tile) b += `<g filter="url(#${id}s)" fill="${P.cloud}"><path d="${cloud(140, 52, 46, 4.500, 2)}"/><path d="${cloud(52, 82, 34, 3.600, 3)}"/></g>`;
  // back roofs
  b += `<g filter="url(#${id}s)" fill="${P.mid}"><path d="M-6 210V${tile ? 132 : 138}L${tile ? 14 : 18} ${tile ? 112 : 120}L${tile ? 38 : 40} ${tile ? 132 : 138}V210Z"/><path d="M${tile ? 22 : 26} ${tile ? 124 : 130}V${tile ? 104 : 114}h8v${tile ? 26 : 22}Z"/><path d="M-6 210V${tile ? 144 : 146}H112V210Z"/></g>`;
  // the lit house in front
  b += `<g filter="url(#${id}s)" fill="${P.front}"><path d="M106 210V118H99L139 86L179 118H172V210Z"/><path d="M152 104V84h11v29Z"/><path d="M172 210V134L190 124L206 132V210Z"/><path d="M-6 210V150H106V210Z"/></g>`;
  b += `<g clip-path="url(#${id}w)"><circle fill="${P.ring3}" cx="152" cy="134" r="30"/><circle fill="${P.ring2}" cx="152" cy="134" r="20"/><circle fill="${P.ring1}" cx="152" cy="134" r="11"/></g>`;
  b += `<path fill="${P.ink}" d="M116 152V124h20v28Z"/><path fill="${P.amber1}" d="M119 127h14v4.500h-14Z"/>`;
  b += `<path fill="${P.ink}" d="M147 129L152 125l5 4ZM148 129h8l-1.300 10h-5.400Z"/><path fill="${P.amber1}" d="M149.500 130.600h5l-.9 6.800h-3.200Z"/>`;
  b += `<path fill="${P.amber2}" d="M110 152h36v${tile ? 5 : 8}h-36Z"/>`;
  if (tile) b += `<path fill="${P.fore}" d="M-6 166H206V210H-6Z"/><path fill="${P.amber1}" d="M114 157h28v5h-28Z"/><path fill="${P.amber2}" d="M108 162h40v6h-40Z"/>`;
  b += `</g>`;
  return { defs, body: b };
}
function markSvg() {
  const m = dome('m');
  return svg({ w: 512, h: 512, vb: '0 6 200 200', defs: m.defs, body: m.body });
}
function iconSvg() {
  const m = dome('i', { tile: true });
  const defs = m.defs + GRAIN + `<clipPath id="tile"><rect width="200" height="200" rx="44"/></clipPath>`;
  const b = `<g clip-path="url(#tile)">${m.body}<rect width="200" height="200" filter="url(#grain)" opacity="0.8"/></g>`;
  return svg({ w: 512, h: 512, vb: '0 0 200 200', defs, body: b });
}

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { s: P.sky, b: P.band3, c: P.band1, u: P.sun, m: P.mid, h: P.front, g: P.fore, k: P.ink, A: P.amber1, a: P.amber2, r: P.ring1, q: P.ring2 };
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
  'ssssbbbbbsssssss',
  'ssbbbbbbbbbsssss',
  'sbbbcccccbbbshss',
  'bbbcccccccbbhhhs',
  'bbccuuuuucchhhhh',
  'bbccuuuuuhhhhhhh',
  'mmcuuuuuuhhhqrrq',
  'mmmmuuuuuhkkrAAr',
  'mmmmmmuuuhkkrAAr',
  'mmmmmmmmmhkkqrrq',
  'mmmmmmmmmhkkhhhh',
  'gggggggggaaaaggg',
  '.gggggggAAAAAAg.',
  '..gggggggggggg..',
];
const FAV32 = [
  '.....ssssssssssssssssssssss.....',
  '...ssssssssssssssssssssssssss...',
  '..ssssssssssssssssssssssssssss..',
  '.sssssssssbbbbbbbbsssssssssssss.',
  '.ssssssbbbbbbbbbbbbbbsssssssssss',
  'sssssbbbbbbbbbbbbbbbbbbsssssssss',
  'sssbbbbbbbbccccccbbbbbbbssssssss',
  'ssbbbbbbbccccccccccbbbbbsshhssss',
  'sbbbbbbbccccccccccccbbbbshhhhsss',
  'bbbbbbbcccccuuuuccccbbbhhhhhhhss',
  'bbbbbbccccuuuuuuuucccbhhhhhhhhhs',
  'bbbbbbcccuuuuuuuuuucchhhhhhhhhhh',
  'bbbbbcccuuuuuuuuuuuuhhhhhhhhhhhh',
  'bbmmbcccuuuuuuuuuuushhhhhhhhhhhh',
  'bmmmmcccuuuuuuuuuuushhhhhhhhhhhh',
  'mmmmmmccuuuuuuuuuuushhhhhhqqqqhh',
  'mmmmmmmcuuuuuuuuuuushhhhhqqrrqqh',
  'mmmmmmmmmuuuuuuuuuushkkkkqrkkrqh',
  'mmmmmmmmmmmuuuuuuuushkAAkqrAArqq',
  'mmmmmmmmmmmmmuuuuuushkkkkqrAArqq',
  'mmmmmmmmmmmmmmmuuuushkkkkqrkkrqh',
  'mmmmmmmmmmmmmmmmmmmshkkkkqqrrqqh',
  'mmmmmmmmmmmmmmmmmmmshkkkkhqqqqhh',
  'mmmmmmmmmmmmmmmmmmmshkkkkhhhhhhh',
  'mmmmmmmmmmmmmmmmmmmshkkkkhhhhhhh',
  'ggggggggggggggggggaaaaaaaagggggg',
  'gggggggggggggggggaAAAAAAAAaggggg',
  'ggggggggggggggggaaaaaaaaaaaagggg',
  '.gggggggggggggggggggggggggggggg.',
  '..gggggggggggggggggggggggggggg..',
  '...gggggggggggggggggggggggggg...',
  '.....gggggggggggggggggggggg.....',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- logo -----------------------------------------------------------------------
function logoSvg(dark) {
  const m = dome(dark ? 'ld' : 'll');
  let b = nest({ x: 10, y: 6, w: 188, h: 188, vb: '0 6 200 200', body: `<defs>${m.defs}</defs>` + m.body });
  b += `<text x="212" y="118" font-family="Kayo" font-size="80" letter-spacing="-0.6" fill="${dark ? '#fbe6c4' : P.type}">Porchlight</text>`;
  b += `<text x="216" y="156" font-family="Optima" font-weight="700" font-size="22" letter-spacing="1" fill="${dark ? '#f0a07a' : P.far}">Leave the light on.</text>`;
  return svg({ w: 640, h: 200, body: b, fonts: FONTS });
}

const notes = `# 44 Papercut dusk

The warm one. The sun goes down in rings of paler paper behind a town cut in four rows, from rose at the back through plum to indigo in front: chimney pots, aerials, a church, a water tower, and five birds on a wire against the last of the light. On the left, in the darkest row, one house has just switched on its porch light: three rings of warmer paper on the wall, the transom lit, the steps cut from amber, the garden gate open. The name is cut from indigo paper, dark on the sky.
Palette: sky #e8866b, sun #fde2aa with rings #f7bd87 / #f2aa7b / #ed9872, rows #c05c72 / #963f6b / #672f60 / #3e2252 / #281846, amber #ffd97c / #f6ab52, light on the wall #ec9d58 / #a2565c / #61335e.
Type: Optima ExtraBlack for the name, cut from indigo paper; Optima Bold for the line under it.
Tagline: Leave the light on.
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
