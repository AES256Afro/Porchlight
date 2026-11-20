// 15 Flat porch: a warm flat illustration. A sage porch at night, a plum
// door, a brass lantern, a cat asleep on the doormat, a rocking chair, a
// fiddle-leaf fig, two moths. The light is drawn as stepped flat shapes.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '15-flat-porch';
const C = {
  sky: '#2a1c30',
  sky2: '#33233a',
  night: '#1e1424',
  lawn: '#241a2b',
  star: '#f3e7cf',
  wall: '#5b7663',
  wallLine: '#4b6553',
  ceiling: '#3a4c40',
  roof: '#21162a',
  trim: '#efe2c6',
  trimShade: '#c8b597',
  door: '#5e2b45',
  doorPanel: '#4c2238',
  doorLit: '#79385a',
  brass: '#c39a48',
  brassHi: '#ecc97c',
  brassDark: '#86642a',
  glass: '#ffe29a',
  glassHot: '#fff6d8',
  wood: '#7c5236',
  woodDark: '#5d3c27',
  woodLine: '#52341f',
  lattice: '#2a1d2f',
  mat: '#b8803f',
  matDark: '#8f5d2c',
  cat: '#d6843f',
  catLit: '#eda65d',
  catDark: '#b0632a',
  catCream: '#f4e3c6',
  pot: '#b5583a',
  potLit: '#cf704c',
  potDark: '#8e4029',
  leaf: '#3f5946',
  leafLit: '#5f7f5f',
  rib: '#86a17e',
  cushion: '#b6533e',
  cushionLit: '#d06a4c',
  blanket: '#d9a646',
  ink: '#2a1c30',
  numeral: '#2a1c30',
  riser: '#a99878',
  doorGlass: '#3a1a2c',
  doorGlassHi: '#6b3b54',
  latticeLine: '#40304a',
};
const FONT = 'Seravek';

// Light: a screen blend toward warm tungsten, per colour, for each step.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const screen = (c, w, t) => hex(rgb(c).map((v, i) => 255 - ((255 - v) * (255 - rgb(w)[i] * t)) / 255));
const LIGHT = '#ffa338';
const lit = (P, t) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.startsWith('#') ? screen(v, LIGHT, t) : v]));
const LEVELS = [0.17, 0.33, 0.5];

const leafPath = (len, w) => `M0 0C${w} ${-len * 0.2} ${w * 1.15} ${-len * 0.78} 0 ${-len}C${-w * 1.15} ${-len * 0.78} ${-w} ${-len * 0.2} 0 0Z`;

function plant(x, floor, C) {
  // fiddle-leaf fig in a terracotta pot; x is the pot's centre
  let b = '';
  const stems = [
    [x - 4, floor - 58, x - 18, floor - 150],
    [x + 2, floor - 58, x + 14, floor - 190],
    [x + 6, floor - 58, x + 30, floor - 120],
  ];
  for (const [x1, y1, x2, y2] of stems) b += `<path d="M${x1} ${y1}Q${(x1 + x2) / 2 - 6} ${(y1 + y2) / 2} ${x2} ${y2}" stroke="${C.leaf}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  const leaves = [
    [x - 18, floor - 148, -24, 64, 22, false],
    [x - 14, floor - 118, -62, 58, 20, false],
    [x - 20, floor - 140, 22, 50, 18, true],
    [x + 14, floor - 188, -6, 66, 23, true],
    [x + 12, floor - 160, 44, 58, 20, true],
    [x + 6, floor - 150, -44, 54, 19, false],
    [x + 30, floor - 118, 62, 56, 20, true],
    [x + 26, floor - 100, 104, 46, 17, true],
    [x - 6, floor - 84, -96, 48, 17, false],
  ];
  for (const [lx, ly, rot, len, w, lit] of leaves) {
    b += `<g transform="translate(${lx} ${ly}) rotate(${rot})"><path d="${leafPath(len, w)}" fill="${lit ? C.leafLit : C.leaf}"/><path d="M0 -4L0 ${-len * 0.86}" stroke="${C.rib}" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/></g>`;
  }
  // pot
  b += `<path d="M${x - 34} ${floor - 58}H${x + 34}L${x + 27} ${floor}H${x - 27}Z" fill="${C.pot}"/>`;
  b += `<path d="M${x + 6} ${floor - 58}H${x + 34}L${x + 27} ${floor}H${x + 4}Z" fill="${C.potLit}"/>`;
  b += `<rect x="${x - 40}" y="${floor - 66}" width="80" height="14" rx="3" fill="${C.potLit}"/>`;
  b += `<rect x="${x - 40}" y="${floor - 54}" width="80" height="4" fill="${C.potDark}" opacity="0.6"/>`;
  return b;
}

function lantern(cx, top, s = 1) {
  // a brass wall lantern: wall plate, cap, glass with a bulb, base, drop
  const P = (v) => +(v * s).toFixed(2);
  let b = `<g transform="translate(${cx} ${top})">`;
  b += `<rect x="${P(-7)}" y="${P(-10)}" width="${P(14)}" height="${P(64)}" rx="${P(7)}" fill="${C.brassDark}"/>`;
  b += `<circle cx="0" cy="${P(-18)}" r="${P(5)}" fill="${C.brass}"/>`;
  b += `<path d="M${P(-6)} ${P(-14)}H${P(6)}L${P(22)} ${P(2)}H${P(-22)}Z" fill="${C.brass}"/>`;
  b += `<path d="M0 ${P(-14)}H${P(6)}L${P(22)} ${P(2)}H0Z" fill="${C.brassHi}"/>`;
  b += `<rect x="${P(-25)}" y="${P(2)}" width="${P(50)}" height="${P(6)}" rx="${P(2)}" fill="${C.brassDark}"/>`;
  b += `<path d="M${P(-20)} ${P(8)}H${P(20)}L${P(15)} ${P(58)}H${P(-15)}Z" fill="${C.glass}"/>`;
  b += `<path d="M${P(-8)} ${P(8)}H${P(8)}L${P(6)} ${P(58)}H${P(-6)}Z" fill="${C.glassHot}"/>`;
  b += `<path d="M${P(-20)} ${P(8)}H${P(20)}L${P(15)} ${P(58)}H${P(-15)}Z" fill="none" stroke="${C.brass}" stroke-width="${P(3.2)}" stroke-linejoin="round"/>`;
  b += `<path d="M0 ${P(8)}V${P(58)}" stroke="${C.brass}" stroke-width="${P(2)}"/>`;
  b += `<path d="M${P(-19)} ${P(58)}H${P(19)}L${P(11)} ${P(68)}H${P(-11)}Z" fill="${C.brass}"/>`;
  b += `<path d="M${P(-4)} ${P(68)}H${P(4)}L0 ${P(78)}Z" fill="${C.brassDark}"/>`;
  b += `</g>`;
  return b;
}

function moth(x, y, s = 1, rot = 0) {
  return (
    `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
    `<path d="M0 0C-4 -9 -15 -11 -17 -3C-18 3 -8 5 0 2Z" fill="${C.star}"/>` +
    `<path d="M0 0C4 -9 15 -11 17 -3C18 3 8 5 0 2Z" fill="#e0cfac"/>` +
    `<path d="M0 2C-3 5 -9 9 -8 11C-5 11 -2 7 0 3Z" fill="#d9c59f"/><path d="M0 2C3 5 9 9 8 11C5 11 2 7 0 3Z" fill="#cbb58c"/>` +
    `<rect x="-1.4" y="-3" width="2.8" height="9" rx="1.4" fill="#8f7a5a"/>` +
    `</g>`
  );
}

function cat(cx, base, s = 1) {
  // curled asleep, head to the right (toward the lamp), tail round the front
  const P = (v) => +(v * s).toFixed(2);
  let b = `<g transform="translate(${cx} ${base})">`;
  b += `<ellipse cx="0" cy="${P(-1)}" rx="${P(60)}" ry="${P(5)}" fill="${C.matDark}" opacity="0.7"/>`;
  // body
  b += `<path d="M${P(-52)} ${P(-4)}C${P(-58)} ${P(-30)} ${P(-30)} ${P(-48)} ${P(2)} ${P(-48)}C${P(30)} ${P(-48)} ${P(50)} ${P(-34)} ${P(52)} ${P(-14)}L${P(48)} ${P(-2)}H${P(-48)}Z" fill="${C.cat}"/>`;
  // light along the top of the back
  b += `<path d="M${P(-20)} ${P(-45)}C${P(6)} ${P(-52)} ${P(36)} ${P(-44)} ${P(48)} ${P(-24)}C${P(34)} ${P(-36)} ${P(10)} ${P(-42)} ${P(-20)} ${P(-45)}Z" fill="${C.catLit}"/>`;
  // stripes
  for (const [x, h] of [[-30, 20], [-14, 24], [2, 25], [18, 22]]) b += `<path d="M${P(x)} ${P(-46 + (x + 30) * 0.02)}c${P(3)} ${P(h * 0.4)} ${P(2)} ${P(h * 0.8)} ${P(-1)} ${P(h)}" stroke="${C.catDark}" stroke-width="${P(4)}" fill="none" stroke-linecap="round"/>`;
  // tail wrapped round the front
  b += `<path d="M${P(-50)} ${P(-10)}C${P(-46)} ${P(4)} ${P(-4)} ${P(4)} ${P(30)} ${P(-2)}" stroke="${C.cat}" stroke-width="${P(12)}" fill="none" stroke-linecap="round"/>`;
  b += `<path d="M${P(18)} ${P(0)}C${P(24)} ${P(-1)} ${P(28)} ${P(-2)} ${P(31)} ${P(-3)}" stroke="${C.catDark}" stroke-width="${P(12)}" fill="none" stroke-linecap="round"/>`;
  // head tucked on the paws, right side
  b += `<ellipse cx="${P(42)}" cy="${P(-18)}" rx="${P(20)}" ry="${P(16)}" fill="${C.cat}"/>`;
  b += `<path d="M${P(28)} ${P(-28)}L${P(30)} ${P(-46)}L${P(42)} ${P(-32)}Z" fill="${C.cat}"/><path d="M${P(31)} ${P(-31)}L${P(32)} ${P(-41)}L${P(38)} ${P(-33)}Z" fill="${C.catDark}"/>`;
  b += `<path d="M${P(46)} ${P(-32)}L${P(58)} ${P(-44)}L${P(60)} ${P(-24)}Z" fill="${C.catLit}"/>`;
  b += `<path d="M${P(48)} ${P(-14)}C${P(52)} ${P(-7)} ${P(58)} ${P(-6)} ${P(62)} ${P(-10)}" fill="${C.catCream}"/>`;
  b += `<ellipse cx="${P(52)}" cy="${P(-11)}" rx="${P(10)}" ry="${P(6)}" fill="${C.catCream}"/>`;
  // closed eye and nose
  b += `<path d="M${P(40)} ${P(-21)}q${P(4)} ${P(3)} ${P(8)} 0" stroke="${C.woodLine}" stroke-width="${P(1.8)}" fill="none" stroke-linecap="round"/>`;
  b += `<circle cx="${P(60)}" cy="${P(-15)}" r="${P(1.8)}" fill="${C.catDark}"/>`;
  // a paw
  b += `<ellipse cx="${P(34)}" cy="${P(-3)}" rx="${P(9)}" ry="${P(4.5)}" fill="${C.catCream}"/>`;
  b += `</g>`;
  return b;
}

function chair(x, floor, C) {
  // rocking chair in profile, facing left; x is the back post foot
  const W = (d, w, col = C.wood) => `<path d="${d}" stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  let b = '';
  // back cushion and back post
  b += W(`M${x + 8} ${floor - 4}L${x + 30} ${floor - 214}`, 10, C.woodDark);
  b += `<path d="M${x - 2} ${floor - 104}C${x - 6} ${floor - 132} ${x - 2} ${floor - 160} ${x + 12} ${floor - 168}C${x + 22} ${floor - 170} ${x + 24} ${floor - 150} ${x + 20} ${floor - 128}C${x + 17} ${floor - 112} ${x + 12} ${floor - 104} ${x - 2} ${floor - 104}Z" fill="${C.cushion}"/>`;
  b += `<path d="M${x + 2} ${floor - 150}C${x + 6} ${floor - 160} ${x + 12} ${floor - 164} ${x + 16} ${floor - 162}" stroke="${C.cushionLit}" stroke-width="4" fill="none" stroke-linecap="round"/>`;

  // rocker
  b += W(`M${x - 122} ${floor - 12}C${x - 80} ${floor + 6} ${x - 6} ${floor + 8} ${x + 40} ${floor - 18}`, 9);
  // legs
  b += W(`M${x - 92} ${floor - 2}L${x - 88} ${floor - 82}`, 8);
  b += W(`M${x + 2} ${floor + 2}L${x - 2} ${floor - 82}`, 8);
  // seat with cushion
  b += `<path d="M${x - 104} ${floor - 92}H${x + 8}V${floor - 80}H${x - 104}Z" fill="${C.wood}"/>`;
  b += `<rect x="${x - 102}" y="${floor - 106}" width="108" height="16" rx="8" fill="${C.cushion}"/>`;
  b += `<rect x="${x - 102}" y="${floor - 106}" width="40" height="7" rx="3.5" fill="${C.cushionLit}"/>`;
  // arm and its front post
  b += W(`M${x + 18} ${floor - 142}L${x - 106} ${floor - 136}`, 8);
  b += W(`M${x - 96} ${floor - 136}L${x - 94} ${floor - 92}`, 7);
  // a blanket over the arm
  b += `<path d="M${x - 52} ${floor - 141}L${x - 14} ${floor - 143}L${x - 10} ${floor - 72}L${x - 48} ${floor - 66}Z" fill="${C.blanket}"/>`;
  for (const t of [0.35, 0.55]) {
    const y = floor - 141 + 70 * t;
    b += `<path d="M${x - 51 + 3 * t} ${y + 1}L${x - 13 + 3 * t} ${y - 2}" stroke="${C.cushion}" stroke-width="4"/>`;
  }
  for (let i = 0; i < 6; i++) b += `<path d="M${x - 46 + i * 6.5} ${floor - 66 - i * 1.1}v7" stroke="${C.blanket}" stroke-width="2" stroke-linecap="round"/>`;
  // finial
  b += `<circle cx="${x + 31}" cy="${floor - 218}" r="6" fill="${C.woodDark}"/>`;
  return b;
}

const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11"/><feColorMatrix type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.05  0 0 0 0 0.12  0 0 0 0.07 0"/></filter>`;

const POST = 600;
const FLOOR = 470;
const LX = 1014;
const LY = 214;
const DX = 800;
const DW = 136;
const DY = 196;

// Everything on the porch that the lamp lights, drawn in palette C.
function porch(C) {
  const W = 1280;
  const H = 640;
  let b = '';
  b += `<rect x="${POST}" y="0" width="${W - POST}" height="${FLOOR}" fill="${C.wall}"/>`;
  for (let y = 112; y < FLOOR; y += 24) b += `<rect x="${POST}" y="${y}" width="${W - POST}" height="2.5" fill="${C.wallLine}"/>`;
  b += `<rect x="${POST}" y="66" width="${W - POST}" height="22" fill="${C.ceiling}"/>`;
  // door and frame
  b += `<rect x="${DX - 16}" y="${DY - 18}" width="${DW + 32}" height="${FLOOR - DY + 18}" fill="${C.trim}"/>`;
  b += `<rect x="${DX - 24}" y="${DY - 26}" width="${DW + 48}" height="10" rx="2" fill="${C.trim}"/>`;
  b += `<rect x="${DX + DW + 10}" y="${DY - 18}" width="6" height="${FLOOR - DY + 18}" fill="${C.trimShade}"/>`;
  b += `<rect x="${DX}" y="${DY}" width="${DW}" height="${FLOOR - DY}" fill="${C.door}"/>`;
  for (let i = 0; i < 3; i++) b += `<rect x="${DX + 18 + i * 35}" y="${DY + 18}" width="30" height="40" rx="2" fill="${C.doorGlass}"/><rect x="${DX + 22 + i * 35}" y="${DY + 22}" width="6" height="18" rx="2" fill="${C.doorGlassHi}"/>`;
  for (const [px, py, pw, ph] of [[DX + 18, DY + 76, 44, 86], [DX + 74, DY + 76, 44, 86], [DX + 18, DY + 186, 44, 70], [DX + 74, DY + 186, 44, 70]]) {
    b += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="2" fill="${C.doorPanel}"/><rect x="${px + 5}" y="${py + 5}" width="${pw - 10}" height="${ph - 10}" rx="1.5" fill="${C.door}"/>`;
  }
  b += `<circle cx="${DX + DW - 16}" cy="${DY + 150}" r="7" fill="${C.brass}"/><circle cx="${DX + DW - 14}" cy="${DY + 148}" r="2.5" fill="${C.brassHi}"/>`;
  b += `<rect x="${DX + 44}" y="${DY + 168}" width="48" height="8" rx="2" fill="${C.brass}"/><rect x="${DX + 48}" y="${DY + 171}" width="40" height="2" fill="${C.brassDark}"/>`;
  b += `<rect x="${DX - 66}" y="${DY + 8}" width="34" height="44" rx="4" fill="${C.trim}"/><text x="${DX - 49}" y="${DY + 40}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="26" fill="${C.numeral}">7</text>`;
  // porch post
  b += `<rect x="${POST}" y="66" width="30" height="${FLOOR - 66}" fill="${C.trim}"/><rect x="${POST + 22}" y="66" width="8" height="${FLOOR - 66}" fill="${C.trimShade}"/>`;
  b += `<rect x="${POST - 6}" y="${FLOOR - 26}" width="42" height="26" fill="${C.trim}"/><rect x="${POST - 6}" y="88" width="42" height="12" fill="${C.trim}"/>`;
  b += plant(716, FLOOR, C);
  b += chair(1176, FLOOR, C);
  // floor, front edge, lattice skirt, steps, mat
  b += `<rect x="${POST - 30}" y="${FLOOR}" width="${W - POST + 30}" height="54" fill="${C.wood}"/>`;
  for (const y of [FLOOR + 14, FLOOR + 30, FLOOR + 46]) b += `<rect x="${POST - 30}" y="${y}" width="${W - POST + 30}" height="2" fill="${C.woodLine}"/>`;
  b += `<rect x="${POST - 30}" y="${FLOOR + 54}" width="${W - POST + 30}" height="18" fill="${C.trim}"/>`;
  b += `<rect x="${POST - 30}" y="${FLOOR + 68}" width="${W - POST + 30}" height="4" fill="${C.trimShade}"/>`;
  b += `<rect x="${POST - 24}" y="${FLOOR + 72}" width="${W - POST + 24}" height="${H - FLOOR - 72}" fill="${C.lattice}"/>`;
  let lat = '';
  for (let x = POST - 200; x < W + 100; x += 26) lat += `M${x} ${FLOOR + 72}l100 100M${x} ${FLOOR + 72}l-100 100`;
  b += `<path d="${lat}" stroke="${C.latticeLine}" stroke-width="5" clip-path="url(#latc)"/>`;
  const steps = [[DX - 28, FLOOR + 72, DW + 56], [DX - 52, FLOOR + 106, DW + 104], [DX - 76, FLOOR + 140, DW + 152]];
  for (const [sx, sy, sw] of steps) b += `<rect x="${sx}" y="${sy}" width="${sw}" height="34" fill="${C.riser}"/><rect x="${sx}" y="${sy}" width="${sw}" height="10" fill="${C.wood}"/><rect x="${sx}" y="${sy + 10}" width="${sw}" height="3" fill="${C.trimShade}"/>`;
  b += `<path d="M${DX - 8} ${FLOOR + 6}H${DX + DW + 8}L${DX + DW + 16} ${FLOOR + 30}H${DX - 16}Z" fill="${C.mat}"/>`;
  b += `<path d="M${DX - 2} ${FLOOR + 11}H${DX + DW + 2}L${DX + DW + 7} ${FLOOR + 25}H${DX - 7}Z" fill="none" stroke="${C.matDark}" stroke-width="2.5"/>`;
  // porch ceiling, fascia and roof edge (above the light)
  b += `<rect x="${POST - 30}" y="0" width="${W - POST + 30}" height="40" fill="${C.roof}"/>`;
  b += `<rect x="${POST - 30}" y="40" width="${W - POST + 30}" height="26" fill="${C.trim}"/>`;
  b += `<rect x="${POST - 30}" y="62" width="${W - POST + 30}" height="4" fill="${C.trimShade}"/>`;
  return b;
}

function hero() {
  const W = 1280;
  const H = 640;
  let b = `<rect width="${W}" height="${H}" fill="${C.sky}"/>`;
  // distant trees on the horizon
  b += `<path d="M0 452C30 430 54 438 74 420C96 402 122 418 140 410C170 396 196 424 222 416C250 404 268 384 296 396C318 406 340 430 372 422C400 414 420 396 452 404C480 412 500 432 530 426C560 420 580 410 ${POST} 414V${H}H0Z" fill="${C.sky2}"/>`;
  // moon, a crescent
  b += `<path d="M470 64a44 44 0 1 0 38 70a36 36 0 1 1 -38 -70Z" fill="${C.star}"/>`;
  const stars = [[96, 92, 5], [214, 58, 3.5], [338, 112, 4.5], [160, 380, 3], [548, 228, 3.5], [40, 330, 3], [392, 40, 3], [300, 372, 3.5], [560, 70, 3]];
  for (const [x, y, s] of stars) b += `<path d="M${x} ${y - s * 2}Q${x} ${y} ${x + s * 2} ${y}Q${x} ${y} ${x} ${y + s * 2}Q${x} ${y} ${x - s * 2} ${y}Q${x} ${y} ${x} ${y - s * 2}Z" fill="${C.star}"/>`;
  // the garden at night: hedge and a picket fence
  b += `<path d="M0 520C40 488 90 500 120 512C150 480 210 490 230 512C262 492 310 498 330 520C360 500 420 506 440 528C470 512 520 516 ${POST} 530V${H}H0Z" fill="${C.night}"/>`;
  let fence = '';
  for (let x = 12; x < POST - 40; x += 34) fence += `<path d="M${x} ${H}V${574}L${x + 8} ${562}L${x + 16} ${574}V${H}Z"/>`;
  b += `<g fill="#170f1c">${fence}<rect x="0" y="588" width="${POST - 40}" height="8"/><rect x="0" y="620" width="${POST - 40}" height="8"/></g>`;

  // the porch, then the same porch in three lit palettes, each clipped to its pool of light
  b += `<clipPath id="latc"><rect x="${POST - 24}" y="${FLOOR + 72}" width="${W - POST + 24}" height="${H - FLOOR - 72}"/></clipPath>`;
  b += `<clipPath id="wallc"><rect x="${POST}" y="66" width="${W - POST}" height="${FLOOR - 66}"/></clipPath>`;
  b += `<clipPath id="floorc"><rect x="${POST - 30}" y="${FLOOR}" width="${W - POST + 30}" height="${H - FLOOR}"/></clipPath>`;
  const wallZ = [[LX, LY + 110, 420, 340], [LX, LY + 74, 262, 218], [LX, LY + 40, 128, 118]];
  const floorZ = [[LX - 70, FLOOR + 50, 480, 104], [LX - 70, FLOOR + 30, 300, 58], [LX - 60, FLOOR + 18, 150, 28]];
  b += porch(C);
  LEVELS.forEach((t, i) => {
    const P = lit(C, t);
    const [wx, wy, wrx, wry] = wallZ[i];
    const [fx, fy, frx, fry] = floorZ[i];
    b += `<clipPath id="lw${i}"><ellipse cx="${wx}" cy="${wy}" rx="${wrx}" ry="${wry}"/></clipPath><clipPath id="lf${i}"><ellipse cx="${fx}" cy="${fy}" rx="${frx}" ry="${fry}"/></clipPath>`;
    const scene = porch(P);
    b += `<g clip-path="url(#wallc)"><g clip-path="url(#lw${i})">${scene}</g></g>`;
    b += `<g clip-path="url(#floorc)"><g clip-path="url(#lf${i})">${scene}</g></g>`;
  });

  // the cat on the mat, lamp and moths
  b += cat(DX + 62, FLOOR + 22, 1);
  b += lantern(LX, LY, 1);
  b += `<path d="M1060 168c22 -26 52 -14 44 8c-6 16 -30 10 -24 -6" fill="none" stroke="${C.star}" stroke-width="1.6" stroke-dasharray="2 6" stroke-linecap="round" opacity="0.7"/>`;
  b += moth(1078, 164, 1.05, -12);
  b += moth(962, 212, 0.85, 16);

  // type
  b += `<text x="64" y="286" font-family="${FONT}" font-weight="700" font-size="98" letter-spacing="-0.5" fill="${C.trim}">Porchlight</text>`;
  b += `<text x="68" y="336" font-family="${FONT}" font-weight="400" font-size="24.5" fill="#d8cfe0">A light left on over your own front door.</text>`;
  b += `<rect width="${W}" height="${H}" filter="url(#grain)"/>`;
  return svg({ w: W, h: H, defs: GRAIN, body: b });
}

// The mark: a round porch scene, lamp above a sleeping cat on its mat.
function badgeScene(C) {
  let b = `<rect width="256" height="256" fill="${C.wall}"/>`;
  for (let y = 26; y < 184; y += 20) b += `<rect y="${y}" width="256" height="2.5" fill="${C.wallLine}"/>`;
  b += `<rect y="184" width="256" height="72" fill="${C.wood}"/><rect y="200" width="256" height="2" fill="${C.woodLine}"/><rect y="220" width="256" height="2" fill="${C.woodLine}"/>`;
  b += `<rect x="12" y="54" width="62" height="130" fill="${C.trim}"/><rect x="22" y="64" width="46" height="120" fill="${C.door}"/><rect x="28" y="78" width="34" height="40" rx="2" fill="${C.doorPanel}"/><rect x="32" y="82" width="26" height="32" rx="1.5" fill="${C.door}"/><circle cx="60" cy="134" r="4" fill="${C.brass}"/>`;
  b += `<path d="M86 190H226L234 210H78Z" fill="${C.mat}"/><path d="M92 194H220L225 206H87Z" fill="none" stroke="${C.matDark}" stroke-width="2"/>`;
  return b;
}

function badge(id) {
  let b = `<clipPath id="${id}"><circle cx="128" cy="128" r="118"/></clipPath>`;
  b += `<circle cx="128" cy="128" r="124" fill="${C.sky}"/>`;
  b += `<g clip-path="url(#${id})">`;
  b += badgeScene(C);
  b += `<clipPath id="${id}w"><rect width="256" height="184"/></clipPath><clipPath id="${id}f"><rect y="184" width="256" height="72"/></clipPath>`;
  const wallZ = [[160, 120, 170, 150], [160, 100, 104, 94], [160, 84, 52, 50]];
  const floorZ = [[150, 204, 190, 44], [150, 200, 120, 26], [150, 198, 64, 14]];
  LEVELS.forEach((t, i) => {
    const scene = badgeScene(lit(C, t));
    const [wx, wy, wrx, wry] = wallZ[i];
    const [fx, fy, frx, fry] = floorZ[i];
    b += `<clipPath id="${id}lw${i}"><ellipse cx="${wx}" cy="${wy}" rx="${wrx}" ry="${wry}"/></clipPath><clipPath id="${id}lf${i}"><ellipse cx="${fx}" cy="${fy}" rx="${frx}" ry="${fry}"/></clipPath>`;
    b += `<g clip-path="url(#${id}w)"><g clip-path="url(#${id}lw${i})">${scene}</g></g>`;
    b += `<g clip-path="url(#${id}f)"><g clip-path="url(#${id}lf${i})">${scene}</g></g>`;
  });
  b += cat(150, 204, 0.86);
  b += lantern(160, 64, 0.9);
  b += moth(206, 48, 0.8, -14);
  b += `</g>`;
  b += `<circle cx="128" cy="128" r="118" fill="none" stroke="${C.brass}" stroke-width="5"/>`;
  return b;
}

function markSvg() {
  return svg({ w: 512, h: 512, vb: '0 0 256 256', body: badge('bm') });
}
function iconSvg() {
  // a plum tile with the badge on it
  let b = `<rect x="0" y="0" width="256" height="256" rx="56" fill="${C.sky}"/>`;
  b += `<g transform="translate(14 14) scale(0.890625)">${badge('bi')}</g>`;
  return svg({ w: 512, h: 512, vb: '0 0 256 256', body: b });
}
function faviconSvg() {
  // 16px: the brass lantern on plum, nothing else
  const b = `
<rect width="16" height="16" rx="3" fill="${C.sky}"/>
<rect x="7" y="1" width="2" height="1" fill="${C.brass}"/>
<rect x="6" y="2" width="4" height="1" fill="${C.brass}"/>
<rect x="4" y="3" width="8" height="2" fill="${C.brassHi}"/>
<rect x="5" y="5" width="6" height="6" fill="${C.brass}"/>
<rect x="6" y="5" width="4" height="6" fill="${C.glass}"/>
<rect x="7" y="6" width="2" height="4" fill="${C.glassHot}"/>
<rect x="5" y="11" width="6" height="1" fill="${C.brass}"/>
<rect x="6" y="12" width="4" height="1" fill="${C.brassDark}"/>
<rect x="7" y="13" width="2" height="1" fill="${C.brassDark}"/>`;
  return svg({ w: 16, h: 16, vb: '0 0 16 16', body: b });
}
function favicon32Svg() {
  const b = `
<rect width="32" height="32" rx="6" fill="${C.sky}"/>
<rect x="14" y="2" width="4" height="2" rx="1" fill="${C.brass}"/>
<path d="M12 4H20L25 8H7Z" fill="${C.brass}"/>
<path d="M16 4H20L25 8H16Z" fill="${C.brassHi}"/>
<rect x="6" y="8" width="20" height="2" fill="${C.brassDark}"/>
<path d="M8 10H24L22 23H10Z" fill="${C.brass}"/>
<path d="M10 11H22L20.5 22H11.5Z" fill="${C.glass}"/>
<path d="M14 11H18L17.5 22H14.5Z" fill="${C.glassHot}"/>
<rect x="15.5" y="11" width="1" height="11" fill="${C.brass}"/>
<path d="M9 23H23L20 26H12Z" fill="${C.brass}"/>
<path d="M14 26H18L16 29Z" fill="${C.brassDark}"/>`;
  return svg({ w: 32, h: 32, vb: '0 0 32 32', body: b });
}
function logoSvg() {
  let b = nest({ x: 16, y: 16, w: 168, h: 168, vb: '0 0 256 256', body: badge('bl') });
  b += `<text x="210" y="128" font-family="${FONT}" font-weight="700" font-size="88" letter-spacing="-1" fill="${C.ink}">Porchlight</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 15 Flat porch

A warm flat illustration: a sage porch at night, a plum door with its number, a brass lantern, a ginger cat asleep on the doormat, a rocking chair with a blanket, a fiddle-leaf fig, two moths. The light is three stepped warm shapes laid over the wall, the door and the floor, so everything it touches warms together.
Palette: plum night #2a1c30, sage #5b7663, brass #c39a48, glass #ffe29a, plum door #5e2b45, cream #efe2c6, ginger #d6843f.
Type: Seravek Bold for the name, Seravek Regular for the tagline.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(),
  'logo.svg': logoSvg(),
  'favicon.svg': faviconSvg(),
  'favicon-32.svg': favicon32Svg(),
  'icon.svg': iconSvg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
