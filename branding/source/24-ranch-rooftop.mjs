// 24 Ranch rooftop: a long mid-century ranch house at night under a starburst
// sky. The name stands on the roofline as dimensional sign letters on a steel
// truss; under it a pink front door, the porch globe lit, a breeze-block
// screen, and a finned car asleep in the carport.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '24-ranch-rooftop';
const C = {
  ink: '#0a1230',
  sky1: '#101f52',
  sky2: '#15296a',
  sky3: '#1b367f',
  steel: '#8ea0c8',
  steelDk: '#5b74b5',
  slab: '#b4c0de',
  wall: '#183a56',
  wallDk: '#122c44',
  glass: '#0e2138',
  seafoam: '#7fd3c0',
  seafoamDk: '#3fa898',
  pink: '#f26d85',
  pinkLt: '#f993a5',
  pinkDk: '#c2405f',
  butter: '#ffd66b',
  hot: '#fff6d2',
  cream: '#fbf1dc',
  lawn: '#103631',
};
const f = (n) => Math.round(n * 10) / 10;
const pol = (cx, cy, a, r) => [cx + Math.cos((a * Math.PI) / 180) * r, cy + Math.sin((a * Math.PI) / 180) * r];

// ---- sky parts -----------------------------------------------------------------
function twinkle(cx, cy, s, fill) {
  const k = s * 0.14;
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + k)},${f(cy - k)} ${f(cx + s)},${cy}Q${f(cx + k)},${f(cy + k)} ${cx},${f(cy + s)}Q${f(cx - k)},${f(cy + k)} ${f(cx - s)},${cy}Q${f(cx - k)},${f(cy - k)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}
// atomic starburst: crossed lines, the long ones tipped with dots
function lineStar(cx, cy, r, stroke, w = 2.2, rot = 0) {
  let d = '';
  let dots = '';
  for (let i = 0; i < 8; i++) {
    const a = i * 22.5 + rot;
    const len = i % 2 ? r * 0.55 : r;
    const [x0, y0] = pol(cx, cy, a, len);
    const [x1, y1] = pol(cx, cy, a + 180, len);
    d += `M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}`;
    if (i % 4 === 0) dots += `<circle cx="${f(x0)}" cy="${f(y0)}" r="${f(w * 1.3)}" fill="${stroke}"/><circle cx="${f(x1)}" cy="${f(y1)}" r="${f(w * 1.3)}" fill="${stroke}"/>`;
  }
  return `<path d="${d}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>${dots}`;
}
// tapered-ray burst with a bright core
function burst(cx, cy, sc, long = C.cream, short = C.seafoam, core = C.pink) {
  const L = [1, 0.42, 0.7, 0.42, 0.86, 0.42, 0.7, 0.42];
  let d1 = '';
  let d2 = '';
  const ray = (a, len, w) => {
    const [tx, ty] = pol(cx, cy, a, len);
    const [ax, ay] = pol(cx, cy, a + 90, w);
    const [bx, by] = pol(cx, cy, a - 90, w);
    return `M${f(ax)},${f(ay)}L${f(tx)},${f(ty)}L${f(bx)},${f(by)}Z`;
  };
  for (let i = 0; i < 16; i += 2) d1 += ray(i * 22.5 - 90, 48 * sc * L[i % 8], 4 * sc);
  for (let i = 0; i < 8; i++) d2 += ray(i * 45 - 67.5, 22 * sc, 2.8 * sc);
  return `<path d="${d1}" fill="${long}"/><path d="${d2}" fill="${short}"/>
<circle cx="${cx}" cy="${cy}" r="${f(8.6 * sc)}" fill="${core}"/><circle cx="${cx}" cy="${cy}" r="${f(4.8 * sc)}" fill="${C.butter}"/>`;
}

// ---- mark: a sign letter on its truss, the lamp lit in its counter ---------------
const P_FACE = 'M58,26H110A41,41 0 0 1 110,108H93V148H58ZM93,53V81H108A14,14 0 0 0 108,53Z';
const P_SOLID = 'M58,26H110A41,41 0 0 1 110,108H93V148H58Z';
function markBody({ face = C.sky1, steel = C.steelDk, slab = C.seafoamDk, star = C.pink } = {}) {
  let truss = '';
  const xs = [36, 62, 88, 114, 140, 166];
  xs.forEach((x, i) => {
    truss += `M${x},150V174`;
    if (i < xs.length - 1) truss += i % 2 ? `M${x},150L${xs[i + 1]},174` : `M${x},174L${xs[i + 1]},150`;
  });
  return `
<path d="M36,150H166${truss}" fill="none" stroke="${steel}" stroke-width="3.2" stroke-linecap="round"/>
<path d="${P_SOLID}" fill="${C.pinkDk}" transform="translate(8 7)"/>
<path d="${P_SOLID}" fill="${C.pink}" transform="translate(4 3.5)"/>
<path d="M93,53V81H108A14,14 0 0 0 108,53Z" fill="${C.butter}"/>
<circle cx="101" cy="64" r="4.6" fill="${C.hot}"/>
<path d="${P_FACE}" fill="${face}" fill-rule="evenodd"/>
<rect x="12" y="174" width="176" height="11" fill="${slab}"/>
<rect x="12" y="185" width="176" height="4" fill="${steel}"/>
${twinkle(168, 44, 17, star)}${twinkle(182, 86, 7, star)}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody({ face: C.cream, steel: C.steel, slab: C.seafoam, star: C.butter }) });

// ---- favicons: a small navy tile, drawn on the pixel grid -------------------------
const PIX = { N: C.sky1, n: C.sky3, C: C.cream, K: C.pink, B: C.butter, H: C.hot, S: C.seafoam, T: C.steelDk };
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
  '.NNNNNNNNNNNNNN.',
  'NNNNNNNNNNNNNNNN',
  'NNNCCCCCCCNNNBNN',
  'NNNCCCCCCCCNBBBN',
  'NNNCCCBBBCCCKBNN',
  'NNNCCCBHBCCCKNNN',
  'NNNCCCBBBCCCKNNN',
  'NNNCCCCCCCCKKNNN',
  'NNNCCCCCCCKKNNNN',
  'NNNCCCKKKKKNNNNN',
  'NNNCCCKNNNNNNNNN',
  'NNNCCCKNNNNNNNNN',
  'NNTNTNTNTNTNTTNN',
  'SSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSS',
  '.nnnnnnnnnnnnnn.',
];
const FAV32 = [
  '..NNNNNNNNNNNNNNNNNNNNNNNNNNNN..',
  '.NNNNNNNNNNNNNNNNNNNNNNNNNNNNNN.',
  'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
  'NNNNNNNNNNNNNNNNNNNNNNNNNNBNNNNN',
  'NNNNNNNCCCCCCCCCCCCNNNNNNNBNNNNN',
  'NNNNNNNCCCCCCCCCCCCCCNNNNBBBNNNN',
  'NNNNNNNCCCCCCCCCCCCCCCNBBBBBBBNN',
  'NNNNNNNCCCCCCCCCCCCCCCCKNBBBNNNN',
  'NNNNNNNCCCCCCCBBBBBCCCCCKNBNNNNN',
  'NNNNNNNCCCCCCCBBBBBBCCCCKKBNNNNN',
  'NNNNNNNCCCCCCCBHHBBBCCCCKKNNNNNN',
  'NNNNNNNCCCCCCCBHHBBBCCCCKKNNNNNN',
  'NNNNNNNCCCCCCCBBBBBBCCCCKKNNNNNN',
  'NNNNNNNCCCCCCCBBBBBCCCCCKKNNNNNN',
  'NNNNNNNCCCCCCCCCCCCCCCCKKKNNNNNN',
  'NNNNNNNCCCCCCCCCCCCCCCKKKNNNNNNN',
  'NNNNNNNCCCCCCCCCCCCCCKKKKNNNNNNN',
  'NNNNNNNCCCCCCCCCCCCKKKKKNNNNNNNN',
  'NNNNNNNCCCCCCCKKKKKKKKNNNNNNNNNN',
  'NNNNNNNCCCCCCCKKNNNNNNNNNNNNNNNN',
  'NNNNNNNCCCCCCCKKNNNNNNNNNNNNNNNN',
  'NNNNNNNCCCCCCCKKNNNNNNNNNNNNNNNN',
  'NNNNNNNCCCCCCCKKNNNNNNNNNNNNNNNN',
  'NNNNTTTTTTTTTTTTTTTTTTTTTTTTNNNN',
  'NNNNTNNNTTNNNTTNNNTTNNNTTNNTNNNN',
  'NNNNTNNTNNTNTNNTNTNNTNTNNTNTNNNN',
  'NNNNTTTNNNNTNNNNTNNNNTNNNNTTNNNN',
  'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
  '.nnnnnnnnnnnnnnnnnnnnnnnnnnnnnn.',
  '..nnnnnnnnnnnnnnnnnnnnnnnnnnnn..',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- icon ----------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: '<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>',
  body: `
<g clip-path="url(#sq)">
<rect width="512" height="512" fill="${C.sky1}"/>
<rect y="170" width="512" height="342" fill="${C.sky2}"/>
<rect y="320" width="512" height="192" fill="${C.sky3}"/>
${lineStar(96, 92, 30, C.cream, 3.4, 8)}${lineStar(420, 250, 20, C.seafoam, 3, 0)}${twinkle(60, 240, 10, C.pink)}${twinkle(300, 44, 8, C.cream)}
<rect y="444" width="512" height="68" fill="${C.wall}"/>
${nest({ x: -4, y: 20, w: 520, h: 520, vb: '0 0 200 200', body: markBody({ face: C.cream, steel: C.steel, slab: C.seafoam, star: C.butter }) })}
</g>`,
});

// ---- the rooftop letters -------------------------------------------------------
function signLetters(x, y, size, ls, { face = C.cream, depth = 6 } = {}) {
  let out = '';
  const t = (dx, dy, fill) =>
    `<text x="${x}" y="${y}" font-family="Futura" font-weight="700" font-size="${size}" letter-spacing="${ls}" fill="${fill}" transform="translate(${dx} ${dy})">PORCHLIGHT</text>`;
  for (let k = depth; k >= 1; k--) out += t(k, k * 0.85, k > depth / 2 ? C.pinkDk : C.pink);
  return out + t(0, 0, face);
}
function truss(x0, x1, yTop, yBot, n, stroke, w = 2) {
  let d = `M${x0},${yTop}H${x1}`;
  const step = (x1 - x0) / n;
  for (let i = 0; i <= n; i++) {
    const x = f(x0 + i * step);
    d += `M${x},${yTop}V${yBot}`;
    if (i < n) d += i % 2 ? `M${x},${yTop}L${f(x0 + (i + 1) * step)},${yBot}` : `M${x},${yBot}L${f(x0 + (i + 1) * step)},${yTop}`;
  }
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
}

// ---- logo ----------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.cream : C.sky1;
  return `
${nest({ x: 12, y: 10, w: 176, h: 176, vb: '0 0 200 200', body: dark ? markBody({ face: C.cream, steel: C.steel, slab: C.seafoam, star: C.butter }) : markBody() })}
${truss(212, 612, 106, 122, 16, dark ? C.steel : C.steelDk, 1.8)}
${signLetters(210, 102, 51, 5.4, { face: ink, depth: 4 })}
<rect x="204" y="122" width="416" height="5" fill="${dark ? C.seafoam : C.seafoamDk}"/>
<text x="212" y="156" font-family="Futura" font-weight="500" font-size="13.5" letter-spacing="3.9" fill="${ink}">KNOW WHAT’S ON YOUR DOORSTEP.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero ----------------------------------------------------------------------
function palm(x, base, cx, cy, sc = 1) {
  const tips = [
    [-92, 40], [-80, -18], [-44, -62], [10, -74], [58, -48], [90, 4], [82, 56],
  ];
  let fronds = '';
  for (const [dx, dy] of tips) {
    const tx = cx + dx * sc;
    const ty = cy + dy * sc;
    const mx = cx + dx * sc * 0.45;
    const my = cy + dy * sc * 0.45 - 34 * sc;
    fronds += `<path d="M${cx},${cy}Q${f(mx)},${f(my - 10 * sc)} ${f(tx)},${f(ty)}Q${f(mx + 4 * sc)},${f(my + 12 * sc)} ${cx},${cy}Z" fill="${C.ink}"/>`;
  }
  return `<path d="M${x},${base}C${x - 10},${f(base - (base - cy) * 0.4)} ${cx - 16},${f(cy + (base - cy) * 0.3)} ${cx},${cy}" fill="none" stroke="${C.ink}" stroke-width="${f(9 * sc)}" stroke-linecap="round"/>${fronds}<circle cx="${cx}" cy="${cy}" r="${f(8 * sc)}" fill="${C.ink}"/>`;
}
function agave(x, y, sc, fill, fill2) {
  const leaves = [[-34, -10], [-26, -30], [-12, -44], [2, -50], [16, -42], [28, -26], [34, -8]];
  return leaves
    .map(([dx, dy], i) => `<path d="M${f(x - 5 * sc)},${y}L${f(x + dx * sc)},${f(y + dy * sc)}L${f(x + 5 * sc)},${y}Z" fill="${i % 2 ? fill2 : fill}"/>`)
    .join('');
}

function hero() {
  const r = rng(24);
  const G = 520;
  const RT = 380; // top of the roof slab
  const WT = 398; // top of the walls
  let dots = '';
  for (let i = 0; i < 70; i++) {
    const x = r() * 1280;
    const y = r() * 330;
    dots += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + r() * 1.1)}" fill="${C.cream}" opacity="${f(0.3 + r() * 0.5)}"/>`;
  }
  const sky = `
<rect width="1280" height="640" fill="${C.sky1}"/>
<rect y="176" width="1280" height="464" fill="${C.sky2}"/>
<rect y="316" width="1280" height="324" fill="${C.sky3}"/>
${dots}
${burst(1128, 92, 1.0)}${burst(196, 96, 0.8, C.cream, C.pink, C.seafoam)}
${lineStar(640, 70, 26, C.cream, 2.4, 6)}${lineStar(388, 150, 17, C.seafoam, 2.2, 0)}${lineStar(900, 158, 18, C.pink, 2.2, 12)}
${lineStar(1232, 236, 14, C.cream, 2, 0)}${lineStar(470, 52, 12, C.pink, 2, 20)}${lineStar(806, 60, 13, C.seafoam, 2, 4)}
${twinkle(300, 60, 9, C.cream)}${twinkle(560, 176, 7, C.butter)}${twinkle(1010, 52, 8, C.cream)}${twinkle(742, 168, 6, C.cream)}${twinkle(1040, 214, 6, C.butter)}${twinkle(120, 214, 7, C.seafoam)}${twinkle(1180, 310, 5, C.cream)}`;

  // ---- house ----
  const LX = 548;
  const LY = 446;
  // breeze-block screen
  let breeze = '';
  for (let by = 0; by < 3; by++)
    for (let bx = 0; bx < 4; bx++) {
      const x = 126 + bx * 27;
      const y = 439 + by * 27;
      breeze += `<rect x="${x}" y="${y}" width="25" height="25" fill="#5d76a6"/><circle cx="${x + 12.5}" cy="${y + 12.5}" r="9" fill="${C.wallDk}"/><circle cx="${x + 12.5}" cy="${y + 12.5}" r="3.2" fill="#5d76a6"/>`;
    }
  let stone = '';
  for (let row = 0; row < 5; row++) {
    const y = 322 + row * 12;
    stone += `M150,${y}H208`;
    for (let k = 0; k < 3; k++) stone += `M${164 + k * 18 + (row % 2 ? 8 : 0)},${y}v12`;
  }
  let panes = '';
  for (let i = 0; i < 4; i++) panes += `<rect x="${582 + i * 66}" y="412" width="62" height="${G - 412}" fill="${C.glass}"/>`;
  let clere = '';
  for (let i = 0; i < 4; i++) clere += `<rect x="${258 + i * 44}" y="408" width="40" height="16" fill="${C.glass}"/>`;

  const house = `
<clipPath id="main"><rect x="236" y="${WT}" width="624" height="${G - WT}"/></clipPath>
<rect x="150" y="320" width="58" height="62" fill="#27407a"/><path d="${stone}" stroke="${C.sky1}" stroke-width="1.6"/>
<rect x="144" y="313" width="70" height="8" fill="${C.steelDk}"/>
<rect x="116" y="${WT}" width="120" height="${G - WT}" fill="${C.wallDk}"/>
<rect x="236" y="${WT}" width="624" height="${G - WT}" fill="${C.wall}"/>
<rect x="860" y="${WT}" width="322" height="${G - WT}" fill="${C.wallDk}"/>
<g clip-path="url(#main)">
<ellipse cx="${LX}" cy="${LY + 10}" rx="200" ry="160" fill="#1e4a62"/>
<ellipse cx="${LX}" cy="${LY + 8}" rx="146" ry="120" fill="#296474"/>
<ellipse cx="${LX}" cy="${LY + 6}" rx="98" ry="86" fill="#3c8489"/>
<ellipse cx="${LX}" cy="${LY + 4}" rx="58" ry="54" fill="#58a89e"/>
<ellipse cx="${LX}" cy="${LY + 2}" rx="27" ry="27" fill="#8fd6bf"/>
</g>
${clere}
<rect x="444" y="406" width="72" height="${G - 406}" fill="${C.cream}"/>
<rect x="450" y="412" width="60" height="${G - 412}" fill="${C.pink}"/>
<clipPath id="leaf"><rect x="450" y="412" width="60" height="${G - 412}"/></clipPath>
<g clip-path="url(#leaf)"><circle cx="${LX}" cy="${LY}" r="98" fill="${C.pinkLt}"/><circle cx="${LX}" cy="${LY}" r="58" fill="#fdb3bf"/></g>
<rect x="458" y="424" width="9" height="9" fill="${C.hot}"/><rect x="469" y="436" width="9" height="9" fill="${C.hot}"/><rect x="480" y="448" width="9" height="9" fill="${C.hot}"/>
<circle cx="501" cy="472" r="3.2" fill="${C.butter}"/>
<rect x="520" y="412" width="12" height="${G - 412}" fill="#2f7f86"/><path d="M523,412V${G}M526,412V${G}M529,412V${G}" stroke="${C.wall}" stroke-width="1"/>
<rect x="576" y="406" width="272" height="${G - 406}" fill="#4a6f8c"/>
${panes}
<path d="M582,412h62v${G - 412}h-34c8,-30 8,-70 -6,-108z" fill="#173450"/>
<path d="M690,${G}v-58m-9,0h18l-4,-20h-10z" fill="#1d3e5c" stroke="#1d3e5c" stroke-width="3" stroke-linejoin="round"/>
<path d="M730,${G}v-22q0,-10 12,-10h30q12,0 12,10v22z" fill="#1d3e5c"/>
<path d="M790,412L742,${G}M836,412L800,490" stroke="#1b3a58" stroke-width="5"/>
<path d="M${LX - 7},${LY - 16}h14" stroke="${C.cream}" stroke-width="3" stroke-linecap="round"/><path d="M${LX},${LY - 16}v6" stroke="${C.cream}" stroke-width="2.4"/>
<circle cx="${LX}" cy="${LY}" r="10.500" fill="${C.butter}"/><circle cx="${LX}" cy="${LY}" r="6.500" fill="${C.hot}"/>
${breeze}
<rect x="120" y="${G - 4}" width="116" height="4" fill="#5d76a6"/>
<path d="M878,${WT}L872,${G}M1164,${WT}L1170,${G}" stroke="${C.steel}" stroke-width="3.4"/>
<path d="M898,506V493Q900,484 916,482L972,478L994,457H1052L1080,477L1118,475L1150,450V500L1142,508Z" fill="${C.ink}"/>
<path d="M1000,461h46l22,16h-84z" fill="#1d3e6a"/><path d="M1024,461v16" stroke="${C.ink}" stroke-width="3"/>
<path d="M902,492H1128" stroke="#4a6f9c" stroke-width="2.2" stroke-linecap="round"/>
<circle cx="942" cy="508" r="14" fill="${C.ink}"/><circle cx="942" cy="508" r="6.500" fill="#4a6f9c"/><circle cx="1098" cy="508" r="14" fill="${C.ink}"/><circle cx="1098" cy="508" r="6.500" fill="#4a6f9c"/>
<rect x="1144" y="468" width="5" height="12" rx="2" fill="${C.pink}"/>
<path d="M1108,${RT}c-3,-14 2,-24 12,-27l-2,-9l7,5c3,-1 6,-1 8,0l7,-5l-2,10c6,5 7,14 4,26z" fill="${C.ink}"/>
<path d="M1136,${RT - 3}c12,2 18,-6 14,-16" fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>
<rect x="90" y="${RT}" width="1108" height="12" fill="${C.slab}"/>
<rect x="90" y="${RT + 12}" width="1108" height="6" fill="#3a4f86"/>`;

  // ---- yard ----
  const yard = `
<rect y="${G}" width="1280" height="${640 - G}" fill="${C.lawn}"/>
<clipPath id="lawn"><rect y="${G}" width="1280" height="64"/></clipPath>
<g clip-path="url(#lawn)">
<ellipse cx="510" cy="${G + 2}" rx="290" ry="58" fill="#15493f"/>
<ellipse cx="506" cy="${G + 2}" rx="190" ry="38" fill="#1f6457"/>
<ellipse cx="500" cy="${G + 2}" rx="104" ry="21" fill="#318872"/>
</g>
<rect x="860" y="${G}" width="322" height="6" fill="#2a3f6b"/>
<path d="M454,${G + 6}h52l3,9h-58zM446,${G + 22}h68l4,12h-76zM436,${G + 42}h88l5,15h-98z" fill="#a9c4bb"/>
<rect y="584" width="1280" height="56" fill="${C.ink}"/>
<rect y="584" width="1280" height="4" fill="#3a4f86"/>
<path d="M48,613H296M984,613H1232" stroke="#3a4f86" stroke-width="3" stroke-dasharray="34 22"/>
<text x="643.500" y="621" text-anchor="middle" font-family="Futura" font-weight="500" font-size="22" letter-spacing="6.6" fill="${C.cream}">KNOW WHAT’S ON YOUR DOORSTEP.</text>
${agave(640, G + 2, 0.8, '#2a7a70', '#1d5f5a')}${agave(792, G + 2, 0.62, '#1d5f5a', '#2a7a70')}${agave(262, G + 2, 0.66, '#1d5f5a', '#266e68')}
<ellipse cx="386" cy="${G - 26}" rx="14" ry="9" fill="${C.pink}"/>
<path d="M397,${G - 30}C410,${G - 36} 396,${G - 48} 402,${G - 58}" fill="none" stroke="${C.pink}" stroke-width="4.4" stroke-linecap="round"/>
<circle cx="402.500" cy="${G - 60}" r="4.2" fill="${C.pink}"/><path d="M405,${G - 62}l8,3l-7,3z" fill="${C.ink}"/>
<path d="M384,${G - 18}V${G + 6}M389,${G - 18}L391,${G + 6}" stroke="${C.pinkDk}" stroke-width="2" stroke-linecap="round"/>
<path d="M1222,584V552" stroke="${C.steel}" stroke-width="4" stroke-linecap="round"/>
<path d="M1206,554v-10a9,9 0 0 1 9,-9h14a9,9 0 0 1 9,9v10z" fill="${C.slab}"/>
<path d="M1238,542V528h9v7h-5" fill="none" stroke="${C.pink}" stroke-width="2.6" stroke-linejoin="round"/>`;

  // ---- sign on the roof ----
  // a row of small bulbs along the rail the letters stand on
  let railBulbs = '';
  for (let x = 266; x <= 1024; x += 15.16) railBulbs += `<circle cx="${f(x)}" cy="341" r="2.7" fill="${C.butter}"/><circle cx="${f(x - 0.7)}" cy="340.300" r="1.1" fill="${C.hot}"/>`;
  const sign = `
${truss(258, 1030, 346, RT, 22, C.steel, 2.2)}
<rect x="256" y="336.500" width="776" height="9" rx="2" fill="${C.steelDk}"/>
${railBulbs}
${signLetters(255, 336, 96, 12.4, { depth: 7 })}`;

  return `
${sky}
${palm(52, G, 84, 232, 1)}
${palm(1240, G, 1226, 318, 0.72)}
${house}
${yard}
${sign}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 24 Ranch rooftop

A long mid-century ranch house at night under a starburst sky. The name stands along the roofline as dimensional sign letters on a steel truss, the way a Googie coffee shop wore its name; under it a pink front door with the porch globe lit, a breeze-block screen, glass walls gone dark, a plastic flamingo, and a finned car asleep in the carport. The tagline is painted on the road. The mark is one sign letter on its truss with the lamp lit in its counter.
Palette: night blues #101f52 / #15296a / #1b367f, steel #8ea0c8, flamingo pink #f26d85, seafoam #7fd3c0, butter #ffd66b, cream #fbf1dc, ink #0a1230.
Type: Futura Bold capitals as built letters with a pink return; Futura Medium capitals for the tagline.
Tagline: Know what's on your doorstep.
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
