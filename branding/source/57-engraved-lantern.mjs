// 57 Engraved lantern: concept 39 refined. Porchlight as a banknote. Lathe-work (guilloche)
// rosettes and a braided border in green-black ink on cream, an engraved lantern
// in the middle whose light is the bare paper, a ribbon for the tagline, and one
// vermilion seal stamped over it all. The seal is the mark.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '57-engraved-lantern';
const C = {
  paper: '#f3ebd3',
  ink: '#12261d', // green-black
  green: '#2f5c47', // the lighter ink of the lathe-work
  tint: '#c3d3b6', // underprint
  red: '#c63f28', // vermilion
  redDk: '#9a2816',
  cream: '#fff7e3',
};
const FONTS = { Engr: 'AcademyEngravedLetPlain', CopL: 'Copperplate-Light' };
const f = (n) => Math.round(n * 10) / 10;
const TAU = Math.PI * 2;

// ---- lathe-work ----------------------------------------------------------------
// K phase-shifted waves round a circle: a braided ring 2A wide.
function ring(cx, cy, R, A, n, K, { pts = 10, B = 0, dir = 1 } = {}) {
  const N = n * pts;
  let d = '';
  for (let k = 0; k < K; k++) {
    const ph = (TAU * k) / K;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * TAU;
      const r = R + A * Math.sin(dir * n * t + ph) + B * Math.sin(2 * n * t - ph);
      d += `${i ? 'L' : 'M'}${f(cx + r * Math.cos(t))},${f(cy + r * Math.sin(t))}`;
    }
    d += 'Z';
  }
  return d;
}
// the same along a straight line from (x0, y0), length len, horizontal or vertical
function braid(x0, y0, len, A, lam, K, vertical = false, pts = 10) {
  const N = Math.round((len / lam) * pts);
  let d = '';
  for (let k = 0; k < K; k++) {
    const ph = (TAU * k) / K;
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * len;
      const v = A * Math.sin((TAU * u) / lam + ph);
      d += `${i ? 'L' : 'M'}${vertical ? `${f(x0 + v)},${f(y0 + u)}` : `${f(x0 + u)},${f(y0 + v)}`}`;
    }
  }
  return d;
}
const circ = (cx, cy, r) => `M${f(cx - r)},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z`;
// a scalloped disc: n round teeth on radius r
function scallop(cx, cy, r, n) {
  const chord = 2 * r * Math.sin(Math.PI / n);
  const rs = f(chord * 0.6);
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU - Math.PI / 2;
    d += i ? `A${rs},${rs} 0 0 1 ${f(cx + r * Math.cos(t))},${f(cy + r * Math.sin(t))}` : `M${f(cx + r * Math.cos(t))},${f(cy + r * Math.sin(t))}`;
  }
  return `${d}Z`;
}
// parallel lines over a box, to be clipped
function hatch(x0, y0, x1, y1, gap, slope = 0) {
  let d = '';
  const h = y1 - y0;
  for (let x = x0 - Math.abs(slope) * h; x < x1 + Math.abs(slope) * h; x += gap) d += `M${f(x)},${y0}L${f(x + slope * h)},${y1}`;
  return d;
}

// ---- the lantern, engraved; origin at its middle, about 130 tall ---------------
let uid = 0;
function lantern({ ink = C.ink, paper = C.paper, k = 1 } = {}) {
  const id = `lt${uid++}`;
  const roof = 'M-4,-49H4L8,-41Q23,-37 31,-26H-31Q-23,-37 -8,-41Z';
  const glass = 'M-28,-21H28L18,30H-18Z';
  const cup = 'M-16,35H16L8,46H-8Z';
  return `
<clipPath id="${id}a"><path d="${roof}"/></clipPath>
<clipPath id="${id}b"><path d="${glass}"/></clipPath>
<clipPath id="${id}c"><path d="${cup}"/></clipPath>
<circle cx="0" cy="-60" r="5.6" fill="none" stroke="${ink}" stroke-width="${2.2 * k}"/>
<circle cx="0" cy="-51" r="3.2" fill="${ink}"/>
<path d="${roof}" fill="${paper}"/>
<g clip-path="url(#${id}a)"><path d="${hatch(-34, -50, 0, -26, 2.6, 0.5)}" stroke="${ink}" stroke-width="${0.7 * k}"/><path d="${hatch(0, -50, 34, -26, 1.5, 0.5)}" stroke="${ink}" stroke-width="${0.9 * k}"/></g>
<path d="${roof}" fill="none" stroke="${ink}" stroke-width="${1.8 * k}" stroke-linejoin="round"/>
<rect x="-34" y="-26.5" width="68" height="6" fill="${ink}"/>
<path d="${glass}" fill="${paper}"/>
<g clip-path="url(#${id}b)">
  <path d="${hatch(13, -21, 30, 30, 1.7, -0.196)}" stroke="${ink}" stroke-width="${0.7 * k}"/>
  <path d="${hatch(-30, -21, -19, 30, 2.6, 0.196)}" stroke="${ink}" stroke-width="${0.6 * k}"/>
</g>
<path d="M-9.4,-21L-6,30M9.4,-21L6,30" stroke="${ink}" stroke-width="${1.5 * k}"/>
<path d="${glass}" fill="none" stroke="${ink}" stroke-width="${2.2 * k}" stroke-linejoin="round"/>
<path d="M-2.6,30V13H2.6V30Z" fill="${paper}" stroke="${ink}" stroke-width="${1.1 * k}"/>
<path d="M0,-12C6,-4 5,2 4.4,5.5A4.6,4.6 0 0 1 -4.4,5.5C-5,2 -2,-2 0,-12Z" fill="${paper}" stroke="${ink}" stroke-width="${1.3 * k}" stroke-linejoin="round"/>
<path d="M0,2C1.6,4.5 1.6,6 1.3,7.4A1.4,1.4 0 0 1 -1.3,7.4C-1.4,6 -0.6,4.5 0,2Z" fill="${ink}"/>
<path d="M0,13V9" stroke="${ink}" stroke-width="${0.9 * k}"/>
<rect x="-21.5" y="29.5" width="43" height="6" fill="${ink}"/>
<path d="${cup}" fill="${paper}"/>
<g clip-path="url(#${id}c)"><path d="${hatch(-18, 35, 18, 46, 1.9, -0.4)}" stroke="${ink}" stroke-width="${0.8 * k}"/></g>
<path d="${cup}" fill="none" stroke="${ink}" stroke-width="${1.6 * k}" stroke-linejoin="round"/>
<path d="M-4.5,46H4.5L0,58Z" fill="${ink}"/>
<circle cx="0" cy="61" r="2.6" fill="${ink}"/>`;
}

// engraved rays between two radii: every third one long
function rayRing(cx, cy, r0, r1, n, w, color) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const a = i % 4 === 0 ? r0 : i % 2 === 0 ? r0 + (r1 - r0) * 0.22 : r0 + (r1 - r0) * 0.5;
    d += `M${f(cx + a * Math.cos(t))},${f(cy + a * Math.sin(t))}L${f(cx + r1 * Math.cos(t))},${f(cy + r1 * Math.sin(t))}`;
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none"/>`;
}

// ---- the seal (the mark), on a 200 grid -------------------------------------------
function sealLantern(cream, red) {
  // the lantern cut as a solid shape for the seal
  return `
<circle cx="0" cy="-59" r="5.4" fill="none" stroke="${cream}" stroke-width="3.2"/>
<path d="M-4,-50H4L8,-41Q23,-37 31,-26H-31Q-23,-37 -8,-41Z" fill="${cream}"/>
<rect x="-35" y="-26" width="70" height="6.5" fill="${cream}"/>
<path d="M-28,-16.5H28L19,29H-19Z" fill="${cream}"/>
<path d="M-9.6,-16.5L-6.4,29M9.6,-16.5L6.4,29" stroke="${red}" stroke-width="2.6"/>
<path d="M0,-10C7,-1 6,5 5.2,9A5.4,5.4 0 0 1 -5.2,9C-6,5 -2.4,0 0,-10Z" fill="${red}"/>
<rect x="-22.5" y="32" width="45" height="6.5" fill="${cream}"/>
<path d="M-16,41.5H16L7,52H-7Z" fill="${cream}"/>
<path d="M-4.6,54H4.6L0,65Z" fill="${cream}"/>`;
}
function seal({ fine = true } = {}) {
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const t = (i / 60) * TAU;
    ticks += `M${f(100 + 73 * Math.cos(t))},${f(100 + 73 * Math.sin(t))}L${f(100 + 79.5 * Math.cos(t))},${f(100 + 79.5 * Math.sin(t))}`;
  }
  return `
<path d="${scallop(100, 100, 91, 30)}" fill="${C.red}"/>
<circle cx="100" cy="100" r="84" fill="none" stroke="${C.cream}" stroke-width="2.4"/>
${fine ? `<path d="${ticks}" stroke="${C.cream}" stroke-width="1.5"/>` : ''}
<circle cx="100" cy="100" r="68.5" fill="none" stroke="${C.cream}" stroke-width="${fine ? 1.3 : 2.4}"/>
<!-- wall plate, arm and scroll: the lantern hangs by the door -->
<rect x="141" y="48" width="8" height="74" rx="1.5" fill="${C.cream}"/>
<path d="M143,58H96A9,9 0 0 0 87,67" fill="none" stroke="${C.cream}" stroke-width="5"/>
<path d="M142,110C125,108 116,90 115,60" fill="none" stroke="${C.cream}" stroke-width="3.6"/>
<circle cx="120.5" cy="97" r="3.4" fill="${C.cream}"/>
<g transform="translate(87 117) scale(0.82)">${sealLantern(C.cream, C.red)}</g>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: seal() });

// ---- favicons on the pixel grid ---------------------------------------------------
const PIX = { V: C.red, C: C.cream, D: C.redDk };
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
  '.....VVVVVV.....',
  '...VVVVVVVVVV...',
  '..VVVVVVVVVVVV..',
  '.VVVVVCCCCCCCVV.',
  '.VVVVVCVVVVCCVV.',
  'VVVVVCCCVVVCCVVV',
  'VVVCCCCCCCVCCVVV',
  'VVVVCCCCCVVCCVVV',
  'VVVVCCVCCVVCCVVV',
  'VVVVCCVCCVVCCVVV',
  'VVVVCCCCCVVVVVVV',
  '.VVVVCCCVVVVVVV.',
  '.VVVVVCVVVVVVVV.',
  '..VVVVVVVVVVVV..',
  '...VVVVVVVVVV...',
  '.....VVVVVV.....',
];
function fav32Rows() {
  const n = 32;
  const g = Array.from({ length: n }, () => Array(n).fill('.'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < n && y >= 0 && y < n) g[y][x] = ch;
  };
  const DX = -4; // the lantern hangs left of the wall plate
  const DY = 2;
  const r = (x0, y0, x1, y1, ch) => {
    for (let y = y0 + DY; y <= y1 + DY; y++) for (let x = x0 + DX; x <= x1 + DX; x++) set(x, y, ch);
  };
  // a disc with sixteen round bites out of its edge, like the seal's scallops
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x + 0.5 - 16;
    const dy = y + 0.5 - 16;
    if (Math.hypot(dx, dy) >= 15.8) continue;
    let bitten = false;
    for (let i = 0; i < 16; i++) {
      const t = ((i + 0.5) / 16) * TAU;
      if (Math.hypot(dx - 15.8 * Math.cos(t), dy - 15.8 * Math.sin(t)) < 1.4) bitten = true;
    }
    if (!bitten) set(x, y, 'V');
  }
  // wall plate and arm
  for (let y = 5; y <= 19; y++) { set(23, y, 'C'); set(24, y, 'C'); }
  for (let x = 12; x <= 23; x++) { set(x, 6, 'C'); set(x, 7, 'C'); }
  // lantern
  r(15, 5, 16, 5, 'C');
  r(14, 6, 17, 6, 'C');
  r(12, 7, 19, 7, 'C');
  r(11, 8, 20, 8, 'C');
  r(9, 9, 22, 10, 'C');
  r(10, 12, 21, 14, 'C');
  r(11, 15, 20, 18, 'C');
  r(12, 19, 19, 20, 'C');
  r(10, 22, 21, 23, 'C');
  r(12, 24, 19, 24, 'C');
  r(13, 25, 18, 25, 'C');
  r(15, 26, 16, 27, 'C');
  // the flame, cut back to red
  set(16 + DX, 13 + DY, 'V');
  r(15, 14, 16, 15, 'V');
  r(14, 16, 17, 17, 'V');
  r(15, 18, 16, 18, 'V');
  return g.map((row) => row.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon: the seal stamped on a corner of the note ---------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  body: `
<clipPath id="ico"><rect width="512" height="512" rx="112"/></clipPath>
<rect width="512" height="512" rx="112" fill="${C.paper}"/>
<g clip-path="url(#ico)">
  <path d="${ring(256, 256, 292, 26, 30, 5, { pts: 8 })}" fill="none" stroke="${C.green}" stroke-width="1.6"/>
  <path d="${ring(256, 256, 232, 20, 24, 6, { pts: 8, dir: -1 })}" fill="none" stroke="${C.green}" stroke-width="1.6"/>
  <circle cx="256" cy="256" r="262" fill="none" stroke="${C.ink}" stroke-width="3"/>
  <circle cx="256" cy="256" r="208" fill="none" stroke="${C.ink}" stroke-width="3"/>
</g>
<circle cx="256" cy="256" r="200" fill="${C.paper}"/>
${nest({ x: 46, y: 46, w: 420, h: 420, vb: '0 0 200 200', body: seal({ fine: true }) })}`,
});

// ---- logo --------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.cream : C.ink;
  const sub = dark ? '#cfdcc3' : C.green;
  return svg({
    w: 640,
    h: 200,
    fonts: FONTS,
    body: `
${nest({ x: 8, y: 8, w: 184, h: 184, vb: '0 0 200 200', body: seal() })}
<text x="208" y="110" font-family="Engr" font-size="60" letter-spacing="1" fill="${ink}" stroke="${ink}" stroke-width="0.6" stroke-linejoin="round">PORCHLIGHT</text>
<path d="M210,128H626" stroke="${ink}" stroke-width="2"/>
<path d="M210,133H626" stroke="${ink}" stroke-width="0.8"/>
<text x="418" y="163" text-anchor="middle" font-family="Copperplate" font-weight="700" font-size="20" letter-spacing="1.6" fill="${sub}">Keep private things private.</text>`,
  });
}

// ---- hero: the note ----------------------------------------------------------------
function hero() {
  const CX = 640;
  const CY = 362;
  // border: rules, a braid on every side, a rosette on every corner
  const corner = (x, y) => `
<path d="${circ(x, y, 36)}" fill="${C.paper}"/>
<path d="${ring(x, y, 27, 7, 12, 4, { pts: 9 })}" fill="none" stroke="${C.ink}" stroke-width="0.8"/>
<circle cx="${x}" cy="${y}" r="36" fill="none" stroke="${C.ink}" stroke-width="1.4"/>
<circle cx="${x}" cy="${y}" r="17" fill="${C.ink}"/>
<circle cx="${x}" cy="${y}" r="14.4" fill="none" stroke="${C.paper}" stroke-width="0.7"/>
<text x="${x}" y="${y + 7.6}" text-anchor="middle" font-family="Engr" font-size="22" fill="${C.paper}">P</text>`;
  const border = `
<rect x="24" y="24" width="1232" height="592" fill="none" stroke="${C.ink}" stroke-width="2.6"/>
<rect x="30" y="30" width="1220" height="580" fill="none" stroke="${C.ink}" stroke-width="0.8"/>
<path d="${braid(58, 56, 1164, 13, 48.5, 3)}${braid(58, 584, 1164, 13, 48.5, 3)}${braid(56, 58, 524, 13, 47.6, 3, true)}${braid(1224, 58, 524, 13, 47.6, 3, true)}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>
<rect x="80" y="80" width="1120" height="480" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
<rect x="85" y="85" width="1110" height="470" fill="none" stroke="${C.ink}" stroke-width="0.6"/>
${corner(56, 56)}${corner(1224, 56)}${corner(56, 584)}${corner(1224, 584)}`;

  // underprint: one slow braid across the note, in the pale ink
  const under = `
<clipPath id="fld"><rect x="86" y="86" width="1108" height="468"/></clipPath>
<g clip-path="url(#fld)">
  <path d="${braid(40, CY - 8, 1200, 150, 400, 12, false, 64)}" fill="none" stroke="${C.tint}" stroke-width="1" stroke-linejoin="round"/>
  <path d="${braid(40, CY - 8, 1200, 96, 300, 9, false, 56)}" fill="none" stroke="${C.tint}" stroke-width="1" stroke-linejoin="round"/>
</g>`;

  // the name on a shallow arch
  const RHO = 1700;
  const yTop = 159;
  const half = 384;
  const yEnd = f(yTop + RHO - Math.sqrt(RHO * RHO - half * half));
  const name = `
<path id="arch" d="M${CX - half},${yEnd}A${RHO},${RHO} 0 0 1 ${CX + half},${yEnd}" fill="none"/>
<text font-family="Engr" font-size="91" letter-spacing="7" fill="${C.ink}" stroke="${C.ink}" stroke-width="0.9" stroke-linejoin="round"><textPath href="#arch" startOffset="50%" text-anchor="middle">PORCHLIGHT</textPath></text>`;

  // the middle vignette: two braided rings, engraved rays, the lantern in bare paper
  const vignette = `
<path d="${circ(CX, CY, 166)}" fill="${C.paper}"/>
<path d="${ring(CX, CY, 151, 12, 22, 4)}" fill="none" stroke="${C.ink}" stroke-width="1.15"/>
<circle cx="${CX}" cy="${CY}" r="166" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
<circle cx="${CX}" cy="${CY}" r="136" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
<circle cx="${CX}" cy="${CY}" r="133" fill="none" stroke="${C.ink}" stroke-width="0.6"/>
<path d="${ring(CX, CY, 119, 11, 16, 4, { dir: -1 })}" fill="none" stroke="${C.green}" stroke-width="1.15"/>
<circle cx="${CX}" cy="${CY}" r="105" fill="none" stroke="${C.ink}" stroke-width="0.6"/>
<circle cx="${CX}" cy="${CY}" r="102" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
${rayRing(CX, CY, 90, 100, 96, 1.1, C.ink)}
<!-- the wall lantern: plate, arm and scroll, then the lantern hung from it -->
<rect x="${CX + 54}" y="${CY - 74}" width="9" height="88" fill="${C.ink}"/>
<path d="M${CX + 56},${CY - 62}H${CX - 5}A9,9 0 0 0 ${CX - 14},${CY - 53}" fill="none" stroke="${C.ink}" stroke-width="4.2"/>
<path d="M${CX + 55},${CY + 2}C${CX + 30},${CY - 2} ${CX + 14},${CY - 26} ${CX + 13},${CY - 60}" fill="none" stroke="${C.ink}" stroke-width="2.6"/>
<circle cx="${CX + 22}" cy="${CY - 14}" r="3.6" fill="${C.ink}"/>
<g transform="translate(${CX - 14} ${CY + 12}) scale(1.02)">${lantern({ k: 1.35 })}</g>`;

  // the ribbon
  const RY = 472;
  const RH = 46;
  const RX0 = 390;
  const RX1 = 890;
  const tail = (dir) => {
    const x0 = dir < 0 ? RX0 : RX1;
    const xt = x0 + dir * 50; // tip
    const xf = x0 - dir * 14; // where the tail tucks behind
    const y0 = RY + 13;
    const y1 = RY + RH + 13;
    const id = `tl${dir < 0 ? 'a' : 'b'}`;
    const shape = `M${xf},${y0}H${xt}L${xt - dir * 16},${(y0 + y1) / 2}L${xt},${y1}H${xf}Z`;
    const lo = Math.min(xf, x0 + dir * 26);
    const hi = Math.max(xf, x0 + dir * 26);
    return `
<clipPath id="${id}"><path d="${shape}"/></clipPath>
<path d="${shape}" fill="${C.paper}"/>
<g clip-path="url(#${id})"><path d="${hatch(lo, y0, hi, y1, 2.4)}" stroke="${C.ink}" stroke-width="0.7"/></g>
<path d="${shape}" fill="none" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M${x0},${RY + RH}H${xf}V${y1}Z" fill="${C.ink}"/>`;
  };
  const ribbon = `
${tail(-1)}${tail(1)}
<rect x="${RX0}" y="${RY}" width="${RX1 - RX0}" height="${RH}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.8"/>
<path d="M${RX0 + 5},${RY + 5}H${RX1 - 5}M${RX0 + 5},${RY + RH - 5}H${RX1 - 5}" stroke="${C.ink}" stroke-width="0.6"/>
<text x="${CX + 1.2}" y="${RY + 31.5}" text-anchor="middle" font-family="Copperplate" font-weight="700" font-size="25" letter-spacing="2.4" fill="${C.ink}">Keep private things private.</text>`;

  // left counter: a front door, engraved
  const LX = 236;
  const LY = 350;
  const door = `
<clipPath id="dr"><path d="M-25,58V-26A25,25 0 0 1 25,-26V58Z"/></clipPath>
<clipPath id="drw"><path d="M-80,-80H80V58H38V-28A38,38 0 0 0 -38,-28V58H-80Z"/></clipPath>
<g clip-path="url(#drw)"><path d="${hatch(-80, -80, 80, 80, 3.1)}" stroke="${C.ink}" stroke-width="0.6" transform="rotate(90)"/></g>
<path d="M-38,58V-28A38,38 0 0 1 38,-28V58" fill="none" stroke="${C.ink}" stroke-width="1"/>
<path d="M-32,58V-28A32,32 0 0 1 32,-28V58" fill="none" stroke="${C.ink}" stroke-width="1.8"/>
<path d="M-25,58V-26A25,25 0 0 1 25,-26V58Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.8"/>
<path d="M-25,-26H25" stroke="${C.ink}" stroke-width="1.6"/>
<path d="M0,-26V-51M0,-26L-17.5,-43.5M0,-26L17.5,-43.5" stroke="${C.ink}" stroke-width="1"/>
<path d="M-12,-26A12,12 0 0 1 12,-26" fill="none" stroke="${C.ink}" stroke-width="1"/>
<rect x="-19" y="-19" width="16" height="30" fill="none" stroke="${C.ink}" stroke-width="1.1"/>
<rect x="3" y="-19" width="16" height="30" fill="none" stroke="${C.ink}" stroke-width="1.1"/>
<rect x="-19" y="18" width="16" height="33" fill="none" stroke="${C.ink}" stroke-width="1.1"/>
<rect x="3" y="18" width="16" height="33" fill="none" stroke="${C.ink}" stroke-width="1.1"/>
<g clip-path="url(#dr)"><path d="${hatch(4, -19, 19, 52, 1.9)}" stroke="${C.ink}" stroke-width="0.55"/></g>
<circle cx="0" cy="14.5" r="2.4" fill="${C.ink}"/>
<path d="M-44,58H44V63H-44Z" fill="${C.ink}"/>
<path d="M-52,63H52V69H-52Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.2"/>
<path d="M-80,69H80V80H-80Z" fill="${C.paper}"/>`;
  const counter = `
<path d="${circ(LX, LY, 104)}" fill="${C.paper}"/>
<path d="${ring(LX, LY, 92, 10, 16, 4)}" fill="none" stroke="${C.ink}" stroke-width="1.1"/>
<circle cx="${LX}" cy="${LY}" r="104" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
<circle cx="${LX}" cy="${LY}" r="80" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
<circle cx="${LX}" cy="${LY}" r="77" fill="none" stroke="${C.ink}" stroke-width="0.6"/>
<clipPath id="cin"><circle cx="0" cy="0" r="76"/></clipPath>
<g transform="translate(${LX} ${LY + 2})"><g clip-path="url(#cin)">${door}</g></g>`;

  // right: where the seal is stamped, a ring is printed to receive it
  const SX = 1044;
  const SY = 350;
  const stamped = `
<path d="${circ(SX, SY, 104)}" fill="${C.paper}"/>
<path d="${ring(SX, SY, 92, 10, 16, 4)}" fill="none" stroke="${C.ink}" stroke-width="1.1"/>
<circle cx="${SX}" cy="${SY}" r="104" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
<circle cx="${SX}" cy="${SY}" r="80" fill="none" stroke="${C.ink}" stroke-width="1.6"/>
<g transform="translate(${SX + 5} ${SY + 3}) rotate(-9) scale(0.98) translate(-100 -100)">${seal()}</g>`;

  // small lines under the counters
  const small = (x, txt, hw) => `
<path d="M${x - hw},460H${x + hw}M${x - hw},488H${x + hw}" stroke="${C.ink}" stroke-width="1.2"/>
<text x="${x + 1.5}" y="479" text-anchor="middle" font-family="Copperplate" font-weight="700" font-size="14" letter-spacing="2.6" fill="${C.ink}">${txt}</text>`;
  return `
<rect width="1280" height="640" fill="${C.paper}"/>
${under}
${border}
${name}
${vignette}
${counter}
${stamped}
${ribbon}
<text x="${CX + 1.5}" y="548" text-anchor="middle" font-family="Copperplate" font-weight="700" font-size="12.5" letter-spacing="3.6" fill="${C.ink}">YOUR REPOS · YOUR SERVERS · YOUR COMPUTER</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, fonts: FONTS, body: hero() });

const notes = `# 57 Engraved lantern

Concept 39 refined. Porchlight as a banknote: lathe-work and a braided border in green-black ink on cream, the name on a shallow arch, a front door in the left counter and, in the middle, an engraved wall lantern on its scrolled bracket whose light is the bare paper. The lines are fewer and heavier than before so the vignettes hold at small sizes. The vermilion seal on the right is the mark: the same wall lantern on its bracket, cut out of a scalloped disc.
Palette: paper #f3ebd3, green-black ink #12261d, lathe green #2f5c47, underprint #c3d3b6, vermilion #c63f28, cream #fff7e3.
Type: Academy Engraved capitals for the name, Copperplate Bold for the tagline and the small line.
Tagline: Keep private things private.
From: 39 Engraved certificate
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logo(false),
  'logo-dark.svg': logo(true),
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
