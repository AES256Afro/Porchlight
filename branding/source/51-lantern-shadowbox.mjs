// 51 Lantern shadow-box: a paper lantern whose window is a shadow box. Behind
// the frame and its mat sit layers of night-blue paper: a moon, two hills, a
// small house with its own porch light cut from amber. The mark is the lantern.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '51-lantern-shadowbox';
const C = {
  paper: '#efe6d3',
  ring3: '#f2dfb8',
  ring2: '#f5d294',
  ring1: '#f8c36c',
  frame: '#232846',
  brim: '#2f366a',
  mat: '#3a4380',
  sky: '#40509a',
  halo2: '#4a5ba8',
  halo1: '#5769b6',
  moon: '#f7edd2',
  far: '#313c7e',
  mid: '#252d63',
  near: '#191f49',
  front: '#10142f',
  house: '#12163a',
  pane: '#2c3672',
  amber1: '#f9c56d',
  amber2: '#ee9a3f',
  amber3: '#8b6a5c',
  path: '#6a5a68',
  ink: '#232846',
  sub: '#5b6082',
  moth: '#fbf6ea',
  mothBody: '#d8c8a6',
};
const f = (n) => Math.round(n * 10) / 10;

// ---- paper -------------------------------------------------------------------------
// The shadow one sheet throws on the sheet behind it.
const sh = (id, dy, sd, op, color = '#070919', dx = 0) =>
  `<filter id="${id}" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${sd}" flood-color="${color}" flood-opacity="${op}"/></filter>`;
const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.18  0 0 0 0 0.1  0 0 0 0.11 0"/></filter>`;

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
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? 'Z' : '');
}
// A hill: a hand-cut ridge through the anchors, closed along the bottom.
function hill(anchors, bottom, seed = 1, jit = 1.1) {
  const r = rng(seed);
  const pts = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [x0, y0] = anchors[k];
    const [x1, y1] = anchors[k + 1];
    pts.push([x0, y0]);
    pts.push([(x0 + x1) / 2 + (r() - 0.5) * 6, (y0 + y1) / 2 + (r() - 0.5) * 2 * jit]);
  }
  pts.push(anchors[anchors.length - 1]);
  const last = pts[pts.length - 1];
  return smooth(pts) + `L${f(last[0])} ${bottom}L${f(pts[0][0])} ${bottom}Z`;
}
// A pine cut with a few straight knife strokes.
function pine(x, base, h, w, seed) {
  const r = rng(seed);
  const tiers = 3 + (h > 40 ? 1 : 0);
  const right = [];
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers;
    const y = base - h + h * 0.88 * t;
    const tip = (w / 2) * (0.34 + 0.66 * t) * (0.92 + 0.16 * r());
    right.push([x + tip, y]);
    if (i < tiers) right.push([x + tip * 0.44, y - h * 0.04]);
  }
  const tw = Math.max(1, w * 0.07);
  right.push([x + tw, base - h * 0.1], [x + tw, base + 3]);
  const left = right.map(([px, py]) => [x - (px - x) * (0.94 + 0.12 * r()), py]).reverse();
  return 'M' + [[x, base - h], ...right, ...left].map(([a, b]) => `${f(a)} ${f(b)}`).join('L') + 'Z';
}
const star = (x, y, s) => `M${f(x)} ${f(y - s)}L${f(x + s * 0.3)} ${f(y - s * 0.3)}L${f(x + s)} ${f(y)}L${f(x + s * 0.3)} ${f(y + s * 0.3)}L${f(x)} ${f(y + s)}L${f(x - s * 0.3)} ${f(y + s * 0.3)}L${f(x - s)} ${f(y)}L${f(x - s * 0.3)} ${f(y - s * 0.3)}Z`;

// ---- the scene in the window ---------------------------------------------------------
// Drawn in the lantern's own coordinates: the window is 208 wide, centred on
// x = 0, from y = 182 (the top of its arch) down to B.
function house(id) {
  // origin at the middle of the doorstep
  return `
<g filter="url(#${id}s)" fill="${C.house}">
  <path d="M-31,0V-34H31V0Z"/>
  <path d="M-40,-32L0,-66L40,-32Z"/>
  <rect x="15" y="-66" width="9" height="20"/>
</g>
<rect x="-25" y="-29" width="9" height="9" fill="${C.pane}"/><rect x="16" y="-29" width="9" height="9" fill="${C.pane}"/><circle cx="0" cy="-46" r="4" fill="${C.pane}"/>
<rect x="-21" y="-17" width="42" height="17" fill="${C.amber3}"/>
<g filter="url(#${id}t)"><circle cx="11" cy="-8.5" r="7.6" fill="${C.amber2}"/></g>
<rect x="-10" y="-14" width="10.5" height="14" fill="${C.front}"/>
<circle cx="11" cy="-8.5" r="3.6" fill="${C.amber1}"/>
<g filter="url(#${id}t)" fill="${C.mat}"><path d="M-22,-23H22L28,-16H-28Z"/><rect x="-23" y="-16" width="3" height="16"/><rect x="20" y="-16" width="3" height="16"/></g>
<g filter="url(#${id}t)"><rect x="-26" y="-1" width="52" height="3.6" fill="${C.amber2}"/><rect x="-11" y="2.6" width="24" height="3.4" fill="${C.amber1}"/></g>`;
}
function scene(B, id, { rich = true } = {}) {
  const hx = -10;
  const hy = B - 112;
  const k = 1.32; // the house, larger than the hills would have it
  const T = 182;
  let b = '';
  b += `<rect x="-110" y="${T - 6}" width="220" height="${B - T + 12}" fill="${C.sky}"/>`;
  b += `<g filter="url(#${id}t)"><circle cx="50" cy="${T + 74}" r="52" fill="${C.halo2}"/></g>`;
  b += `<g filter="url(#${id}t)"><circle cx="50" cy="${T + 74}" r="35" fill="${C.halo1}"/></g>`;
  b += `<g filter="url(#${id}t)"><circle cx="50" cy="${T + 74}" r="20" fill="${C.moon}"/></g>`;
  const stars = rich
    ? [[-60, T + 62, 4.4], [-22, T + 38, 3.2], [-70, T + 112, 2.8], [-34, T + 96, 2.4], [0, T + 122, 2.8], [84, T + 140, 2.6], [-4, T + 66, 2.2]]
    : [[-58, T + 64, 5.4], [-22, T + 40, 3.8], [-66, T + 112, 3.4]];
  b += `<g filter="url(#${id}t)" fill="${C.moon}">${stars.map(([x, y, s]) => `<path d="${star(x, y, s)}"/>`).join('')}</g>`;

  // far hill
  b += `<g filter="url(#${id}s)" fill="${C.far}"><path d="${hill([[-110, B - 150], [-60, B - 170], [-4, B - 152], [56, B - 174], [110, B - 158]], B + 6, 3)}"/>`;
  if (rich) b += `<path d="${pine(-84, B - 162, 24, 12, 2)}"/><path d="${pine(-70, B - 166, 18, 9, 3)}"/><path d="${pine(66, B - 171, 26, 13, 4)}"/><path d="${pine(81, B - 166, 19, 10, 5)}"/><path d="${pine(95, B - 162, 23, 11, 6)}"/>`;
  b += `</g>`;

  // the hill the house stands on, the pool of light on it and the path down
  b += `<g filter="url(#${id}s)" fill="${C.mid}"><path d="${hill([[-110, B - 96], [-56, B - 118], [10, B - 110], [62, B - 122], [110, B - 110]], B + 6, 5)}"/></g>`;
  b += `<g filter="url(#${id}t)"><ellipse cx="${hx + 5}" cy="${hy + 10}" rx="54" ry="11" fill="${C.amber3}"/></g>`;
  b += `<g filter="url(#${id}t)"><ellipse cx="${hx + 8}" cy="${hy + 9}" rx="32" ry="6.5" fill="${C.amber2}"/></g>`;
  b += `<g filter="url(#${id}t)"><path d="M${hx + 2},${hy + 13}C${hx + 6},${hy + 34} ${hx + 32},${hy + 46} ${hx + 70},${hy + 62}L${hx + 48},${hy + 64}C${hx + 18},${hy + 50} ${hx - 10},${hy + 36} ${hx - 12},${hy + 14}Z" fill="${C.path}"/></g>`;
  b += `<g transform="translate(${hx} ${hy}) scale(${k})">${house(id)}</g>`;

  // near hill, with pines either side
  b += `<g filter="url(#${id}s)" fill="${C.near}"><path d="${hill([[-110, B - 36], [-58, B - 54], [0, B - 42], [50, B - 48], [110, B - 66]], B + 6, 7)}"/><path d="${pine(-84, B - 44, 70, 34, 8)}"/><path d="${pine(-56, B - 50, 44, 22, 9)}"/><path d="${pine(88, B - 58, 80, 38, 10)}"/>${rich ? `<path d="${pine(62, B - 49, 38, 19, 11)}"/>` : ''}</g>`;
  b += `<g filter="url(#${id}s)" fill="${C.front}"><path d="${hill([[-110, B - 12], [-40, B - 21], [20, B - 12], [110, B - 23]], B + 6, 12)}"/></g>`;
  return b;
}

// ---- the lantern -----------------------------------------------------------------------
// Origin at the centre of the hanging ring's top. bodyH sets how tall the box is.
function lantern(id, { bodyH = 338, frame = C.frame, brim = C.brim, mat = C.mat, rich = true, string = 0, shadow = '#070919' } = {}) {
  const y0 = 162;
  const y1 = y0 + bodyH;
  const B = y1 - 22; // bottom of the window
  const arch = (hw, top, bot) => `M${-hw},${bot}V${top + hw}A${hw},${hw} 0 0 1 ${hw},${top + hw}V${bot}Z`;
  const win = arch(104, 182, B);
  const win2 = arch(94, 192, B - 10);
  const defs = `${sh(`${id}s`, 2.4, 2.2, 0.55, shadow)}${sh(`${id}t`, 1.2, 1.1, 0.5, shadow)}${sh(`${id}f`, 3.4, 3.2, 0.62, shadow)}<clipPath id="${id}w"><path d="${win}"/></clipPath>`;
  const vent = (x, y) => `<circle cx="${x}" cy="${y}" r="7" fill="${C.amber2}"/><circle cx="${x + 0.7}" cy="${y + 1.3}" r="5.4" fill="${C.amber1}"/>`;
  const body = `
${string ? `<path d="M0,${-string}V12" stroke="${frame}" stroke-width="3.4"/>` : ''}
<g clip-path="url(#${id}w)">${scene(B, id, { rich })}</g>
<g filter="url(#${id}f)"><path d="${win}${win2}" fill="${mat}" fill-rule="evenodd"/></g>
<g filter="url(#${id}f)"><path d="M-126,${y0}H126V${y1}H-126Z${win}" fill="${frame}" fill-rule="evenodd"/></g>
<g filter="url(#${id}t)" fill="${brim}"><rect x="-128" y="${y0}" width="11" height="${bodyH}"/><rect x="117" y="${y0}" width="11" height="${bodyH}"/></g>
<g filter="url(#${id}s)" fill="${frame}">
  <path d="M0,2A20,20 0 1 0 0.01,2ZM0,12A10,10 0 1 1 -0.01,12Z" fill-rule="evenodd"/>
  <rect x="-12" y="40" width="24" height="22" rx="3"/>
  <path d="M-38,58H38L120,118Q134,128 134,140V152H-134V140Q-134,128 -120,118Z"/>
</g>
${vent(-46, 124)}${vent(0, 124)}${vent(46, 124)}
<g filter="url(#${id}s)"><rect x="-146" y="146" width="292" height="18" rx="5" fill="${brim}"/></g>
<g filter="url(#${id}s)" fill="${frame}">
  <path d="M-100,${y1 + 16}H100L74,${y1 + 46}H-74Z"/>
  <circle cx="0" cy="${y1 + 58}" r="13"/>
</g>
<g filter="url(#${id}s)"><rect x="-146" y="${y1 - 2}" width="292" height="20" rx="5" fill="${brim}"/></g>`;
  return { defs, body, height: y1 + 71 };
}

// ---- mark ------------------------------------------------------------------------------
function markBody(id, dark = false) {
  const L = lantern(id, {
    bodyH: 262,
    rich: false,
    frame: dark ? C.paper : C.frame,
    brim: dark ? '#dccfb2' : C.brim,
    mat: dark ? '#cfc2a6' : C.mat,
  });
  const s = 196 / L.height;
  return `<defs>${L.defs}</defs><g transform="translate(100 2) scale(${f(s * 100) / 100})">${L.body}</g>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('m') });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('m', true) });

// ---- favicons, on the pixel grid ---------------------------------------------------------
const PIX = { I: '#2b3160', S: '#46569f', C: C.moon, H: '#171c44', A: C.amber1, a: C.amber2 };
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
  '.......II.......',
  '......IIII......',
  '....IIIIIIII....',
  '..IIIIIIIIIIII..',
  '...IIIIIIIIII...',
  '...ISSSSSCCSI...',
  '...ISSSSSCCSI...',
  '...ISSSSSSSSI...',
  '...ISSSHHSSSI...',
  '...ISHHHHHHSI...',
  '...IHHHAAHHHI...',
  '...IHHHAAHHHI...',
  '...IIIIIIIIII...',
  '..IIIIIIIIIIII..',
  '.....IIIIII.....',
  '.......II.......',
];
const FAV32 = [
  '..............IIII..............',
  '.............II..II.............',
  '.............II..II.............',
  '..............IIII..............',
  '.............IIIIII.............',
  '...........IIIIIIIIII...........',
  '.........IIIIIIIIIIIIII.........',
  '.......IIIIIIIIIIIIIIIIII.......',
  '.....IIIIIIIIIIIIIIIIIIIIII.....',
  '....IIIIIIIIIIIIIIIIIIIIIIII....',
  '......IIIIIIIIIIIIIIIIIIII......',
  '......IISSSSSSSSSSSSSSSSII......',
  '......IISSSSSSSSSSSCCCSSII......',
  '......IISSSCSSSSSSCCCCCSII......',
  '......IISSSSSSSSSSCCCCCSII......',
  '......IISSSSSSSCSSSCCCSSII......',
  '......IISSSSSSSSSSSSSSSSII......',
  '......IISSSSSSSSHHSSSSSSII......',
  '......IISSSSSSSHHHHSSSSSII......',
  '......IISSSSSSHHHHHHSSSSII......',
  '......IIHHSSSHHHHHHHHSHHII......',
  '......IIHHHHHHHHHaaHHHHHII......',
  '......IIHHHHHHAAHaAaHHHHII......',
  '......IIHHHHHHAAHHaHHHHHII......',
  '......IIHHHHHaAAaHHHHHHHII......',
  '......IIIIIIIIIIIIIIIIIIII......',
  '....IIIIIIIIIIIIIIIIIIIIIIII....',
  '.....IIIIIIIIIIIIIIIIIIIIII.....',
  '.........IIIIIIIIIIIIII.........',
  '...........IIIIIIIIII...........',
  '..............IIII..............',
  '..............IIII..............',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- icon --------------------------------------------------------------------------------
function iconBody() {
  const L = lantern('i', { bodyH: 262, rich: false, shadow: '#070919' });
  const s = 404 / L.height;
  return `
<defs>${L.defs}${sh('ir', 3, 3.5, 0.3, '#6b4a1e')}${sh('io', 10, 9, 0.42, '#5a3c14')}<clipPath id="ib"><rect width="512" height="512" rx="112"/></clipPath></defs>
<g clip-path="url(#ib)">
  <rect width="512" height="512" fill="${C.paper}"/>
  <g filter="url(#ir)"><circle cx="256" cy="268" r="262" fill="${C.ring3}"/></g>
  <g filter="url(#ir)"><circle cx="256" cy="268" r="196" fill="${C.ring2}"/></g>
  <g filter="url(#ir)"><circle cx="256" cy="268" r="130" fill="${C.ring1}"/></g>
  <g filter="url(#io)"><g transform="translate(256 54) scale(${f(s * 1000) / 1000})">${L.body}</g></g>
</g>`;
}
const iconSvg = svg({ w: 512, h: 512, vb: '0 0 512 512', body: iconBody() });

// ---- logo --------------------------------------------------------------------------------
// Gill Sans Bold at 100 px: the i's dot sits at x 327.9-345.5, from 68.6 down to about 54 above the baseline.
function wordmark(x, y, size, fill, id) {
  const k = size / 100;
  const dx = x + 336.7 * k;
  const dy = y - 61 * k;
  return `
<clipPath id="${id}"><path clip-rule="evenodd" d="M${x - 20},${y - size}H${x + 540 * k}V${y + size * 0.4}H${x - 20}ZM${f(x + 324 * k)},${f(y - 73 * k)}H${f(x + 349.5 * k)}V${f(y - 52.5 * k)}H${f(x + 324 * k)}Z"/></clipPath>
<g clip-path="url(#${id})"><text x="${x}" y="${y}" font-family="Gill Sans" font-weight="700" font-size="${size}" fill="${fill}">Porchlight</text></g>
<circle cx="${f(dx)}" cy="${f(dy)}" r="${f(10.6 * k)}" fill="${C.amber2}"/>
<circle cx="${f(dx)}" cy="${f(dy)}" r="${f(6.2 * k)}" fill="${C.amber1}"/>`;
}
function logo(dark) {
  const L = lantern('lg', {
    bodyH: 262,
    rich: false,
    frame: dark ? C.paper : C.frame,
    brim: dark ? '#dccfb2' : C.brim,
    mat: dark ? '#cfc2a6' : C.mat,
  });
  const s = 176 / L.height;
  return `
<defs>${L.defs}</defs>
<g transform="translate(78 12) scale(${f(s * 1000) / 1000})">${L.body}</g>
${wordmark(170, 112, 82, dark ? C.paper : C.ink, 'lgc')}
<text x="174" y="152" font-family="Gill Sans" font-weight="600" font-size="24.5" letter-spacing="0.3" fill="${dark ? '#b9bcd6' : C.sub}">Home security for your code.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero --------------------------------------------------------------------------------
function moth(x, y, s, rot) {
  // cut from two papers and folded down the middle, so one side sits a shade darker
  const wing = (m, fore, hind) => `
  <path d="M${4 * m},4L${20 * m},6C${25 * m},12 ${21 * m},23 ${12 * m},25C${6 * m},23 ${3 * m},15 ${2 * m},8Z" fill="${hind}"/>
  <path d="M${2 * m},-6L${35 * m},-17C${38 * m},-8 ${31 * m},3 ${20 * m},7L${4 * m},5Z" fill="${fore}"/>
  <path d="M${27 * m},-13C${28 * m},-6 ${24 * m},1 ${17 * m},4" fill="none" stroke="${C.mothBody}" stroke-width="1.6"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
  ${wing(-1, C.moth, '#eadfc6')}${wing(1, '#f1e8d3', '#e0d3b6')}
  <path d="M0,-10C3.6,-6 3.6,10 0,15C-3.6,10 -3.6,-6 0,-10Z" fill="${C.mothBody}"/>
  <circle cx="0" cy="-11" r="3.2" fill="${C.mothBody}"/>
  <path d="M-1.4,-13C-3,-19 -7,-23 -12,-24M1.4,-13C3,-19 7,-23 12,-24" fill="none" stroke="${C.mothBody}" stroke-width="1.3" stroke-linecap="round"/>
</g>`;
}
function hero() {
  const LX = 1004;
  const L = lantern('h', { string: 80 });
  const sc = 0.9;
  const top = 50;
  const cy = top + 330 * sc;
  return `
<defs>${L.defs}${GRAIN}${sh('ring', 3, 4, 0.26, '#6b4a1e')}${sh('obj', 14, 12, 0.4, '#5a3c14', 4)}${sh('type', 2.4, 1.7, 0.3, '#3a2c14')}${sh('mo', 5, 3.5, 0.32, '#5a3c14', 2)}${sh('land', -2, 2.4, 0.2, '#6b4a1e')}</defs>
<rect width="1280" height="640" fill="${C.paper}"/>
<g filter="url(#land)" fill="#eadfc9"><path d="${hill([[-10, 520], [150, 486], [330, 508], [520, 474], [760, 512], [1000, 486], [1290, 520]], 650, 21, 2)}"/><path d="${pine(196, 496, 58, 28, 22)}"/><path d="${pine(228, 500, 40, 20, 23)}"/><path d="${pine(548, 482, 50, 24, 24)}"/></g>
<g filter="url(#land)" fill="#e3d8be"><path d="${hill([[-10, 584], [120, 560], [300, 580], [470, 556], [700, 590], [960, 570], [1290, 598]], 650, 25, 2)}"/><path d="${pine(64, 572, 66, 32, 26)}"/><path d="${pine(102, 568, 44, 22, 27)}"/><path d="${pine(404, 566, 54, 26, 28)}"/></g>
<g filter="url(#ring)"><circle cx="${LX}" cy="${cy}" r="340" fill="${C.ring3}"/></g>
<g filter="url(#ring)"><circle cx="${LX}" cy="${cy}" r="252" fill="${C.ring2}"/></g>
<g filter="url(#ring)"><circle cx="${LX}" cy="${cy}" r="168" fill="${C.ring1}"/></g>
<g filter="url(#obj)"><g transform="translate(${LX} ${top}) scale(${sc})">${L.body}</g></g>
<g filter="url(#mo)">${moth(1184, 216, 1.12, 28)}${moth(822, 426, 0.9, -40)}${moth(1200, 470, 0.66, 70)}</g>
<g filter="url(#type)">${wordmark(84, 322, 110, C.ink, 'hc')}</g>
<text x="89" y="384" font-family="Gill Sans" font-weight="600" font-size="37.5" letter-spacing="0.4" fill="${C.sub}">Home security for your code.</text>
<rect width="1280" height="640" filter="url(#grain)"/>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 51 Lantern shadow-box

A paper lantern whose window is a shadow box. Behind the indigo frame and its mat sit layers of night-blue paper, each with a tight shadow on the one behind: a moon in its halo, a far hill, the hill with a small house whose own porch light, steps and pool of light are cut from amber, then pines and a dark foreground. The lantern hangs in front of three warm paper rings, the light it throws, and the dot of the i is the same amber. The mark is the lantern.
Palette: paper #efe6d3, glow #f2dfb8 / #f5d294 / #f8c36c, frame #232846, mat #3a4380, sky #40509a, hills #313c7e / #252d63 / #191f49 / #10142f, moon #f7edd2, amber #f9c56d / #ee9a3f.
Type: Gill Sans Bold for the name, Gill Sans SemiBold for the tagline.
Tagline: Home security for your code.
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
