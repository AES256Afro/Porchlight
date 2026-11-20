// 60 Flat city stoop II (refines 47): a brick row house at night. Steps and an iron rail up
// to a teal double door with its number in the transom, a lantern over it, a
// cat in the one lit window, bins, a street tree and a bicycle. The light is
// three stepped rings on the brick and three pools on the pavement.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '60-flat-stoop-two';
const C = {
  brick: '#7b4743',
  brickLine: '#6a3b39',
  base: '#5d3434',
  baseLine: '#4d2a2c',
  stone: '#b7a08d',
  stoneShade: '#927d6c',
  stoneDark: '#756253',
  door: '#2c6c70',
  doorDark: '#215458',
  doorHi: '#3b8787',
  frame: '#241c2c',
  glass: '#1c1727',
  glassHi: '#3a2f4a',
  iron: '#17121d',
  brass: '#c9a14e',
  bin: '#516a6c',
  binDark: '#3e5456',
  binHi: '#6b8586',
  leaf: '#2f5f59',
  leafHi: '#417a6e',
  bloom: '#f3e6cf',
  pave: '#4b3f4c',
  paveLine: '#3d323f',
  curb: '#635461',
  road: '#1d1725',
};
const NIGHT = { sky: '#241b30', far: '#1a1323', far2: '#201828', win: '#2a2036', cream: '#f3e6cf', amber: '#f0b55a', amberHi: '#f8d58c', drape: '#d98f47', cat: '#1c1420', tree: '#1c3a3c', treeHi: '#2a5754', trunk: '#3a2a30', glass: '#ffe7a6', hot: '#fff8de' };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const LIGHT = '#ffb650';
const warm = (c, t) => {
  const a = rgb(c);
  const l = rgb(LIGHT);
  return hex(a.map((v, i) => (255 - ((255 - v) * (255 - l[i] * t)) / 255) * 0.45 + (v + (l[i] - v) * t) * 0.55));
};
const lit = (P, t) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, warm(v, t)]));
const LEVELS = [0.13, 0.26, 0.38];
const n = (v) => +v.toFixed(2);

const W = 1280;
const H = 640;
const BX = 590; // the house's left edge
const DC = 850; // centre of the door
const SILL = 392; // top of the stoop
const WALK = 560;
const LY = 104; // lantern
const FONT = 'Iowan Old Style';

function tallWindow(cx, C, kind) {
  const x = cx - 45;
  const top = 190;
  const h = 182;
  let b = '';
  // lintel with a keystone, sill
  b += `<rect x="${x - 10}" y="${top - 20}" width="110" height="18" fill="${C.stone}"/><path d="M${cx - 9} ${top - 24}H${cx + 9}L${cx + 6} ${top - 2}H${cx - 6}Z" fill="${C.stoneShade}"/>`;
  b += `<rect x="${x - 10}" y="${top + h}" width="110" height="12" fill="${C.stone}"/><rect x="${x - 10}" y="${top + h + 9}" width="110" height="3" fill="${C.stoneShade}"/>`;
  b += `<rect x="${x - 3}" y="${top - 3}" width="96" height="${h + 6}" fill="${C.frame}"/>`;
  if (kind === 'lit') {
    b += `<rect x="${x + 3}" y="${top + 3}" width="84" height="${h - 6}" fill="${NIGHT.amber}"/>`;
    b += `<rect x="${x + 3}" y="${top + 60}" width="84" height="${h - 63}" fill="${NIGHT.amberHi}"/>`;
    // drapes, a lampshade, the cat on the sill
    b += `<path d="M${x + 3} ${top + 3}H${x + 34}C${x + 30} ${top + 60} ${x + 16} ${top + 96} ${x + 3} ${top + 108}Z" fill="${NIGHT.drape}"/><path d="M${x + 87} ${top + 3}H${x + 56}C${x + 60} ${top + 60} ${x + 74} ${top + 96} ${x + 87} ${top + 108}Z" fill="${NIGHT.drape}"/>`;
    b += `<g transform="translate(${cx + 4} ${top + h - 3})" fill="${NIGHT.cat}"><path d="M-17 0C-21 -24 -13 -42 0 -42C13 -42 21 -24 17 0Z"/><circle cx="-1" cy="-50" r="12"/><path d="M-12 -54L-11.5 -69L-2.5 -59.5ZM0.5 -59.5L9.5 -69L10 -54Z"/><path d="M15 -5C34 -4 38 -16 33 -25" fill="none" stroke="${NIGHT.cat}" stroke-width="5.5" stroke-linecap="round"/></g>`;
  } else {
    b += `<rect x="${x + 3}" y="${top + 3}" width="84" height="${h - 6}" fill="${C.glass}"/>`;
    b += `<path d="M${x + 12} ${top + 84}L${x + 46} ${top + 12}H${x + 62}L${x + 12} ${top + 118}Z" fill="${C.glassHi}"/>`;
    if (kind === 'blind') {
      b += `<rect x="${x + 3}" y="${top + 3}" width="84" height="74" fill="${C.glassHi}"/>`;
      for (let y = top + 12; y < top + 76; y += 9) b += `<rect x="${x + 3}" y="${y}" width="84" height="2" fill="${C.glass}"/>`;
      b += `<path d="M${cx + 30} ${top + 77}v18" stroke="${C.glassHi}" stroke-width="1.6"/><circle cx="${cx + 30}" cy="${top + 97}" r="2.4" fill="${C.glassHi}"/>`;
    }
  }
  b += `<rect x="${x + 3}" y="${top + h / 2 - 3}" width="84" height="6" fill="${C.frame}"/>`;
  return b;
}

function binCan(x, C, tilt = 0) {
  // a ribbed metal bin and its lid; x is the left, standing on the pavement
  let b = `<path d="M${x} ${WALK - 62}H${x + 46}L${x + 43} ${WALK}H${x + 3}Z" fill="${C.bin}"/>`;
  b += `<path d="M${x + 30} ${WALK - 62}H${x + 46}L${x + 43} ${WALK}H${x + 29}Z" fill="${C.binDark}"/>`;
  for (const dx of [9, 17, 25, 33]) b += `<path d="M${x + dx} ${WALK - 54}L${x + dx + (dx - 21) * 0.05} ${WALK - 6}" stroke="${C.binDark}" stroke-width="2"/>`;
  b += `<rect x="${x - 1}" y="${WALK - 46}" width="48" height="3" fill="${C.binHi}"/><rect x="${x + 1}" y="${WALK - 18}" width="44" height="3" fill="${C.binHi}"/>`;
  b += `<g transform="rotate(${tilt} ${x + 23} ${WALK - 64})"><path d="M${x - 5} ${WALK - 62}Q${x + 23} ${WALK - 78} ${x + 51} ${WALK - 62}Z" fill="${C.binHi}"/><rect x="${x - 6}" y="${WALK - 64}" width="58" height="5" rx="2.5" fill="${C.bin}"/><path d="M${x + 16} ${WALK - 72}q7 -9 14 0" fill="none" stroke="${C.binDark}" stroke-width="3" stroke-linecap="round"/></g>`;
  return b;
}

function house(C) {
  let b = `<rect x="${BX}" y="0" width="${W - BX}" height="${WALK}" fill="${C.brick}"/>`;
  // brick: courses, and joints staggered every other course
  let courses = '';
  let joints = '';
  let i = 0;
  for (let y = 14; y < 404; y += 13) {
    courses += `M${BX} ${y}H${W}`;
    for (let x = BX + (i % 2 ? 26 : 0) + 10; x < W; x += 52) joints += `M${x} ${y}v13`;
    i++;
  }
  b += `<path d="${courses}" stroke="${C.brickLine}" stroke-width="2"/><path d="${joints}" stroke="${C.brickLine}" stroke-width="2" opacity="0.7"/>`;
  // the base: darker, in big blocks, under a stone band
  b += `<rect x="${BX}" y="404" width="${W - BX}" height="${WALK - 404}" fill="${C.base}"/>`;
  let blocks = '';
  for (let y = 444, k = 0; y < WALK; y += 38, k++) {
    blocks += `M${BX} ${y}H${W}`;
    for (let x = BX + (k % 2 ? 40 : 86); x < W; x += 92) blocks += `M${x} ${y}v38`;
  }
  for (let x = BX + 40; x < W; x += 92) blocks += `M${x} 414v30`;
  b += `<path d="${blocks}" stroke="${C.baseLine}" stroke-width="2.5"/>`;
  b += `<rect x="${BX}" y="398" width="${W - BX}" height="14" fill="${C.stone}"/><rect x="${BX}" y="409" width="${W - BX}" height="3" fill="${C.stoneShade}"/>`;
  // the floor above: only the sills and the foot of each window show
  for (const cx of [675, DC, 1025, 1175]) {
    b += `<rect x="${cx - 48}" y="-6" width="96" height="46" fill="${C.frame}"/><rect x="${cx - 42}" y="-6" width="84" height="40" fill="${C.glass}"/><path d="M${cx - 30} 34L${cx - 6} -6H${cx + 8}L${cx - 16} 34Z" fill="${C.glassHi}"/>`;
    b += `<rect x="${cx - 55}" y="40" width="110" height="12" fill="${C.stone}"/><rect x="${cx - 55}" y="49" width="110" height="3" fill="${C.stoneShade}"/>`;
  }
  b += tallWindow(675, C, 'dark') + tallWindow(1025, C, 'lit') + tallWindow(1175, C, 'blind');
  // window box under the lit window
  b += `<rect x="976" y="384" width="98" height="16" rx="2" fill="${C.doorDark}"/>`;
  for (let x = 982, k = 0; x < 1070; x += 11, k++) b += `<circle cx="${x}" cy="${381 - (k % 3) * 3}" r="7" fill="${k % 2 ? C.leaf : C.leafHi}"/>`;
  for (const [x, y] of [[986, 374], [1004, 371], [1019, 376], [1037, 372], [1054, 375], [1066, 372]]) b += `<circle cx="${x}" cy="${y}" r="3" fill="${C.bloom}"/>`;
  // basement windows behind bars
  for (const cx of [675, 1025, 1175]) {
    b += `<rect x="${cx - 43}" y="436" width="86" height="76" fill="${C.frame}"/><rect x="${cx - 38}" y="441" width="76" height="66" fill="${C.glass}"/>`;
    let bars = '';
    for (let x = cx - 28; x < cx + 36; x += 14) bars += `M${x} 438V510`;
    b += `<path d="${bars}M${cx - 40} 474H${cx + 40}" stroke="${C.iron}" stroke-width="3"/>`;
  }
  // doorway: stone pilasters, hood on brackets, transom with the number, double doors
  b += `<rect x="768" y="170" width="164" height="${SILL - 170}" fill="${C.stone}"/>`;
  b += `<rect x="768" y="170" width="7" height="${SILL - 170}" fill="${C.stoneShade}"/><rect x="925" y="170" width="7" height="${SILL - 170}" fill="${C.stoneShade}"/>`;
  b += `<path d="M762 172h20v26q-14 0 -20 -12ZM938 172h-20v26q14 0 20 -12Z" fill="${C.stoneShade}"/>`;
  b += `<rect x="758" y="150" width="184" height="24" fill="${C.stone}"/><rect x="750" y="140" width="200" height="12" fill="${C.stone}"/><rect x="750" y="149" width="200" height="3" fill="${C.stoneShade}"/><rect x="758" y="170" width="184" height="4" fill="${C.stoneShade}"/>`;
  b += `<rect x="788" y="184" width="124" height="${SILL - 184}" fill="${C.frame}"/>`;
  b += `<rect x="794" y="190" width="112" height="30" fill="${C.glass}"/><text x="${DC}" y="213.5" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="22" letter-spacing="2" fill="${C.brass}">214</text>`;
  for (const x of [794, 852]) {
    b += `<rect x="${x}" y="226" width="54" height="${SILL - 226}" fill="${C.door}"/>`;
    b += `<rect x="${x + 9}" y="238" width="36" height="92" rx="2" fill="${C.glass}"/><path d="M${x + 14} ${300}L${x + 30} 244H${x + 38}L${x + 14} 322Z" fill="${C.glassHi}"/>`;
    b += `<rect x="${x + 9}" y="340" width="36" height="40" rx="2" fill="${C.doorDark}"/><rect x="${x + 14}" y="345" width="26" height="30" rx="1.5" fill="${C.door}"/>`;
  }
  b += `<rect x="848" y="226" width="4" height="${SILL - 226}" fill="${C.doorDark}"/>`;
  b += `<circle cx="843" cy="334" r="4" fill="${C.brass}"/><circle cx="857" cy="334" r="4" fill="${C.brass}"/>`;
  // area railing to the right of the stoop
  let rail = '';
  for (let x = 992; x < W; x += 17) rail += `M${x} 478V${WALK}`;
  b += `<path d="${rail}M984 492H${W}M984 546H${W}" stroke="${C.iron}" stroke-width="3.4"/>`;
  for (let x = 992; x < W; x += 17) b += `<path d="M${x - 4} 480L${x} 468L${x + 4} 480Z" fill="${C.iron}"/>`;
  b += `<rect x="978" y="466" width="9" height="${WALK - 466}" fill="${C.iron}"/><circle cx="982.5" cy="462" r="6" fill="${C.iron}"/>`;
  // the stoop: a landing and seven steps that widen as they come down
  b += `<rect x="${DC - 100}" y="${SILL - 8}" width="200" height="10" fill="${C.stone}"/>`;
  for (let k = 0; k < 7; k++) {
    const y = SILL + k * 24;
    const hw = 96 + k * 6.5;
    b += `<rect x="${n(DC - hw)}" y="${y}" width="${n(hw * 2)}" height="24" fill="${C.stoneShade}"/>`;
    b += `<rect x="${n(DC - hw - 3)}" y="${y}" width="${n(hw * 2 + 6)}" height="9" fill="${C.stone}"/>`;
    b += `<rect x="${n(DC - hw)}" y="${y + 9}" width="${n(hw * 2)}" height="2.5" fill="${C.stoneDark}"/>`;
  }
  // iron handrails with a newel and ball at the foot
  for (const s of [-1, 1]) {
    const top = [DC + s * 100, SILL - 76];
    const bot = [DC + s * 142, WALK - 72];
    let d = '';
    for (let k = 0; k < 7; k++) {
      const x = DC + s * (100 + k * 6.5);
      const t = (x - top[0]) / (bot[0] - top[0]);
      d += `M${n(x)} ${n(top[1] + t * (bot[1] - top[1]))}V${SILL + k * 24}`;
    }
    b += `<path d="${d}" stroke="${C.iron}" stroke-width="3"/>`;
    b += `<path d="M${top[0]} ${top[1]}L${bot[0]} ${bot[1]}" stroke="${C.iron}" stroke-width="6" stroke-linecap="round"/>`;
    b += `<path d="M${top[0]} ${top[1]}V${SILL}" stroke="${C.iron}" stroke-width="5"/>`;
    b += `<rect x="${bot[0] - 6}" y="${bot[1] - 2}" width="12" height="${WALK - bot[1] + 2}" fill="${C.iron}"/><circle cx="${bot[0]}" cy="${bot[1] - 9}" r="8.5" fill="${C.iron}"/>`;
  }
  b += binCan(602, C, 0) + binCan(653, C, -7);
  return b;
}

function pavement(C) {
  let b = `<rect x="0" y="${WALK}" width="${W}" height="${H - WALK}" fill="${C.pave}"/>`;
  let j = '';
  for (let x = 60; x < W; x += 118) j += `M${x} ${WALK}V606`;
  b += `<path d="${j}" stroke="${C.paveLine}" stroke-width="2"/>`;
  b += `<rect x="0" y="606" width="${W}" height="9" fill="${C.curb}"/><rect x="0" y="615" width="${W}" height="${H - 615}" fill="${C.road}"/>`;
  return b;
}

function bicycle(x, y, P) {
  const r = 26;
  const bw = [x, y - r];
  const fw = [x + 80, y - r];
  const bb = [x + 32, y - r + 2];
  const seat = [x + 23, y - 66];
  const head = [x + 65, y - 66];
  let b = '';
  for (const [cx, cy] of [bw, fw]) b += `<circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="none" stroke="${P.tyre}" stroke-width="4"/><circle cx="${cx}" cy="${cy}" r="3" fill="${P.tyre}"/><path d="M${cx - r + 4} ${cy}H${cx + r - 4}M${cx} ${cy - r + 4}V${cy + r - 4}M${cx - 16} ${cy - 16}L${cx + 16} ${cy + 16}M${cx - 16} ${cy + 16}L${cx + 16} ${cy - 16}" stroke="${P.tyre}" stroke-width="1" opacity="0.8"/>`;
  const L = (a, c, w = 4, col = P.frame) => `<path d="M${a[0]} ${a[1]}L${c[0]} ${c[1]}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  b += L(bw, bb) + L(bw, seat) + L(seat, bb) + L(bb, head) + L(seat, head) + L(head, fw);
  b += L([seat[0] - 2, seat[1] - 10], seat);
  b += `<path d="M${seat[0] - 13} ${seat[1] - 12}H${seat[0] + 8}" stroke="${P.tyre}" stroke-width="5" stroke-linecap="round"/>`;
  b += `<path d="M${head[0]} ${head[1]}L${head[0] - 3} ${head[1] - 15}H${head[0] - 15}" stroke="${P.tyre}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  b += `<circle cx="${bb[0]}" cy="${bb[1]}" r="5" fill="${P.tyre}"/>`;
  return b;
}

// the lit edge of a clump of leaves: the clump less a copy of itself moved away from the lamp
function crescent(x, y, r, fill, d) {
  const a = Math.atan2(LY - y, DC - 14 - x);
  const u = [Math.cos(a), Math.sin(a)];
  const h = Math.sqrt(r * r - (d * d) / 4);
  const m = [x - (d / 2) * u[0], y - (d / 2) * u[1]];
  const i1 = [m[0] - h * u[1], m[1] + h * u[0]];
  const i2 = [m[0] + h * u[1], m[1] - h * u[0]];
  return `<path d="M${n(i1[0])} ${n(i1[1])}A${r} ${r} 0 1 0 ${n(i2[0])} ${n(i2[1])}A${r} ${r} 0 0 1 ${n(i1[0])} ${n(i1[1])}Z" fill="${fill}"/>`;
}
function tree() {
  const N = NIGHT;
  let b = `<g transform="translate(14 0)"><ellipse cx="574" cy="${WALK + 21}" rx="48" ry="7" fill="#150f1a"/>`;
  // trunk and a limb, their tips lost in the leaves
  b += `<path d="M574 ${WALK + 20}C576 480 568 384 578 304C582 266 594 234 612 204" stroke="${N.trunk}" stroke-width="15" fill="none" stroke-linecap="round"/>`;
  b += `<path d="M582 296C600 262 640 240 672 204" stroke="${N.trunk}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  const clumps = [[600, 40, 52], [558, 86, 40], [562, 152, 40], [572, 208, 24], [606, 180, 46], [592, 112, 56], [664, 12, 40], [648, 70, 60], [664, 160, 54], [706, 106, 50], [712, 48, 44], [718, 172, 32]];
  for (const [x, y, r] of clumps) b += `<circle cx="${x}" cy="${y}" r="${r}" fill="${N.tree}"/>`;
  // lit in the order they overlap: the far ones first
  const litClumps = [[600, 40, 52], [592, 112, 56], [606, 180, 46], [648, 70, 60], [664, 160, 54], [712, 48, 44], [706, 106, 50], [718, 172, 32]];
  litClumps.forEach(([x, y, r], k) => {
    if (k >= 3) b += `<circle cx="${x}" cy="${y}" r="${r}" fill="${N.tree}"/>`;
    b += crescent(x, y, r, N.treeHi, r * (k < 3 ? 0.3 : 0.5));
    if (k >= 4) b += crescent(x, y, r, '#3a7166', r * 0.2);
  });
  return b + '</g>';
}

function lantern(x, y) {
  // a brass lantern on an iron backplate, over the door hood. (x, y) is the middle of its glass.
  let b = `<g transform="translate(${x} ${y}) scale(1.15) translate(${-x} ${-y})"><rect x="${x - 9}" y="${y - 36}" width="18" height="70" rx="9" fill="${C.iron}"/>`;
  b += `<circle cx="${x}" cy="${y - 33}" r="4.5" fill="${C.brass}"/>`;
  b += `<path d="M${x - 8} ${y - 30}H${x + 8}L${x + 21} ${y - 18}H${x - 21}Z" fill="${C.brass}"/><path d="M${x} ${y - 30}H${x + 8}L${x + 21} ${y - 18}H${x}Z" fill="#e6c577"/>`;
  b += `<path d="M${x - 18} ${y - 18}H${x + 18}L${x + 13} ${y + 18}H${x - 13}Z" fill="${NIGHT.glass}"/><path d="M${x - 7} ${y - 18}H${x + 7}L${x + 5} ${y + 18}H${x - 5}Z" fill="${NIGHT.hot}"/>`;
  b += `<path d="M${x - 18} ${y - 18}H${x + 18}L${x + 13} ${y + 18}H${x - 13}Z" fill="none" stroke="${C.brass}" stroke-width="3" stroke-linejoin="round"/><path d="M${x} ${y - 18}V${y + 18}" stroke="${C.brass}" stroke-width="1.8"/>`;
  b += `<path d="M${x - 16} ${y + 18}H${x + 16}L${x + 9} ${y + 26}H${x - 9}Z" fill="${C.brass}"/><path d="M${x - 3.5} ${y + 26}H${x + 3.5}L${x} ${y + 34}Z" fill="#96742f"/></g>`;
  return b;
}

function skyline() {
  const N = NIGHT;
  let b = `<rect width="${W}" height="${H}" fill="${N.sky}"/>`;
  // crescent and a few city stars
  b += `<path d="M108 58a34 34 0 1 0 30 54a28 28 0 1 1 -30 -54Z" fill="${N.cream}"/>`;
  for (const [x, y, s] of [[236, 92, 3], [318, 44, 2.4], [404, 136, 2.6], [58, 190, 2.4], [470, 70, 2.2], [196, 168, 2]]) b += `<path d="M${x} ${y - s * 2}Q${x} ${y} ${x + s * 2} ${y}Q${x} ${y} ${x} ${y + s * 2}Q${x} ${y} ${x - s * 2} ${y}Q${x} ${y} ${x} ${y - s * 2}Z" fill="${N.cream}" opacity="0.85"/>`;
  // roofs across the street: all asleep
  b += `<g fill="${N.far2}"><rect x="0" y="424" width="170" height="140"/><rect x="330" y="410" width="150" height="160"/></g>`;
  b += `<g fill="${N.far}"><rect x="150" y="452" width="200" height="110"/><rect x="460" y="440" width="140" height="124"/><rect x="18" y="404" width="20" height="22"/><rect x="364" y="392" width="16" height="20"/><rect x="436" y="398" width="24" height="14"/>`;
  // a water tank on legs
  b += `<path d="M214 452L222 418M274 452L266 418M244 452V418M218 436H270" stroke="${N.far}" stroke-width="4" fill="none"/><rect x="212" y="374" width="64" height="46" rx="3"/><path d="M206 376L244 350L282 376Z"/></g>`;
  const r = rng(47);
  let wins = '';
  for (const [x0, y0, cols, rows] of [[14, 444, 5, 4], [168, 472, 6, 3], [346, 432, 4, 4], [476, 460, 4, 3]])
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (r() > 0.25) wins += `<rect x="${x0 + i * 30}" y="${y0 + j * 32}" width="14" height="19"/>`;
  b += `<g fill="${N.win}">${wins}</g>`;
  return b;
}

function scene() {
  let b = skyline();
  b += `<clipPath id="hc"><rect x="${BX}" y="0" width="${W - BX}" height="${WALK}"/></clipPath><clipPath id="pc"><rect x="0" y="${WALK}" width="${W}" height="${H - WALK}"/></clipPath>`;
  const all = (P) => pavement(P) + house(P);
  b += all(C);
  const R = [118, 250, 392];
  const pool = [[150, 14], [270, 28], [400, 44]];
  LEVELS.forEach((t, i) => {
    const sc = all(lit(C, t));
    const k = 2 - i;
    // masks, not clip paths: a clip's soft edge lets the layers under a shape show through as a hairline
    b += `<mask id="lw${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><circle cx="${DC}" cy="${LY + 40}" r="${R[k]}" fill="#fff"/></mask><mask id="lp${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><ellipse cx="${DC}" cy="${WALK + 22}" rx="${pool[k][0]}" ry="${pool[k][1]}" fill="#fff"/></mask>`;
    b += `<g clip-path="url(#hc)"><g mask="url(#lw${i})">${sc}</g></g><g clip-path="url(#pc)"><g mask="url(#lp${i})">${sc}</g></g>`;
  });
  b += bicycle(432, WALK + 26, { tyre: '#120d17', frame: NIGHT.cream });
  b += tree();
  b += lantern(DC, LY);
  // two moths
  const moth = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0C-4 -9 -15 -11 -17 -3C-18 3 -8 5 0 2Z" fill="${NIGHT.cream}"/><path d="M0 0C4 -9 15 -11 17 -3C18 3 8 5 0 2Z" fill="#e2d2ae"/><rect x="-1.4" y="-3" width="2.8" height="9" rx="1.4" fill="#8f7a5a"/></g>`;
  b += moth(DC + 44, LY - 26, 0.8, 20) + moth(DC - 50, LY + 8, 0.7, -24);
  return b;
}

function hero() {
  let b = scene();
  b += `<text x="54" y="292" font-family="${FONT}" font-weight="900" font-size="85" letter-spacing="-1" fill="${NIGHT.cream}">Porchlight</text>`;
  b += `<text x="58" y="337" font-family="${FONT}" font-style="italic" font-size="25.5" fill="#dcbcae">See what you’ve left out in the open.</text>`;
  b += `<text x="59" y="378" font-family="Futura" font-weight="500" font-size="12.5" letter-spacing="3.4" fill="#a98f9c">YOUR REPOS · YOUR SERVERS · YOUR COMPUTER</text>`;
  return svg({ w: W, h: H, body: b });
}

// ---- mark: the doorway on its steps, the lamp's rings behind ----------------------
const RING = [warm(C.brick, 0.3), warm(C.brick, 0.62), '#f2bf62'];
function markBody() {
  let b = '';
  b += `<circle cx="100" cy="80" r="78" fill="${RING[0]}"/><circle cx="100" cy="80" r="57" fill="${RING[1]}"/><circle cx="100" cy="80" r="38" fill="${RING[2]}"/>`;
  // the head of the doorway under the lamp: hood, frame, transom, the tops of the doors
  b += `<rect x="52" y="140" width="96" height="58" fill="${C.stone}"/>`;
  b += `<rect x="42" y="130" width="116" height="13" fill="${C.stone}"/><rect x="42" y="140" width="116" height="3" fill="${C.stoneShade}"/>`;
  b += `<rect x="61" y="150" width="78" height="48" fill="${C.frame}"/><rect x="65" y="154" width="70" height="12" fill="${NIGHT.amber}"/>`;
  b += `<rect x="65" y="170" width="33.5" height="28" fill="${C.door}"/><rect x="101.5" y="170" width="33.5" height="28" fill="${C.door}"/>`;
  b += `<rect x="72" y="177" width="19.5" height="21" fill="${C.frame}"/><rect x="108.5" y="177" width="19.5" height="21" fill="${C.frame}"/>`;
  // the lantern, large
  b += `<g transform="translate(100 76) scale(0.92) translate(-100 -76)">`;
  b += `<rect x="91" y="16" width="18" height="112" rx="9" fill="${C.iron}"/><circle cx="100" cy="25" r="7" fill="${C.iron}"/>`;
  b += `<path d="M87 34H113L135 55H65Z" fill="${C.iron}"/>`;
  b += `<path d="M69 55H131L121.5 113H78.5Z" fill="${C.iron}"/>`;
  b += `<path d="M76.5 61.5H123.5L116 106.5H84Z" fill="${NIGHT.glass}"/><path d="M92 61.5H108L105.5 106.5H94.5Z" fill="${NIGHT.hot}"/>`;
  b += `<path d="M100 61.5V106.5" stroke="${C.iron}" stroke-width="3.2"/>`;
  b += `<path d="M73 113H127L115 125H85Z" fill="${C.iron}"/><path d="M93.5 125H106.5L100 134Z" fill="${C.iron}"/>`;
  b += `<path d="M87 34H113L117 38H83Z" fill="${C.brass}"/><rect x="73" y="113" width="54" height="3.4" fill="${C.brass}"/>`;
  b += `</g>`;
  return b;
}
const markSvg = () => svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

function iconSvg() {
  let b = `<clipPath id="ic"><rect width="512" height="512" rx="112"/></clipPath><g clip-path="url(#ic)"><rect width="512" height="512" fill="${C.brick}"/>`;
  let courses = '';
  for (let y = 30, i = 0; y < 512; y += 30, i++) {
    courses += `M0 ${y}H512`;
    for (let x = (i % 2 ? 60 : 0) + 20; x < 512; x += 120) courses += `M${x} ${y}v30`;
  }
  b += `<path d="${courses}" stroke="${C.brickLine}" stroke-width="4"/>`;
  b += `<rect y="470" width="512" height="42" fill="${C.pave}"/></g>`;
  b += nest({ x: 26, y: 26, w: 460, h: 460, vb: '0 0 200 200', body: markBody() });
  return svg({ w: 512, h: 512, body: b });
}

// ---- favicons, on the pixel grid ----------------------------------------------------
const PIX = { B: C.brick, a: RING[0], b: RING[1], c: RING[2], S: C.stone, s: C.stoneShade, D: C.door, F: C.frame, H: NIGHT.hot, A: C.brass, I: C.iron };
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
function favRows(N) {
  const k = N / 16;
  const g = Array.from({ length: N }, () => Array(N).fill('.'));
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const cr = 2.6 * k;
      const ex = Math.max(0, cr - 0.5 - Math.min(x, N - 1 - x));
      const ey = Math.max(0, cr - 0.5 - Math.min(y, N - 1 - y));
      if (ex * ex + ey * ey > cr * cr) continue;
      const d = Math.hypot(x - c, y - 5.6 * k);
      g[y][x] = d < 4.4 * k ? 'c' : d < 6.8 * k ? 'b' : d < 9.4 * k ? 'a' : 'B';
    }
  const box = (x0, y0, x1, y1, ch) => { for (let y = Math.round(y0 * k); y < Math.round(y1 * k); y++) for (let x = Math.round(x0 * k); x < Math.round(x1 * k); x++) g[y][x] = ch; };
  // the head of the doorway
  box(2, 12, 14, 13, 'S');
  box(3, 13, 13, 16, 'F');
  box(4, 14, 8, 16, 'D');
  box(8, 14, 12, 16, 'D');
  if (N === 32) { box(7.75, 14, 8.25, 16, 'F'); box(3.5, 13.5, 12.5, 14, 'A'); box(2, 12.5, 14, 13, 's'); }
  // the lantern: iron backplate, brass cap and foot, lit glass
  box(7, 1, 9, 2, 'I');
  box(6, 2, 10, 3, 'I');
  box(4, 3, 12, 4, 'I');
  box(5, 4, 11, 10, 'I');
  box(6, 4, 10, 9, 'H');
  box(7, 10, 9, 11, 'I');
  if (N === 32) { box(5.5, 4.5, 10.5, 9, 'H'); box(5, 4, 11, 4.5, 'I'); box(7.75, 4.5, 8.25, 9, 'I'); box(6, 10, 10, 10.5, 'I'); box(7.5, 11, 8.5, 11.5, 'I'); box(7.5, 0.5, 8.5, 1, 'I'); }
  // keep the tile's corners
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const cr = 2.6 * k;
      const ex = Math.max(0, cr - 0.5 - Math.min(x, N - 1 - x));
      const ey = Math.max(0, cr - 0.5 - Math.min(y, N - 1 - y));
      if (ex * ex + ey * ey > cr * cr) g[y][x] = '.';
    }
  return g.map((r) => r.join(''));
}
const favSvg = () => svg({ w: 16, h: 16, crisp: true, body: pix(favRows(16)) });
const fav32Svg = () => svg({ w: 32, h: 32, crisp: true, body: pix(favRows(32)) });

// ---- logo ------------------------------------------------------------------------
function logoSvg(dark) {
  let b = nest({ x: 8, y: 6, w: 188, h: 188, vb: '0 0 200 200', body: markBody() });
  b += `<text x="204" y="116" font-family="${FONT}" font-weight="900" font-size="74" letter-spacing="-1" fill="${dark ? NIGHT.cream : NIGHT.sky}">Porchlight</text>`;
  b += `<text x="207" y="153" font-family="${FONT}" font-style="italic" font-size="20.5" fill="${dark ? '#dcbcae' : C.brick}">See what you’ve left out in the open.</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 60 Flat city stoop II

A brick row house at night, drawn flat: seven stone steps and an iron rail up to a teal double door with its number in the transom, a brass lantern over the hood, one lit window, bins by the steps, a street tree, a bicycle, and the roofs across the street asleep under a water tank. The lamp's light is three stepped rings on the brick and three pools on the pavement, turned down so the door keeps its teal. The mark is now the lantern itself, large and in dark iron so its lit glass is the brightest thing, with its rings of light and the head of the doorway under it.
Palette: plum night #241b30, brick #7b4743, stone #b7a08d, teal #2c6c70, iron #17121d, brass #c9a14e, amber #f0b55a, cream #f3e6cf.
Type: Iowan Old Style Black for the name, Iowan Old Style Italic for the tagline, Futura Medium capitals for the small line.
Tagline: See what you've left out in the open.
From: 47 Flat city stoop
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
