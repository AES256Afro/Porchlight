// 45 Flat porch (dog and swing): a navy clapboard porch at night. A barn light
// over a mustard door, a dog sitting up in its light looking out for whoever
// is coming, a parcel on the mat, boots, a porch swing, a hanging fern. The
// light is three stepped bells on the wall and three pools on the floor.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '45-flat-porch-dog';
const C = {
  sky: '#121930',
  hill: '#18213c',
  garden: '#0d1324',
  star: '#f3e6c8',
  wall: '#2a3f66',
  wallLine: '#233659',
  ceiling: '#1a2746',
  roof: '#0e1428',
  trim: '#efe3c8',
  trimShade: '#c9b996',
  door: '#dba33a',
  doorPanel: '#c28b2a',
  pane: '#1b2848',
  paneHi: '#3b548a',
  wood: '#7b4c3b',
  woodLine: '#5c3629',
  woodDark: '#653b2d',
  skirt: '#16203b',
  skirtLine: '#202d50',
  terra: '#c5583a',
  terraLit: '#de7651',
  terraDark: '#953e29',
  fern: '#467663',
  fernLit: '#6c9f82',
  fernDark: '#2f5446',
  kraft: '#c99b63',
  kraftDark: '#a47846',
  metal: '#0e1428',
  glass: '#ffe6a2',
  glassHot: '#fff8de',
  mat: '#8c6a4a',
  matDark: '#6d4f36',
  chain: '#8a93a8',
};
const DOG = { body: '#f1e3c7', shade: '#d6c4a2', lit: '#fff6dc', patch: '#a9593c', patchDark: '#87432c', ink: '#121930' };
const WORD = 'Rockwell';

// Light: each colour is mixed toward warm lamplight, more for each step.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const LIGHT = '#ffc04e';
const warm = (c, t) => {
  const a = rgb(c);
  const l = rgb(LIGHT);
  // part screen (keeps the hue of what is lit), part mix (the lamp's own colour)
  return hex(a.map((v, i) => {
    const scr = 255 - ((255 - v) * (255 - l[i] * t)) / 255;
    const mix = v + (l[i] - v) * t;
    return scr * 0.25 + mix * 0.75;
  }));
};
const lit = (P, t) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, warm(v, t)]));
const LEVELS = [0.15, 0.34, 0.56];
const n = (v) => +v.toFixed(2);

const W = 1280;
const H = 640;
const EDGE = 716; // right end of the porch floor
const POST = 664;
const FLOOR = 470;
const LX = 566; // the lamp's mouth
const LY = 164;
const DX = 346;
const DW = 116;
const DY = 198;

// ---- things on the porch ---------------------------------------------------------
function swing(C) {
  const x0 = 28;
  const x1 = 236;
  let b = '';
  // chains
  for (const x of [x0 + 14, x1 - 14]) {
    b += `<path d="M${x} 84V300" stroke="${C.chain}" stroke-width="3" stroke-dasharray="7 4" stroke-linecap="round"/>`;
    b += `<circle cx="${x}" cy="86" r="4" fill="${C.chain}"/>`;
  }
  // back: frame and slats
  b += `<rect x="${x0 + 6}" y="276" width="${x1 - x0 - 12}" height="12" rx="6" fill="${C.trim}"/>`;
  for (let x = x0 + 14; x < x1 - 18; x += 22) b += `<rect x="${x}" y="286" width="13" height="62" fill="${C.trim}"/><rect x="${x + 9}" y="286" width="4" height="62" fill="${C.trimShade}"/>`;
  // cushion and a striped pillow
  b += `<rect x="${x0 + 14}" y="330" width="${x1 - x0 - 28}" height="22" rx="10" fill="${C.terra}"/>`;
  b += `<rect x="${x0 + 22}" y="333" width="${x1 - x0 - 90}" height="6" rx="3" fill="${C.terraLit}"/>`;
  b += `<g transform="rotate(-9 ${x1 - 62} 318)"><rect x="${x1 - 88}" y="292" width="52" height="46" rx="8" fill="${C.door}"/>`;
  for (const dx of [12, 24, 36]) b += `<rect x="${x1 - 88 + dx}" y="292" width="5" height="46" fill="${C.trim}"/>`;
  b += `</g>`;
  // arms, seat
  for (const x of [x0, x1 - 22]) b += `<rect x="${x}" y="300" width="22" height="9" rx="3" fill="${C.trim}"/><rect x="${x + 7}" y="306" width="9" height="48" fill="${C.trim}"/><rect x="${x + 13}" y="306" width="3" height="48" fill="${C.trimShade}"/>`;
  b += `<rect x="${x0 - 2}" y="350" width="${x1 - x0 + 4}" height="13" rx="3" fill="${C.trim}"/>`;
  b += `<rect x="${x0 - 2}" y="359" width="${x1 - x0 + 4}" height="4" rx="2" fill="${C.trimShade}"/>`;
  return b;
}

// a frond: a bent rib with paired leaflets that shorten toward the tip
function frond(x0, y0, x1, y1, bend, len, fill) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const L = Math.hypot(x1 - x0, y1 - y0);
  const cx = mx + (-(y1 - y0) / L) * bend;
  const cy = my + ((x1 - x0) / L) * bend;
  let d = '';
  for (let t = 0.12; t <= 0.98; t += 7.4 / L) {
    const u = 1 - t;
    const px = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const py = u * u * y0 + 2 * u * t * cy + t * t * y1;
    let tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
    let ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    const tl = Math.hypot(tx, ty);
    tx /= tl;
    ty /= tl;
    const l = len * (1 - t * 0.78);
    for (const sg of [1, -1]) d += `M${n(px)} ${n(py)}l${n((-ty * sg * 0.9 + tx * 0.42) * l)} ${n((tx * sg * 0.9 + ty * 0.42) * l)}`;
  }
  return (
    `<path d="${d}" stroke="${fill}" stroke-width="4.4" fill="none" stroke-linecap="round"/>` +
    `<path d="M${n(x0)} ${n(y0)}Q${n(cx)} ${n(cy)} ${n(x1)} ${n(y1)}" stroke="${fill}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  );
}
function fern(x, C) {
  const top = 152;
  let b = '';
  b += `<circle cx="${x}" cy="86" r="4" fill="${C.chain}"/>`;
  for (const dx of [-24, 0, 24]) b += `<path d="M${x} 86L${x + dx} ${top}" stroke="${C.chain}" stroke-width="2"/>`;
  const fr = [
    // behind the pot: long ones that hang
    [x - 8, top, x - 58, top + 96, 24, 12, C.fernDark],
    [x + 8, top, x + 56, top + 102, -24, 12, C.fernDark],
    [x - 2, top, x - 24, top + 118, 14, 11, C.fernDark],
    [x + 4, top, x + 20, top + 124, -12, 11, C.fernDark],
    // in front: arching out and over
    [x - 10, top - 2, x - 82, top + 34, 30, 12, C.fern],
    [x + 10, top - 2, x + 84, top + 40, -30, 12, C.fern],
    [x - 6, top - 4, x - 56, top - 30, 12, 10, C.fern],
    [x + 6, top - 4, x + 60, top - 26, -12, 10, C.fernLit],
    [x, top - 4, x - 10, top - 54, 6, 10, C.fern],
    [x + 2, top - 4, x + 28, top - 50, -8, 10, C.fernLit],
    [x + 8, top + 2, x + 50, top + 76, -20, 11, C.fernLit],
    [x - 8, top + 2, x - 50, top + 68, 20, 11, C.fern],
  ];
  const pot = `<path d="M${x - 28} ${top}H${x + 28}C${x + 28} ${top + 22} ${x + 16} ${top + 30} ${x} ${top + 30}C${x - 16} ${top + 30} ${x - 28} ${top + 22} ${x - 28} ${top}Z" fill="${C.terra}"/><path d="M${x + 4} ${top}H${x + 28}C${x + 28} ${top + 22} ${x + 16} ${top + 30} ${x + 2} ${top + 30}Z" fill="${C.terraLit}"/><rect x="${x - 31}" y="${top - 4}" width="62" height="8" rx="3" fill="${C.terraLit}"/>`;
  for (const f of fr.slice(0, 4)) b += frond(...f);
  b += pot;
  for (const f of fr.slice(4)) b += frond(...f);
  return b;
}

function boots(x, C) {
  // a pair of wellingtons stood heel to heel, toes out
  const boot = (bx, sx, fill, hi) =>
    `<g transform="translate(${bx} ${FLOOR}) scale(${sx} 0.9)">` +
    `<path d="M0 -68H25V-5Q25 0 19 0H-15Q-22 0 -21 -8Q-19 -19 -5 -22Q1 -24 0 -32Z" fill="${fill}"/>` +
    `<rect x="-2" y="-68" width="29" height="8" rx="2.5" fill="${hi}"/>` +
    `<path d="M-19 -2.5H23" stroke="${C.terraDark}" stroke-width="5" stroke-linecap="round"/></g>`;
  return boot(x, 0.9, C.terra, C.terraLit) + boot(x + 53, -0.9, C.terra, C.terraLit);
}

function parcel(x, y, C) {
  // a taped box with a label
  const w = 78;
  const h = 52;
  let b = `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" rx="2" fill="${C.kraft}"/>`;
  b += `<rect x="${x}" y="${y - h}" width="${w}" height="10" fill="${C.kraftDark}"/>`;
  b += `<rect x="${x + w / 2 - 7}" y="${y - h}" width="14" height="${h}" fill="${C.trim}" opacity="0.9"/>`;
  b += `<rect x="${x + 8}" y="${y - 30}" width="22" height="16" rx="1.5" fill="${C.trim}"/>`;
  b += `<path d="M${x + 11} ${y - 25}h16M${x + 11} ${y - 20}h11" stroke="${C.kraftDark}" stroke-width="2"/>`;
  b += `<path d="M${x + w - 22} ${y - 14}l6 -8l6 8M${x + w - 16} ${y - 22}v14" stroke="${C.kraftDark}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  return b;
}

function lamp(x, y) {
  // a barn light on a gooseneck: wall plate, arm, enamel shade, bulb. (x, y) is the mouth.
  let b = '';
  b += `<path d="M${x + 52} ${y - 22}C${x + 52} ${y - 76} ${x} ${y - 76} ${x} ${y - 34}" stroke="${C.metal}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  b += `<circle cx="${x + 52}" cy="${y - 20}" r="9" fill="${C.metal}"/><circle cx="${x + 52}" cy="${y - 20}" r="3" fill="${C.wallLine}"/>`;
  b += `<path d="M${x - 16} ${y}A16 11 0 0 0 ${x + 16} ${y}Z" fill="${C.glass}"/>`;
  b += `<path d="M${x - 8} ${y}A8 6 0 0 0 ${x + 8} ${y}Z" fill="${C.glassHot}"/>`;
  b += `<rect x="${x - 7}" y="${y - 40}" width="14" height="10" rx="2" fill="${C.terraDark}"/>`;
  b += `<path d="M${x - 12} ${y - 32}H${x + 12}Q${x + 22} ${y - 14} ${x + 40} ${y - 4}H${x - 40}Q${x - 22} ${y - 14} ${x - 12} ${y - 32}Z" fill="${C.terra}"/>`;
  b += `<path d="M${x + 2} ${y - 32}H${x + 12}Q${x + 22} ${y - 14} ${x + 40} ${y - 4}H${x + 10}Q${x + 6} ${y - 18} ${x + 2} ${y - 32}Z" fill="${C.terraLit}"/>`;
  b += `<rect x="${x - 43}" y="${y - 5}" width="86" height="6" rx="3" fill="${C.terraDark}"/>`;
  return b;
}

// The dog: sitting up, in profile, looking right. Origin is the floor under it.
function dog(x, y, s, id, D = DOG) {
  let b = `<g transform="translate(${x} ${y}) scale(${s})">`;
  const body = 'M10 -106C-12 -96 -40 -66 -45 -32C-48 -12 -40 0 -24 0H38C40 -4 36 -8 30 -9L27 -50C33 -64 33 -80 27 -94Z';
  b += `<clipPath id="${id}"><path d="${body}"/></clipPath>`;
  // tail
  b += `<path d="M-40 -14C-62 -16 -70 -40 -57 -55" stroke="${D.body}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
  b += `<path d="M-63 -38C-64 -45 -62 -51 -57 -55" stroke="${D.patch}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
  b += `<path d="${body}" fill="${D.body}"/>`;
  b += `<g clip-path="url(#${id})">`;
  b += `<ellipse cx="-30" cy="-62" rx="24" ry="30" transform="rotate(28 -30 -62)" fill="${D.patch}"/>`;
  b += `<path d="M30 -9L27 -50C24 -40 20 -24 21 0H40Z" fill="${D.shade}"/>`;
  b += `</g>`;
  // thigh and hind paw, front paw
  b += `<path d="M-33 -3C-38 -38 2 -46 9 -12" stroke="${D.shade}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  b += `<ellipse cx="2" cy="-4" rx="15" ry="5.5" fill="${D.body}"/><path d="M-10 -1H15" stroke="${D.shade}" stroke-width="2.5" stroke-linecap="round"/>`;
  b += `<path d="M15 0V-48" stroke="${D.shade}" stroke-width="3" stroke-linecap="round"/>`;
  b += `<ellipse cx="33" cy="-4.5" rx="12" ry="5.5" fill="${D.body}"/>`;
  // collar
  b += `<path d="M6 -99L29 -91" stroke="${C.terra}" stroke-width="8" stroke-linecap="round"/>`;
  b += `<circle cx="25" cy="-84" r="4.5" fill="${C.door}"/>`;
  // head: skull, muzzle, ear with its tip folded forward, eye, nose
  b += `<g transform="translate(22 -112) scale(1.08) translate(-22 112)">`;
  b += `<path d="M2 -112C2 -128 14 -138 28 -137C40 -136 46 -130 52 -127C61 -126 68 -122 68 -114C68 -106 60 -102 50 -102C42 -101 36 -98 28 -96C14 -94 2 -100 2 -112Z" fill="${D.body}"/>`;
  b += `<path d="M10 -128C16 -135 24 -138 30 -137C40 -136 46 -130 52 -127C58 -126 63 -124 66 -121C58 -123 50 -122 44 -125C38 -129 30 -132 22 -131C17 -130 13 -129 10 -128Z" fill="${D.lit}"/>`;
  b += `<path d="M38 -104C44 -101 54 -101 60 -104" stroke="${D.shade}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  b += `<path d="M3 -121C-1 -136 3 -149 11 -155C18 -149 24 -140 24 -130C18 -124 10 -119 3 -121Z" fill="${D.patch}"/>`;
  b += `<path d="M11 -155C19 -156 27 -151 31 -143C25 -143 18 -145 13 -149Z" fill="${D.patchDark}"/>`;
  b += `<circle cx="37" cy="-121" r="3.2" fill="${D.ink}"/>`;
  b += `<ellipse cx="65" cy="-118" rx="5.5" ry="4.5" fill="${D.ink}"/>`;
  b += `</g></g>`;
  return b;
}

function moth(x, y, s = 1, rot = 0) {
  return (
    `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
    `<path d="M0 0C-4 -9 -15 -11 -17 -3C-18 3 -8 5 0 2Z" fill="${C.star}"/>` +
    `<path d="M0 0C4 -9 15 -11 17 -3C18 3 8 5 0 2Z" fill="#e2d2ae"/>` +
    `<path d="M0 2C-3 5 -9 9 -8 11C-5 11 -2 7 0 3Z" fill="#d9c59f"/><path d="M0 2C3 5 9 9 8 11C5 11 2 7 0 3Z" fill="#cbb58c"/>` +
    `<rect x="-1.4" y="-3" width="2.8" height="9" rx="1.4" fill="#8f7a5a"/></g>`
  );
}

// ---- the porch, drawn in a palette ---------------------------------------------
function porch(C) {
  let b = '';
  b += `<rect x="0" y="0" width="${POST + 14}" height="${FLOOR}" fill="${C.wall}"/>`;
  for (let y = 108; y < FLOOR; y += 24) b += `<rect x="0" y="${y}" width="${POST + 14}" height="2.5" fill="${C.wallLine}"/>`;
  b += `<rect x="0" y="62" width="${POST + 14}" height="22" fill="${C.ceiling}"/>`;
  // door: frame, leaf, four panes, two panels, knob
  b += `<rect x="${DX - 16}" y="${DY - 16}" width="${DW + 32}" height="${FLOOR - DY + 16}" fill="${C.trim}"/>`;
  b += `<rect x="${DX - 24}" y="${DY - 26}" width="${DW + 48}" height="12" rx="2" fill="${C.trim}"/>`;
  b += `<rect x="${DX + DW + 10}" y="${DY - 14}" width="6" height="${FLOOR - DY + 14}" fill="${C.trimShade}"/>`;
  b += `<rect x="${DX}" y="${DY}" width="${DW}" height="${FLOOR - DY}" fill="${C.door}"/>`;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++) {
      const px = DX + 16 + c * 44;
      const py = DY + 16 + r * 40;
      b += `<rect x="${px}" y="${py}" width="40" height="36" rx="2" fill="${C.pane}"/><path d="M${px + 6} ${py + 30}L${px + 20} ${py + 6}H${px + 28}L${px + 14} ${py + 30}Z" fill="${C.paneHi}"/>`;
    }
  for (const px of [DX + 16, DX + 62]) b += `<rect x="${px}" y="${DY + 108}" width="38" height="146" rx="2" fill="${C.doorPanel}"/><rect x="${px + 5}" y="${DY + 113}" width="28" height="136" rx="1.5" fill="${C.door}"/>`;
  b += `<circle cx="${DX + DW - 13}" cy="${DY + 170}" r="7" fill="${C.metal}"/><circle cx="${DX + DW - 11}" cy="${DY + 168}" r="2.4" fill="${C.paneHi}"/>`;
  // number
  b += `<rect x="${DX + DW + 30}" y="${DY + 6}" width="44" height="34" rx="5" fill="${C.trim}"/><text x="${DX + DW + 52}" y="${DY + 31}" text-anchor="middle" font-family="${WORD}" font-weight="700" font-size="23" fill="${C.sky}">12</text>`;
  // post
  b += `<rect x="${POST}" y="62" width="28" height="${FLOOR - 62}" fill="${C.trim}"/><rect x="${POST + 21}" y="62" width="7" height="${FLOOR - 62}" fill="${C.trimShade}"/>`;
  b += `<rect x="${POST - 6}" y="${FLOOR - 26}" width="40" height="26" fill="${C.trim}"/><rect x="${POST - 6}" y="84" width="40" height="12" fill="${C.trim}"/>`;
  b += swing(C);
  b += fern(292, C);
  b += boots(264, C);
  // floor, edge, skirt
  b += `<rect x="0" y="${FLOOR}" width="${EDGE}" height="54" fill="${C.wood}"/>`;
  for (const y of [FLOOR + 14, FLOOR + 30, FLOOR + 46]) b += `<rect x="0" y="${y}" width="${EDGE}" height="2" fill="${C.woodLine}"/>`;
  b += `<ellipse cx="132" cy="${FLOOR + 22}" rx="96" ry="9" fill="${C.woodLine}" opacity="0.7"/>`;
  b += `<rect x="0" y="${FLOOR + 54}" width="${EDGE}" height="18" fill="${C.trim}"/><rect x="0" y="${FLOOR + 68}" width="${EDGE}" height="4" fill="${C.trimShade}"/>`;
  b += `<rect x="0" y="${FLOOR + 72}" width="${EDGE - 8}" height="${H - FLOOR - 72}" fill="${C.skirt}"/>`;
  for (let x = 14; x < EDGE - 8; x += 22) b += `<rect x="${x}" y="${FLOOR + 72}" width="3" height="${H - FLOOR - 72}" fill="${C.skirtLine}"/>`;
  // steps under the door
  const steps = [[DX - 30, FLOOR + 72, DW + 60], [DX - 54, FLOOR + 106, DW + 108], [DX - 78, FLOOR + 140, DW + 156]];
  for (const [sx, sy, sw] of steps) b += `<rect x="${sx}" y="${sy}" width="${sw}" height="34" fill="${C.woodDark}"/><rect x="${sx}" y="${sy}" width="${sw}" height="10" fill="${C.wood}"/><rect x="${sx}" y="${sy + 10}" width="${sw}" height="3" fill="${C.woodLine}"/>`;
  // mat and the parcel on it
  b += `<path d="M${DX - 10} ${FLOOR + 6}H${DX + DW + 10}L${DX + DW + 18} ${FLOOR + 30}H${DX - 18}Z" fill="${C.mat}"/>`;
  b += `<path d="M${DX - 4} ${FLOOR + 11}H${DX + DW + 4}L${DX + DW + 9} ${FLOOR + 25}H${DX - 9}Z" fill="none" stroke="${C.matDark}" stroke-width="2.5"/>`;
  b += parcel(DX + 8, FLOOR + 14, C);
  // roof edge and fascia
  b += `<rect x="0" y="0" width="${EDGE}" height="38" fill="${C.roof}"/>`;
  b += `<rect x="0" y="38" width="${EDGE}" height="24" fill="${C.trim}"/><rect x="0" y="58" width="${EDGE}" height="4" fill="${C.trimShade}"/>`;
  return b;
}

// the bell of light on the wall: narrow at the lamp, wide at the floor
const bell = (a, t) => `M${LX - a} ${FLOOR}C${n(LX - a * 0.66)} ${FLOOR - 150} ${LX - t - 26} ${LY + 74} ${LX - t} ${LY - 2}H${LX + t}C${LX + t + 26} ${LY + 74} ${n(LX + a * 0.66)} ${FLOOR - 150} ${LX + a} ${FLOOR}Z`;
const BELLS = [[330, 44], [214, 36], [112, 26]];
const POOLS = [[330, 64], [214, 40], [112, 22]];

function scene() {
  let b = `<rect width="${W}" height="${H}" fill="${C.sky}"/>`;
  // far hills, neighbours asleep, a tree
  b += `<path d="M${EDGE - 20} 430C760 416 800 428 846 414C900 398 960 420 1010 410C1064 398 1110 376 1164 388C1210 398 1250 420 ${W} 414V${H}H${EDGE - 20}Z" fill="${C.hill}"/>`;
  const house = (x, y, w, h) => `<path d="M${x} ${y + h}V${y}L${x + w / 2} ${y - w * 0.36}L${x + w} ${y}V${y + h}Z"/><rect x="${x + w * 0.68}" y="${y - w * 0.34}" width="${w * 0.12}" height="${w * 0.2}"/>`;
  b += `<g fill="${C.garden}">${house(800, 470, 96, 90)}${house(930, 482, 76, 80)}<path d="M1060 560V470C1020 474 1000 440 1022 418C1010 386 1042 362 1070 376C1090 350 1134 362 1136 394C1166 400 1174 440 1148 456C1138 474 1110 478 1088 470V560Z"/></g>`;
  // moon and stars
  b += `<circle cx="1176" cy="96" r="38" fill="${C.star}"/><circle cx="1164" cy="86" r="7" fill="#e2d3b0"/><circle cx="1190" cy="106" r="10" fill="#e2d3b0"/><circle cx="1172" cy="118" r="4" fill="#e2d3b0"/>`;
  const stars = [[786, 80, 4.5], [884, 132, 3], [960, 60, 3.5], [1050, 108, 3], [1246, 196, 3.5], [1100, 40, 2.5], [828, 372, 3], [1008, 356, 3.5], [1232, 338, 3], [760, 196, 3]];
  for (const [x, y, s] of stars) b += `<path d="M${x} ${y - s * 2}Q${x} ${y} ${x + s * 2} ${y}Q${x} ${y} ${x} ${y + s * 2}Q${x} ${y} ${x - s * 2} ${y}Q${x} ${y} ${x} ${y - s * 2}Z" fill="${C.star}"/>`;
  // the garden: a hedge, and the lamplight reaching the grass
  b += `<path d="M${EDGE - 20} ${H}V556C760 540 800 548 830 560C870 536 930 544 960 564C1000 546 1060 552 1090 570C1130 552 1190 556 1220 574C1240 566 1262 566 ${W} 572V${H}Z" fill="${C.garden}"/>`;
  // a mailbox by the gate, flag up
  b += `<rect x="1178" y="530" width="12" height="${H - 530}" fill="#1b2542"/>`;
  b += `<path d="M1132 534V514A20 20 0 0 1 1152 494H1236V534Z" fill="#2a3760"/><path d="M1132 534V514A20 20 0 0 1 1172 514V534Z" fill="#1f2a4b"/>`;
  b += `<rect x="1210" y="468" width="6" height="34" fill="${C.terraDark}"/><rect x="1210" y="468" width="20" height="13" fill="${C.terra}"/>`;

  // the porch, then again in three warmer palettes clipped to the light
  b += `<clipPath id="wallc"><rect x="0" y="62" width="${POST + 28}" height="${FLOOR - 62}"/></clipPath>`;
  b += `<clipPath id="floorc"><rect x="0" y="${FLOOR}" width="${EDGE}" height="${H - FLOOR}"/></clipPath>`;
  b += porch(C);
  LEVELS.forEach((t, i) => {
    const sc = porch(lit(C, t));
    const [a, tt] = BELLS[i];
    const [rx, ry] = POOLS[i];
    // masks, not clip paths: a clip's soft edge lets the layers under a shape show through as a hairline
    b += `<mask id="lw${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><path d="${bell(a, tt)}" fill="#fff"/></mask><mask id="lf${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><ellipse cx="${LX}" cy="${FLOOR + 10}" rx="${rx}" ry="${ry}" fill="#fff"/></mask>`;
    b += `<g clip-path="url(#wallc)"><g mask="url(#lw${i})">${sc}</g></g>`;
    b += `<g clip-path="url(#floorc)"><g mask="url(#lf${i})">${sc}</g></g>`;
  });
  b += `<ellipse cx="${LX + 2}" cy="${FLOOR + 5}" rx="54" ry="7" fill="${C.woodLine}" opacity="0.55"/>`;
  b += dog(LX - 6, FLOOR + 4, 0.86, 'dg');
  b += lamp(LX, LY);
  b += moth(LX + 58, LY + 46, 0.9, 18) + moth(LX - 64, LY + 22, 0.75, -20);
  return b;
}

function hero() {
  let b = scene();
  b += `<text x="758" y="290" font-family="${WORD}" font-weight="700" font-size="86" letter-spacing="-0.5" fill="${C.trim}">Porchlight</text>`;
  b += `<text x="762" y="338" font-family="${WORD}" font-weight="400" font-size="27" fill="#c5cfe6">See who’s at the door.</text>`;
  return svg({ w: W, h: H, body: b });
}

// ---- the mark: a doorway of light, the lamp at its top, the dog waiting in it ----
const M = [warm(C.wall, 0.3), warm(C.wall, 0.62), '#f3c45c'];
function markBody(id) {
  const arch = (w, top) => `M${100 - w} 190V${top + w}A${w} ${w} 0 0 1 ${100 + w} ${top + w}V190Z`;
  let b = `<path d="${arch(76, 10)}" fill="${C.wall}"/>`;
  b += `<clipPath id="${id}a"><path d="${arch(76, 10)}"/></clipPath><g clip-path="url(#${id}a)">`;
  const cone = (a, t) => `M${100 - a} 172C${100 - a * 0.7} 120 ${100 - t - 8} 86 ${100 - t} 54H${100 + t}C${100 + t + 8} 86 ${100 + a * 0.7} 120 ${100 + a} 172Z`;
  b += `<path d="${cone(96, 22)}" fill="${M[0]}"/><path d="${cone(70, 18)}" fill="${M[1]}"/><path d="${cone(44, 14)}" fill="${M[2]}"/>`;
  b += `<rect x="0" y="160" width="200" height="40" fill="${C.wood}"/>`;
  b += `<ellipse cx="100" cy="166" rx="92" ry="13" fill="${warm(C.wood, 0.3)}"/><ellipse cx="100" cy="166" rx="66" ry="9" fill="${warm(C.wood, 0.55)}"/><ellipse cx="100" cy="166" rx="40" ry="5.5" fill="${warm(C.wood, 0.8)}"/>`;
  b += `</g>`;
  b += dog(96, 168, 0.62, `${id}d`, { body: C.sky, shade: '#2a3558', lit: C.sky, patch: C.sky, patchDark: '#2a3558', ink: C.glass });
  // shade
  b += `<rect x="94" y="22" width="12" height="9" rx="2" fill="${C.terraDark}"/>`;
  b += `<path d="M90 29H110Q117 44 132 51H68Q83 44 90 29Z" fill="${C.terra}"/><path d="M101 29H110Q117 44 132 51H106Q104 40 101 29Z" fill="${C.terraLit}"/>`;
  b += `<rect x="65" y="50" width="70" height="6" rx="3" fill="${C.terraDark}"/>`;
  b += `<path d="M88 56A12 8 0 0 0 112 56Z" fill="${C.glassHot}"/>`;
  b += `<path d="${arch(76, 10)}" fill="none" stroke="${C.door}" stroke-width="6"/>`;
  return b;
}
const markSvg = () => svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('m') });

function iconSvg() {
  let b = `<rect width="512" height="512" rx="112" fill="${C.sky}"/>`;
  b += `<clipPath id="ic"><rect width="512" height="512" rx="112"/></clipPath><g clip-path="url(#ic)">`;
  b += `<rect y="0" width="512" height="512" fill="${C.wall}"/>`;
  for (let y = 44; y < 512; y += 44) b += `<rect y="${y}" width="512" height="5" fill="${C.wallLine}"/>`;
  b += `</g>`;
  b += nest({ x: 36, y: 30, w: 440, h: 440, vb: '0 0 200 200', body: markBody('i') });
  return svg({ w: 512, h: 512, body: b });
}

// ---- favicons, on the pixel grid ----------------------------------------------------
const PIX = { W: C.wall, T: C.terra, t: C.terraDark, H: C.glassHot, a: M[0], b: M[1], c: M[2], F: warm(C.wood, 0.5), D: C.sky, R: C.terra, E: C.glass };
function pix(rows) {
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
// the tile, the shade and the steps of light are worked out per pixel; the dog is drawn by hand
function favRows(N, dogRows, dogX, dogY) {
  const g = Array.from({ length: N }, () => Array(N).fill('.'));
  const k = N / 16;
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const cr = 2.4 * k; // corner radius
      const ex = Math.max(0, cr - 0.5 - Math.min(x, N - 1 - x));
      const ey = Math.max(0, cr - 0.5 - Math.min(y, N - 1 - y));
      if (ex * ex + ey * ey > cr * cr) continue;
      let ch = 'W';
      const d = Math.abs(x - c);
      const yy = y / k;
      if (yy >= 13.5) ch = 'F';
      else if (yy >= 4) {
        const t = yy - 4;
        if (d <= (1.0 + t * 0.34) * k) ch = 'c';
        else if (d <= (1.9 + t * 0.52) * k) ch = 'b';
        else if (d <= (2.8 + t * 0.7) * k) ch = 'a';
      }
      if (yy >= 3 && yy < 4 && d <= 4.6 * k) ch = 't';
      else if (yy >= 2 && yy < 3 && d <= 2.6 * k) ch = 'T';
      else if (yy >= 1 && yy < 2 && d <= 1.2 * k) ch = N === 16 ? 'T' : y < 3 ? 't' : 'T';
      else if (yy >= 4 && yy < 4.6 && d <= 1.2 * k) ch = 'H';
      g[y][x] = ch;
    }
  dogRows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') g[dogY + j][dogX + i] = ch; }));
  return g.map((row) => row.join(''));
}
const DOG16 = [
  '....D..',
  '...DDD.',
  '...DDDD',
  '...RR..',
  '..DDD..',
  '.DDDD..',
  '.DDDD..',
  'DDDDDD.',
];
const DOG32 = [
  '.......D.....',
  '......DD.....',
  '......DDDD...',
  '.....DDDEDDD.',
  '.....DDDDDDDD',
  '.....DDDDDD..',
  '....RRRRR....',
  '....DDDDD....',
  '...DDDDDD....',
  '..DDDDDDD....',
  '..DDDDDDD....',
  '.DDDDDDDD....',
  'D.DDDDDDD....',
  'D.DDDDDDD....',
  '.DDDDDDDDD...',
  '..DDDDDDDDDD.',
];
const favSvg = () => svg({ w: 16, h: 16, crisp: true, body: pix(favRows(16, DOG16, 5, 6)) });
const fav32Svg = () => svg({ w: 32, h: 32, crisp: true, body: pix(favRows(32, DOG32, 10, 12)) });

// ---- logo ------------------------------------------------------------------------
function logoSvg(dark) {
  let b = nest({ x: 14, y: 8, w: 184, h: 184, vb: '0 0 200 200', body: markBody(dark ? 'ld' : 'll') });
  b += `<text x="208" y="118" font-family="${WORD}" font-weight="700" font-size="76" letter-spacing="-0.5" fill="${dark ? C.trim : C.sky}">Porchlight</text>`;
  b += `<text x="211" y="156" font-family="${WORD}" font-weight="400" font-size="22" fill="${dark ? '#c5cfe6' : C.terraDark}">See who’s at the door.</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 45 Flat porch (dog and swing)

The same family as 15, a new scene: a navy clapboard porch at night, a barn light on a gooseneck over a mustard door, and a dog sitting up in its light, looking out for whoever is coming. A parcel waits on the mat; boots, a porch swing with a striped pillow and a hanging fern fill the rest. The light is drawn as three stepped bells on the wall and three pools on the floor, each one warming everything it crosses. The mark is a doorway of light with the lamp at its top and the dog waiting in it.
Palette: night #121930, navy #2a3f66, mustard #dba33a, terracotta #c5583a, cream #efe3c8, fern #467663, lamplight #ffe6a2.
Type: Rockwell Bold for the name, Rockwell Regular for the tagline.
Tagline: See who's at the door.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(),
  'logo.svg': logoSvg(false),
  'logo-dark.svg': logoSvg(true),
  'favicon.svg': favSvg(),
  'favicon-32.svg': fav32Svg(),
  'icon.svg': iconSvg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
