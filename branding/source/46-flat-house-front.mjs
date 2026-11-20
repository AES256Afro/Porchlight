// 46 Flat house front: the whole house, symmetrical and storybook-flat, under a
// dusk sky in bands. Every window is dark; only the porch is lit. A picket
// fence, a mailbox, a bicycle. The title is centred above, the way a
// storybook cover sets it.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '46-flat-house-front';
const SKY = ['#3b4265', '#52537a', '#786a8c', '#a98190', '#d49e8e', '#edc49d'];
const C = {
  wall: '#8fb0ad',
  wallLine: '#7ea19e',
  wallShade: '#6f9391',
  trim: '#f1e7d4',
  trimShade: '#cdbfab',
  roof: '#454a6c',
  roofLine: '#393e5d',
  shutter: '#4b6d76',
  pane: '#363d5c',
  paneHi: '#566086',
  door: '#d8705c',
  doorDark: '#b95747',
  brick: '#a8675f',
  brickDark: '#8a5049',
  deck: '#b8a48e',
  deckShade: '#9a8672',
  lattice: '#4b6d76',
  lawn: '#47655a',
  lawnDark: '#3b564d',
  path: '#b3a091',
  pathLine: '#998777',
  fence: '#dcd2c2',
  fenceShade: '#b9ad9c',
  bush: '#3f6157',
  bushHi: '#55796a',
  flower: '#edc49d',
  pot: '#b95747',
  tree: '#324d4c',
  treeHi: '#3d5c58',
  ink: '#2b2f48',
  metal: '#2b2f48',
  tyre: '#2b2f48',
  bike: '#d8705c',
  basket: '#cdbfab',
  mail: '#52537a',
  glass: '#fff3cf',
};
const CREAM = '#f6ecd8';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const LIGHT = '#ffc552';
const warm = (c, t) => {
  const a = rgb(c);
  const l = rgb(LIGHT);
  return hex(a.map((v, i) => (255 - ((255 - v) * (255 - l[i] * t)) / 255) * 0.4 + (v + (l[i] - v) * t) * 0.6));
};
const lit = (P, t) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, warm(v, t)]));
const LEVELS = [0.18, 0.42, 0.7];
const n = (v) => +v.toFixed(2);

const W = 1280;
const H = 640;
const CX = 640;
const HX0 = 460;
const HX1 = 820;
const PEAK = 204;
const SL = 0.76;
const roofY = (x) => PEAK + Math.abs(x - CX) * SL;
const FLOOR = 540;
const GROUND = 564;
const PR_TOP = 430;
const PR_BOT = 446;
const PCEIL = 454;
const LY = 461;

function sash(cx, top, w, h, C, shutters = true) {
  const x = cx - w / 2;
  let b = '';
  if (shutters) for (const sx of [x - 20, x + w + 6]) b += `<rect x="${sx}" y="${top - 2}" width="14" height="${h + 4}" fill="${C.shutter}"/><path d="M${sx + 3} ${top + 8}h8M${sx + 3} ${top + 16}h8M${sx + 3} ${top + 24}h8M${sx + 3} ${top + h - 22}h8M${sx + 3} ${top + h - 14}h8M${sx + 3} ${top + h - 6}h8" stroke="${C.wallShade}" stroke-width="2"/>`;
  b += `<rect x="${x - 4}" y="${top - 4}" width="${w + 8}" height="${h + 8}" fill="${C.trim}"/>`;
  b += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${C.pane}"/>`;
  b += `<path d="M${x + w * 0.16} ${top + h * 0.44}L${x + w * 0.46} ${top + 3}H${x + w * 0.66}L${x + w * 0.16} ${top + h * 0.72}Z" fill="${C.paneHi}"/>`;
  b += `<rect x="${x}" y="${top + h / 2 - 1.5}" width="${w}" height="3" fill="${C.trim}"/><rect x="${cx - 1.5}" y="${top}" width="3" height="${h}" fill="${C.trim}"/>`;
  b += `<rect x="${x - 8}" y="${top + h + 4}" width="${w + 16}" height="5" fill="${C.trim}"/><rect x="${x - 8}" y="${top + h + 7}" width="${w + 16}" height="2" fill="${C.trimShade}"/>`;
  return b;
}

function house(C) {
  let b = '';
  // chimney, behind the roof
  b += `<rect x="728" y="238" width="30" height="80" fill="${C.brick}"/><rect x="724" y="230" width="38" height="10" fill="${C.brickDark}"/>`;
  b += `<path d="M728 256h30M728 272h30" stroke="${C.brickDark}" stroke-width="2"/>`;
  // gable wall and clapboards
  const wallPath = `M${HX0} ${FLOOR}V${n(roofY(HX0))}L${CX} ${PEAK}L${HX1} ${n(roofY(HX1))}V${FLOOR}Z`;
  b += `<path d="${wallPath}" fill="${C.wall}"/>`;
  let lines = '';
  for (let y = PEAK + 26; y < PR_TOP; y += 13) lines += `M${HX0} ${y}H${HX1}`;
  for (let y = PCEIL + 16; y < FLOOR; y += 13) lines += `M${HX0} ${y}H${HX1}`;
  b += `<g clip-path="url(#gable)"><path d="${lines}" stroke="${C.wallLine}" stroke-width="2"/></g>`;
  // roof: a slate chevron with a cream bargeboard under it
  b += `<path d="M${HX0 - 12} ${n(roofY(HX0 - 12) + 14)}L${CX} ${PEAK + 14}L${HX1 + 12} ${n(roofY(HX1 + 12) + 14)}" fill="none" stroke="${C.trim}" stroke-width="6"/>`;
  b += `<path d="M${HX0 - 30} ${n(roofY(HX0 - 30))}L${CX} ${PEAK}L${HX1 + 30} ${n(roofY(HX1 + 30))}" fill="none" stroke="${C.roof}" stroke-width="20" stroke-linejoin="miter"/>`;
  // attic porthole
  b += `<circle cx="${CX}" cy="290" r="25" fill="${C.trim}"/><circle cx="${CX}" cy="290" r="19" fill="${C.pane}"/>`;
  b += `<path d="M${CX - 12} 296L${CX + 2} 274H${CX + 10}L${CX - 6} 300Z" fill="${C.paneHi}"/>`;
  b += `<rect x="${CX - 1.5}" y="271" width="3" height="38" fill="${C.trim}"/><rect x="${CX - 19}" y="288.5" width="38" height="3" fill="${C.trim}"/>`;
  // upstairs windows
  for (const cx of [536, 640, 744]) b += sash(cx, 356, 44, 58, C);
  // porch: roof, fascia, the shade under it
  b += `<rect x="${HX0}" y="${PCEIL}" width="${HX1 - HX0}" height="${FLOOR - PCEIL}" fill="${C.wall}"/>`;
  let l2 = '';
  for (let y = PCEIL + 16; y < FLOOR; y += 13) l2 += `M${HX0} ${y}H${HX1}`;
  b += `<path d="${l2}" stroke="${C.wallLine}" stroke-width="2"/>`;
  b += `<rect x="${HX0}" y="${PCEIL}" width="${HX1 - HX0}" height="9" fill="${C.wallShade}"/>`;
  // downstairs windows and the door
  for (const cx of [524, 756]) b += sash(cx, 474, 46, 50, C);
  b += `<rect x="${CX - 32}" y="466" width="64" height="${FLOOR - 466}" fill="${C.trim}"/>`;
  b += `<rect x="${CX - 26}" y="472" width="52" height="${FLOOR - 472}" fill="${C.door}"/>`;
  b += `<path d="M${CX - 15} 502V490A15 15 0 0 1 ${CX + 15} 490V502Z" fill="${C.pane}"/><path d="M${CX} 477V502M${CX - 15} 491H${CX + 15}" stroke="${C.door}" stroke-width="2.5"/>`;
  b += `<rect x="${CX - 17}" y="509" width="34" height="24" fill="${C.doorDark}"/><rect x="${CX - 13}" y="513" width="26" height="16" fill="${C.door}"/>`;
  b += `<circle cx="${CX + 19}" cy="507" r="2.6" fill="${C.trim}"/>`;
  // posts and rails
  const posts = [HX0 + 2, 566, 704, HX1 - 12];
  for (const [x0, x1] of [[posts[0], posts[1]], [posts[2], posts[3]]]) {
    b += `<rect x="${x0}" y="510" width="${x1 - x0 + 10}" height="5" fill="${C.trim}"/><rect x="${x0}" y="532" width="${x1 - x0 + 10}" height="4" fill="${C.trim}"/>`;
    let bal = '';
    for (let x = x0 + 18; x < x1; x += 10) bal += `M${x} 515V532`;
    b += `<path d="${bal}" stroke="${C.trim}" stroke-width="3"/>`;
  }
  for (const x of posts) b += `<rect x="${x}" y="${PCEIL}" width="10" height="${FLOOR - PCEIL}" fill="${C.trim}"/><rect x="${x + 7}" y="${PCEIL}" width="3" height="${FLOOR - PCEIL}" fill="${C.trimShade}"/><rect x="${x - 3}" y="${PCEIL}" width="16" height="5" fill="${C.trim}"/>`;
  // topiary either side of the door
  for (const x of [590, 690]) {
    b += `<rect x="${x - 1.5}" y="${FLOOR - 26}" width="3" height="14" fill="${C.tree}"/>`;
    b += `<circle cx="${x}" cy="${FLOOR - 34}" r="11" fill="${C.bush}"/><path d="M${x - 2} ${FLOOR - 44}A11 11 0 0 1 ${x + 10} ${FLOOR - 30}A14 14 0 0 0 ${x - 2} ${FLOOR - 44}Z" fill="${C.bushHi}"/>`;
    b += `<path d="M${x - 9} ${FLOOR - 13}H${x + 9}L${x + 7} ${FLOOR}H${x - 7}Z" fill="${C.pot}"/>`;
  }
  // porch roof over all of it
  b += `<path d="M${HX0 - 18} ${PR_BOT}L${HX0 + 2} ${PR_TOP}H${HX1 - 2}L${HX1 + 18} ${PR_BOT}Z" fill="${C.roof}"/>`;
  b += `<path d="M${HX0 - 8} ${PR_BOT - 8}H${HX1 + 8}" stroke="${C.roofLine}" stroke-width="2"/>`;
  b += `<rect x="${HX0 - 16}" y="${PR_BOT}" width="${HX1 - HX0 + 32}" height="8" fill="${C.trim}"/><rect x="${HX0 - 16}" y="${PR_BOT + 6}" width="${HX1 - HX0 + 32}" height="2" fill="${C.trimShade}"/>`;
  // deck edge, lattice, steps
  b += `<rect x="${HX0 - 8}" y="${FLOOR}" width="${HX1 - HX0 + 16}" height="6" fill="${C.trim}"/>`;
  b += `<rect x="${HX0 - 2}" y="${FLOOR + 6}" width="${HX1 - HX0 + 4}" height="${GROUND - FLOOR - 6}" fill="${C.lattice}"/>`;
  [[598, 684], [590, 692], [582, 700]].forEach(([x0, x1], i) => {
    const y = FLOOR + i * 8;
    b += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="8" fill="${C.deckShade}"/><rect x="${x0}" y="${y}" width="${x1 - x0}" height="3.5" fill="${C.deck}"/>`;
  });
  return b;
}

function bicycle(x, y, C) {
  // leaning on the fence; (x, y) is where the back wheel touches the ground
  const r = 25;
  const bw = [x, y - r];
  const fw = [x + 76, y - r];
  const bb = [x + 30, y - r + 2]; // bottom bracket
  const seat = [x + 22, y - 62];
  const head = [x + 62, y - 62];
  let b = '';
  for (const [cx, cy] of [bw, fw]) b += `<circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="none" stroke="${C.tyre}" stroke-width="4"/><circle cx="${cx}" cy="${cy}" r="3" fill="${C.tyre}"/><path d="M${cx - r + 4} ${cy}H${cx + r - 4}M${cx} ${cy - r + 4}V${cy + r - 4}M${cx - 15} ${cy - 15}L${cx + 15} ${cy + 15}M${cx - 15} ${cy + 15}L${cx + 15} ${cy - 15}" stroke="${C.tyre}" stroke-width="1" opacity="0.7"/>`;
  const L = (a, c, w = 4, col = C.bike) => `<path d="M${a[0]} ${a[1]}L${c[0]} ${c[1]}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  b += L(bw, bb) + L(bw, seat) + L(seat, bb) + L(bb, head) + L(seat, head) + L(head, fw);
  b += L([seat[0] - 2, seat[1] - 10], seat, 4);
  b += `<path d="M${seat[0] - 12} ${seat[1] - 12}H${seat[0] + 8}" stroke="${C.tyre}" stroke-width="5" stroke-linecap="round"/>`;
  b += `<path d="M${head[0]} ${head[1]}L${head[0] - 3} ${head[1] - 14}H${head[0] - 14}" stroke="${C.tyre}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  b += `<path d="M${head[0] + 2} ${head[1] - 8}H${head[0] + 26}L${head[0] + 23} ${head[1] + 8}H${head[0] + 5}Z" fill="${C.basket}"/><path d="M${head[0] + 4} ${head[1] - 2}H${head[0] + 25}" stroke="${C.fenceShade}" stroke-width="1.5"/>`;
  b += `<circle cx="${bb[0]}" cy="${bb[1]}" r="5" fill="${C.tyre}"/>`;
  return b;
}

function garden(C) {
  let b = `<rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="${C.lawn}"/>`;
  b += `<path d="M0 ${GROUND + 34}H${W}V${H}H0Z" fill="${C.lawnDark}" opacity="0.5"/>`;
  // path from the steps to the gate
  b += `<path d="M582 ${GROUND}H700L716 ${H}H566Z" fill="${C.path}"/>`;
  b += `<path d="M579 ${GROUND + 20}H703M574 ${GROUND + 44}H708M570 ${GROUND + 66}H712" stroke="${C.pathLine}" stroke-width="2"/>`;
  // flower beds along the porch
  for (const [x0, x1] of [[HX0 - 16, 578], [704, HX1 + 16]]) {
    let x = x0;
    let i = 0;
    while (x < x1 - 10) {
      const r = [15, 12, 17, 13][i % 4];
      b += `<circle cx="${x + r}" cy="${GROUND + 2 - r * 0.5}" r="${r}" fill="${i % 2 ? C.bushHi : C.bush}"/>`;
      b += `<circle cx="${x + r - 4}" cy="${GROUND - r * 0.8}" r="2.4" fill="${C.flower}"/><circle cx="${x + r + 5}" cy="${GROUND - r * 0.4}" r="2.4" fill="${i % 3 ? C.flower : C.door}"/><circle cx="${x + r - 1}" cy="${GROUND - 1}" r="2" fill="${C.trim}"/>`;
      x += r * 1.6;
      i++;
    }
  }
  // picket fence with a gap for the gate
  const picket = (x) => `<path d="M${x} 632V588L${x + 6} 580L${x + 12} 588V632Z" fill="${C.fence}"/><rect x="${x + 9}" y="588" width="3" height="44" fill="${C.fenceShade}"/>`;
  let f = '';
  for (let x = 6; x < 560; x += 25) f += picket(x);
  for (let x = W - 18; x > 720; x -= 25) f += picket(x);
  b += `<rect x="0" y="596" width="566" height="5" fill="${C.fenceShade}"/><rect x="0" y="618" width="566" height="5" fill="${C.fenceShade}"/>`;
  b += `<rect x="716" y="596" width="${W - 716}" height="5" fill="${C.fenceShade}"/><rect x="716" y="618" width="${W - 716}" height="5" fill="${C.fenceShade}"/>`;
  b += f;
  for (const x of [556, 710]) b += `<rect x="${x}" y="574" width="14" height="62" fill="${C.fence}"/><rect x="${x + 10}" y="574" width="4" height="62" fill="${C.fenceShade}"/><rect x="${x - 2}" y="570" width="18" height="6" rx="2" fill="${C.fence}"/>`;
  b += `<circle cx="563" cy="566" r="5" fill="${C.fence}"/>`;
  // mailbox in front of the fence, flag up
  b += `<rect x="316" y="606" width="9" height="34" fill="${C.ink}"/>`;
  b += `<path d="M292 610V596A13 13 0 0 1 305 583H350V610Z" fill="${C.mail}"/><path d="M292 610V596A13 13 0 0 1 318 596V610Z" fill="${C.ink}"/>`;
  b += `<rect x="336" y="566" width="4.5" height="22" fill="${C.doorDark}"/><rect x="336" y="566" width="13" height="9" fill="${C.door}"/>`;
  b += bicycle(782, 636, C);
  return b;
}

function cypress(x, base, h, w, fill, hi) {
  return (
    `<path d="M${x} ${base - h}C${x + w * 0.62} ${base - h * 0.62} ${x + w * 0.6} ${base - h * 0.18} ${x + w * 0.24} ${base}H${x - w * 0.24}C${x - w * 0.6} ${base - h * 0.18} ${x - w * 0.62} ${base - h * 0.62} ${x} ${base - h}Z" fill="${fill}"/>` +
    `<path d="M${x} ${base - h}C${x + w * 0.62} ${base - h * 0.62} ${x + w * 0.6} ${base - h * 0.18} ${x + w * 0.24} ${base}H${x + w * 0.04}C${x + w * 0.3} ${base - h * 0.3} ${x + w * 0.24} ${base - h * 0.7} ${x} ${base - h}Z" fill="${hi}"/>`
  );
}

function backdrop() {
  let b = '';
  const ys = [0, 166, 258, 334, 402, 462, H];
  SKY.forEach((c, i) => (b += `<rect x="0" y="${ys[i]}" width="${W}" height="${ys[i + 1] - ys[i] + 1}" fill="${c}"/>`));
  // moon and stars
  b += `<path d="M1134 62a30 30 0 1 0 26 48a25 25 0 1 1 -26 -48Z" fill="${CREAM}"/>`;
  const stars = [[92, 70, 4], [176, 128, 2.6], [248, 52, 3], [70, 196, 2.6], [1040, 150, 2.6], [1206, 176, 3], [1232, 52, 2.6], [980, 56, 3], [332, 112, 2.4], [1090, 214, 2.2], [150, 262, 2.2]];
  for (const [x, y, s] of stars) b += `<path d="M${x} ${y - s * 2}Q${x} ${y} ${x + s * 2} ${y}Q${x} ${y} ${x} ${y + s * 2}Q${x} ${y} ${x - s * 2} ${y}Q${x} ${y} ${x} ${y - s * 2}Z" fill="${CREAM}" opacity="0.9"/>`;
  // far hills
  b += `<path d="M0 ${GROUND}V500C80 486 150 492 220 478C300 462 360 484 430 480H850C920 484 980 462 1060 478C1130 492 1200 486 ${W} 500V${GROUND}Z" fill="#6a5f82"/>`;
  b += `<path d="M0 ${GROUND}V528C90 518 170 524 250 514C330 504 400 520 460 518H820C880 520 950 504 1030 514C1110 524 1190 518 ${W} 528V${GROUND}Z" fill="#514d70"/>`;
  // cypresses, mirrored
  for (const s of [-1, 1]) {
    b += cypress(CX + s * 332, GROUND + 4, 250, 58, C.tree, C.treeHi);
    b += cypress(CX + s * 272, GROUND + 4, 322, 66, '#2c4646', C.tree);
    b += cypress(CX + s * 396, GROUND + 4, 186, 50, '#2c4646', C.tree);
  }
  return b;
}

function weathervane() {
  const y = PEAK - 12;
  let b = `<path d="M${CX} ${y}V${y - 34}" stroke="${C.ink}" stroke-width="3"/>`;
  b += `<circle cx="${CX}" cy="${y - 14}" r="3.5" fill="${C.ink}"/>`;
  b += `<path d="M${CX - 24} ${y - 28}H${CX + 16}" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>`;
  b += `<path d="M${CX + 14} ${y - 35}L${CX + 28} ${y - 28}L${CX + 14} ${y - 21}Z" fill="${C.ink}"/>`;
  b += `<path d="M${CX - 28} ${y - 35}L${CX - 18} ${y - 28}L${CX - 28} ${y - 21}Z" fill="${C.ink}"/>`;
  return b;
}

function scene() {
  let b = backdrop();
  b += `<clipPath id="gable"><path d="M${HX0} ${FLOOR}V${n(roofY(HX0))}L${CX} ${PEAK}L${HX1} ${n(roofY(HX1))}V${FLOOR}Z"/></clipPath>`;
  b += `<clipPath id="underporch"><rect x="${HX0 - 8}" y="${PCEIL}" width="${HX1 - HX0 + 16}" height="${FLOOR - PCEIL}"/></clipPath>`;
  b += `<clipPath id="groundc"><rect x="0" y="${FLOOR}" width="${W}" height="${H - FLOOR}"/></clipPath>`;
  const all = (P) => house(P) + garden(P);
  b += all(C);
  const wallR = [176, 108, 58];
  const pool = [[272, 72], [184, 48], [100, 26]];
  LEVELS.forEach((t, i) => {
    const sc = all(lit(C, t));
    // masks, not clip paths: a clip's soft edge lets the layers under a shape show through as a hairline
    b += `<mask id="lw${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><circle cx="${CX}" cy="${LY + 26}" r="${wallR[i]}" fill="#fff"/></mask><mask id="lg${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><ellipse cx="${CX}" cy="${GROUND + 12}" rx="${pool[i][0]}" ry="${pool[i][1]}" fill="#fff"/></mask>`;
    b += `<g clip-path="url(#underporch)"><g mask="url(#lw${i})">${sc}</g></g>`;
    b += `<g clip-path="url(#groundc)"><g mask="url(#lg${i})">${sc}</g></g>`;
  });
  // the lamp itself
  b += `<rect x="${CX - 5}" y="${PCEIL}" width="10" height="3" fill="${C.ink}"/><circle cx="${CX}" cy="${LY + 1}" r="6.5" fill="${C.glass}"/><circle cx="${CX}" cy="${LY + 1}" r="3.2" fill="#ffffff"/>`;
  b += weathervane();
  // a cat on the gate post, watching the door
  b += `<g transform="translate(717 571)" fill="${C.ink}"><path d="M-8 0C-10 -11 -6 -18 0 -18C6 -18 9 -11 8 0Z"/><circle cx="-2.5" cy="-22" r="6"/><path d="M-8 -24L-7.5 -31L-3 -27ZM-2 -27L2 -31L3.5 -24Z"/><path d="M6 -3C13 -3 13 8 10 15" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/></g>`;
  return b;
}

function hero() {
  let b = scene();
  b += `<text x="${CX + 7}" y="96" text-anchor="middle" font-family="Futura" font-weight="700" font-size="74" letter-spacing="14" fill="${CREAM}">PORCHLIGHT</text>`;
  b += `<text x="${CX + 3}" y="136" text-anchor="middle" font-family="Futura" font-weight="500" font-size="19" letter-spacing="6" fill="${SKY[5]}">LOOK AFTER YOUR OWN HOUSE.</text>`;
  return svg({ w: W, h: H, body: b });
}

// ---- mark: the house, dark but for its porch --------------------------------------
function markBody(id) {
  const sl = 0.78;
  const ry = (x) => 34 + Math.abs(x - 100) * sl;
  const wall = `M40 176V${n(ry(40))}L100 34L160 ${n(ry(160))}V176Z`;
  let b = `<path d="${wall}" fill="${C.wall}"/>`;
  // windows
  for (const x of [58, 122]) b += `<rect x="${x - 2}" y="88" width="24" height="26" fill="${C.trim}"/><rect x="${x + 1}" y="91" width="18" height="20" fill="${C.pane}"/><rect x="${x + 9}" y="91" width="2" height="20" fill="${C.trim}"/>`;
  b += `<circle cx="100" cy="72" r="11" fill="${C.trim}"/><circle cx="100" cy="72" r="7.5" fill="${C.pane}"/>`;
  // under the porch: three steps of light
  b += `<clipPath id="${id}p"><rect x="40" y="130" width="120" height="46"/></clipPath>`;
  b += `<g clip-path="url(#${id}p)"><circle cx="100" cy="146" r="60" fill="${warm(C.wall, 0.3)}"/><circle cx="100" cy="146" r="40" fill="${warm(C.wall, 0.62)}"/><circle cx="100" cy="146" r="21" fill="#f6cf6c"/></g>`;
  b += `<rect x="89" y="142" width="22" height="34" fill="${C.door}"/><rect x="87" y="140" width="26" height="3" fill="${C.trim}"/>`;
  b += `<circle cx="100" cy="134" r="4.5" fill="#fffaf0"/>`;
  for (const x of [42, 152]) b += `<rect x="${x}" y="130" width="6" height="46" fill="${C.trim}"/>`;
  b += `<path d="M30 130L40 120H160L170 130Z" fill="${C.roof}"/><rect x="32" y="128" width="136" height="5" fill="${C.trim}"/>`;
  b += `<rect x="34" y="176" width="132" height="6" fill="${C.trim}"/><rect x="82" y="182" width="36" height="6" fill="${C.deck}"/><rect x="76" y="188" width="48" height="6" fill="${C.deckShade}"/>`;
  // roof
  b += `<path d="M24 ${n(ry(24))}L100 34L176 ${n(ry(176))}" fill="none" stroke="${C.roof}" stroke-width="13" stroke-linejoin="miter"/>`;
  return b;
}
const markSvg = () => svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody('m') });
// on a dark page the slate roof needs a lighter edge
function markDarkSvg() {
  const sl = 0.78;
  const ry = (x) => 34 + Math.abs(x - 100) * sl;
  const b = markBody('md') + `<path d="M24 ${n(ry(24))}L100 34L176 ${n(ry(176))}" fill="none" stroke="#6a709a" stroke-width="13" stroke-linejoin="miter"/><path d="M30 130L40 120H160L170 130Z" fill="#6a709a"/><rect x="32" y="128" width="136" height="5" fill="${C.trim}"/>`;
  return svg({ w: 512, h: 512, vb: '0 0 200 200', body: b });
}

function iconSvg() {
  let b = `<clipPath id="ic"><rect width="512" height="512" rx="112"/></clipPath><g clip-path="url(#ic)">`;
  const ys = [0, 110, 200, 280, 350, 512];
  [SKY[0], SKY[1], SKY[2], SKY[3], SKY[4]].forEach((c, i) => (b += `<rect y="${ys[i]}" width="512" height="${ys[i + 1] - ys[i] + 1}" fill="${c}"/>`));
  b += `<rect y="424" width="512" height="88" fill="${C.lawn}"/>`;
  b += `<ellipse cx="256" cy="452" rx="150" ry="26" fill="${warm(C.lawn, 0.3)}"/><ellipse cx="256" cy="448" rx="92" ry="15" fill="${warm(C.lawn, 0.6)}"/>`;
  b += nest({ x: 46, y: 52, w: 420, h: 420, vb: '0 0 200 200', body: markBody('i') });
  b += `</g>`;
  return svg({ w: 512, h: 512, body: b });
}

// ---- favicons, on the pixel grid ----------------------------------------------------
const PIX = { R: C.roof, W: C.wall, P: C.pane, T: C.trim, D: C.door, G: '#f6cf6c', g: warm(C.wall, 0.62), H: '#fffaf0', S: C.deck };
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
const FAV16 = [
  '.......RR.......',
  '......RRRR......',
  '.....RRWWRR.....',
  '....RRWWWWRR....',
  '...RRWWPPWWRR...',
  '..RRWWWPPWWWRR..',
  '.RRWWWWWWWWWWRR.',
  '..WPPWWWWWWPPW..',
  '..WPPWWWWWWPPW..',
  '.RRRRRRRRRRRRRR.',
  '..WWWgGHHGgWWW..',
  '..TWggGDDGggWT..',
  '..TWgGGDDGGgWT..',
  '..TWgGGDDGGgWT..',
  '.TTTTTTTTTTTTTT.',
  '.....SSSSSS.....',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const set = (x, y, ch) => { if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch; };
  // wall and gable
  for (let y = 2; y <= 28; y++)
    for (let x = 3; x <= 28; x++) {
      const top = 2 + Math.abs(x - 15.5) * 0.9;
      if (y >= top && x >= 4 && x <= 27) set(x, y, 'W');
    }
  // roof chevron, 3 pixels thick
  for (let x = 1; x <= 30; x++) {
    const top = Math.round(0.6 + Math.abs(x - 15.5) * 0.9);
    for (let k = 0; k < 3; k++) set(x, top + k, 'R');
  }
  // windows
  for (const x0 of [6, 21]) for (let y = 13; y <= 17; y++) for (let x = x0; x < x0 + 5; x++) set(x, y, (x - x0) === 2 ? 'T' : 'P');
  for (let y = 8; y <= 10; y++) for (let x = 14; x <= 17; x++) set(x, y, 'P');
  // porch roof
  for (let x = 2; x <= 29; x++) { set(x, 19, 'R'); set(x, 20, 'R'); }
  // light under the porch
  for (let y = 21; y <= 28; y++)
    for (let x = 4; x <= 27; x++) {
      const d = Math.hypot(x - 15.5, (y - 22.5) * 1.1);
      set(x, y, d < 4.6 ? 'G' : d < 8.2 ? 'g' : 'W');
    }
  for (let y = 23; y <= 28; y++) for (let x = 14; x <= 17; x++) set(x, y, 'D');
  set(15, 21, 'H'); set(16, 21, 'H');
  for (let y = 21; y <= 28; y++) { set(4, y, 'T'); set(27, y, 'T'); }
  for (let x = 3; x <= 28; x++) set(x, 29, 'T');
  for (let x = 11; x <= 20; x++) set(x, 30, 'S');
  for (let x = 9; x <= 22; x++) set(x, 31, 'S');
  return g.map((r) => r.join(''));
}
const favSvg = () => svg({ w: 16, h: 16, crisp: true, body: pix(FAV16) });
const fav32Svg = () => svg({ w: 32, h: 32, crisp: true, body: pix(fav32Rows()) });

// ---- logo ------------------------------------------------------------------------
function logoSvg(dark) {
  let b = nest({ x: 10, y: 6, w: 188, h: 188, vb: '0 0 200 200', body: markBody(dark ? 'ld' : 'll') });
  if (dark) b += nest({ x: 10, y: 6, w: 188, h: 188, vb: '0 0 200 200', body: `<path d="M24 ${n(34 + 76 * 0.78)}L100 34L176 ${n(34 + 76 * 0.78)}" fill="none" stroke="#6a709a" stroke-width="13" stroke-linejoin="miter"/><path d="M30 130L40 120H160L170 130Z" fill="#6a709a"/><rect x="32" y="128" width="136" height="5" fill="${C.trim}"/>` });
  b += `<text x="212" y="112" font-family="Futura" font-weight="700" font-size="47" letter-spacing="7" fill="${dark ? CREAM : C.roof}">PORCHLIGHT</text>`;
  b += `<text x="214" y="145" font-family="Futura" font-weight="500" font-size="13.4" letter-spacing="3.9" fill="${dark ? SKY[4] : C.doorDark}">LOOK AFTER YOUR OWN HOUSE.</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 46 Flat house front

The whole house, symmetrical and storybook-flat: a duck-egg clapboard front under a slate gable, cypresses mirrored either side, a picket fence across the front, a mailbox with its flag up, a bicycle leaning by the gate and a cat on the gatepost. The dusk sky is six flat bands from indigo down to peach. Every window is dark; the one light is under the porch, drawn as three stepped shapes that warm the door, the posts, the steps and the path. The title is centred above in tracked capitals, the way a storybook cover sets it.
Palette: indigo #3b4265, mauve #786a8c, peach #edc49d, duck egg #8fb0ad, slate #454a6c, coral #d8705c, cream #f1e7d4, lawn #47655a.
Type: Futura Bold capitals, tracked wide, for the name; Futura Medium capitals for the tagline.
Tagline: Look after your own house.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(),
  'mark-dark.svg': markDarkSvg(),
  'logo.svg': logoSvg(false),
  'logo-dark.svg': logoSvg(true),
  'favicon.svg': favSvg(),
  'favicon-32.svg': fav32Svg(),
  'icon.svg': iconSvg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
