// 50 Scratchboard: the night-time sibling of 08. A black board, and everything
// that can be seen has been scratched out of it: the siding swells into white
// where the globe lights it and breaks up into the dark, a moth, the edge of a
// door. One amber spot: the flame.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '50-scratchboard';
const BLACK = '#0d0c0b';
const WHITE = '#f4efe4';
const AMBER = '#f2a63a';
const INK = '#15120f'; // type on a light page
const f = (n) => Math.round(n * 100) / 100;

// ---- scratches -------------------------------------------------------------------
// A line along (x(t), y(t)) whose width follows w(t); it breaks where w is ~0.
function swell(p, t0, t1, w, { step = 4, min = 0.2 } = {}) {
  const segs = [];
  let cur = [];
  for (let t = t0; t <= t1 + 0.01; t += step) {
    const ww = w(t);
    const [x, y, nx, ny] = p(t);
    if (ww > min) cur.push([x, y, nx, ny, ww]);
    else if (cur.length) {
      cur.push([x, y, nx, ny, 0]);
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs
    .filter((s) => s.length > 2)
    .map((s) => {
      s[0][4] = 0;
      const a = s.map(([x, y, nx, ny, ww]) => `${f(x + (nx * ww) / 2)},${f(y + (ny * ww) / 2)}`);
      const b = s.map(([x, y, nx, ny, ww]) => `${f(x - (nx * ww) / 2)},${f(y - (ny * ww) / 2)}`).reverse();
      return `M${a.join('L')}L${b.join('L')}Z`;
    })
    .join('');
}
const hline = (y, wob, ph) => (x) => [x, y + wob * Math.sin(x / 43 + ph) + wob * 0.5 * Math.sin(x / 13 + ph * 2.3), 0, 1];
const vline = (x, wob, ph) => (y) => [x + wob * Math.sin(y / 47 + ph), y, 1, 0];

// A scratch that starts wide at r0 and runs out to a point at r1.
function wedge(cx, cy, a, r0, r1, w) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x0 = cx + c * r0;
  const y0 = cy + s * r0;
  return `M${f(x0 - s * w)},${f(y0 + c * w)}L${f(cx + c * r1)},${f(cy + s * r1)}L${f(x0 + s * w)},${f(y0 - c * w)}Z`;
}
// A scratch pointed at both ends.
function lens(x1, y1, x2, y2, w) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * w;
  const ny = ((x2 - x1) / len) * w;
  return `M${f(x1)},${f(y1)}Q${f(mx + nx)},${f(my + ny)} ${f(x2)},${f(y2)}Q${f(mx - nx)},${f(my - ny)} ${f(x1)},${f(y1)}Z`;
}
const circlePts = (cx, cy, r, a0, a1, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
// An arc scratched with a width that swells in the middle.
function arc(cx, cy, r, a0, a1, w) {
  const pts = circlePts(cx, cy, r, a0, a1, 36);
  const out = pts.map(([x, y], i) => {
    const k = Math.sin((i / 36) * Math.PI) * w * 0.5;
    const a = a0 + ((a1 - a0) * i) / 36;
    return [`${f(x + Math.cos(a) * k)},${f(y + Math.sin(a) * k)}`, `${f(x - Math.cos(a) * k)},${f(y - Math.sin(a) * k)}`];
  });
  return `M${out.map((o) => o[0]).join('L')}L${out
    .map((o) => o[1])
    .reverse()
    .join('L')}Z`;
}

// ---- the pendant lamp ----------------------------------------------------------------
// A glass globe on a chain. G is the reference centre (the flame sits a little
// below it), k the scale (1 = 102 tall). Returns what hides the wall behind
// it (black) and what is scratched on top (white, amber).
function globePath(G, k) {
  const q = (x, y) => `${f(G.x + x * k)},${f(G.y + y * k)}`;
  return `M${q(-28, -48)}C${q(-52, -42)} ${q(-60, -8)} ${q(-54, 12)}C${q(-48, 34)} ${q(-26, 50)} ${q(0, 54)}C${q(26, 50)} ${q(48, 34)} ${q(54, 12)}C${q(60, -8)} ${q(52, -42)} ${q(28, -48)}Z`;
}
function lamp(G, k, { id = 'glass', seed = 3, fine = true, links = 8, fade = 150 } = {}) {
  const r = rng(seed);
  const X = (x) => G.x + x * k;
  const Y = (y) => G.y + y * k;
  const F = { x: G.x, y: Y(2) }; // the flame
  const glassD = globePath(G, k);
  const chainTop = Y(-78 - links * 13);
  const occl = `
<path d="${glassD}" stroke="${BLACK}" stroke-width="${f(11 * k)}" stroke-linejoin="round"/>
<path d="M${f(X(-24))},${f(Y(-68))}H${f(X(24))}L${f(X(38))},${f(Y(-44))}H${f(X(-38))}Z"/>
<circle cx="${f(G.x)}" cy="${f(Y(61))}" r="${f(8 * k)}"/>
<rect x="${f(X(-8))}" y="${f(chainTop)}" width="${f(16 * k)}" height="${f(Y(-64) - chainTop)}"/>`;

  // glass: scratches packed solid round the flame and thinning toward the rim
  let glass = '';
  const n = fine ? 170 : 90;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.02;
    const r1 = (i % 2 ? 74 : 52 + r() * 16) * k;
    glass += wedge(F.x, F.y, a, 16 * k, r1, (fine ? 1.15 : 1.7) * k * (0.8 + r() * 0.5));
  }
  const q = (x, y) => `${f(F.x + x * k)},${f(F.y + y * k)}`;
  // the flame stands on a candle, so the globe reads as a lamp and never as an eye
  const flame = `<path d="M${q(0, -25)}C${q(5, -14)} ${q(12, -5)} ${q(9.5, 5)}C${q(7.5, 12)} ${q(-7.5, 12)} ${q(-9.5, 5)}C${q(-12, -5)} ${q(-5, -14)} ${q(0, -25)}Z" fill="${AMBER}"/>`;
  const candle = `<path d="M${q(-7, 15)}L${q(7, 15)}L${q(7, 36)}L${q(15, 36)}L${q(11, 46)}L${q(-11, 46)}L${q(-15, 36)}L${q(-7, 36)}Z" fill="${BLACK}"/>
<path d="${lens(F.x + 5 * k, F.y + 17 * k, F.x + 5 * k, F.y + 35 * k, 0.6 * k)}${lens(F.x - 5 * k, F.y + 17 * k, F.x - 5 * k, F.y + 35 * k, 0.35 * k)}${lens(F.x - 13 * k, F.y + 37.5 * k, F.x + 13 * k, F.y + 37.5 * k, 0.6 * k)}" fill="${WHITE}"/>
<path d="${arc(G.x, G.y, 44 * k, Math.PI * 1.08, Math.PI * 1.36, 5 * k)}" fill="${BLACK}"/>`;

  // collar: lit from below, ribbed
  let metal = '';
  metal += lens(X(-33), Y(-49.5), X(33), Y(-49.5), 1.5 * k);
  metal += lens(X(-21), Y(-64), X(21), Y(-64), 0.8 * k);
  for (let i = -3; i <= 3; i++) metal += lens(X(i * 9), Y(-51.5), X(i * 6), Y(-62), (i === 0 ? 1.0 : 0.7) * k);
  // the bead under the glass
  const bead = `<circle cx="${f(G.x)}" cy="${f(Y(61))}" r="${f(3.6 * k)}" fill="${WHITE}"/>`;
  // chain: links that fade as they climb out of the light
  let chain = `<circle cx="${f(G.x)}" cy="${f(Y(-71))}" r="${f(5 * k)}" fill="none" stroke="${WHITE}" stroke-width="${f(1.5 * k)}"/>`;
  for (let i = 0; i < links; i++) {
    const cy = Y(-84 - i * 13);
    const s = Math.exp(-(((cy - G.y) / (fade * k)) ** 2) * 1.2);
    if (s < 0.12) break;
    chain +=
      i % 2 === 0
        ? `<path d="M${f(G.x)},${f(cy - 8 * k)}V${f(cy + 8 * k)}" stroke="${WHITE}" stroke-width="${f(2 * k * s)}" stroke-linecap="round"/>`
        : `<ellipse cx="${f(G.x)}" cy="${f(cy)}" rx="${f(3.8 * k)}" ry="${f(8 * k)}" fill="none" stroke="${WHITE}" stroke-width="${f(1.5 * k * s)}"/>`;
  }
  return {
    F,
    occl,
    art: `<clipPath id="${id}"><path d="${glassD}"/></clipPath>
<g clip-path="url(#${id})"><circle cx="${f(F.x)}" cy="${f(F.y)}" r="${f(25 * k)}" fill="${WHITE}"/><path d="${glass}" fill="${WHITE}"/>${candle}</g>
${flame}
<path d="${glassD}" fill="none" stroke="${WHITE}" stroke-width="${f(1.5 * k)}"/>
<path d="${metal}" fill="${WHITE}"/>${bead}${chain}`,
  };
}

// Rays scratched outward from the globe, in three lengths.
function glory(G, r0, { n = 90, long = 150, mid = 72, short = 36, seed = 5, skipUp = 0.5, w = 1.5 } = {}) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.03;
    const len = i % 3 === 0 ? long * (0.85 + r() * 0.3) : i % 3 === 1 ? mid * (0.8 + r() * 0.4) : short * (0.8 + r() * 0.5);
    let up = Math.abs(a - Math.PI * 1.5);
    if (up > Math.PI) up = Math.PI * 2 - up;
    if (up < skipUp) continue;
    d += wedge(G.x, G.y, a, r0, r0 + len, i % 3 === 0 ? w : w * 0.72);
  }
  return d;
}

// A moth, wings veined with fine scratches. Origin at the thorax.
function moth(x, y, s, rot, { fine = true } = {}) {
  let d = '';
  const fan = (root, edge, n, w) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const seg = t * (edge.length - 1);
      const j = Math.min(edge.length - 2, Math.floor(seg));
      const q = seg - j;
      const ex = edge[j][0] + (edge[j + 1][0] - edge[j][0]) * q;
      const ey = edge[j][1] + (edge[j + 1][1] - edge[j][1]) * q;
      d += lens(root[0], root[1], ex, ey, w);
    }
  };
  const fore = [[6, -8], [30, -23], [35, -12], [32, -3], [9, 3]];
  const hind = [[9, 4], [25, 6], [24, 17], [14, 25], [3, 12]];
  for (const m of [1, -1]) {
    const mir = (pts) => pts.map(([px, py]) => [px * m, py]);
    fan([2 * m, -3], mir(fore), fine ? 12 : 6, fine ? 0.55 : 0.9);
    fan([2 * m, 3], mir(hind), fine ? 9 : 5, fine ? 0.5 : 0.8);
  }
  const outline = (pts) => 'M' + pts.map(([px, py]) => `${px},${py}`).join('L');
  const wings = [fore, hind]
    .flatMap((w) => [w, w.map(([px, py]) => [-px, py])])
    .map((w) => `<path d="${outline([[w === fore ? 0 : 0, 0], ...w])}Z" fill="${BLACK}" stroke="${BLACK}" stroke-width="3" stroke-linejoin="round"/>`)
    .join('');
  const edges = [fore, hind]
    .flatMap((w) => [w, w.map(([px, py]) => [-px, py])])
    .map((w) => `<path d="${outline(w)}" fill="none" stroke="${WHITE}" stroke-width="${fine ? 0.9 : 1.3}" stroke-linejoin="round" stroke-linecap="round"/>`)
    .join('');
  return `
<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
  ${wings}
  <path d="${d}" fill="${WHITE}"/>
  ${edges}
  <ellipse cx="0" cy="2" rx="3.1" ry="11.5" fill="${WHITE}"/>
  <path d="M-2.6,0H2.6M-2.8,4H2.8M-2.4,8H2.4" stroke="${BLACK}" stroke-width="0.7"/>
  <circle cx="0" cy="-10.5" r="3" fill="${WHITE}"/>
  <path d="M-1.4,-13C-3,-19 -7,-23 -11,-24M1.4,-13C3,-19 7,-23 11,-24" fill="none" stroke="${WHITE}" stroke-width="0.8" stroke-linecap="round"/>
</g>`;
}

// ---- mark: a round board -------------------------------------------------------------
function markBody(id) {
  const G = { x: 100, y: 106 };
  const k = 0.6;
  const L = lamp(G, k, { id: `${id}g`, fine: false, seed: 7, links: 6, fade: 400 });
  return `
<clipPath id="${id}"><circle cx="100" cy="100" r="85"/></clipPath>
<circle cx="100" cy="100" r="96" fill="${BLACK}"/>
<g clip-path="url(#${id})">
  <path d="${glory(L.F, 43, { n: 48, long: 36, mid: 23, short: 13, seed: 4, skipUp: 0.34, w: 2.2 })}" fill="${WHITE}"/>
  <g fill="${BLACK}">${L.occl}</g>
  ${L.art}
</g>
<circle cx="100" cy="100" r="90" fill="none" stroke="${WHITE}" stroke-width="1.8"/>
<circle cx="100" cy="100" r="86" fill="none" stroke="${WHITE}" stroke-width="0.7"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('mk') });

// ---- favicons, on the pixel grid -------------------------------------------------------
const PIX = { K: BLACK, W: WHITE, A: AMBER, g: '#8d8980' };
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
  '.KKKKKKWWKKKKKK.',
  'KKKKKKKWWKKKKKKK',
  'KKWKKKWWWWKKKWKK',
  'KKKWKKKKKKKKWKKK',
  'KKKKKWWWWWWKKKKK',
  'KKKKWWWAAWWWKKKK',
  'KWKKWWWAAWWWKKWK',
  'KWKKWWWAAWWWKKWK',
  'KKKKWWWKKWWWKKKK',
  'KKKKKWWKKWWKKKKK',
  'KKKWKKWWWWKKWKKK',
  'KKWKKKKKKKKKKWKK',
  'KKKKKKKWWKKKKKKK',
  'KKKKWKKWWKKWKKKK',
  'KKKWKKKKKKKKWKKK',
  '.KKKKKKKKKKKKKK.',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('K'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [31, 0], [30, 0], [31, 1], [0, 31], [1, 31], [0, 30], [31, 31], [30, 31], [31, 30]]) set(x, y, '.');
  const cx = 15.5;
  // acorn glass, rows 7..23
  const half = [5, 7, 8, 9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 6, 4];
  half.forEach((h, j) => {
    for (let x = Math.ceil(cx - h); x <= Math.floor(cx + h); x++) set(x, 7 + j, 'W');
  });
  // flame
  const fl = [1, 1, 2, 2, 2, 2, 1];
  fl.forEach((h, j) => {
    for (let x = Math.ceil(cx - h); x <= Math.floor(cx + h); x++) set(x, 10 + j, 'A');
  });
  for (let y = 17; y <= 19; y++) {
    set(15, y, 'K');
    set(16, y, 'K');
  }
  for (let x = 13; x <= 18; x++) set(x, 20, 'K');
  // collar, ring and chain
  for (let x = 11; x <= 20; x++) set(x, 5, 'W');
  for (let x = 12; x <= 19; x++) set(x, 4, 'g');
  for (let y = 0; y <= 3; y++) {
    set(15, y, 'W');
    set(16, y, 'g');
  }
  // rays
  const ray = (dx, dy, r0, r1) => {
    for (let t = r0; t <= r1; t++) set(Math.round(cx + dx * t), Math.round(14.5 + dy * t), 'W');
  };
  ray(1, 0, 12, 15);
  ray(-1, 0, 12, 15);
  ray(0.94, -0.34, 12, 14);
  ray(-0.94, -0.34, 12, 14);
  ray(0.87, 0.5, 12, 16);
  ray(-0.87, 0.5, 12, 16);
  ray(0.6, 0.8, 12, 14);
  ray(-0.6, 0.8, 12, 14);
  ray(0.34, 0.94, 13, 16);
  ray(-0.34, 0.94, 13, 16);
  ray(0.77, -0.64, 12, 15);
  ray(-0.77, -0.64, 12, 15);
  set(15, 27, 'W');
  set(16, 27, 'W');
  set(15, 28, 'W');
  set(16, 28, 'W');
  set(15, 29, 'W');
  set(16, 29, 'W');
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon ----------------------------------------------------------------------------
function iconBody() {
  const G = { x: 256, y: 262 };
  const k = 1.5;
  const L = lamp(G, k, { id: 'ig', seed: 9, links: 7, fade: 190 });
  const S = (x, y) => Math.exp(-(((x - L.F.x) ** 2 + (y - L.F.y) ** 2) / (150 * 150)));
  let wall = '';
  let i = 0;
  for (let y = 62; y < 470; y += 13.5, i++) {
    if (i % 4 === 3) continue;
    const ph = i * 1.7;
    wall += swell(hline(y, 0.6, ph), 44, 468, (x) => 6.2 * S(x, y) * (i % 4 === 0 ? 1.25 : 1) * (0.85 + 0.15 * Math.sin(x / 31 + ph)), { step: 6, min: 0.5 });
  }
  return `
<rect width="512" height="512" rx="112" fill="${BLACK}"/>
<clipPath id="ic"><rect x="36" y="36" width="440" height="440" rx="81"/></clipPath>
<g clip-path="url(#ic)">
  <path d="${wall}" fill="${WHITE}"/>
  <path d="${glory(L.F, 112, { n: 60, long: 110, mid: 64, short: 34, seed: 6, skipUp: 0.36, w: 4 })}" fill="${WHITE}"/>
  <g fill="${BLACK}">${L.occl}</g>
  ${L.art}
</g>
<rect x="26" y="26" width="460" height="460" rx="90" fill="none" stroke="${WHITE}" stroke-width="3.4"/>
<rect x="36" y="36" width="440" height="440" rx="81" fill="none" stroke="${WHITE}" stroke-width="1.3"/>`;
}
const iconSvg = svg({ w: 512, h: 512, vb: '0 0 512 512', body: iconBody() });

// ---- logo ----------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? WHITE : INK;
  return `
${nest({ x: 16, y: 16, w: 168, h: 168, vb: '0 0 200 200', body: markBody('lm') })}
<text x="212" y="112" font-family="Bodoni 72" font-size="86" fill="${ink}">Porchlight</text>
<path d="${lens(214, 134, 398, 134, 0.9)}${lens(424, 134, 606, 134, 0.9)}" fill="${ink}"/>
<path d="M411,128.5L416.5,134L411,139.5L405.5,134Z" fill="${AMBER}"/>
<text x="411" y="168" text-anchor="middle" font-family="Bodoni 72" font-style="italic" font-size="25" fill="${ink}">On all night.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero ----------------------------------------------------------------------------
function hero() {
  const G = { x: 506, y: 244 };
  const L = lamp(G, 1, { id: 'hg', seed: 3, links: 12, fade: 150 });
  const C = L.F;
  const S = (x, y) => Math.exp(-(((x - C.x) / 168) ** 2 + ((y - C.y) / 184) ** 2));
  const EDGE = 250; // where the wall meets the door casing

  // siding: boards of four lines and a dark joint
  let wall = '';
  let i = 0;
  for (let y = 46; y < 604; y += 6.4, i++) {
    if (i % 5 === 4) continue;
    const boost = i % 5 === 0 ? 1.35 : 1;
    const ph = i * 2.1;
    wall += swell(hline(y, 0.45, ph), EDGE + 3, 756, (x) => {
      const s = S(x, y);
      if (s < 0.4 && Math.sin(x / 29 + ph) + 0.45 * Math.sin(x / 11 + ph * 1.7) > s * 3.6 - 0.2) return 0;
      return 3.05 * s * boost * (0.84 + 0.16 * Math.sin(x / 19 + ph)) * Math.min(1, (760 - x) / 90);
    });
  }

  // casing and door: they stand proud of the wall and catch the light edge on
  const SD = (x, y) => 1.3 * Math.exp(-(((x - C.x) / 345) ** 2 + ((y - C.y) / 182) ** 2));
  let door = '';
  const up = (x, k, ph, y0 = 56, y1 = 592) => {
    door += swell(vline(x, 0.35, ph), y0, y1, (y) => {
      const s = SD(x, y);
      if (s < 0.3 && Math.sin(y / 31 + ph) > s * 5 - 0.4) return 0;
      return k * s * (0.85 + 0.15 * Math.sin(y / 23 + ph));
    });
  };
  const across = (y, x0, x1, k, ph) => {
    door += swell(hline(y, 0.3, ph), x0, x1, (x) => {
      const s = SD(x, y);
      if (s < 0.3 && Math.sin(x / 27 + ph) > s * 5 - 0.4) return 0;
      return k * s;
    });
  };
  // casing, a moulded board 54 wide
  up(EDGE, 4.6, 0.3);
  up(EDGE - 6, 1.3, 1.1);
  up(EDGE - 15, 2.6, 2.2);
  up(EDGE - 27, 1.2, 3.1);
  up(EDGE - 40, 2.3, 4.5);
  up(EDGE - 45, 1.0, 5.2);
  up(EDGE - 54, 3.2, 6.0);
  // the door leaf: its edge, and two panels with their mouldings
  const LX = EDGE - 60;
  up(LX, 1.8, 7.3);
  const panel = (y0, y1, ph) => {
    const x1 = LX - 26;
    const x0 = 64;
    up(x1, 3.6, ph, y0, y1);
    up(x1 - 7, 1.5, ph + 1, y0 + 7, y1 - 7);
    up(x0, 1.4, ph + 2, y0, y1);
    up(x0 + 7, 2.6, ph + 3, y0 + 7, y1 - 7);
    across(y0, x0, x1, 3.0, ph + 4);
    across(y0 + 7, x0 + 7, x1 - 7, 1.3, ph + 5);
    across(y1, x0, x1, 1.6, ph + 6);
    across(y1 - 7, x0 + 7, x1 - 7, 2.8, ph + 7);
    // the field of the panel, hatched where a little light reaches it
    for (let d = 0; d < 13; d++) {
      const xa = x1 - 16 - d * 6.5;
      const s = SD(xa, (y0 + y1) / 2);
      const len = 16 + d * 2.5;
      for (let yy = y0 + 20 + (d % 2) * 9; yy < y1 - 22 - len; yy += 30 + d * 3) {
        const sy = SD(xa, yy);
        if (sy * 2.6 > 0.25) door += lens(xa, yy, xa - len * 0.5, yy + len, sy * 1.3);
      }
      if (s < 0.05) break;
    }
  };
  panel(98, 292, 8.1);
  panel(338, 566, 9.4);
  // knob: a crescent of light on brass
  const KX = LX - 13;
  const knob = `<circle cx="${KX}" cy="316" r="9" fill="${BLACK}"/><path d="${arc(KX, 316, 6.6, -1.2, 1.25, 2.6)}" fill="${WHITE}"/><circle cx="${KX}" cy="316" r="6.6" fill="none" stroke="${WHITE}" stroke-width="0.5" opacity="0.6"/><path d="${arc(KX, 316, 11.5, -0.7, 0.75, 0.9)}" fill="${WHITE}"/>`;

  // dust and slips of the blade
  const r = rng(41);
  let dust = '';
  for (let k = 0; k < 70; k++) {
    const x = 40 + r() * 1200;
    const y = 40 + r() * 560;
    const a = r() * Math.PI;
    const l = 1 + r() * r() * 9;
    dust += lens(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.35 + r() * 0.3);
  }

  // frame: ruled scratches that overrun at the corners
  const fr = (inset, over) => {
    const a = inset;
    const b = 1280 - inset;
    const c = 640 - inset;
    return `M${a - over},${a}H${b + over}M${b},${a - over}V${c + over}M${b + over},${c}H${a - over}M${a},${c + over}V${a - over}`;
  };

  const TX = 1004;
  return `
<rect width="1280" height="640" fill="${BLACK}"/>
<path d="${wall}" fill="${WHITE}"/>
<path d="${glory(C, 74, { n: 96, long: 150, mid: 74, short: 36, seed: 5, skipUp: 0.3 })}" fill="${WHITE}"/>
<path d="${door}" fill="${WHITE}"/>
${knob}
<g fill="${BLACK}">${L.occl}</g>
${L.art}
${moth(664, 336, 1.35, -24)}
${moth(398, 428, 0.62, 38, { fine: false })}
<path d="${dust}" fill="${WHITE}" opacity="0.55"/>
<path d="${fr(22, 8)}" fill="none" stroke="${WHITE}" stroke-width="1.1"/>
<path d="${fr(28, 3)}" fill="none" stroke="${WHITE}" stroke-width="0.45"/>

${moth(TX, 202, 0.6, 0, { fine: false })}
<text x="${TX}" y="318" text-anchor="middle" font-family="Bodoni 72" font-size="104" fill="${WHITE}">Porchlight</text>
<path d="M${TX - 216},352H${TX - 18}M${TX + 18},352H${TX + 216}" stroke="${WHITE}" stroke-width="1.3"/>
<path d="M${TX - 216},357H${TX - 18}M${TX + 18},357H${TX + 216}" stroke="${WHITE}" stroke-width="0.5"/>
<path d="M${TX},347L${TX + 7.5},354.5L${TX},362L${TX - 7.5},354.5Z" fill="${AMBER}"/>
<text x="${TX}" y="414" text-anchor="middle" font-family="Bodoni 72" font-style="italic" font-size="46" fill="${WHITE}">On all night.</text>
<text x="${TX}" y="468" text-anchor="middle" font-family="Bodoni 72 Smallcaps" font-size="17" letter-spacing="4.5" fill="${WHITE}" opacity="0.86">keys · packages · domains · this mac</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 50 Scratchboard

The night-time sibling of 08: a black board, and everything you can see has been scratched out of it. The siding swells into white where the globe lights it and breaks up as it runs into the dark; rays, a moth with veined wings and the upright edge of a door casing are cut the same way. The only colour is the amber flame in the glass globe, which hangs on a chain that fades as it climbs out of the light. The mark is a round board with the globe and its rays.
Palette: board #0d0c0b, scratch white #f4efe4, amber #f2a63a; type on a light page #15120f.
Type: Bodoni 72 for the name, its italic for the tagline, Bodoni 72 Smallcaps tracked for the small line.
Tagline: On all night.
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
