// 56 Lantern shadow-box II: 51 with the thing it protects inside it. The paper
// lantern's window is a shadow box holding a front door and its steps, lit by
// their own porch light cut from amber. The mark is the lantern on its glow.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '56-lantern-shadowbox-two';
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
  wall: '#2f3a7c',
  lit3: '#514f96',
  lit2: '#86688a',
  lit1: '#d39a5a',
  door: '#161b45',
  panel: '#232b63',
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
// x = 0, from y = 182 (the top of its arch) down to B. Everything is set out
// from B, so a shorter window simply shows less sky.
function scene(B, id, { rich = true } = {}) {
  const T = 182;
  const G = B - 24; // the ground line
  const D = G - 30; // the threshold, above three steps
  const DT = D - 104; // top of the door
  const E = D - 136; // the eaves
  const LX = 50; // the porch light
  const LY = DT + 34;
  let b = '';
  b += `<rect x="-110" y="${T - 6}" width="220" height="${B - T + 12}" fill="${C.sky}"/>`;
  if (rich) {
    b += `<g filter="url(#${id}t)"><circle cx="62" cy="${T + 40}" r="36" fill="${C.halo2}"/></g>`;
    b += `<g filter="url(#${id}t)"><circle cx="62" cy="${T + 40}" r="24" fill="${C.halo1}"/></g>`;
    b += `<g filter="url(#${id}t)"><circle cx="62" cy="${T + 40}" r="13" fill="${C.moon}"/></g>`;
    b += `<g filter="url(#${id}t)" fill="${C.moon}">${[[-50, T + 50, 4], [-14, T + 24, 3], [-70, T + 84, 2.6], [14, T + 22, 2.2]].map(([x, y, s]) => `<path d="${star(x, y, s)}"/>`).join('')}</g>`;
  }
  // the wall, and the light on it: three rings of warmer paper
  b += `<g transform="translate(-8 ${B}) scale(1.12) translate(0 ${-B})">`;
  b += `<clipPath id="${id}wl"><rect x="-112" y="${E}" width="224" height="${G - E}"/></clipPath>`;
  b += `<g filter="url(#${id}s)"><rect x="-112" y="${E}" width="224" height="${G - E + 4}" fill="${C.wall}"/></g>`;
  b += `<g clip-path="url(#${id}wl)">`;
  b += `<g filter="url(#${id}t)"><circle cx="${LX}" cy="${LY + 8}" r="96" fill="${C.lit3}"/></g>`;
  b += `<g filter="url(#${id}t)"><circle cx="${LX}" cy="${LY + 6}" r="64" fill="${C.lit2}"/></g>`;
  b += `<g filter="url(#${id}t)"><circle cx="${LX}" cy="${LY + 4}" r="34" fill="${C.lit1}"/></g>`;
  b += `</g>`;
  // the porch roof
  b += `<g filter="url(#${id}s)" fill="${C.near}"><path d="M-124,${E + 12}L-12,${E - 44}L124,${E + 12}V${E + 22}H-124Z"/></g>`;
  // door case, door, and its panels
  b += `<g filter="url(#${id}s)"><rect x="-62" y="${DT - 9}" width="78" height="${D - DT + 9}" fill="${C.mat}"/></g>`;
  b += `<g filter="url(#${id}t)"><rect x="-54" y="${DT}" width="62" height="${D - DT}" fill="${C.door}"/></g>`;
  b += `<rect x="-47" y="${DT + 8}" width="20" height="38" fill="${C.panel}"/><rect x="-19" y="${DT + 8}" width="20" height="38" fill="${C.panel}"/><rect x="-47" y="${DT + 54}" width="20" height="42" fill="${C.panel}"/><rect x="-19" y="${DT + 54}" width="20" height="42" fill="${C.panel}"/>`;
  b += `<circle cx="2" cy="${DT + 52}" r="2.8" fill="${C.amber1}"/>`;
  // the porch light: a small wall lantern on its bracket
  b += `<g filter="url(#${id}t)" fill="${C.front}"><path d="M${LX - 22},${LY - 22}H${LX - 17}V${LY - 4}H${LX - 22}Z"/><path d="M${LX - 18},${LY - 19}H${LX + 2}V${LY - 14}H${LX - 18}Z"/><path d="M${LX - 11},${LY - 10}L${LX},${LY - 18}L${LX + 11},${LY - 10}Z"/><path d="M${LX - 8},${LY + 11}H${LX + 8}L${LX + 4},${LY + 16}H${LX - 4}Z"/></g>`;
  b += `<path d="M${LX - 9},${LY - 10}H${LX + 9}L${LX + 7},${LY + 11}H${LX - 7}Z" fill="${C.amber1}"/><path d="M${LX - 4},${LY - 7}H${LX + 4}L${LX + 3},${LY + 8}H${LX - 3}Z" fill="${C.moon}"/>`;
  // the ground, the pool of light on it, and three lit steps
  b += `<g filter="url(#${id}s)"><rect x="-112" y="${G}" width="224" height="${B - G + 8}" fill="${C.front}"/></g>`;
  b += `<g filter="url(#${id}t)"><ellipse cx="-14" cy="${G + 10}" rx="74" ry="9" fill="${C.amber3}"/></g>`;
  b += `<g filter="url(#${id}t)"><rect x="-86" y="${D + 20}" width="126" height="10" fill="${C.amber3}"/></g>`;
  b += `<g filter="url(#${id}t)"><rect x="-76" y="${D + 10}" width="106" height="10" fill="${C.amber2}"/></g>`;
  b += `<g filter="url(#${id}t)"><rect x="-66" y="${D}" width="86" height="10" fill="${C.amber1}"/></g>`;
  // clipped bays in pots either side, in front of everything
  if (rich) {
    b += `<g filter="url(#${id}s)" fill="${C.front}"><path d="M-104,${G}V${G - 52}C-104,${G - 80} -84,${G - 80} -84,${G - 52}V${G}Z"/><path d="M84,${G}V${G - 44}C84,${G - 70} 106,${G - 70} 106,${G - 44}V${G}Z"/></g>`;
  }
  b += `</g>`;
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
// The lantern in front of the light it gives: two rings of warm paper make the
// silhouette round, so it is as wide as it is tall.
function markBody(id) {
  const L = lantern(id, { bodyH: 214, rich: false });
  const s = 186 / L.height;
  return `<defs>${L.defs}</defs>
<circle cx="100" cy="104" r="94" fill="${C.ring2}"/><circle cx="100" cy="104" r="66" fill="${C.ring1}"/>
<g transform="translate(100 7) scale(${f(s * 1000) / 1000})">${L.body}</g>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('m') });

// ---- favicons, on the pixel grid ---------------------------------------------------------
const PIX = { I: '#2b3160', S: '#55528f', C: C.moon, H: '#171c44', A: C.amber1, a: C.amber2, R: C.ring2 };
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
  '.....IIIIII.....',
  '...IIIIIIIIII...',
  '.IIIIIIIIIIIIII.',
  '..IIIIIIIIIIII..',
  '..ISSSSSSSSSSI..',
  '..ISHHHHSSSSSI..',
  '..ISHHHHSAASSI..',
  '..ISHHHHSAASSI..',
  '..ISHHHHSSSSSI..',
  '..ISHHHHSSSSSI..',
  '..IaaaaaaaSSSI..',
  '..IIIIIIIIIIII..',
  '.IIIIIIIIIIIIII.',
  '....IIIIIIII....',
  '.......II.......',
];
const FAV32 = [
  '..............IIII..............',
  '.............II..II.............',
  '..............IIII..............',
  '............IIIIIIII............',
  '.........IIIIIIIIIIIIII.........',
  '......IIIIIIIIIIIIIIIIIIII......',
  '....IIIIIIIIIIIIIIIIIIIIIIII....',
  '..IIIIIIIIIIIIIIIIIIIIIIIIIIII..',
  '..IIIIIIIIIIIIIIIIIIIIIIIIIIII..',
  '....IIIIIIIIIIIIIIIIIIIIIIII....',
  '....IISSSSSSSSSSSSSSSSSSSSII....',
  '....IISSSSSSSSSSSSSSSSSSSSII....',
  '....IISSIIIIIIIIIISSSSSSSSII....',
  '....IISSIHHHHHHHHISSSIISSSII....',
  '....IISSIHHHHHHHHISSAAAASSII....',
  '....IISSIHHHHHHHHISSACCASSII....',
  '....IISSIHHHHHHHHISSACCASSII....',
  '....IISSIHHHHHHHHISSAAAASSII....',
  '....IISSIHHHHHHAHISSSIISSSII....',
  '....IISSIHHHHHHHHISSSSSSSSII....',
  '....IISSIHHHHHHHHISSSSSSSSII....',
  '....IISSIHHHHHHHHISSSSSSSSII....',
  '....IISAAAAAAAAAAAASSSSSSSII....',
  '....IIaaaaaaaaaaaaaaaSSSSSII....',
  '....IIIIIIIIIIIIIIIIIIIIIIII....',
  '..IIIIIIIIIIIIIIIIIIIIIIIIIIII..',
  '..IIIIIIIIIIIIIIIIIIIIIIIIIIII..',
  '......IIIIIIIIIIIIIIIIIIII......',
  '........IIIIIIIIIIIIIIII........',
  '..............IIII..............',
  '..............IIII..............',
  '................................',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- icon --------------------------------------------------------------------------------
function iconBody() {
  const L = lantern('i', { bodyH: 236, rich: false, shadow: '#070919' });
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
  return `
${nest({ x: 12, y: 10, w: 180, h: 180, vb: '0 0 200 200', body: markBody('lg') })}
${wordmark(208, 112, 76, dark ? C.paper : C.ink, 'lgc')}
<text x="212" y="150" font-family="Gill Sans" font-weight="600" font-size="24" letter-spacing="0.3" fill="${dark ? '#b9bcd6' : C.sub}">Know what’s on your doorstep.</text>`;
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
<g filter="url(#mo)">${moth(1190, 226, 1.0, 28)}</g>
<g filter="url(#type)">${wordmark(84, 322, 110, C.ink, 'hc')}</g>
<text x="89" y="384" font-family="Gill Sans" font-weight="600" font-size="37.5" letter-spacing="0.4" fill="${C.sub}">Know what’s on your doorstep.</text>
<text x="90" y="436" font-family="Gill Sans" font-weight="600" font-size="15" letter-spacing="3.4" fill="${C.sub}" opacity="0.85">YOUR REPOS · YOUR SERVERS · YOUR COMPUTER</text>
<rect width="1280" height="640" filter="url(#grain)"/>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 56 Lantern shadow-box II

Concept 51 with the thing it protects inside it. The paper lantern's window is still a shadow box, but the layers behind the indigo frame now show a front door and its three steps, lit by their own small wall lantern: three rings of warmer paper on the wall, amber steps, a pool of light on the ground, the porch roof and a moon above. The lantern hangs in front of the warm paper rings it throws. The mark is the lantern on two of those rings, so it is round and as wide as it is tall; the moths are down to one.
Palette: paper #efe6d3, glow #f2dfb8 / #f5d294 / #f8c36c, frame #232846, mat #3a4380, sky #40509a, wall #2f3a7c lit #514f96 / #86688a / #d39a5a, door #161b45, amber #f9c56d / #ee9a3f.
Type: Gill Sans Bold for the name, Gill Sans SemiBold for the tagline and the small tracked capitals.
Tagline: Know what's on your doorstep.
From: 51 Lantern shadow-box
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
