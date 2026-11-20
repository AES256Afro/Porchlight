// 59 Linocut II (refines 49): a two-block linocut. The navy key block is a solid night with
// everything cut out of it; the amber block prints first, a few pixels off
// register, and shows through the cuts nearest the lantern. The light is the
// gouge marks themselves, radiating in rings.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '59-linocut-two';
const PAPER = '#efe7d5';
const NAVY = '#1a2847';
const NAVY_LT = '#26396a'; // the same block on a dark page
const AMBER = '#e9a034';
const AMBER_DK = '#d98a1c';
const PENCIL = '#8d867a';
const f = (n) => Math.round(n * 10) / 10;

// ---- cut shapes ----------------------------------------------------------------
// A V-gouge mark: enters sharp at (x1,y1), widens, and stops blunt at (x2,y2).
function gouge(x1, y1, x2, y2, w) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy * w;
  const ny = ux * w;
  const mx = x1 + dx * 0.55;
  const my = y1 + dy * 0.55;
  return `M${f(x1)},${f(y1)}Q${f(mx + nx)},${f(my + ny)} ${f(x2 + nx * 0.6)},${f(y2 + ny * 0.6)}Q${f(x2 + ux * w * 0.7)},${f(y2 + uy * w * 0.7)} ${f(x2 - nx * 0.6)},${f(y2 - ny * 0.6)}Q${f(mx - nx)},${f(my - ny)} ${f(x1)},${f(y1)}Z`;
}

// A long knife line with tapered ends and an uneven width.
function cutLine(x0, y0, x1, y1, w, { seed = 1, step = 26, wobble = 0.5 } = {}) {
  const r = rng(seed);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / step));
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const top = [];
  const bot = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const end = Math.min(1, Math.min(t, 1 - t) * n * 0.9);
    const hw = (w / 2) * end * (0.75 + r() * 0.5);
    const off = (r() - 0.5) * 2 * wobble * end;
    const x = x0 + (x1 - x0) * t + nx * off;
    const y = y0 + (y1 - y0) * t + ny * off;
    top.push(`${f(x + nx * hw)},${f(y + ny * hw)}`);
    bot.push(`${f(x - nx * hw)},${f(y - ny * hw)}`);
  }
  return `M${top.join('L')}L${bot.reverse().join('L')}Z`;
}

// A faceted, hand-cut circle or ellipse.
function blob(cx, cy, rx, { ry = rx, n = 28, amp = 1.2, seed = 1 } = {}) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + ((r() - 0.5) * 2 * amp) / rx;
    pts.push(`${f(cx + Math.cos(a) * rx * k)},${f(cy + Math.sin(a) * ry * k)}`);
  }
  return `M${pts.join('L')}Z`;
}

// A rectangle whose edges were cut by hand along a ruler that slipped a little.
function roughRect(x, y, w, h, { seed = 1, amp = 1, step = 44 } = {}) {
  const r = rng(seed);
  const pts = [];
  const edge = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / step));
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const j = i === 0 ? 0 : (r() - 0.5) * 2 * amp;
      pts.push(`${f(x0 + (x1 - x0) * t + nx * j)},${f(y0 + (y1 - y0) * t + ny * j)}`);
    }
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
  return `M${pts.join('L')}Z`;
}

// Rings of gouge marks radiating from (cx, cy), thinning out with distance.
function rays(cx, cy, { r0, gap, rings, seed = 1, w0 = 2.9, w1 = 1.7, arc = 13, grow = 0.04, keep = () => true, fall = 1.5 }) {
  const r = rng(seed);
  let d = '';
  for (let k = 0; k < rings; k++) {
    const rad = r0 + k * gap * (1 + k * grow);
    const len = gap * 0.66 * (1 + k * 0.06);
    const n = Math.round((2 * Math.PI * rad) / (arc + k * 1.3));
    const off = r() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.05;
      const l = len * (0.72 + r() * 0.5);
      const rr = rad + (r() - 0.5) * gap * 0.22;
      const w = (w0 + ((w1 - w0) * k) / Math.max(1, rings - 1)) * (0.8 + r() * 0.4);
      const dice = r();
      if (dice > 1 - k / (rings + fall)) continue;
      const x1 = cx + Math.cos(a) * rr;
      const y1 = cy + Math.sin(a) * rr;
      const x2 = cx + Math.cos(a) * (rr + l);
      const y2 = cy + Math.sin(a) * (rr + l);
      if (!keep(x1, y1, x2, y2, k)) continue;
      d += gouge(x1, y1, x2, y2, w);
    }
  }
  return d;
}

// ---- hand-cut capitals -----------------------------------------------------------
// Each glyph: width, then polygons on a 10-unit cap height (the first is the
// outline, the rest are counters; drawn with the even-odd rule).
const G = {
  P: [8, [[0, 0], [6.5, 0], [8, 1.5], [8, 5], [6.5, 6.5], [3, 6.5], [3, 10], [0, 10]], [[3, 2.5], [5.2, 2.5], [5.2, 4], [3, 4]]],
  O: [8.5, [[2, 0], [6.5, 0], [8.5, 2], [8.5, 8], [6.5, 10], [2, 10], [0, 8], [0, 2]], [[3.4, 2.6], [5.1, 2.6], [5.5, 3], [5.5, 7], [5.1, 7.4], [3.4, 7.4], [3, 7], [3, 3]]],
  R: [8.7, [[0, 0], [6.5, 0], [8, 1.5], [8, 4.8], [6.9, 6], [8.7, 10], [5.4, 10], [3.9, 6.5], [3, 6.5], [3, 10], [0, 10]], [[3, 2.5], [5.2, 2.5], [5.2, 4], [3, 4]]],
  C: [8, [[2, 0], [6.3, 0], [8, 1.7], [8, 3.6], [5.2, 3.6], [5.2, 2.9], [4.9, 2.6], [3.4, 2.6], [3, 3], [3, 7], [3.4, 7.4], [4.9, 7.4], [5.2, 7.1], [5.2, 6.4], [8, 6.4], [8, 8.3], [6.3, 10], [2, 10], [0, 8], [0, 2]]],
  H: [8.5, [[0, 0], [3, 0], [3, 3.8], [5.5, 3.8], [5.5, 0], [8.5, 0], [8.5, 10], [5.5, 10], [5.5, 6.3], [3, 6.3], [3, 10], [0, 10]]],
  L: [6.8, [[0, 0], [3, 0], [3, 7.4], [6.8, 7.4], [6.8, 10], [0, 10]]],
  I: [3, [[0, 0], [3, 0], [3, 10], [0, 10]]],
  G: [8.5, [[2, 0], [6.5, 0], [8.5, 2], [8.5, 3.6], [5.5, 3.6], [5.5, 3], [5.1, 2.6], [3.4, 2.6], [3, 3], [3, 7], [3.4, 7.4], [5.1, 7.4], [5.5, 7], [5.5, 6.7], [4.4, 6.7], [4.4, 4.7], [8.5, 4.7], [8.5, 8], [6.5, 10], [2, 10], [0, 8], [0, 2]]],
  T: [8, [[0, 0], [8, 0], [8, 2.6], [5.5, 2.6], [5.5, 10], [2.5, 10], [2.5, 2.6], [0, 2.6]]],
  N: [8.8, [[0, 0], [3, 0], [5.8, 5.2], [5.8, 0], [8.8, 0], [8.8, 10], [5.8, 10], [3, 4.8], [3, 10], [0, 10]]],
  D: [8.5, [[0, 0], [6.3, 0], [8.5, 2.2], [8.5, 7.8], [6.3, 10], [0, 10]], [[3, 2.6], [5, 2.6], [5.5, 3.1], [5.5, 6.9], [5, 7.4], [3, 7.4]]],
  E: [7, [[0, 0], [7, 0], [7, 2.6], [3, 2.6], [3, 3.8], [6.2, 3.8], [6.2, 6.2], [3, 6.2], [3, 7.4], [7, 7.4], [7, 10], [0, 10]]],
  S: [8, [[1.8, 0], [8, 0], [8, 2.6], [3.3, 2.6], [3, 2.9], [3, 3.5], [3.3, 3.8], [6.2, 3.8], [8, 5.6], [8, 8.2], [6.2, 10], [0, 10], [0, 7.4], [4.7, 7.4], [5, 7.1], [5, 6.6], [4.7, 6.3], [1.8, 6.3], [0, 4.5], [0, 1.8]]],
  A: [9, [[3, 0], [6, 0], [9, 10], [5.9, 10], [5.5, 8.3], [3.5, 8.3], [3.1, 10], [0, 10]], [[4.5, 3.4], [5.05, 6.1], [3.95, 6.1]]],
  '.': [2.8, [[0, 7.2], [2.8, 7.2], [2.8, 10], [0, 10]]],
};
function measure(text, gap, space) {
  let w = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (ch === ' ') w += space;
    else {
      w += G[ch][0];
      if (i < chars.length - 1 && chars[i + 1] !== ' ') w += gap;
    }
  });
  return w;
}
// Path for a line of capitals, fitted to `width` (or set at `unit`).
function letters(text, x, y, { width, unit, gap = 0.9, space = 4, seed = 1, jitter = 0.1 } = {}) {
  const total = measure(text, gap, space);
  const u = unit ?? width / total;
  const r = rng(seed);
  let cx = x;
  let d = '';
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (ch === ' ') {
      cx += space * u;
      return;
    }
    const [w, ...polys] = G[ch];
    const lift = (r() - 0.5) * jitter * u * 1.6;
    for (const poly of polys) {
      d += 'M' + poly.map(([px, py]) => `${f(cx + (px + (r() - 0.5) * 2 * jitter) * u)},${f(y + lift + (py + (r() - 0.5) * 2 * jitter) * u)}`).join('L') + 'Z';
    }
    cx += w * u;
    if (i < chars.length - 1 && chars[i + 1] !== ' ') cx += gap * u;
  });
  return { d, unit: u, width: total * u, height: 10 * u };
}

// ---- the lantern, as marks in the navy block --------------------------------------
// Centre of the glass is (cx, cy). White keeps lino (prints navy), black cuts.
function lanternCuts(cx, cy, s, { detail = false } = {}) {
  const p = (pts) => pts.map(([x, y]) => `${f(cx + x * s)},${f(cy + y * s)}`).join(' ');
  const q = (x, y) => `${f(cx + x * s)},${f(cy + y * s)}`;
  const g = (x1, y1, x2, y2, w) => gouge(cx + x1 * s, cy + y1 * s, cx + x2 * s, cy + y2 * s, w * s);
  // two nicks on the cap, where the metal catches the light
  const nicks = detail ? `<path d="${g(-9, -37, -24, -25.5, 1.5)}${g(9, -37, 24, -25.5, 1.5)}" fill="#000"/>` : '';
  return `
<polygon points="${p([[-49, -42], [-39, -42], [-39, 4], [-49, 4]])}" fill="#fff"/>
<path d="M${q(-44, -24)}C${q(-44, -66)} ${q(-10, -72)} ${q(0, -55.5)}" fill="none" stroke="#fff" stroke-width="${f(5 * s)}"/>
<path d="M${q(-40, -12)}C${q(-24, -13)} ${q(-17, -27)} ${q(-25, -35)}" fill="none" stroke="#fff" stroke-width="${f(3.8 * s)}" stroke-linecap="round"/>
<circle cx="${f(cx)}" cy="${f(cy - 49 * s)}" r="${f(6.4 * s)}" fill="none" stroke="#fff" stroke-width="${f(4.2 * s)}"/>
<polygon points="${p([[-7, -42.5], [7, -42.5], [31, -25], [31, -16], [-31, -16], [-31, -25]])}" fill="#fff"/>
<polygon points="${p([[-25, -16], [25, -16], [19, 34], [-19, 34]])}" fill="#fff"/>
<polygon points="${p([[-23, 33], [23, 33], [23, 42], [-23, 42]])}" fill="#fff"/>
<polygon points="${p([[-13, 42], [13, 42], [0, 57]])}" fill="#fff"/>
<polygon points="${p([[-19.5, -10.5], [19.5, -10.5], [14.6, 28.5], [-14.6, 28.5]])}" fill="#000"/>
<polygon points="${p([[-2.8, 15], [2.8, 15], [2.8, 29], [-2.8, 29]])}" fill="#fff"/>
${nicks}`;
}
// Ridges the gouge left standing near the rim of a cleared area.
function chatter(cx, cy, r, { n = 9, seed = 1 } = {}) {
  const q = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 0 : Math.PI;
    const a = side + (q() - 0.5) * 2.0;
    const rr = r * (0.8 + q() * 0.13);
    const half = (3.5 + q() * 4) / rr;
    const x1 = cx + Math.cos(a - half) * rr;
    const y1 = cy + Math.sin(a - half) * rr;
    const x2 = cx + Math.cos(a + half) * rr;
    const y2 = cy + Math.sin(a + half) * rr;
    d += gouge(x1, y1, x2, y2, 0.9 + q() * 0.7);
  }
  return d;
}
function flame(cx, cy, s) {
  const q = (x, y) => `${f(cx + x * s)},${f(cy + y * s)}`;
  return `M${q(0, -15)}C${q(6, -7)} ${q(8, 2)} ${q(0, 10)}C${q(-8, 2)} ${q(-6, -7)} ${q(0, -15)}Z`;
}
function moth(x, y, s, rot) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" fill="#000"><path d="M-1,0L-11,-8L-13,2L-5,6ZM1,0L11,-8L13,2L5,6Z"/><path d="M-1.4,-5L1.4,-5L0.8,7L-0.8,7Z"/></g>`;
}

// ---- mark ------------------------------------------------------------------------
// A round block: the lantern in its cleared halo, one ring of gouges, a cut rim.
function markBody(id, { navy = NAVY } = {}) {
  const c = 100;
  const cy = 101;
  const ring = rays(c, cy, { r0: 67.5, gap: 20, rings: 1, seed: 11, w0: 3.6, w1: 3.6, arc: 17 });
  return `
<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
  <rect width="200" height="200" fill="#fff"/>
  <path d="${blob(c, cy, 62, { n: 30, amp: 1, seed: 4 })}" fill="#000"/>
  ${lanternCuts(c + 8, cy + 3, 0.9)}
  <path d="${ring}" fill="#000"/>
  <path d="${blob(c, c, 89.5, { n: 44, amp: 0.6, seed: 8 })}${blob(c, c, 86.6, { n: 44, amp: 0.6, seed: 9 })}" fill="#000" fill-rule="evenodd"/>
</mask>
<path d="${blob(c, c, 95, { n: 40, amp: 0.9, seed: 2 })}" fill="${PAPER}"/>
<path d="${blob(c + 1.6, cy + 1.2, 65, { n: 30, amp: 1, seed: 5 })}${flame(c + 9.6, cy + 6.8, 0.81)}" fill="${AMBER}" fill-rule="evenodd"/>
<path d="${blob(c, c, 95.6, { n: 40, amp: 0.9, seed: 2 })}" fill="${navy}" mask="url(#${id})"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('cut') });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('cut', { navy: NAVY_LT }) });

// ---- favicons, on the pixel grid ---------------------------------------------------
const PIX = { N: NAVY, A: AMBER, P: PAPER };
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
  '.NNNNNNNNNNNNNN.',
  'NNNNNNNNNNNNNPNN',
  'NNNNNNNNNNNNNNNN',
  'NNNAAAAAAANNNNPN',
  'NNNANNNNNANNNNNN',
  'NNNANNNAAAAANNNN',
  'NNNANNAAAAAAANNN',
  'NNNNNNNAPPPANNNN',
  'NNNNNNNAPPPANNPP',
  'NNNNNNNAPPPANNPP',
  'NNNNNNNAPPPANNNN',
  'NNNNNNNAAAAANNNN',
  'NNNNNNNNAAANNNNN',
  'NNPNNNNNNANNNNPN',
  'NNNNNPNNNNNNPNNN',
  '.NNNNNNNNNNNNNN.',
];
if (FAV16.some((r) => r.length !== 16)) throw new Error('favicon rows must be 16 wide');
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('N'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  const box = (x, y, w, h, ch) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, ch);
  };
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [31, 0], [30, 0], [31, 1], [0, 31], [1, 31], [0, 30], [31, 31], [30, 31], [31, 30]]) set(x, y, '.');
  // the lantern on its bracket, printed amber
  box(5, 6, 2, 11, 'A'); // wall plate
  box(5, 5, 14, 2, 'A'); // arm
  box(17, 7, 2, 2, 'A'); // drop
  box(15, 9, 6, 1, 'A'); // cap
  box(12, 10, 12, 2, 'A');
  box(13, 12, 10, 10, 'A'); // frame
  box(12, 22, 12, 1, 'A'); // base
  box(15, 23, 6, 1, 'A');
  box(17, 24, 2, 1, 'A');
  box(15, 14, 6, 6, 'P'); // glass
  box(17, 16, 2, 4, 'A'); // flame
  set(17, 15, 'A');
  // gouges, where the paper shows
  box(27, 15, 3, 2, 'P');
  box(17, 27, 2, 3, 'P');
  box(8, 20, 2, 2, 'P');
  for (let k = 0; k < 3; k++) {
    box(25 + k, 5 - k + 2, 2, 1, 'P');
    box(25 + k, 24 + k, 2, 1, 'P');
    box(8 - k, 24 + k, 2, 1, 'P');
  }
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon ------------------------------------------------------------------------
function iconBody() {
  const c = 256;
  const cy = 262;
  const keep = (x1, y1, x2, y2) => [x1, x2].every((x) => x > 44 && x < 468) && [y1, y2].every((y) => y > 44 && y < 468);
  const cuts = rays(c, cy, { r0: 172, gap: 44, rings: 3, seed: 21, w0: 6.4, w1: 4.6, arc: 30, keep, fall: 6 });
  const rr = (x, y, w, h, r) => `M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}V${y + r}Q${x},${y} ${x + r},${y}Z`;
  return `
<mask id="icut" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
  <rect width="512" height="512" fill="#fff"/>
  <path d="${blob(c, cy, 152, { n: 36, amp: 2.4, seed: 4 })}" fill="#000"/>
  ${lanternCuts(c + 20, cy + 6, 2.2, { detail: true })}
  <path d="${chatter(c, cy, 152, { n: 8, seed: 7 })}" fill="#fff"/>
  <path d="${cuts}" fill="#000"/>
  <path d="${rr(24, 24, 464, 464, 92)}${rr(31, 31, 450, 450, 86)}" fill="#000" fill-rule="evenodd"/>
</mask>
<rect width="512" height="512" rx="112" fill="${PAPER}"/>
<path d="${blob(c + 5, cy + 4, 214, { n: 40, amp: 3, seed: 5 })}${flame(c + 25, cy + 18, 1.98)}" fill="${AMBER}" fill-rule="evenodd"/>
<rect width="512" height="512" rx="112" fill="${NAVY}" mask="url(#icut)"/>`;
}
const iconSvg = svg({ w: 512, h: 512, vb: '0 0 512 512', body: iconBody() });

// ---- logo ------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? PAPER : NAVY;
  const U = 4.6;
  const porch = letters('PORCH', 208, 54, { unit: U, seed: 31, jitter: 0.09 });
  const lx = 208 + porch.width + U * 0.9;
  const light = letters('LIGHT', lx, 54, { unit: U, seed: 32, jitter: 0.09 });
  const full = lx + light.width - 208;
  const tag = letters('NOTHING HIDES ON A LIT PORCH.', 208, 122, { width: full, seed: 33, jitter: 0.05 });
  return `
${nest({ x: 14, y: 14, w: 172, h: 172, vb: '0 0 200 200', body: markBody('lcut', { navy: dark ? NAVY_LT : NAVY }) })}
<path d="${porch.d}" fill="${ink}" fill-rule="evenodd"/>
<path d="${light.d}" fill="${dark ? AMBER : AMBER_DK}" fill-rule="evenodd"/>
<path d="${tag.d}" fill="${ink}" fill-rule="evenodd"/>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero ------------------------------------------------------------------------
function hero() {
  const B = { x: 48, y: 46, w: 1184, h: 540 };
  const L = { x: 412, y: 240 };
  const D = { x: 102, y: 206, w: 150, h: 340 };
  const FLOOR = D.y + D.h;
  const OFF = [4, 3];
  const moths = [
    [512, 318, 1.1, 140],
  ];

  // --- the amber block ---
  const amber = `
<clipPath id="sheet"><rect x="${B.x + 3}" y="${B.y + 3}" width="${B.w - 6}" height="${B.h - 6}"/></clipPath>
<g clip-path="url(#sheet)"><g transform="translate(${OFF[0]} ${OFF[1]})" fill="${AMBER}">
  <path d="${blob(L.x, L.y, 136, { n: 44, amp: 2.2, seed: 3 })}${flame(L.x + 11, L.y + 8, 1.2)}" fill-rule="evenodd"/>
  <path d="${roughRect(D.x, D.y, D.w, D.h + 4, { seed: 5, amp: 0.9 })}"/>
  <path d="${blob(L.x - 6, FLOOR + 16, 170, { ry: 30, n: 30, amp: 2, seed: 6 })}"/>
  <path d="${roughRect(606, 286, 582, 152, { seed: 7, amp: 1.1 })}"/>
</g></g>`;

  // --- what is cut out of the navy block ---
  const keep = (x1, y1, x2, y2) => {
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      if (x > 572 || x < B.x + 26 || y < B.y + 26 || y > FLOOR - 12) return false;
      if (x < D.x + D.w + 26 && y > D.y - 30) return false;
      for (const [mx, my] of moths) if (Math.hypot(x - mx, y - my) < 21) return false;
    }
    return true;
  };
  const light = rays(L.x, L.y, { r0: 102, gap: 27, rings: 7, seed: 17, keep, fall: 7, w0: 3.2, w1: 2.2 });

  // door: cut clear (amber shows), with the panels left standing
  const px = (x) => D.x + x;
  const py = (y) => D.y + y;
  const panel = (x, y, w, h, seed) => `<path d="${roughRect(px(x), py(y), w, h, { seed, amp: 0.7, step: 30 })}" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="miter"/>`;
  const door = `
<path d="${roughRect(D.x, D.y, D.w, D.h + 1, { seed: 9, amp: 0.8 })}" fill="#000"/>
<path d="${roughRect(px(20), py(20), 52, 30, { seed: 10, amp: 0.6, step: 26 })}${roughRect(px(78), py(20), 52, 30, { seed: 15, amp: 0.6, step: 26 })}${roughRect(px(20), py(56), 52, 30, { seed: 16, amp: 0.6, step: 26 })}${roughRect(px(78), py(56), 52, 30, { seed: 17, amp: 0.6, step: 26 })}" fill="#fff"/>
${panel(20, 108, 46, 112, 11)}${panel(84, 108, 46, 112, 12)}${panel(20, 242, 46, 76, 13)}${panel(84, 242, 46, 76, 14)}
<circle cx="${px(138.5)}" cy="${py(231)}" r="5.6" fill="#fff"/>`;
  // casing: three knife lines round the door
  const casing = [
    cutLine(D.x - 15, FLOOR - 2, D.x - 15, D.y - 20, 3.4, { seed: 21 }),
    cutLine(D.x - 22, D.y - 15, D.x + D.w + 22, D.y - 15, 3.4, { seed: 22 }),
    cutLine(D.x + D.w + 15, D.y - 20, D.x + D.w + 15, FLOOR - 2, 3.4, { seed: 23 }),
  ].join('');
  // floor: board edges, lit where the pool falls
  const floor = [
    cutLine(B.x + 22, FLOOR + 2, 578, FLOOR + 2, 4, { seed: 31, step: 34 }),
    cutLine(B.x + 40, FLOOR + 15, 250, FLOOR + 15, 2.6, { seed: 32 }),
    cutLine(272, FLOOR + 15, 470, FLOOR + 15, 3, { seed: 33 }),
    cutLine(492, FLOOR + 15, 566, FLOOR + 15, 2.4, { seed: 34 }),
    cutLine(300, FLOOR + 26, 430, FLOOR + 26, 2.4, { seed: 35 }),
    cutLine(120, FLOOR + 26, 226, FLOOR + 26, 2, { seed: 36 }),
  ].join('');

  // frame: four knife lines that overrun at the corners
  const fr = 13;
  const frame = [
    cutLine(B.x + 5, B.y + fr, B.x + B.w - 5, B.y + fr, 2.6, { seed: 41, step: 50, wobble: 0.35 }),
    cutLine(B.x + B.w - fr, B.y + 5, B.x + B.w - fr, B.y + B.h - 5, 2.6, { seed: 42, step: 50, wobble: 0.35 }),
    cutLine(B.x + B.w - 5, B.y + B.h - fr, B.x + 5, B.y + B.h - fr, 2.6, { seed: 43, step: 50, wobble: 0.35 }),
    cutLine(B.x + fr, B.y + B.h - 5, B.x + fr, B.y + 5, 2.6, { seed: 44, step: 50, wobble: 0.35 }),
  ].join('');

  // lettering, cut straight into the block
  const TX = 606;
  const TW = 580;
  const porch = letters('PORCH', TX, 134, { width: TW, seed: 51, jitter: 0.085 });
  const lightY = 134 + porch.height + 24;
  const lightW = letters('LIGHT', TX, lightY, { width: TW, seed: 52, jitter: 0.075 });
  const tagY = lightY + lightW.height + 40;
  const tag = letters('NOTHING HIDES ON A LIT PORCH.', TX, tagY, { width: TW, seed: 53, jitter: 0.05 });

  // where the ink did not quite take
  const r = rng(77);
  let specks = '';
  for (let i = 0; i < 560; i++) {
    const x = B.x + 4 + r() * (B.w - 8);
    const y = B.y + 4 + r() * (B.h - 8);
    const s = 0.5 + r() * r() * 1.5;
    specks += `<rect x="${f(x)}" y="${f(y)}" width="${f(s * (0.8 + r()))}" height="${f(s)}" fill="#000" opacity="${f(0.35 + r() * 0.5)}" transform="rotate(${Math.round(r() * 90)} ${f(x)} ${f(y)})"/>`;
  }

  const mask = `
<mask id="hcut" maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="640">
  <rect width="1280" height="640" fill="#fff"/>
  <path d="${blob(L.x, L.y, 88, { n: 34, amp: 1.5, seed: 2 })}" fill="#000"/>
  ${lanternCuts(L.x + 11, L.y + 3, 1.18, { detail: true })}
  <path d="${chatter(L.x, L.y, 88, { n: 8, seed: 6 })}" fill="#fff"/>
  <path d="${light}" fill="#000"/>
  ${moths.map((m) => moth(...m)).join('')}
  ${door}
  <path d="${casing}${floor}${frame}" fill="#000"/>
  <path d="${porch.d}${lightW.d}${tag.d}" fill="#000" fill-rule="evenodd"/>
  ${specks}
</mask>`;

  return `
<rect width="1280" height="640" fill="${PAPER}"/>
${mask}
${amber}
<path d="${roughRect(B.x, B.y, B.w, B.h, { seed: 1, amp: 1.2, step: 58 })}" fill="${NAVY}" mask="url(#hcut)"/>
<text x="${B.x + 4}" y="616" font-family="Bradley Hand" font-weight="700" font-size="17" fill="${PENCIL}">12/50</text>
<text x="${B.x + B.w - 4}" y="616" text-anchor="end" font-family="Bradley Hand" font-weight="700" font-size="17" fill="${PENCIL}">two blocks, navy over amber</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 59 Linocut II

A two-block linocut. The navy block is one solid night with everything cut out of it: a wall lantern on its iron bracket in a cleared halo, the front door beside it, and the name in chunky hand-cut capitals. The light is the gouge marks themselves, ring after ring of them thinning out with distance. The amber block prints first and a few pixels off register, so the marks nearest the lantern, the door and the word LIGHT show amber and the rest show paper. The mark is the lantern on its bracket, large in its round.
Palette: paper #efe7d5, navy #1a2847, amber #e9a034 (deeper #d98a1c for type on a light page), pencil #8d867a.
Type: capitals drawn for this concept as faceted polygons, as if cut with a knife, for the name and the tagline; the edition line is Bradley Hand.
Tagline: Nothing hides on a lit porch.
From: 49 Linocut
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'mark-dark.svg': markDarkSvg,
  'logo.svg': logoSvg,
  'logo-dark.svg': logoDarkSvg,
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
