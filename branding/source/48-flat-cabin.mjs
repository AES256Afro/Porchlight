// 48 Flat cabin porch: a log cabin in the pines under the mountains. A lantern
// hangs from the post at the foot of the porch steps and an owl sits on top
// of the post with its eyes open. Two chairs on the porch, firewood, fireflies
// in the grass. The light is three stepped rings in the air and on the logs,
// and three pools on the ground.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '48-flat-cabin';
const C = {
  sky: '#0c2325',
  mtnFar: '#1c4542',
  mtnFace: '#28594f',
  snow: '#aebfa6',
  mtnMid: '#163a37',
  forest: '#112d2a',
  forest2: '#0d2423',
  meadow: '#17372d',
  meadow2: '#122c26',
  tuft: '#21483a',
  path: '#3f4a36',
  pathLine: '#33402f',
  log: '#7a5234',
  logLine: '#5e3d26',
  logEnd: '#94693f',
  logRing: '#6b4729',
  roof: '#3b6a55',
  roofLine: '#2f5846',
  roof2: '#2c5142',
  stone: '#7f7c6c',
  stoneDark: '#5f5c50',
  door: '#2e5a47',
  doorLine: '#234737',
  trim: '#e8dcbc',
  trimShade: '#bfb08c',
  pane: '#0f2423',
  paneHi: '#254442',
  chair: '#d9c9a3',
  chairShade: '#b09e78',
  deck: '#8a6442',
  deckDark: '#674830',
  iron: '#131917',
};
const N = { sky: '#0c2325', cream: '#f0e6c8', glass: '#ffc75c', hot: '#fff3cf', fly: '#ffd870', fore: '#071918', post: '#6b4a30', postLit: '#a67c4c' };
const OWL = { body: '#7c5c3e', dark: '#59402a', lit: '#a5804f', belly: '#ead9b5', eye: '#ffc75c', pupil: '#131917', beak: '#d9963a' };
const FONT = 'Superclarendon';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const LIGHT = '#ffb84e';
const warm = (c, t) => {
  const a = rgb(c);
  const l = rgb(LIGHT);
  return hex(a.map((v, i) => (255 - ((255 - v) * (255 - l[i] * t)) / 255) * 0.45 + (v + (l[i] - v) * t) * 0.55));
};
const lit = (P, t) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, warm(v, t)]));
const LEVELS = [0.13, 0.28, 0.48];
const n = (v) => +v.toFixed(2);

const W = 1280;
const H = 640;
const GROUND = 548;
const DECK = 512;
const BEAM = 348;
const CX0 = 810; // cabin wall
const CX1 = 1232;
const PX = 716; // lantern post
const LX = 750;
const LY = 412;

// a pine: tiers of boughs, each a triangle, on a short trunk
function pine(x, base, h, w, fill, tiers = 5) {
  let d = '';
  const step = (h * 0.92) / tiers;
  for (let i = 0; i < tiers; i++) {
    const top = base - h + i * step * 0.82;
    const bot = Math.min(base - h * 0.06, top + step * 1.5);
    const hw = (w / 2) * (0.3 + (0.7 * (i + 1)) / tiers);
    d += `M${n(x)} ${n(top)}L${n(x + hw)} ${n(bot)}Q${n(x)} ${n(bot - step * 0.16)} ${n(x - hw)} ${n(bot)}Z`;
  }
  return `<path d="${d}" fill="${fill}"/><rect x="${n(x - w * 0.04)}" y="${n(base - h * 0.1)}" width="${n(w * 0.08)}" height="${n(h * 0.1)}" fill="${fill}"/>`;
}

function backdrop(C, withSky = false) {
  let b = withSky ? `<rect width="${W}" height="${H}" fill="${C.sky}"/>` : '';
  // far range, its moonlit faces and snow
  b += `<path d="M0 452L120 404L210 426L330 366L420 392L520 338L610 370L720 262L800 204L870 132L930 100L1000 156L1060 138L1130 200L1210 174L${W} 232V${H}H0Z" fill="${C.mtnFar}"/>`;
  b += `<path d="M930 100L870 132L800 204L720 262L792 236L842 196L880 176L900 138Z" fill="${C.mtnFace}"/><path d="M1060 138L1000 156L964 204L1010 186L1034 160Z" fill="${C.mtnFace}"/><path d="M520 338L420 392L470 380L500 356Z" fill="${C.mtnFace}"/><path d="M1210 174L1130 200L1100 240L1150 218L1180 196Z" fill="${C.mtnFace}"/>`;
  b += `<path d="M930 100L896 122L912 126L924 118L938 130L950 120L966 130L958 122Z" fill="${C.snow}"/><path d="M1060 138L1040 150L1052 152L1062 146L1074 154L1070 148Z" fill="${C.snow}"/>`;
  // nearer ridge
  b += `<path d="M0 488L140 446L260 470L380 428L500 458L640 400L760 440L900 392L1040 430L1160 398L${W} 440V${H}H0Z" fill="${C.mtnMid}"/>`;
  // the wood behind the clearing
  const r = rng(48);
  for (let x = -10; x < W + 30; x += 34) {
    const h = 96 + r() * 110 + (x > 760 ? 70 : 0);
    b += pine(x + r() * 10, GROUND + 8, h, 54 + r() * 22, r() > 0.5 ? C.forest : C.forest2, 5);
  }
  for (let x = 8; x < W + 30; x += 52) b += pine(x + r() * 14, GROUND + 10, 70 + r() * 60 + (x > 760 ? 30 : 0), 50 + r() * 16, C.forest2, 4);
  return b;
}

function chair(cx, C) {
  // an Adirondack chair from the front: fanned back, wide arms
  const f = DECK;
  let b = '';
  b += `<path d="M${cx - 23} ${f - 34}L${cx - 31} ${f - 80}Q${cx} ${f - 108} ${cx + 31} ${f - 80}L${cx + 23} ${f - 34}Z" fill="${C.chair}"/>`;
  b += `<path d="M${cx - 5} ${f - 36}L${cx - 7} ${f - 93}M${cx + 5} ${f - 36}L${cx + 7} ${f - 93}M${cx - 14} ${f - 36}L${cx - 19} ${f - 87}M${cx + 14} ${f - 36}L${cx + 19} ${f - 87}" stroke="${C.chairShade}" stroke-width="2.4"/>`;
  for (const s of [-1, 1]) {
    b += `<rect x="${cx + s * 33 - 13}" y="${f - 58}" width="26" height="7" rx="2" fill="${C.chair}"/>`;
    b += `<rect x="${cx + s * 38 - 3.5}" y="${f - 52}" width="7" height="52" fill="${C.chairShade}"/>`;
  }
  b += `<path d="M${cx - 24} ${f - 40}H${cx + 24}L${cx + 29} ${f - 22}H${cx - 29}Z" fill="${C.chairShade}"/>`;
  b += `<rect x="${cx - 30}" y="${f - 24}" width="60" height="9" rx="2" fill="${C.chair}"/>`;
  for (const s of [-1, 1]) b += `<rect x="${cx + s * 25 - 3.5}" y="${f - 16}" width="7" height="16" fill="${C.chair}"/>`;
  return b;
}

function cabin(C) {
  let b = '';
  // stone chimney, behind the roof
  b += `<rect x="1146" y="150" width="44" height="120" fill="${C.stone}"/><rect x="1140" y="142" width="56" height="12" fill="${C.stoneDark}"/>`;
  b += `<path d="M1146 176h22v16h22M1160 192v18h-14M1176 210v18h14M1146 228h30" stroke="${C.stoneDark}" stroke-width="2.4" fill="none"/>`;
  // main roof: green tin with standing seams
  b += `<path d="M${CX0 - 14} 314L${CX0 + 30} 212H${CX1 - 30}L${CX1 + 14} 314Z" fill="${C.roof}"/>`;
  let seams = '';
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    seams += `M${n(CX0 + 30 + t * (CX1 - CX0 - 60))} 214L${n(CX0 - 14 + t * (CX1 - CX0 + 28))} 314`;
  }
  b += `<path d="${seams}" stroke="${C.roofLine}" stroke-width="2.4"/>`;
  b += `<rect x="${CX0 + 24}" y="206" width="${CX1 - CX0 - 48}" height="9" rx="3" fill="${C.roofLine}"/>`;
  // porch roof, lower and darker, and its log beam
  b += `<path d="M${CX0 - 30} ${BEAM}L${CX0 - 14} 312H${CX1 + 14}L${CX1 + 30} ${BEAM}Z" fill="${C.roof2}"/>`;
  let s2 = '';
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    s2 += `M${n(CX0 - 14 + t * (CX1 - CX0 + 28))} 312L${n(CX0 - 30 + t * (CX1 - CX0 + 60))} ${BEAM}`;
  }
  b += `<path d="${s2}" stroke="${C.roofLine}" stroke-width="2.4" opacity="0.7"/>`;
  b += `<rect x="${CX0 - 14}" y="308" width="${CX1 - CX0 + 28}" height="5" fill="${C.roofLine}"/>`;
  // wall of logs under the porch
  b += `<rect x="${CX0}" y="${BEAM}" width="${CX1 - CX0}" height="${DECK - BEAM}" fill="${C.log}"/>`;
  let courses = '';
  for (let y = BEAM + 26; y < DECK; y += 19) courses += `M${CX0} ${y}H${CX1}`;
  b += `<path d="${courses}" stroke="${C.logLine}" stroke-width="3"/>`;
  for (const x of [CX0, CX1]) for (let y = BEAM + 16.5; y < DECK; y += 19) b += `<circle cx="${x}" cy="${y}" r="9" fill="${C.logEnd}"/><circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="${C.logRing}" stroke-width="1.6"/>`;
  // door
  b += `<rect x="832" y="390" width="76" height="${DECK - 390}" fill="${C.trim}"/><rect x="839" y="397" width="62" height="${DECK - 397}" fill="${C.door}"/>`;
  b += `<path d="M854.5 397V${DECK}M870 397V${DECK}M885.5 397V${DECK}" stroke="${C.doorLine}" stroke-width="2"/>`;
  b += `<rect x="852" y="410" width="36" height="30" rx="2" fill="${C.trim}"/><rect x="855" y="413" width="30" height="24" fill="${C.pane}"/><path d="M859 433L870 415H876L865 433Z" fill="${C.paneHi}"/><rect x="869" y="413" width="2.4" height="24" fill="${C.trim}"/>`;
  b += `<rect x="845" y="456" width="5" height="18" rx="2.5" fill="${C.iron}"/>`;
  // windows
  for (const cx of [1012, 1150]) {
    b += `<rect x="${cx - 46}" y="384" width="92" height="76" fill="${C.trim}"/><rect x="${cx - 40}" y="390" width="80" height="64" fill="${C.pane}"/>`;
    b += `<path d="M${cx - 30} 446L${cx - 2} 394H${cx + 12}L${cx - 16} 446Z" fill="${C.paneHi}"/>`;
    b += `<rect x="${cx - 1.5}" y="390" width="3" height="64" fill="${C.trim}"/><rect x="${cx - 40}" y="420.5" width="80" height="3" fill="${C.trim}"/>`;
    b += `<rect x="${cx - 52}" y="460" width="104" height="6" fill="${C.trim}"/><rect x="${cx - 52}" y="464" width="104" height="2" fill="${C.trimShade}"/>`;
  }
  // chairs, and firewood stacked at the end
  b += chair(1014, C) + chair(1144, C);
  for (const [x, y] of [[1198, 503], [1215, 503], [1198, 486], [1215, 486], [1206.5, 471]]) b += `<circle cx="${x}" cy="${y}" r="8.6" fill="${C.logEnd}"/><circle cx="${x}" cy="${y}" r="4" fill="none" stroke="${C.logRing}" stroke-width="1.5"/>`;
  // posts and the beam they carry
  for (const x of [CX0 + 2, 938, 1082, CX1 - 16]) b += `<rect x="${x}" y="${BEAM}" width="14" height="${DECK - BEAM}" fill="${C.logEnd}"/><rect x="${x + 10}" y="${BEAM}" width="4" height="${DECK - BEAM}" fill="${C.logLine}"/>`;
  b += `<rect x="${CX0 - 26}" y="${BEAM}" width="${CX1 - CX0 + 52}" height="14" rx="6" fill="${C.logEnd}"/><rect x="${CX0 - 20}" y="${BEAM + 10}" width="${CX1 - CX0 + 40}" height="3" fill="${C.logLine}"/>`;
  // deck and the stones it stands on
  b += `<rect x="${CX0 - 12}" y="${DECK}" width="${CX1 - CX0 + 24}" height="12" fill="${C.deck}"/><rect x="${CX0 - 12}" y="${DECK + 9}" width="${CX1 - CX0 + 24}" height="3" fill="${C.deckDark}"/>`;
  b += `<rect x="${CX0 - 4}" y="${DECK + 12}" width="${CX1 - CX0 + 8}" height="${GROUND - DECK - 12}" fill="${C.forest2}"/>`;
  for (const x of [CX0 - 6, 934, 1078, CX1 - 22]) b += `<rect x="${x}" y="${DECK + 12}" width="28" height="${GROUND - DECK - 12}" fill="${C.stone}"/><path d="M${x} ${DECK + 24}h28M${x + 14} ${DECK + 12}v12M${x + 8} ${DECK + 24}v12" stroke="${C.stoneDark}" stroke-width="2"/>`;
  return b;
}

function ground(C) {
  let b = `<path d="M0 566C220 544 520 556 720 ${GROUND}H${W}V${H}H0Z" fill="${C.meadow}"/>`;
  b += `<path d="M0 618C320 600 820 610 ${W} 602V${H}H0Z" fill="${C.meadow2}"/>`;
  // path from the steps
  b += `<path d="M812 ${GROUND}H930C900 580 850 610 820 ${H}H620C690 610 770 580 812 ${GROUND}Z" fill="${C.path}"/>`;
  b += `<path d="M796 566C820 572 880 572 912 566M756 590C800 598 850 598 884 590M700 616C760 626 820 626 846 616" stroke="${C.pathLine}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  // steps
  [[826, 916], [818, 924], [810, 932]].forEach(([x0, x1], k) => {
    const y = DECK + k * 12;
    b += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="12" fill="${C.deckDark}"/><rect x="${x0}" y="${y}" width="${x1 - x0}" height="5" fill="${C.deck}"/>`;
  });
  // tufts of grass
  const r = rng(7);
  for (let i = 0; i < 46; i++) {
    const x = r() * W;
    const y = 566 + r() * 66;
    if (x > 610 && x < 940 && y > 548) continue;
    b += `<path d="M${n(x - 7)} ${n(y)}L${n(x - 3)} ${n(y - 11)}L${n(x)} ${n(y - 2)}L${n(x + 4)} ${n(y - 14)}L${n(x + 8)} ${n(y)}Z" fill="${C.tuft}"/>`;
  }
  // a chopping block with the axe left in it
  b += `<rect x="1034" y="580" width="44" height="30" fill="${C.logLine}"/><ellipse cx="1056" cy="580" rx="22" ry="7" fill="${C.logEnd}"/><ellipse cx="1056" cy="580" rx="12" ry="3.6" fill="none" stroke="${C.logRing}" stroke-width="1.4"/><ellipse cx="1056" cy="610" rx="22" ry="5" fill="${C.logLine}"/>`;
  b += `<path d="M1062 578L1092 532" stroke="${C.logEnd}" stroke-width="5" stroke-linecap="round"/><path d="M1052 570L1066 562L1072 580L1060 586Z" fill="${C.stone}"/>`;
  return b;
}

function owl(x, y, s, O = OWL) {
  let b = `<g transform="translate(${x} ${y}) scale(${s})">`;
  b += `<path d="M-17 -54L-21 -74L-5 -63ZM17 -54L21 -74L5 -63Z" fill="${O.dark}"/>`;
  b += `<path d="M0 -3C-19 -3 -23 -26 -21 -43C-20 -59 -11 -67 0 -67C11 -67 20 -59 21 -43C23 -26 19 -3 0 -3Z" fill="${O.body}"/>`;
  b += `<path d="M-21 -42C-25 -27 -21 -11 -10 -5C-15 -17 -15 -31 -21 -42ZM21 -42C25 -27 21 -11 10 -5C15 -17 15 -31 21 -42Z" fill="${O.dark}"/>`;
  b += `<ellipse cx="0" cy="-23" rx="11.5" ry="17" fill="${O.belly}"/>`;
  b += `<path d="M-6 -30l3 3l3 -3M0 -30l3 3l3 -3M-3 -22l3 3l3 -3M-6 -14l3 3l3 -3M0 -14l3 3l3 -3" stroke="${O.dark}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  b += `<circle cx="-9" cy="-50" r="11" fill="${O.belly}"/><circle cx="9" cy="-50" r="11" fill="${O.belly}"/>`;
  b += `<circle cx="-9" cy="-50" r="7" fill="${O.eye}"/><circle cx="9" cy="-50" r="7" fill="${O.eye}"/>`;
  b += `<circle cx="-9" cy="-50" r="3.6" fill="${O.pupil}"/><circle cx="9" cy="-50" r="3.6" fill="${O.pupil}"/><circle cx="-10.4" cy="-51.6" r="1.2" fill="${O.belly}"/><circle cx="7.6" cy="-51.6" r="1.2" fill="${O.belly}"/>`;
  b += `<path d="M-3.4 -44H3.4L0 -36Z" fill="${O.beak}"/>`;
  b += `<path d="M-9 -3v4M-5.5 -3v4M5.5 -3v4M9 -3v4" stroke="${O.beak}" stroke-width="2.6" stroke-linecap="round"/>`;
  b += `</g>`;
  return b;
}

function lantern(x, y, s = 1) {
  // a hanging lantern; (x, y) is the middle of its glass
  let b = `<g transform="translate(${x} ${y}) scale(${s})">`;
  b += `<circle cx="0" cy="-33" r="5" fill="none" stroke="${C.iron}" stroke-width="3"/>`;
  b += `<path d="M-9 -28H9L17 -17H-17Z" fill="${C.iron}"/>`;
  b += `<rect x="-13" y="-17" width="26" height="34" fill="${N.glass}"/><rect x="-5.5" y="-17" width="11" height="34" fill="${N.hot}"/>`;
  b += `<path d="M-13 -17V17M13 -17V17M0 -17V17" stroke="${C.iron}" stroke-width="2.6"/>`;
  b += `<rect x="-16" y="16" width="32" height="6" rx="1.5" fill="${C.iron}"/><rect x="-4" y="22" width="8" height="4" rx="1.5" fill="${C.iron}"/>`;
  b += `</g>`;
  return b;
}

function post() {
  let b = '';
  b += `<rect x="${PX - 6}" y="348" width="12" height="${GROUND - 340}" fill="${N.post}"/><rect x="${PX + 1}" y="348" width="5" height="${GROUND - 340}" fill="${N.postLit}"/>`;
  b += `<rect x="${PX - 10}" y="342" width="20" height="8" rx="2" fill="${N.postLit}"/>`;
  b += `<path d="M${PX} 372H${LX + 6}" stroke="${N.post}" stroke-width="6" stroke-linecap="round"/><path d="M${PX + 4} 398L${LX - 4} 374" stroke="${N.post}" stroke-width="5" stroke-linecap="round"/>`;
  b += `<path d="M${LX} 372V${LY - 38}" stroke="${C.iron}" stroke-width="2.6"/>`;
  return b;
}

function fireflies() {
  const pts = [[96, 520, 1], [178, 468, 0.8], [262, 556, 1], [338, 498, 0.7], [420, 590, 1], [470, 520, 0.8], [548, 476, 0.7], [590, 600, 1], [150, 606, 0.8], [36, 586, 0.7], [1000, 606, 0.9], [1150, 590, 0.8], [1236, 556, 0.7], [960, 574, 0.6], [620, 524, 0.8], [306, 420, 0.6], [520, 404, 0.6]];
  return pts.map(([x, y, s]) => `<circle cx="${x}" cy="${y}" r="${n(8 * s)}" fill="${N.fly}" opacity="0.16"/><circle cx="${x}" cy="${y}" r="${n(4.4 * s)}" fill="${N.fly}" opacity="0.3"/><circle cx="${x}" cy="${y}" r="${n(2.2 * s)}" fill="${N.hot}"/>`).join('');
}

function scene() {
  let b = `<rect width="${W}" height="${H}" fill="${N.sky}"/>`;
  // stars and a thin moon
  const r = rng(11);
  for (let i = 0; i < 40; i++) b += `<circle cx="${n(r() * W)}" cy="${n(r() * 300)}" r="${n(0.8 + r() * 1.1)}" fill="${N.cream}" opacity="${n(0.4 + r() * 0.5)}"/>`;
  for (const [x, y, s] of [[80, 70, 4], [300, 46, 3], [520, 96, 3.4], [668, 60, 3], [1180, 70, 3.4], [1090, 40, 2.6], [406, 140, 2.6]]) b += `<path d="M${x} ${y - s * 2}Q${x} ${y} ${x + s * 2} ${y}Q${x} ${y} ${x} ${y + s * 2}Q${x} ${y} ${x - s * 2} ${y}Q${x} ${y} ${x} ${y - s * 2}Z" fill="${N.cream}"/>`;
  b += `<path d="M1226 108a30 30 0 1 0 26 48a25 25 0 1 1 -26 -48Z" fill="${N.cream}"/>`;
  b += backdrop(C);
  // the lamp's rings in the air: the wood behind it, lit
  const R = [222, 146, 78];
  LEVELS.forEach((t, i) => {
    // masks, not clip paths: a clip's soft edge lets the layers under a shape show through as a hairline
    b += `<mask id="la${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><circle cx="${LX}" cy="${LY}" r="${R[i]}" fill="#fff"/></mask><g mask="url(#la${i})">${backdrop(lit(C, t), true)}</g>`;
  });
  b += ground(C) + cabin(C);
  b += `<clipPath id="und"><rect x="${CX0 - 30}" y="${BEAM}" width="${CX1 - CX0 + 60}" height="${GROUND - BEAM}"/></clipPath>`;
  const pool = [[300, 60], [196, 38], [104, 20]];
  LEVELS.forEach((t, i) => {
    const P = lit(C, t);
    b += `<mask id="lg${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><ellipse cx="${LX + 10}" cy="${GROUND + 22}" rx="${pool[i][0]}" ry="${pool[i][1]}" fill="#fff"/></mask>`;
    b += `<g clip-path="url(#und)"><g mask="url(#la${i})">${cabin(P)}</g></g>`;
    b += `<g mask="url(#lg${i})">${ground(P)}</g>`;
  });
  b += post() + lantern(LX, LY, 1.1) + owl(PX, 343, 1.04);
  // the nearest pines, dark against it all
  b += pine(22, 700, 380, 190, N.fore, 6) + pine(1296, 700, 400, 180, N.fore, 6);
  b += fireflies();
  return b;
}

function hero() {
  let b = scene();
  b += `<text x="76" y="234" font-family="${FONT}" font-weight="700" font-size="82" letter-spacing="-1" fill="${N.cream}">Porchlight</text>`;
  b += `<text x="80" y="282" font-family="${FONT}" font-weight="400" font-size="27" fill="#b9cbb0">Lights on. Eyes open.</text>`;
  return svg({ w: W, h: H, body: b });
}

// ---- mark: the lantern and the owl on it --------------------------------------------
const RING = [warm(C.forest, 0.42), warm(C.forest, 0.75), '#f3c768'];
function markBody(dark = false) {
  let b = '';
  b += `<circle cx="100" cy="128" r="68" fill="${dark ? warm(C.forest, 0.2) : C.forest}"/><circle cx="100" cy="128" r="52" fill="${RING[0]}"/><circle cx="100" cy="128" r="36" fill="${RING[1]}"/>`;
  // lantern
  b += `<path d="M86 94H114L124 106H76Z" fill="${C.iron}"/>`;
  b += `<rect x="80" y="106" width="40" height="52" fill="${N.glass}"/><rect x="92" y="106" width="16" height="52" fill="${N.hot}"/>`;
  b += `<path d="M80 106V158M120 106V158M100 106V158" stroke="${C.iron}" stroke-width="4"/>`;
  b += `<rect x="74" y="156" width="52" height="10" rx="2.5" fill="${C.iron}"/><rect x="92" y="166" width="16" height="6" rx="2" fill="${C.iron}"/>`;
  b += owl(100, 97, 1.12);
  return b;
}
const markSvg = (dark) => svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody(dark) });

function iconSvg() {
  let b = `<clipPath id="ic"><rect width="512" height="512" rx="112"/></clipPath><g clip-path="url(#ic)"><rect width="512" height="512" fill="${N.sky}"/>`;
  b += `<path d="M0 330L90 250L170 300L256 200L340 290L420 230L512 310V512H0Z" fill="${C.mtnFar}"/>`;
  for (const [x, h, w] of [[30, 230, 130], [130, 170, 110], [392, 180, 110], [486, 240, 130]]) b += pine(x, 530, h, w, C.forest2, 5);
  b += `</g>`;
  b += nest({ x: 36, y: 30, w: 440, h: 440, vb: '0 0 200 200', body: markBody(true) });
  return svg({ w: 512, h: 512, body: b });
}

// ---- favicons, on the pixel grid ----------------------------------------------------
const PIX = { G: C.forest, O: OWL.body, o: OWL.dark, E: OWL.eye, P: OWL.pupil, B: OWL.belly, K: OWL.beak, I: C.iron, A: N.glass, H: N.hot, a: RING[1], r: RING[0] };
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
  '....o......o....',
  '....oOOOOOOo....',
  '...OOBBOOBBOO...',
  '...OBEPOOPEBO...',
  '...OOBBKKBBOO...',
  '...oOOBBBBOOo...',
  '.GGoOOBBBBOOoGG.',
  'GGrrIIIIIIIIrrGG',
  'GrraIAAHHAAIarrG',
  'GraaIAAHHAAIaarG',
  'GraaIAAHHAAIaarG',
  'GraaIAAHHAAIaarG',
  'GGraIAAHHAAIarGG',
  'GGrIIIIIIIIIIrGG',
  '.GGGrrIIIIrrGGG.',
  '...GGGGGGGGGG...',
];
const FAV32 = [
  '........oo............oo........',
  '........ooo..........ooo........',
  '........oooOOOOOOOOOOooo........',
  '.......oOOOOOOOOOOOOOOOOo.......',
  '.......OOBBBBBOOOOBBBBBOO.......',
  '......OOBBEEEBBOOBBEEEBBOO......',
  '......OOBEEPPEBOOBEPPEEBOO......',
  '......OOBEEPPEBOOBEPPEEBOO......',
  '......OOBBEEEBBKKBBEEEBBOO......',
  '......OOOBBBBBOKKOBBBBBOOO......',
  '......oOOOOOBBBBBBBBOOOOOo......',
  '......oOOOOBBBBBBBBBBOOOOo......',
  '....GGoOOOOBBoBBBBoBBOOOOoGG....',
  '..GGGGooOOOBBBBooBBBBOOOooGGGG..',
  '.GGGGrrrIIIIIIIIIIIIIIIIrrrGGGG.',
  '.GGGrrrIIIIIIIIIIIIIIIIIIrrrGGG.',
  'GGGrrraaaIAAAAAHHHHAAAAAIaaarrGG',
  'GGrrraaaaIAAAAAHHHHAAAAAIaaaarrG',
  'GGrrraaaaIAAAAAHHHHAAAAAIaaaarrG',
  'GGrrraaaaIAAAAAHHHHAAAAAIaaaarrG',
  'GGrrraaaaIAAAAAHHHHAAAAAIaaaarrG',
  'GGrrraaaaIAAAAAHHHHAAAAAIaaaarrG',
  'GGrrraaaaIAAAAAHHHHAAAAAIaaaarrG',
  'GGrrraaaaIAAAAAHHHHAAAAAIaaaarrG',
  'GGGrrraaaIAAAAAHHHHAAAAAIaaarrGG',
  'GGGrrraaaIAAAAAHHHHAAAAAIaaarrGG',
  '.GGGrrrIIIIIIIIIIIIIIIIIIIrrGGG.',
  '.GGGGrrIIIIIIIIIIIIIIIIIIIrrGGG.',
  '..GGGGrrrrrrIIIIIIIIrrrrrrGGGG..',
  '...GGGGGrrrrrrrrrrrrrrrGGGGGG...',
  '.....GGGGGGGGGGGGGGGGGGGGGG.....',
  '.......GGGGGGGGGGGGGGGGGG.......',
];
const favSvg = () => svg({ w: 16, h: 16, crisp: true, body: pix(FAV16) });
const fav32Svg = () => svg({ w: 32, h: 32, crisp: true, body: pix(FAV32) });

// ---- logo ------------------------------------------------------------------------
function logoSvg(dark) {
  let b = nest({ x: 8, y: 4, w: 192, h: 192, vb: '0 0 200 200', body: markBody(dark) });
  b += `<text x="200" y="116" font-family="${FONT}" font-weight="700" font-size="67" letter-spacing="-1" fill="${dark ? N.cream : C.forest}">Porchlight</text>`;
  b += `<text x="203" y="153" font-family="${FONT}" font-weight="400" font-size="22" fill="${dark ? '#b9cbb0' : C.logLine}">Lights on. Eyes open.</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 48 Flat cabin porch

A log cabin in the pines under the mountains, drawn flat. A lantern hangs from the post at the foot of the porch steps, and an owl sits on top of the post with its eyes wide open, which is the tagline in one picture. Two Adirondack chairs on the porch, firewood stacked at the end, an axe left in the chopping block, fireflies in the grass. The light is three stepped rings that pick the wood out of the dark and warm the logs and the door, with three pools on the ground. The mark is the lantern with the owl on it.
Palette: night #0c2325, forest #112d2a, mountain #1c4542, tin roof #3b6a55, log #7a5234, amber #ffc75c, cream #f0e6c8.
Type: Superclarendon Bold for the name, Superclarendon Regular for the tagline.
Tagline: Lights on. Eyes open.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(false),
  'mark-dark.svg': markSvg(true),
  'logo.svg': logoSvg(false),
  'logo-dark.svg': logoSvg(true),
  'favicon.svg': favSvg(),
  'favicon-32.svg': fav32Svg(),
  'icon.svg': iconSvg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
