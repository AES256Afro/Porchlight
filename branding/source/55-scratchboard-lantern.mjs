// 55 Scratchboard lantern: 50 with the owner's porch light. A black board, and
// everything that can be seen has been scratched out of it: a wall lantern on
// its bracket beside the door, the siding swelling into white where it is lit,
// the door and its casing. One amber spot: the flame.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '55-scratchboard-lantern';
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

// ---- the wall lantern ----------------------------------------------------------------
// A four-sided lantern hung from a scrolled bracket whose plate is on the wall
// to the left. G is the reference centre (the flame sits a little below it), k
// the scale. Returns what hides the wall behind it (black) and what is
// scratched on top (white, amber).
function lamp(G, k, { id = 'glass', seed = 3, fine = true, reach = 118, plate = [-122, -34], bold = 1 } = {}) {
  const r = rng(seed);
  const X = (x) => G.x + x * k;
  const Y = (y) => G.y + y * k;
  const P = (x, y) => `${f(X(x))},${f(Y(y))}`;
  const F = { x: G.x, y: Y(2) }; // the flame
  const glassD = `M${P(-34, -46)}L${P(34, -46)}L${P(22, 44)}L${P(-22, 44)}Z`;
  const roofD = `M${P(-44, -44)}L${P(-9, -78)}L${P(-6, -86)}L${P(6, -86)}L${P(9, -78)}L${P(44, -44)}Z`;
  const baseD = `M${P(-27, 43)}L${P(27, 43)}L${P(17, 55)}L${P(6, 58)}L${P(0, 68)}L${P(-6, 58)}L${P(-17, 55)}Z`;
  const armD = `M${P(-reach, -104)}H${f(X(-26))}Q${P(0, -104)} ${P(0, -84)}`;
  const scrollD = `M${P(-reach, -50)}C${P(-reach + 46, -50)} ${P(-44, -66)} ${P(-40, -104)}`;
  const curlD = `M${P(-reach + 30, -104)}C${P(-reach + 30, -84)} ${P(-reach + 58, -80)} ${P(-reach + 58, -92)}C${P(-reach + 58, -98)} ${P(-reach + 48, -98)} ${P(-reach + 49, -91)}`;
  const px0 = X(-reach - 13);
  const pw = 13 * k;
  const py0 = Y(plate[0]);
  const ph = (plate[1] - plate[0]) * k;
  const iron = `fill="none" stroke-linecap="round"`;
  const occl = `
<path d="${glassD}" stroke="${BLACK}" stroke-width="${f(11 * k)}" stroke-linejoin="round"/>
<path d="${roofD}" stroke="${BLACK}" stroke-width="${f(6 * k)}" stroke-linejoin="round"/>
<path d="${baseD}" stroke="${BLACK}" stroke-width="${f(5 * k)}" stroke-linejoin="round"/>
<path d="${armD}" ${iron} stroke="${BLACK}" stroke-width="${f(13 * k)}"/>
<path d="${scrollD}" ${iron} stroke="${BLACK}" stroke-width="${f(11 * k)}"/>
<path d="${curlD}" ${iron} stroke="${BLACK}" stroke-width="${f(9 * k)}"/>
<rect x="${f(px0 - 4 * k)}" y="${f(py0 - 4 * k)}" width="${f(pw + 8 * k)}" height="${f(ph + 8 * k)}"/>`;

  // glass: scratches packed solid round the flame and thinning toward the frame
  let glass = '';
  const n = fine ? 170 : 90;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.02;
    const r1 = (i % 2 ? 78 : 50 + r() * 18) * k;
    glass += wedge(F.x, F.y, a, 16 * k, r1, (fine ? 1.15 : 1.9) * k * (0.8 + r() * 0.5));
  }
  const q = (x, y) => `${f(F.x + x * k)},${f(F.y + y * k)}`;
  const flame = `<path d="M${q(0, -25)}C${q(5, -14)} ${q(12, -5)} ${q(9.5, 5)}C${q(7.5, 12)} ${q(-7.5, 12)} ${q(-9.5, 5)}C${q(-12, -5)} ${q(-5, -14)} ${q(0, -25)}Z" fill="${AMBER}"/>`;
  const candle = `<path d="M${q(-7, 15)}L${q(7, 15)}L${q(7, 34)}L${q(15, 34)}L${q(12, 44)}L${q(-12, 44)}L${q(-15, 34)}L${q(-7, 34)}Z" fill="${BLACK}"/>
<path d="${lens(F.x + 5 * k, F.y + 17 * k, F.x + 5 * k, F.y + 33 * k, 0.6 * k)}${lens(F.x - 13 * k, F.y + 35.5 * k, F.x + 13 * k, F.y + 35.5 * k, 0.6 * k)}" fill="${WHITE}"/>
<path d="M${P(-17, -46)}L${P(-11, 44)}M${P(17, -46)}L${P(11, 44)}" stroke="${BLACK}" stroke-width="${f(2.6 * k * bold)}"/>`;

  // roof and base: black iron, lit from below, ribbed
  let metal = '';
  metal += lens(X(-41), Y(-46), X(41), Y(-46), 1.7 * k * bold);
  for (let i = -3; i <= 3; i++) metal += lens(X(i * 11), Y(-50), X(i * 2.6), Y(-76), (i === 0 ? 1.2 : 0.8) * k * bold);
  metal += lens(X(-7), Y(-79), X(7), Y(-79), 0.8 * k * bold);
  metal += lens(X(-25), Y(44.5), X(25), Y(44.5), 1.5 * k * bold);
  metal += lens(X(-15), Y(53.5), X(15), Y(53.5), 0.8 * k * bold);
  // bracket: a line of light along the underside of each bar
  const hi = f(1.7 * k * bold);
  const bracket = `
<path d="${armD}" ${iron} stroke="${WHITE}" stroke-width="${hi}"/>
<path d="${scrollD}" ${iron} stroke="${WHITE}" stroke-width="${hi}"/>
<path d="${curlD}" ${iron} stroke="${WHITE}" stroke-width="${f(1.2 * k * bold)}"/>
<rect x="${f(px0)}" y="${f(py0)}" width="${f(pw)}" height="${f(ph)}" fill="none" stroke="${WHITE}" stroke-width="${f(1.3 * k * bold)}"/>
<path d="${lens(px0 + pw - 3 * k, py0 + 6 * k, px0 + pw - 3 * k, py0 + ph - 6 * k, 0.9 * k * bold)}" fill="${WHITE}"/>
<circle cx="${f(px0 + pw / 2)}" cy="${f(py0 + 9 * k)}" r="${f(1.5 * k)}" fill="${WHITE}"/><circle cx="${f(px0 + pw / 2)}" cy="${f(py0 + ph - 9 * k)}" r="${f(1.5 * k)}" fill="${WHITE}"/>`;
  return {
    F,
    occl,
    art: `<clipPath id="${id}"><path d="${glassD}"/></clipPath>
<g clip-path="url(#${id})"><circle cx="${f(F.x)}" cy="${f(F.y)}" r="${f(25 * k)}" fill="${WHITE}"/><path d="${glass}" fill="${WHITE}"/>${candle}</g>
${flame}
<path d="${glassD}" fill="none" stroke="${WHITE}" stroke-width="${f(1.5 * k * bold)}" stroke-linejoin="round"/>
<path d="${metal}" fill="${WHITE}"/>
<circle cx="${f(G.x)}" cy="${f(Y(68))}" r="${f(2.6 * k)}" fill="${WHITE}"/>${bracket}`,
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
  const G = { x: 114, y: 113 };
  const k = 0.6;
  const L = lamp(G, k, { id: `${id}g`, fine: false, seed: 7, reach: 88, plate: [-120, -36], bold: 1.9 });
  return `
<clipPath id="${id}"><circle cx="100" cy="100" r="85"/></clipPath>
<circle cx="100" cy="100" r="96" fill="${BLACK}"/>
<g clip-path="url(#${id})">
  <path d="${glory(L.F, 47, { n: 40, long: 36, mid: 24, short: 14, seed: 4, skipUp: 0.62, w: 2.9 })}" fill="${WHITE}"/>
  <g fill="${BLACK}">${L.occl}</g>
  ${L.art}
</g>
<circle cx="100" cy="100" r="90" fill="none" stroke="${WHITE}" stroke-width="2.2"/>
<circle cx="100" cy="100" r="85.5" fill="none" stroke="${WHITE}" stroke-width="0.8"/>`;
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
  '.KKKKKKKKKKKKKK.',
  'KKKKKKKKKKKKKKKK',
  'KWWWWWWWWWWKKKKK',
  'KWWKKKKKKWWKKKKK',
  'KWWKKKKKWWWWKKKK',
  'KWWKKKWWWWWWWWKK',
  'KKKKKKKWWWWWWKKK',
  'KKKKWKKWWAAWWKKW',
  'KKKKKKKWWAAWWKKK',
  'KKKKWKKWWAAWWKKW',
  'KKKKKKKWWKKWWKKK',
  'KKKKKKKKWWWWKKKK',
  'KKKKKKKKKWWKKKKK',
  'KKKKKKWKKKKKKWKK',
  'KKKKKKKKKWWKKKKK',
  '.KKKKKKKKKKKKKK.',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('K'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [31, 0], [30, 0], [31, 1], [0, 31], [1, 31], [0, 30], [31, 31], [30, 31], [31, 30]]) set(x, y, '.');
  const cx = 18.5;
  const span = (h, y, ch) => {
    for (let x = Math.ceil(cx - h); x <= Math.floor(cx + h); x++) set(x, y, ch);
  };
  // plate, arm and drop
  for (let y = 3; y <= 15; y++) for (let x = 2; x <= 4; x++) set(x, y, 'W');
  for (let x = 5; x <= 19; x++) {
    set(x, 4, 'W');
    set(x, 5, 'W');
  }
  for (let y = 6; y <= 7; y++) span(1, y, 'W');
  // roof, eave, glass, base, finial
  [2, 4, 6, 8].forEach((h, j) => span(h, 8 + j, 'W'));
  span(9, 12, 'W');
  [7, 7, 7, 7, 6, 6, 6, 6, 5, 5, 5].forEach((h, j) => span(h, 14 + j, 'W'));
  span(7, 13, 'K');
  [1, 1, 2, 2, 2, 1].forEach((h, j) => span(h, 15 + j, 'A'));
  for (let y = 21; y <= 23; y++) span(1, y, 'K');
  span(3, 24, 'K');
  span(6, 25, 'W');
  span(4, 26, 'W');
  span(1, 27, 'W');
  span(1, 28, 'W');
  // rays
  const ray = (dx, dy, r0, r1) => {
    for (let t = r0; t <= r1; t++) set(Math.round(cx + dx * t), Math.round(18.5 + dy * t), 'W');
  };
  ray(1, 0, 10, 12);
  ray(-1, 0, 10, 12);
  ray(0.8, 0.6, 11, 13);
  ray(-0.8, 0.6, 11, 14);
  ray(0.87, -0.5, 12, 13);
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon ----------------------------------------------------------------------------
function iconBody() {
  const G = { x: 292, y: 286 };
  const k = 1.72;
  const L = lamp(G, k, { id: 'ig', seed: 9, reach: 104, plate: [-124, -30], bold: 1.3, fine: false });
  const S = (x, y) => Math.exp(-(((x - L.F.x) ** 2 + (y - L.F.y) ** 2) / (165 * 165)));
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
  <path d="${glory(L.F, 122, { n: 54, long: 100, mid: 60, short: 32, seed: 6, skipUp: 0.5, w: 4.4 })}" fill="${WHITE}"/>
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
<text x="411" y="168" text-anchor="middle" font-family="Bodoni 72" font-style="italic" font-size="24" fill="${ink}">Keep your secrets off the street.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero ----------------------------------------------------------------------------
function hero() {
  const G = { x: 500, y: 272 };
  const L = lamp(G, 1.34, { id: 'hg', seed: 3, reach: 122, plate: [-126, -28] });
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
  const SD = (x, y) => 2.1 * Math.exp(-(((x - C.x) / 400) ** 2 + ((y - C.y) / 215) ** 2));
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
<path d="${glory(C, 100, { n: 96, long: 150, mid: 74, short: 36, seed: 5, skipUp: 0.52 })}" fill="${WHITE}"/>
<path d="${door}" fill="${WHITE}"/>
${knob}
<g fill="${BLACK}">${L.occl}</g>
${L.art}
${moth(676, 408, 1.1, -24)}
<path d="${dust}" fill="${WHITE}" opacity="0.55"/>
<path d="${fr(22, 8)}" fill="none" stroke="${WHITE}" stroke-width="1.1"/>
<path d="${fr(28, 3)}" fill="none" stroke="${WHITE}" stroke-width="0.45"/>

<text x="${TX}" y="318" text-anchor="middle" font-family="Bodoni 72" font-size="104" fill="${WHITE}">Porchlight</text>
<path d="M${TX - 216},352H${TX - 18}M${TX + 18},352H${TX + 216}" stroke="${WHITE}" stroke-width="1.3"/>
<path d="M${TX - 216},357H${TX - 18}M${TX + 18},357H${TX + 216}" stroke="${WHITE}" stroke-width="0.5"/>
<path d="M${TX},347L${TX + 7.5},354.5L${TX},362L${TX - 7.5},354.5Z" fill="${AMBER}"/>
<text x="${TX}" y="414" text-anchor="middle" font-family="Bodoni 72" font-style="italic" font-size="35" fill="${WHITE}">Keep your secrets off the street.</text>
<text x="${TX}" y="468" text-anchor="middle" font-family="Bodoni 72 Smallcaps" font-size="15.5" letter-spacing="3.2" fill="${WHITE}" opacity="0.86">your repos · your servers · your computer</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 55 Scratchboard lantern

Concept 50 with a proper porch light. A black board, and everything you can see has been scratched out of it: a four-sided wall lantern hangs from a scrolled iron bracket beside the front door, the siding swells into white where it is lit and breaks up as it runs into the dark, and the door, its casing and its knob catch the light edge on. The only colour is the amber flame. The mark is a round board with the lantern on its bracket and a ring of cut rays, drawn heavier so it holds when small.
Palette: board #0d0c0b, scratch white #f4efe4, amber #f2a63a; type on a light page #15120f.
Type: Bodoni 72 for the name, its italic for the tagline, Bodoni 72 Smallcaps tracked for the small line.
Tagline: Keep your secrets off the street.
From: 50 Scratchboard
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
