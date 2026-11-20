// 12 Papercut night: layered cut paper, inky teal stepping lighter toward
// the back, the porch light and its pool cut from warm amber paper.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '12-papercut-night';
const f = (n) => Math.round(n * 10) / 10;

const P = {
  sky: '#2b5961',
  halo2: '#30616a',
  halo1: '#376b73',
  far: '#22484f',
  farTree: '#1c3f47',
  mid: '#163540',
  midTree: '#12303a',
  near: '#0f2a33',
  fore: '#0a1f27',
  front: '#06161c',
  house: '#0c242d',
  pane: '#1f454d',
  cream: '#f3e5c3',
  amber1: '#f7c86a',
  amber2: '#e39b4b',
  amber3: '#8f6a43',
  amber4: '#5a5442',
  ink: '#0b2129',
  porch: '#1d424c',
  doorInk: '#05131a',
};

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
function ridge(anchors, { step = 34, jit = 2.2, seed = 1 } = {}) {
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
  const first = pts[0];
  const last = pts[pts.length - 1];
  return smooth(pts) + `L${f(last[0])} ${bottom}L${f(first[0])} ${bottom}Z`;
}

// A pine cut with straight knife strokes: tiers of drooping branches.
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
  const left = right
    .map(([px, py], i) => [x - (px - x) * (0.94 + 0.12 * rng(seed + i)()), py + (i % 2 ? 1 : -1) * h * 0.01])
    .reverse();
  const pts = [[x + (r() - 0.5) * 1.5, base - h], ...right, ...left];
  return 'M' + pts.map(([a, b]) => `${f(a)} ${f(b)}`).join('L') + 'Z';
}

// A round, hand-cut blob.
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

// Sunburst of short cut wedges around a point.
function rays(cx, cy, r0, r1, n, width, start = 0, sweep = Math.PI * 2) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = start + (sweep * (i + 0.5)) / n;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = -sa * width;
    const py = ca * width;
    d += `M${f(cx + ca * r0 - px / 3)} ${f(cy + sa * r0 - py / 3)}L${f(cx + ca * r1 - px)} ${f(cy + sa * r1 - py)}L${f(cx + ca * r1 + px)} ${f(cy + sa * r1 + py)}L${f(cx + ca * r0 + px / 3)} ${f(cy + sa * r0 + py / 3)}Z`;
  }
  return d;
}

// Grass edge: a ridge with cut blades sticking up.
function grassEdge(x0, x1, y, bottom, seed, blade = 14) {
  const r = rng(seed);
  const pts = [[x0, y]];
  let x = x0;
  const by = (x) => y + Math.sin(x / 130 + seed) * blade * 0.35;
  while (x < x1) {
    if (r() < 0.3) {
      // a tuft of three blades leaning slightly
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

const SHADOW = (id, dy, sd, op) =>
  `<filter id="${id}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#020b0f" flood-opacity="${op}"/></filter>`;
const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/></filter>`;

// The house on its hill, with the porch lit. Returns layered groups.
function house(cx, base, s, seed) {
  const W = 210 * s;
  const H = 100 * s;
  const x0 = cx - W / 2;
  const x1 = cx + W / 2;
  const top = base - H;
  const apex = top - 66 * s;
  const eave = 12 * s;
  const body =
    `M${f(x0)} ${f(base)}L${f(x0)} ${f(top)}L${f(x0 - eave)} ${f(top)}L${f(cx)} ${f(apex)}L${f(x1 + eave)} ${f(top)}L${f(x1)} ${f(top)}L${f(x1)} ${f(base)}Z` +
    // chimney
    `M${f(cx + 52 * s)} ${f(apex + 30 * s)}L${f(cx + 52 * s)} ${f(apex + 6 * s)}L${f(cx + 74 * s)} ${f(apex + 6 * s)}L${f(cx + 74 * s)} ${f(apex + 46 * s)}Z` +
    `M${f(cx + 49 * s)} ${f(apex + 9 * s)}L${f(cx + 49 * s)} ${f(apex + 3 * s)}L${f(cx + 77 * s)} ${f(apex + 3 * s)}L${f(cx + 77 * s)} ${f(apex + 9 * s)}Z`;
  // porch roof (a small gable on two posts), cut from a lighter paper
  const pr = 58 * s;
  const porch =
    `M${f(cx - pr - 7 * s)} ${f(base - 54 * s)}L${f(cx)} ${f(base - 82 * s)}L${f(cx + pr + 7 * s)} ${f(base - 54 * s)}L${f(cx + pr + 7 * s)} ${f(base - 48 * s)}L${f(cx - pr - 7 * s)} ${f(base - 48 * s)}Z` +
    `M${f(cx - pr)} ${f(base - 48 * s)}h${f(5 * s)}V${f(base)}h${f(-5 * s)}Z` +
    `M${f(cx + pr - 5 * s)} ${f(base - 48 * s)}h${f(5 * s)}V${f(base)}h${f(-5 * s)}Z`;
  // windows: dark panes with muntins left in the wall
  const win = (wx, wy, ww, wh) => {
    const g = 2.2 * s;
    const pw = (ww - g) / 2;
    const ph = (wh - g) / 2;
    return [
      [wx, wy],
      [wx + pw + g, wy],
      [wx, wy + ph + g],
      [wx + pw + g, wy + ph + g],
    ]
      .map(([a, b]) => `M${f(a)} ${f(b)}h${f(pw)}v${f(ph)}h${f(-pw)}Z`)
      .join('');
  };
  const panes =
    win(x0 + 16 * s, top + 22 * s, 28 * s, 32 * s) +
    win(x1 - 44 * s, top + 22 * s, 28 * s, 32 * s) +
    // round gable window
    `M${f(cx - 11 * s)} ${f(apex + 40 * s)}a${f(11 * s)} ${f(11 * s)} 0 1 0 ${f(22 * s)} 0a${f(11 * s)} ${f(11 * s)} 0 1 0 ${f(-22 * s)} 0Z`;
  // door with a lit fanlight; the lamp on the wall to its right, under the porch roof
  const dw = 30 * s;
  const dh = 44 * s;
  const door = `M${f(cx - dw / 2)} ${f(base)}V${f(base - dh)}H${f(cx + dw / 2)}V${f(base)}Z`;
  const fan = `M${f(cx - dw / 2 + 4 * s)} ${f(base - dh + 9 * s)}a${f(dw / 2 - 4 * s)} ${f(6 * s)} 0 0 1 ${f(dw - 8 * s)} 0Z`;
  const lampX = cx + 33 * s;
  const lampY = base - 33 * s;
  const lampFrame =
    `M${f(lampX - 6 * s)} ${f(lampY - 8 * s)}L${f(lampX)} ${f(lampY - 13 * s)}L${f(lampX + 6 * s)} ${f(lampY - 8 * s)}Z` +
    `M${f(lampX - 4.6 * s)} ${f(lampY - 8 * s)}h${f(9.2 * s)}l${f(-1.4 * s)} ${f(12 * s)}h${f(-6.4 * s)}Z` +
    `M${f(lampX - 3 * s)} ${f(lampY + 4 * s)}h${f(6 * s)}v${f(2 * s)}h${f(-6 * s)}Z`;
  const lamp = `M${f(lampX - 3.2 * s)} ${f(lampY - 6.4 * s)}h${f(6.4 * s)}l${f(-1.1 * s)} ${f(9.4 * s)}h${f(-4.2 * s)}Z`;
  return { body, porch, panes, door, fan, lamp, lampFrame, lampX, lampY, x0, x1, top, apex };
}

// ---- hero -----------------------------------------------------------------
function hero() {
  const W = 1280;
  const H = 640;
  const r = rng(12);
  const defs = SHADOW('s', 4, 2.4, 0.55) + SHADOW('t', 3, 1.6, 0.5) + GRAIN;
  let b = `<rect width="${W}" height="${H}" fill="${P.sky}"/>`;

  // moon with cut halo rings
  const MX = 1084;
  const MY = 128;
  b += `<g filter="url(#s)"><circle fill="${P.halo2}" cx="${MX}" cy="${MY}" r="116"/></g>`;
  b += `<g filter="url(#s)"><circle fill="${P.halo1}" cx="${MX}" cy="${MY}" r="80"/></g>`;
  b += `<g filter="url(#s)"><circle fill="${P.cream}" cx="${MX}" cy="${MY}" r="44"/></g>`;
  // stars
  const stars = [
    [560, 92, 7], [668, 168, 5], [742, 70, 6], [880, 120, 4.5], [610, 248, 4], [930, 210, 5],
    [1214, 262, 5], [1236, 70, 4], [500, 196, 4], [818, 46, 4.5], [455, 60, 5.5], [990, 272, 3.5],
  ];
  b += `<g filter="url(#t)" fill="${P.cream}">${stars.map(([x, y, s]) => `<path d="${star(x, y, s)}"/>`).join('')}</g>`;

  // far hills and their pines
  const far = hill([[-20, 392], [180, 352], [420, 384], [640, 340], [860, 372], [1080, 330], [1300, 362]], H, { seed: 3, jit: 2 });
  let farTrees = '';
  for (const [x, h] of [[150, 46], [176, 34], [198, 40], [620, 42], [646, 54], [672, 36], [1040, 40], [1066, 52], [1122, 38], [1240, 44]]) {
    const y = 352 + Math.sin(x / 110) * 14 + (x > 900 ? -18 : 0);
    farTrees += `<path d="${pine(x, y + 8, h, h * 0.5, x)}"/>`;
  }
  b += `<g filter="url(#s)" fill="${P.far}"><path d="${far}"/>${farTrees}</g>`;

  // the house hill
  const CX = 902;
  const BASE = 394;
  const mid = hill([[340, 480], [560, 450], [760, 404], [900, 394], [1040, 398], [1180, 420], [1300, 412]], H, { seed: 5, jit: 1.6 });
  const hs = house(CX, BASE, 1.08, 5);
  let midTrees = '';
  for (const [x, y, h] of [[700, 418, 92], [736, 410, 70], [1098, 404, 104], [1140, 414, 66]]) midTrees += `<path d="${pine(x, y + 6, h, h * 0.46, x + 1)}"/>`;
  midTrees += `<path d="${blob(1192, 372, 34, 40, 9)}"/><path d="M1190 404h5v14h-5Z"/>`;
  b += `<g filter="url(#s)" fill="${P.mid}"><path d="${mid}"/>${midTrees}</g>`;

  // light on the ground: stepped amber paper, then the path down the hill
  b += `<g filter="url(#t)">`;
  b += `<path fill="${P.amber4}" d="${blob(CX - 6, BASE + 16, 94, 26, 41, 18, 0.015)}"/>`;
  b += `<path fill="${P.amber3}" d="${blob(CX - 3, BASE + 12, 66, 18, 42, 16, 0.015)}"/>`;
  b += `<path fill="${P.amber2}" d="${blob(CX + 1, BASE + 8, 46, 11, 43, 14, 0.015)}"/>`;
  b += `</g>`;
  // a garden path, widening as it comes down the hill toward us
  const L = [[CX - 12, BASE + 14], [CX - 46, BASE + 34], [CX - 128, BASE + 62], [CX - 226, BASE + 102], [CX - 290, BASE + 140]];
  const R = [[CX - 238, BASE + 146], [CX - 176, BASE + 104], [CX - 92, BASE + 64], [CX - 20, BASE + 34], [CX + 10, BASE + 14]];
  const pathD = smooth(L) + 'L' + smooth(R).slice(1) + 'Z';
  b += `<g filter="url(#t)"><path fill="${P.amber4}" d="${pathD}"/></g>`;

  // house
  b += `<g filter="url(#s)" fill="${P.house}"><path d="${hs.body}"/></g>`;
  b += `<path fill="${P.pane}" d="${hs.panes}"/>`;
  // rays around the porch lamp, cut from pale amber, behind the porch layer
  b += `<g filter="url(#t)"><circle fill="${P.amber3}" cx="${hs.lampX}" cy="${hs.lampY - 2}" r="24"/></g>`;
  b += `<g filter="url(#t)"><circle fill="${P.amber2}" cx="${hs.lampX}" cy="${hs.lampY - 2}" r="15"/></g>`;
  b += `<g filter="url(#t)" fill="${P.doorInk}"><path d="${hs.door}"/></g>`;
  b += `<path fill="${P.amber1}" d="${hs.fan}"/>`;
  // porch floor and steps, lit
  b += `<g filter="url(#t)"><path fill="${P.amber2}" d="M${CX - 70} ${BASE - 2}h140v6h-140Z"/><path fill="${P.amber1}" d="M${CX - 30} ${BASE + 4}h60v6h-60Z"/></g>`;
  b += `<g filter="url(#t)" fill="${P.porch}"><path d="${hs.porch}"/></g>`;
  b += `<g filter="url(#t)"><path fill="${P.ink}" d="${hs.lampFrame}"/></g><path fill="${P.amber1}" d="${hs.lamp}"/>`;

  // near hills
  const near = hill([[-20, 488], [170, 452], [380, 470], [560, 520], [760, 506], [980, 520], [1140, 490], [1300, 500]], H, { seed: 8, jit: 2 });
  let nearTrees = '';
  for (const [x, y, h] of [[1188, 494, 150], [1236, 500, 104], [262, 466, 84], [292, 470, 60]]) nearTrees += `<path d="${pine(x, y, h, h * 0.44, x + 7)}"/>`;
  b += `<g filter="url(#s)" fill="${P.near}"><path d="${near}"/>${nearTrees}</g>`;

  // foreground grass
  b += `<g filter="url(#s)" fill="${P.fore}"><path d="${grassEdge(-10, 1290, 574, H, 31, 22)}"/></g>`;
  b += `<g filter="url(#s)" fill="${P.front}"><path d="${grassEdge(-10, 1290, 614, H, 33, 26)}"/></g>`;

  // type, cut from cream paper
  b += `<g filter="url(#t)" fill="${P.cream}" font-family="Avenir Next" font-weight="600">`;
  b += `<text x="92" y="236" font-size="108" letter-spacing="4">Porchlight</text>`;
  b += `<text x="96" y="296" font-size="27" font-weight="500" letter-spacing="1.6" fill="#d9e4da">A light left on over your own front door.</text>`;
  b += `</g>`;

  b += `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.9"/>`;
  return svg({ w: W, h: H, defs, body: b });
}

// ---- mark: an arch-shaped window into the cut-paper night ---------------------
function archScene(id) {
  // 256 x 256 space; arch x 40..216, top y 24, bottom 240
  const defs =
    SHADOW(`${id}s`, 3, 1.6, 0.55) +
    `<clipPath id="${id}c"><path d="M40 240V112a88 88 0 0 1 176 0V240Z"/></clipPath>` +
    `<filter id="${id}in" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>`;
  let b = `<g clip-path="url(#${id}c)">`;
  b += `<rect x="30" y="14" width="200" height="236" fill="${P.sky}"/>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.halo1}" cx="168" cy="74" r="36"/></g>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.cream}" cx="168" cy="74" r="19"/></g>`;
  b += `<g filter="url(#${id}s)" fill="${P.cream}"><path d="${star(86, 70, 6)}"/><path d="${star(112, 44, 4)}"/></g>`;
  b += `<g filter="url(#${id}s)" fill="${P.far}"><path d="${hill([[30, 170], [96, 150], [160, 168], [230, 146]], 260, { seed: 2, step: 26, jit: 1.2 })}"/><path d="${pine(64, 160, 40, 20, 6)}"/><path d="${pine(196, 152, 46, 22, 7)}"/></g>`;
  const hs = house(128, 202, 0.52, 3);
  b += `<g filter="url(#${id}s)" fill="${P.mid}"><path d="${hill([[30, 214], [90, 204], [128, 200], [180, 204], [230, 196]], 260, { seed: 4, step: 24, jit: 0.8 })}"/></g>`;
  b += `<g filter="url(#${id}s)"><path fill="${P.amber3}" d="${blob(130, 205, 62, 9, 8, 14, 0.02)}"/><path fill="${P.amber2}" d="${blob(130, 204, 34, 5, 9, 12, 0.02)}"/></g>`;
  b += `<g filter="url(#${id}s)" fill="${P.house}"><path d="${hs.body}"/></g>`;
  b += `<path fill="${P.pane}" d="${hs.panes}"/>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.amber3}" cx="${hs.lampX}" cy="${hs.lampY - 1}" r="14"/></g>`;
  b += `<g filter="url(#${id}s)"><circle fill="${P.amber2}" cx="${hs.lampX}" cy="${hs.lampY - 1}" r="8.5"/></g>`;
  b += `<g filter="url(#${id}s)" fill="${P.doorInk}"><path d="${hs.door}"/></g><path fill="${P.amber1}" d="${hs.fan}"/>`;
  b += `<path fill="${P.amber2}" d="M${128 - 34} 199h68v4h-68Z"/>`;
  b += `<g filter="url(#${id}s)" fill="${P.porch}"><path d="${hs.porch}"/></g>`;
  b += `<path fill="${P.ink}" d="${hs.lampFrame}"/><path fill="${P.amber1}" d="${hs.lamp}"/>`;
  b += `<g filter="url(#${id}s)" fill="${P.near}"><path d="${grassEdge(30, 232, 226, 260, 5, 9)}"/></g>`;
  // the frame's shadow falling inside the arch
  b += `<path d="M40 240V112a88 88 0 0 1 176 0V240" fill="none" stroke="#020b0f" stroke-opacity="0.6" stroke-width="10" filter="url(#${id}in)"/>`;
  b += `</g>`;
  return { defs, body: b };
}

function markSvg() {
  const a = archScene('m');
  const body = a.body + `<path d="M40 240V112a88 88 0 0 1 176 0V240Z" fill="none" stroke="${P.ink}" stroke-width="3"/>`;
  return svg({ w: 512, h: 512, vb: '0 0 256 256', defs: a.defs, body });
}

function iconSvg() {
  // a cut-paper tile with the arch cut through it
  const a = archScene('i');
  const defs = a.defs + SHADOW('fs', 5, 3, 0.6) + GRAIN;
  let b = `<rect x="8" y="8" width="240" height="240" rx="52" fill="${P.sky}"/>`;
  b += a.body;
  b += `<g filter="url(#fs)"><path fill-rule="evenodd" fill="${P.fore}" d="M60 8H196A52 52 0 0 1 248 60V196A52 52 0 0 1 196 248H60A52 52 0 0 1 8 196V60A52 52 0 0 1 60 8ZM40 240V112a88 88 0 0 1 176 0V240Z"/></g>`;
  // a thin lip of lighter paper inside the opening
  b += `<path d="M40 240V112a88 88 0 0 1 176 0V240" fill="none" stroke="${P.near}" stroke-width="2"/>`;
  b += `<rect x="8" y="8" width="240" height="240" rx="52" filter="url(#grain)" opacity="0.8"/>`;
  return svg({ w: 512, h: 512, vb: '0 0 256 256', defs, body: b });
}

function faviconSvg() {
  // 16-unit grid; whole-pixel shapes
  const b = `
<rect x="0" y="0" width="16" height="16" rx="3" fill="${P.sky}"/>
<rect x="11" y="2" width="2" height="2" fill="${P.cream}"/>
<path fill="${P.far}" d="M0 11L4 9L9 10L16 8V16H0Z"/>
<path fill="${P.ink}" d="M3 14V8H2L8 3L14 8H13V14Z"/>
<rect x="7" y="10" width="2" height="4" fill="${P.amber1}"/>
<rect x="10" y="9" width="1" height="1" fill="${P.amber1}"/>
<rect x="0" y="14" width="16" height="2" fill="${P.amber2}"/>
<rect x="0" y="15" width="16" height="1" fill="${P.fore}"/>
<rect x="5" y="14" width="6" height="1" fill="${P.amber1}"/>`;
  return svg({ w: 16, h: 16, vb: '0 0 16 16', body: b });
}

function logoSvg() {
  const a = archScene('l');
  let b = nest({ x: 22, y: 12, w: 176, h: 176, vb: '0 0 256 256', body: `<defs>${a.defs}</defs>` + a.body + `<path d="M40 240V112a88 88 0 0 1 176 0V240Z" fill="none" stroke="${P.ink}" stroke-width="3"/>` });
  b += `<text x="208" y="134" font-family="Avenir Next" font-weight="600" font-size="80" letter-spacing="2.5" fill="${P.ink}">Porchlight</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 12 Papercut night

Layered cut paper: teal hills stepping lighter toward the moon, a house on the middle hill, and the porch light, the rings of light around it, the lit steps and the pool on the ground cut from warm amber paper. Each layer is flat with a tight shadow onto the one behind; edges are hand-cut, slightly uneven.
Palette: sky #2b5961, hills #22484f / #163540 / #0f2a33 / #0a1f27, house #0c242d, amber #f7c86a / #e39b4b / #a8693a, cream #f3e5c3.
Type: Avenir Next Demi Bold, tracked +2.5 to +4; tagline Avenir Next Medium.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(),
  'logo.svg': logoSvg(),
  'favicon.svg': faviconSvg(),
  'icon.svg': iconSvg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
