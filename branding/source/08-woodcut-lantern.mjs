// 08 Woodcut lantern: a wall lantern on a scrolled iron bracket, cut like a
// wood engraving. The wall is horizontal hatching whose lines thin to nothing
// where the lantern lights it; the light is the paper showing through.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '08-woodcut-lantern';
const PAPER = '#f2e8d2';
const PAPER2 = '#e9dcbf';
const INK = '#241a13';
const VERM = '#c43d26';

const f = (n) => Math.round(n * 10) / 10;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// A horizontal engraved line whose width follows w(x); broken where w ~ 0.
function swellLine(x0, x1, y, w, { step = 4, wobble = 0.5, seed = 1 } = {}) {
  const r = rng(seed);
  const ph = r() * 6.28;
  const ph2 = r() * 6.28;
  const segs = [];
  let cur = [];
  for (let x = x0; x <= x1 + 0.01; x += step) {
    const ww = w(x);
    const yy = y + wobble * Math.sin(x / 41 + ph) + wobble * 0.5 * Math.sin(x / 13 + ph2);
    if (ww > 0.18) cur.push([x, yy, ww]);
    else if (cur.length) {
      cur.push([x, yy, 0]);
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs
    .filter((s) => s.length > 1)
    .map((s) => {
      const top = s.map(([x, y, ww]) => `${f(x)},${f(y - ww / 2)}`);
      const bot = s.map(([x, y, ww]) => `${f(x)},${f(y + ww / 2)}`).reverse();
      return `M${top.join('L')}L${bot.join('L')}Z`;
    })
    .join('');
}

// A tapered stroke from a to b, widest in the middle.
function taper(x1, y1, x2, y2, w) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  return `M${f(x1)},${f(y1)}Q${f(mx + nx)},${f(my + ny)} ${f(x2)},${f(y2)}Q${f(mx - nx)},${f(my - ny)} ${f(x1)},${f(y1)}Z`;
}

// A ray that starts thin near the light and swells, then ends sharp.
function ray(cx, cy, ang, r0, r1, w) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const nx = -s * w;
  const ny = c * w;
  const a = [cx + c * r0, cy + s * r0];
  const b = [cx + c * r1, cy + s * r1];
  const m = [cx + c * (r0 * 0.35 + r1 * 0.65), cy + s * (r0 * 0.35 + r1 * 0.65)];
  return `M${f(a[0])},${f(a[1])}Q${f(m[0] + nx)},${f(m[1] + ny)} ${f(b[0])},${f(b[1])}Q${f(m[0] - nx)},${f(m[1] - ny)} ${f(a[0])},${f(a[1])}Z`;
}

function spiral(cx, cy, r0, a0, turns, dir = 1, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = r0 * (1 - 0.78 * t);
    const a = a0 + dir * t * turns * Math.PI * 2;
    pts.push(`${f(cx + Math.cos(a) * r)},${f(cy + Math.sin(a) * r)}`);
  }
  return 'M' + pts.join('L');
}

// The lantern, origin at the hanging point, about 148 units tall.
// Glass centre is at (0, 80).
function lantern({ detail = true } = {}) {
  const roofCuts = detail
    ? [
        'M-2.5,22C-5,30-12,36-26,40.5',
        'M2.5,22C5,30 12,36 26,40.5',
        'M-1,23C-2,31-6,37-14,41.5',
        'M1,23C2,31 6,37 14,41.5',
      ]
        .map((d) => `<path d="${d}" fill="none" stroke="${PAPER}" stroke-width="1.1" stroke-linecap="round"/>`)
        .join('')
    : '';
  const rivets = [-23, -11.5, 0, 11.5, 23].map((x) => `<circle cx="${x}" cy="48.5" r="1.25" fill="${PAPER}"/>`).join('');
  // fine glow lines inside the glass around the flame
  let glow = '';
  if (detail) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + 0.2;
      if (Math.abs(Math.sin(a)) > 0.93 && Math.sin(a) > 0) continue; // keep clear of the candle
      glow += ray(0, 75, a, 13, k % 2 ? 19 : 23, 0.55);
    }
  }
  return `
<g>
  <circle cx="0" cy="5" r="4.6" fill="none" stroke="${INK}" stroke-width="2.6"/>
  <path d="M0,9L1.8,14.5L-1.8,14.5Z" fill="${INK}"/>
  <circle cx="0" cy="16" r="3.2" fill="${INK}"/>
  <path d="M-4,18L4,18C6,28 16,35.5 34,39.5L34,45L-34,45L-34,39.5C-16,35.5-6,28-4,18Z" fill="${INK}"/>
  ${roofCuts}
  <rect x="-31" y="45" width="62" height="7" fill="${INK}"/>
  ${rivets}
  <path d="M-27,52L27,52L21,110L-21,110Z" fill="${PAPER}"/>
  <clipPath id="glass"><path d="M-27,52L27,52L21,110L-21,110Z"/></clipPath>
  <g clip-path="url(#glass)">
    <path d="${glow}" fill="${INK}"/>
    ${detail ? `<path d="${[0, 1, 2, 3].map((i) => taper(-24 + i * 3, 58 + i * 2, -18 + i * 3, 100 + i * 2, 0.45)).join('')}${[0, 1, 2, 3].map((i) => taper(24 - i * 3, 58 + i * 2, 18 - i * 3, 100 + i * 2, 0.45)).join('')}" fill="${INK}"/>` : ''}
  </g>
  <path d="M-12,52L-9.5,110M12,52L9.5,110" stroke="${INK}" stroke-width="3"/>
  <path d="M-27,52L27,52L21,110L-21,110Z" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linejoin="round"/>
  <path d="M-4.2,88.5L-2,86.8L0,88L2.4,86.6L4.2,88.4L4.2,110L-4.2,110Z" fill="${INK}"/>
  ${detail ? `<path d="M2,90L2,107" stroke="${PAPER}" stroke-width="0.9"/>` : ''}
  <path d="M0,61C5.6,69.5 7,77.5 0.4,84.5C-6.4,78-5.4,70 0,61Z" fill="${VERM}"/>
  <path d="M0.2,70.5C2.4,74.5 2.6,78.5 0.3,81C-2,78.6-1.9,74.4 0.2,70.5Z" fill="${PAPER}"/>
  <rect x="-24" y="109.5" width="48" height="7.5" fill="${INK}"/>
  ${detail ? `<path d="M-21,113.2L21,113.2" stroke="${PAPER}" stroke-width="0.9"/>` : ''}
  <path d="M-20,117L20,117L7,132L-7,132Z" fill="${INK}"/>
  ${detail ? `<path d="M-12.5,119.5L-5,129.5M-6,119.5L-1.8,129.5" stroke="${PAPER}" stroke-width="0.9" stroke-linecap="round"/>` : ''}
  <circle cx="0" cy="137" r="5.2" fill="${INK}"/>
  ${detail ? `<path d="M-3,134.5A3.6,3.6 0 0 1 0.5,133.4" stroke="${PAPER}" stroke-width="1" fill="none" stroke-linecap="round"/>` : ''}
  <path d="M-2.2,141L2.2,141L0,148.5Z" fill="${INK}"/>
</g>`;
}

// Bracket: arm to the right of the hook, plate at x = L.
function bracket(L, { detail = true } = {}) {
  const sp = spiral(L * 0.72, 15, 9.5, Math.PI * 0.95, 1.15, 1);
  return `
<g fill="none" stroke="${INK}" stroke-linecap="round">
  <path d="M0,1L0,-4.5L${L},-4.5" stroke-width="4.6" stroke-linejoin="round"/>
  <path d="M${f(L * 0.18)},-4C${f(L * 0.3)},16 ${f(L * 0.5)},27 ${f(L * 0.66)},24.5" stroke-width="3.4"/>
  <path d="${sp}" stroke-width="3.1"/>
  <path d="M${f(L * 0.55)},-4C${f(L * 0.6)},-14 ${f(L * 0.78)},-15 ${f(L * 0.84)},-8" stroke-width="2.4"/>
</g>
<circle cx="-5" cy="-4.5" r="3.3" fill="${INK}"/>
<rect x="${L - 2}" y="-24" width="10" height="76" rx="3.5" fill="${INK}"/>
${detail ? `<path d="M${L + 4.6},-18L${L + 4.6},46" stroke="${PAPER}" stroke-width="0.9"/><circle cx="${L + 2.4}" cy="-16" r="1.6" fill="${PAPER}"/><circle cx="${L + 2.4}" cy="44" r="1.6" fill="${PAPER}"/>` : ''}`;
}

// Wall hatching around a light at (lx, ly): lines thin to nothing near it.
function wallHatch({ x0, x1, y0, y1, gap, maxW, lx, ly, r0, r1, seed, shadow = null, extra = null }) {
  let d = '';
  let k = 0;
  for (let y = y0 + gap / 2; y < y1; y += gap) {
    k++;
    d += swellLine(
      x0,
      x1,
      y,
      (x) => {
        let t = smooth(r0, r1, Math.hypot(x - lx, (y - ly) * 1.08));
        if (shadow) t = Math.max(t, shadow(x, y));
        if (extra) t *= extra(x, y);
        return maxW * t;
      },
      { step: 4, wobble: gap * 0.07, seed: seed + k },
    );
  }
  return d;
}

// ---- mark: a printer's device ------------------------------------------------
function device({ gap = 4.2, maxW = 2.3, rays = true, cx = 88, hang = 32, s = 0.78 } = {}) {
  const lx = cx;
  const ly = hang + 76 * s;
  const roofTop = hang + 18 * s;
  const hatch = wallHatch({
    x0: 8, x1: 192, y0: 8, y1: 192, gap, maxW, lx, ly, r0: 26, r1: 84, seed: 11,
    shadow: (x, y) => (y < roofTop + 6 ? 0.7 * (1 - smooth(-8, 6, Math.abs(x - lx) - (9 + (roofTop + 6 - y) * 0.45))) : 0),
  });
  let rayD = '';
  if (rays) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + Math.PI / 24;
      // keep the bracket side clear
      if (Math.sin(a) < -0.55) continue;
      rayD += ray(lx, ly, a, 46 * s / 0.78, (k % 2 ? 56 : 64) * s / 0.78, 0.9);
    }
  }
  return `
<clipPath id="dev"><circle cx="100" cy="100" r="86"/></clipPath>
<circle cx="100" cy="100" r="86" fill="${PAPER}"/>
<g clip-path="url(#dev)">
  <path d="${hatch}" fill="${INK}"/>
  <path d="${rayD}" fill="${INK}"/>
  <g transform="translate(${cx} ${hang}) scale(${s})">${bracket(96)}${lantern()}</g>
</g>
<circle cx="100" cy="100" r="86.5" fill="none" stroke="${INK}" stroke-width="2"/>
<circle cx="100" cy="100" r="94" fill="none" stroke="${INK}" stroke-width="6"/>`;
}

const markBody = device();
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody });

// ---- favicon: lantern on a paper tile, pixel-snapped -------------------------
const favSvg = svg({
  w: 16,
  h: 16,
  vb: '0 0 16 16',
  body: `
<rect x="0" y="0" width="16" height="16" rx="3" fill="${PAPER}"/>
<rect x="0.5" y="0.5" width="15" height="15" rx="2.5" fill="none" stroke="${INK}" stroke-width="1"/>
<rect x="7" y="2" width="2" height="1" fill="${INK}"/>
<path d="M8,2.5L12,5L12,6L4,6L4,5Z" fill="${INK}"/>
<rect x="4" y="6" width="8" height="1" fill="${INK}"/>
<rect x="4" y="7" width="1" height="4" fill="${INK}"/>
<rect x="11" y="7" width="1" height="4" fill="${INK}"/>
<rect x="7" y="7" width="2" height="3" fill="${VERM}"/>
<rect x="4" y="11" width="8" height="1" fill="${INK}"/>
<rect x="6" y="12" width="4" height="1" fill="${INK}"/>
<rect x="7" y="13" width="2" height="1" fill="${INK}"/>`,
});

const fav32Svg = svg({
  w: 32,
  h: 32,
  vb: '0 0 32 32',
  body: `
<rect x="0" y="0" width="32" height="32" rx="6" fill="${PAPER}"/>
<rect x="1" y="1" width="30" height="30" rx="5" fill="none" stroke="${INK}" stroke-width="2"/>
<rect x="15" y="4" width="2" height="3" fill="${INK}"/>
<path d="M16,6.5L23,11V12.5H9V11Z" fill="${INK}"/>
<rect x="10" y="12" width="12" height="2" fill="${INK}"/>
<rect x="10" y="14" width="12" height="9" fill="${INK}"/>
<rect x="12" y="14" width="8" height="8" fill="${PAPER}"/>
<path d="M16,15C17.6,17 18,19 17,21H15C14,19 14.4,17 16,15Z" fill="${VERM}"/>
<rect x="10" y="22" width="12" height="2" fill="${INK}"/>
<path d="M11,24H21L18,27H14Z" fill="${INK}"/>
<rect x="15" y="27" width="2" height="2" fill="${INK}"/>
<rect x="4" y="18" width="4" height="1" fill="${INK}"/>
<rect x="24" y="18" width="4" height="1" fill="${INK}"/>
<path d="M5,12.5L8,14M27,12.5L24,14M5,24.5L8,23M27,24.5L24,23" stroke="${INK}" stroke-width="1"/>`,
});

// ---- icon: the device on a paper tile, coarser cut for small sizes ------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
<rect x="16" y="16" width="480" height="480" rx="104" fill="${PAPER2}"/>
<rect x="16" y="16" width="480" height="480" rx="104" fill="none" stroke="${INK}" stroke-width="10"/>
${nest({ x: 38, y: 38, w: 436, h: 436, vb: '0 0 200 200', body: device({ gap: 6.5, maxW: 3.6, s: 0.9, hang: 22, cx: 90 }) })}`,
});

// ---- logo --------------------------------------------------------------------
const logoSvg = svg({
  w: 640,
  h: 200,
  vb: '0 0 640 200',
  body: `
${nest({ x: 14, y: 14, w: 172, h: 172, vb: '0 0 200 200', body: device({ gap: 5, maxW: 2.7 }) })}
<text x="214" y="118" font-family="Big Caslon" font-size="76" fill="${INK}" letter-spacing="1">Porchlight</text>
<path d="M216,140H340" stroke="${INK}" stroke-width="1.4"/>
<path d="M346,140l6,-4.5l6,4.5l-6,4.5Z" fill="${VERM}"/>
<path d="M364,140H596" stroke="${INK}" stroke-width="1.4"/>
<text x="217" y="168" font-family="Hoefler Text" font-size="12.5" fill="${INK}" letter-spacing="3.1">KEYS · PACKAGES · DOMAINS · THIS MAC</text>`,
});

// ---- hero --------------------------------------------------------------------
function hero() {
  const BX0 = 72;
  const BY0 = 64;
  const BX1 = 600;
  const BY1 = 576;
  // lantern placement
  const s = 1.38;
  const cx = 432;
  const hang = 150;
  const lx = cx;
  const ly = hang + 76 * s;
  const roofTop = hang + 18 * s;
  // door
  const D = { x0: 112, x1: 300, y0: 172, y1: 512 };
  const stepTop = 512;

  const inDoor = (x, y) => x > D.x0 - 22 && x < D.x1 + 22 && y > D.y0 - 30 && y < stepTop;
  const wall = wallHatch({
    x0: BX0, x1: BX1, y0: BY0, y1: stepTop, gap: 6, maxW: 3.4, lx, ly, r0: 54, r1: 300, seed: 100,
    shadow: (x, y) => (y < roofTop + 8 ? 0.7 * (1 - smooth(-18, 10, Math.abs(x - lx) - (14 + (roofTop + 8 - y) * 0.42))) : 0),
    extra: (x, y) => (inDoor(x, y) ? 0 : 1),
  });

  // door leaf: vertical engraved grain, lit from the right
  let doorD = '';
  {
    const r = rng(7);
    for (let x = D.x0 + 3; x < D.x1; x += 5) {
      const t = smooth(90, 330, Math.hypot(x - lx, 300 - ly));
      const w = 2.9 * (0.35 + 0.65 * t);
      const jitter = (r() - 0.5) * 0.4;
      // vertical swell line: build from points down the door
      const pts = [];
      for (let y = D.y0; y <= D.y1; y += 8) {
        const tt = smooth(70, 330, Math.hypot(x - lx, y - ly));
        pts.push([x + 0.35 * Math.sin(y / 29 + x), y, (w + jitter) * (0.45 + 0.55 * tt)]);
      }
      const L = pts.map(([px, py, pw]) => `${f(px - pw / 2)},${f(py)}`);
      const R = pts.map(([px, py, pw]) => `${f(px + pw / 2)},${f(py)}`).reverse();
      doorD += `M${L.join('L')}L${R.join('L')}Z`;
    }
  }
  // panels: four raised panels and a fanless top light
  const panels = [
    [134, 286, 76, 96],
    [226, 286, 52, 96],
    [134, 400, 76, 96],
    [226, 400, 52, 96],
  ];
  // the door is two leaves? keep one leaf: panels in two columns
  const panelSvg = panels
    .map(([x, y, w, h]) => {
      const bev = 7;
      const hi = [1, 2, 3].map((i) => `M${x + w - bev + i * 1.8},${y + bev - i * 1.6 + 2}V${y + h - bev + i * 1.6 - 2}`).join('');
      return `<path d="M${x},${y}H${x + w}L${x + w - bev},${y + bev}H${x + bev}V${y + h - bev}L${x},${y + h}Z" fill="${INK}"/>
<path d="M${x + w},${y}V${y + h}H${x}L${x + bev},${y + h - bev}H${x + w - bev}V${y + bev}Z" fill="${PAPER}"/>
<path d="${hi}" stroke="${INK}" stroke-width="0.8"/>
<path d="M${x + bev},${y + h - bev + 2.5}H${x + w - bev}" stroke="${INK}" stroke-width="0.8"/>
<rect x="${x + bev}" y="${y + bev}" width="${w - 2 * bev}" height="${h - 2 * bev}" fill="none" stroke="${INK}" stroke-width="1.4"/>`;
    })
    .join('');
  // door glass: four lights, dark (the hall is dark)
  let glassD = '';
  for (let k = 0; k < 40; k++) {
    const y = 192 + k * 1.95;
    glassD += `M128,${f(y)}H284`;
  }
  const doorSvg = `
<rect x="${D.x0 - 22}" y="${D.y0 - 30}" width="${D.x1 - D.x0 + 44}" height="${stepTop - D.y0 + 30}" fill="${INK}"/>
<path d="M${D.x0 - 14},${D.y0 - 22}H${D.x1 + 14}V${stepTop}M${D.x0 - 14},${D.y0 - 22}V${stepTop}" stroke="${PAPER}" stroke-width="1.4" fill="none"/>
<path d="M${D.x0 - 30},${D.y0 - 30}H${D.x1 + 30}V${D.y0 - 38}H${D.x0 - 30}Z" fill="${INK}"/>
<path d="M${D.x1 + 8},${D.y0 - 24}V${stepTop - 2}" stroke="${PAPER}" stroke-width="2.2"/>
<rect x="${D.x0}" y="${D.y0}" width="${D.x1 - D.x0}" height="${D.y1 - D.y0}" fill="${PAPER}"/>
<path d="${doorD}" fill="${INK}"/>
<rect x="124" y="186" width="164" height="86" fill="${INK}"/>
<rect x="128" y="190" width="156" height="78" fill="${INK}"/>
<path d="${glassD}" stroke="${PAPER}" stroke-width="0.5" opacity="0.5"/>
<path d="M205,190V268M128,229H284" stroke="${INK}" stroke-width="5"/>
<path d="M207.5,190V268M128,231.5H284" stroke="${PAPER}" stroke-width="1"/>
<path d="M266,196L276,206M262,204L274,216" stroke="${PAPER}" stroke-width="1.4" stroke-linecap="round"/>
${panelSvg}
<circle cx="286" cy="392" r="7.5" fill="${INK}"/>
<path d="M283,388A5,5 0 0 1 290,389" stroke="${PAPER}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M283,404h6v14h-6z" fill="${INK}"/>
<path d="M286,408v6" stroke="${PAPER}" stroke-width="1.6"/>
<text x="206" y="171" font-family="Hoefler Text" font-size="15" fill="${PAPER}" text-anchor="middle" letter-spacing="2">N° 12</text>`;

  // step and doormat
  let stepD = '';
  for (let y = stepTop + 14; y < BY1; y += 4.2) {
    stepD += swellLine(BX0, BX1, y, (x) => 2.6 * (0.55 + 0.45 * smooth(60, 380, Math.hypot(x - lx, y - ly - 120))), { step: 5, wobble: 0.3, seed: Math.round(y) });
  }
  let stepTopD = '';
  for (let y = stepTop + 3; y < stepTop + 12; y += 3) {
    stepTopD += swellLine(BX0, BX1, y, (x) => 1.5 * smooth(110, 380, Math.abs(x - lx) + 40), { step: 5, wobble: 0.2, seed: Math.round(y * 3) });
  }
  // stone joints on the step face
  const joints = [190, 352, 520].map((x) => `M${x},${stepTop + 12}V${BY1}`).join('');

  // doormat on the step top (seen nearly edge-on): a dark band with a cut fringe
  let fringe = '';
  for (let x = 128; x <= 284; x += 4) fringe += `M${x},${stepTop + 9}l1.2,4`;

  // rays around the lantern
  let rayD = '';
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2 + Math.PI / 36;
    if (Math.sin(a) < -0.5) continue; // bracket and roof side
    const long = k % 3 === 0;
    rayD += ray(lx, ly, a, 70, long ? 134 : k % 3 === 1 ? 104 : 92, long ? 1.5 : 1.05);
  }

  // moths
  const moth = (x, y, r, sc = 1) =>
    `<g transform="translate(${x} ${y}) rotate(${r}) scale(${sc})"><path d="M0,-1C-4,-9-15,-12-17,-6C-18,-1-12,3-6,3C-4,6-2,6 0,4C2,6 4,6 6,3C12,3 18,-1 17,-6C15,-12 4,-9 0,-1Z" fill="${INK}"/><path d="M-14,-6C-11,-8-7,-7-3,-2M14,-6C11,-8 7,-7 3,-2M-11,0C-8,0-5,0-2,1M11,0C8,0 5,0 2,1" stroke="${PAPER}" stroke-width="0.9" fill="none" stroke-linecap="round"/><path d="M0,0V8" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/><path d="M-0.6,-2C-2,-6-4,-8-6,-9M0.6,-2C2,-6 4,-8 6,-9" stroke="${INK}" stroke-width="0.8" fill="none"/></g>`;

  // a ragged block edge
  const r = rng(42);
  const edge = (ax, ay, bx, by, n) => {
    let p = '';
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      p += `L${f(ax + (bx - ax) * t + (r() - 0.5) * 1.6)},${f(ay + (by - ay) * t + (r() - 0.5) * 1.6)}`;
    }
    return p;
  };
  const O = 10;
  const frame = `M${BX0 - O},${BY0 - O}${edge(BX0 - O, BY0 - O, BX1 + O, BY0 - O, 40)}${edge(BX1 + O, BY0 - O, BX1 + O, BY1 + O, 40)}${edge(BX1 + O, BY1 + O, BX0 - O, BY1 + O, 40)}${edge(BX0 - O, BY1 + O, BX0 - O, BY0 - O, 40)}Z M${BX0},${BY0}H${BX1}V${BY1}H${BX0}Z`;

  const TX = 940;
  return `
<rect width="1280" height="640" fill="${PAPER}"/>
<clipPath id="block"><rect x="${BX0}" y="${BY0}" width="${BX1 - BX0}" height="${BY1 - BY0}"/></clipPath>
<g clip-path="url(#block)">
  <rect x="${BX0}" y="${BY0}" width="${BX1 - BX0}" height="${BY1 - BY0}" fill="${PAPER}"/>
  <path d="${wall}" fill="${INK}"/>
  <path d="${rayD}" fill="${INK}"/>
  ${doorSvg}
  <rect x="${BX0}" y="${stepTop}" width="${BX1 - BX0}" height="2.5" fill="${INK}"/>
  <path d="${stepTopD}" fill="${INK}"/>
  <rect x="${BX0}" y="${stepTop + 12}" width="${BX1 - BX0}" height="2" fill="${INK}"/>
  <path d="${stepD}" fill="${INK}"/>
  <path d="${joints}" stroke="${PAPER}" stroke-width="1.6"/>
  <rect x="124" y="${stepTop + 3}" width="164" height="7" fill="${INK}"/>
  <path d="${fringe}" stroke="${INK}" stroke-width="1"/>
  <path d="M128,${stepTop + 6}H284" stroke="${PAPER}" stroke-width="0.8" stroke-dasharray="3 3"/>
  <g transform="translate(${cx} ${hang}) scale(${s})">${bracket(100)}${lantern()}</g>
  ${moth(364, 226, -16, 0.95)}
  ${moth(514, 318, 22, 0.8)}
  ${moth(482, 176, 6, 0.62)}
</g>
<path d="${frame}" fill="${INK}" fill-rule="evenodd"/>
<rect x="${BX0 - O - 9}" y="${BY0 - O - 9}" width="${BX1 - BX0 + 2 * O + 18}" height="${BY1 - BY0 + 2 * O + 18}" fill="none" stroke="${INK}" stroke-width="1.2"/>

<text x="${TX}" y="196" font-family="Hoefler Text" font-size="15" fill="${VERM}" text-anchor="middle" letter-spacing="5">AT HOME, AFTER DARK</text>
<text x="${TX}" y="300" font-family="Big Caslon" font-size="112" fill="${INK}" text-anchor="middle">Porchlight</text>
<path d="M${TX - 250},338H${TX - 14}M${TX + 14},338H${TX + 250}" stroke="${INK}" stroke-width="1.5"/>
<path d="M${TX - 250},344H${TX - 14}M${TX + 14},344H${TX + 250}" stroke="${INK}" stroke-width="0.7"/>
<path d="M${TX},333.5l8,7.5l-8,7.5l-8,-7.5Z" fill="${VERM}"/>
<text x="${TX}" y="398" font-family="Hoefler Text" font-style="italic" font-size="34" fill="${INK}" text-anchor="middle">A light left on over</text>
<text x="${TX}" y="440" font-family="Hoefler Text" font-style="italic" font-size="34" fill="${INK}" text-anchor="middle">your own front door.</text>
<text x="${TX}" y="520" font-family="Hoefler Text" font-size="14" fill="${INK}" text-anchor="middle" letter-spacing="4.4">KEYS · PACKAGES · DOMAINS · THIS MAC</text>`;
}

const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 08 Woodcut lantern

A wall lantern on a scrolled iron bracket, cut like a wood engraving: the wall is hatching whose lines thin to nothing where the lantern reaches, so the light is the bare paper. One vermilion flame; the mark is a round printer's device.
Palette: paper #f2e8d2, tile #e9dcbf, ink #241a13, vermilion #c43d26.
Type: Big Caslon for the name; Hoefler Text italic for the tagline and tracked caps for the small lines.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logoSvg,
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
