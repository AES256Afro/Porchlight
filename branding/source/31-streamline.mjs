// 31 Streamline: Streamline Moderne at dusk. A cream stucco house with a
// rounded corner, wrap-around glass block, a porthole and a pipe rail on the
// roof; three speed stripes run in from the left edge, underline the name and
// carry on round the house. A globe porch light is on by the coral door.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '31-streamline';
const C = {
  deep: '#0d3642',
  teal1: '#124856',
  teal2: '#1a5f6c',
  sea: '#4f908e',
  aqua: '#8fc9c0',
  ground: '#0c2a33',
  lawn: '#103640',
  cream: '#f5ecd8',
  wall: '#d9d0bc',
  wall2: '#e8dfcb',
  shade1: '#c5bda9',
  shade2: '#aea895',
  shade3: '#96917f',
  grey: '#8c989d',
  greyLt: '#bcc6c8',
  coral: '#ee7a56',
  coralLt: '#f5a688',
  coralDk: '#c45c3d',
  butter: '#ffd98a',
  hot: '#fff3cf',
};
const FONTS = { FutB: 'Futura-Bold', FutM: 'Futura-Medium' };
const f = (n) => Math.round(n * 100) / 100;

// A capsule: a bar with fully rounded ends.
const bar = (x, y, w, h, fill) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}" fill="${fill}"/>`;

// ---- mark: a globe on a gooseneck arm, three speed stripes behind it -----------------
function markBody({ stripe = C.teal2, mid = C.coral, ring = C.teal1, cap = C.teal1 } = {}) {
  const gx = 104;
  const gy = 124;
  return `
${bar(24, 91.5, 70, 13, stripe)}
${bar(2, 117.5, 80, 13, mid)}
${bar(24, 143.5, 70, 13, stripe)}
<path d="M${gx},64V46Q${gx},29 ${gx + 17},29H178" fill="none" stroke="${cap}" stroke-width="11"/>
<rect x="172" y="8" width="18" height="60" rx="6" fill="${cap}"/>
<path d="M${gx - 25},78Q${gx - 25},56 ${gx},56Q${gx + 25},56 ${gx + 25},78Z" fill="${cap}"/>
<circle cx="${gx}" cy="${gy}" r="58" fill="${ring}"/>
<circle cx="${gx}" cy="${gy}" r="49" fill="${C.butter}"/>
<circle cx="${gx}" cy="${gy}" r="35" fill="${C.hot}"/>
<path d="M${gx - 37},${gy - 12}A39,39 0 0 1 ${gx - 12},${gy - 37}" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });
const markDarkSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 200 200',
  body: markBody({ stripe: C.aqua, mid: C.coral, ring: C.sea, cap: C.sea }),
});

// ---- favicons ---------------------------------------------------------------------
const PIX = { T: C.teal2, D: C.teal1, R: C.coral, B: C.butter, H: C.hot, W: '#ffffff' };
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
  '............DD..',
  '.......DDDDDDD..',
  '.......DD...DD..',
  '......DDDD..DD..',
  '.....DDDDDD.....',
  '....DBBBBBBD....',
  'TTTDBBHHHHBBD...',
  '...DBHWHHHHBD...',
  'RRRDBHHHHHHBD...',
  '...DBHHHHHHBD...',
  'TTTDBBHHHHBBD...',
  '....DBBBBBBD....',
  '.....DDDDDD.....',
  '................',
  '................',
  '................',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const put = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  const box = (x0, y0, x1, y1, ch) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch);
  };
  const cx = 17.5;
  const cy = 19.5;
  // stripes first, the globe covers their ends
  box(2, 14, 12, 15, 'T');
  box(0, 19, 12, 20, 'R');
  box(2, 24, 12, 25, 'T');
  // arm and wall plate
  box(17, 4, 18, 9, 'D');
  box(17, 3, 29, 4, 'D');
  box(28, 0, 31, 9, 'D');
  box(15, 7, 20, 8, 'D');
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= 11.6) put(x, y, d > 9.6 ? 'D' : d > 6.9 ? 'B' : 'H');
    }
  put(13, 15, 'W');
  put(14, 14, 'W');
  put(13, 16, 'W');
  put(15, 13, 'W');
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon -----------------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
<clipPath id="ic"><rect width="512" height="512" rx="112"/></clipPath>
<g clip-path="url(#ic)">
  <rect width="512" height="512" fill="${C.deep}"/>
  <rect y="150" width="512" height="362" fill="${C.teal1}"/>
  <rect y="300" width="512" height="212" fill="${C.teal2}"/>
  <rect y="408" width="512" height="104" fill="${C.sea}"/>
  <rect y="456" width="512" height="56" fill="${C.coralLt}"/>
  <rect y="486" width="512" height="26" fill="${C.coral}"/>
  ${nest({ x: 52, y: 40, w: 420, h: 420, vb: '0 0 200 200', body: markBody({ stripe: C.cream, mid: C.coral, ring: C.cream, cap: C.cream }) })}
</g>`,
});

// ---- logo -------------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.cream : C.teal1;
  const line = dark ? C.aqua : C.teal2;
  return `
${nest({ x: 4, y: 4, w: 192, h: 192, vb: '0 0 200 200', body: dark ? markBody({ stripe: C.aqua, mid: C.coral, ring: C.sea, cap: C.sea }) : markBody() })}
<text transform="translate(206 112) skewX(-12)" font-family="FutB" font-size="76" fill="${ink}">Porchlight</text>
${bar(196, 130, 420, 6, line)}${bar(232, 142, 384, 6, C.coral)}${bar(268, 154, 348, 6, line)}
<text transform="translate(272 186) skewX(-12)" font-family="FutM" font-size="17" letter-spacing="1.2" fill="${ink}">Keep watch over what’s yours.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(true) });

// ---- hero ----------------------------------------------------------------------------------
function hero() {
  const G = 540; // ground
  const WL = 618; // the bay's silhouette
  const WT = 240; // top of the wall
  const TAN = 770; // where the curve meets the flat front
  const LX = 884; // the globe
  const LY = 404;
  const SY = [262, 276, 290]; // the three speed stripes

  const sky = `
<rect width="1280" height="640" fill="${C.deep}"/>
<rect y="150" width="1280" height="490" fill="${C.teal1}"/>
<rect y="306" width="1280" height="334" fill="${C.teal2}"/>
<rect y="412" width="1280" height="228" fill="${C.sea}"/>
<rect y="468" width="1280" height="172" fill="${C.coralLt}"/>
<rect y="506" width="1280" height="134" fill="${C.coral}"/>`;
  const clouds = `
${bar(84, 62, 250, 12, C.teal1)}${bar(150, 80, 330, 12, C.teal1)}${bar(110, 98, 190, 12, C.teal1)}
${bar(40, 426, 230, 11, C.teal2)}${bar(120, 443, 330, 11, C.teal2)}
${bar(900, 74, 170, 11, C.teal1)}${bar(840, 91, 260, 11, C.teal1)}`;
  const stars = [
    [540, 60, 2.2], [612, 118, 1.6], [706, 52, 2], [770, 150, 1.5], [1118, 44, 1.8], [1226, 120, 2.2], [36, 120, 1.6], [470, 132, 1.5], [1190, 196, 1.5],
  ]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.cream}"/>`)
    .join('');
  const moon = `<path d="M1166,58A34,34 0 1 0 1196,112A28,28 0 1 1 1166,58Z" fill="${C.cream}"/>`;

  // speed stripes across the sky; they turn teal where they reach the house
  const skyStripes = SY.map((y, i) => `<rect x="0" y="${y}" width="${WL}" height="7" fill="${i === 1 ? C.coral : C.cream}"/>`).join('');

  // the roof: a small rounded penthouse, a mast with a pennant, a pipe rail over the bay
  const roof = `
<path d="M1002,${WT}V206Q1002,186 1022,186H1160V${WT}Z" fill="${C.shade1}"/>
<path d="M1002,${WT}V206Q1002,186 1022,186H1036V${WT}Z" fill="${C.shade2}"/>
<rect x="1002" y="200" width="158" height="5" fill="${C.teal2}"/><rect x="1002" y="210" width="158" height="5" fill="${C.teal2}"/>
<rect x="1160" y="186" width="120" height="${WT - 186}" fill="${C.shade2}"/>
<rect x="1213" y="96" width="4" height="${WT - 96}" fill="${C.greyLt}"/>
<path d="M1217,100H1256L1244,109L1256,118H1217Z" fill="${C.coral}"/>
<path d="M630,${WT}V214Q630,206 638,206H930M630,223H930" fill="none" stroke="${C.greyLt}" stroke-width="3.2"/>
<path d="M690,206V${WT}M750,206V${WT}M810,206V${WT}M870,206V${WT}M930,204V${WT}" stroke="${C.greyLt}" stroke-width="3.2"/>`;

  // the wall, turning away at the bay, and the lamp's light on it in stepped rings
  let blocks = '';
  const cols = [];
  for (let i = 0; i <= 8; i++) cols.push(TAN - 152 * Math.sin((i * 11.25 * Math.PI) / 180));
  cols.reverse(); // from the silhouette to the tangent
  const flat = [TAN + 30, TAN + 60];
  const xs = [...cols, ...flat];
  const BY0 = 322;
  for (const x of xs.slice(1, -1)) blocks += `M${f(x)},${BY0}V${BY0 + 120}`;
  for (let r = 1; r < 4; r++) blocks += `M${f(xs[0])},${BY0 + r * 30}H${f(xs[xs.length - 1])}`;
  const lit = [
    [1, 0], [4, 1], [6, 0], [9, 2], [3, 3], [8, 1], [2, 2], [7, 3],
  ]
    .map(([c, r]) => `<rect x="${f(xs[c])}" y="${BY0 + r * 30}" width="${f(xs[c + 1] - xs[c])}" height="30" fill="${C.aqua}"/>`)
    .join('');
  const wall = `
<clipPath id="wallclip"><rect x="${WL}" y="${WT}" width="${1280 - WL}" height="${G - WT}"/></clipPath>
<rect x="${WL}" y="${WT}" width="${1280 - WL}" height="${G - WT}" fill="${C.wall}"/>
<g clip-path="url(#wallclip)">
  <circle cx="${LX}" cy="${LY}" r="176" fill="${C.wall2}"/>
  <circle cx="${LX}" cy="${LY}" r="116" fill="${C.cream}"/>
  <circle cx="${LX}" cy="${LY}" r="58" fill="#fff1cc"/>
  <rect x="${WL}" y="${WT}" width="52" height="${G - WT}" fill="${C.shade1}"/>
  <rect x="${WL}" y="${WT}" width="26" height="${G - WT}" fill="${C.shade2}"/>
  <rect x="${WL}" y="${WT}" width="9" height="${G - WT}" fill="${C.shade3}"/>
</g>
${SY.map((y, i) => `<rect x="${WL}" y="${y}" width="${1280 - WL}" height="7" fill="${i === 1 ? C.coral : C.teal2}"/>`).join('')}
<rect x="${WL - 4}" y="${WT - 5}" width="${1280 - WL + 4}" height="9" rx="2" fill="${C.grey}"/>
<rect x="${f(xs[0])}" y="${BY0}" width="${f(xs[xs.length - 1] - xs[0])}" height="120" fill="${C.sea}"/>
${lit}
<path d="${blocks}" stroke="${C.cream}" stroke-width="2.4" fill="none"/>
<rect x="${f(xs[0])}" y="${BY0}" width="${f(xs[xs.length - 1] - xs[0])}" height="120" fill="none" stroke="${C.grey}" stroke-width="4"/>`;

  // porthole
  const PX = 1128;
  const PY = 420;
  const porthole = `
<circle cx="${PX}" cy="${PY}" r="42" fill="${C.grey}"/>
<circle cx="${PX}" cy="${PY}" r="34" fill="${C.teal1}"/>
<path d="M${PX - 22},${PY + 10}A24,24 0 0 1 ${PX + 4},${PY - 23}" fill="none" stroke="${C.sea}" stroke-width="5" stroke-linecap="round"/>
<path d="M${PX - 34},${PY}H${PX + 34}M${PX},${PY - 34}V${PY + 34}" stroke="${C.grey}" stroke-width="4"/>
${[45, 135, 225, 315].map((a) => `<circle cx="${f(PX + 38 * Math.cos((a * Math.PI) / 180))}" cy="${f(PY + 38 * Math.sin((a * Math.PI) / 180))}" r="2.4" fill="${C.cream}"/>`).join('')}`;

  // door, canopy, globe
  const DX = 926;
  const DW = 88;
  const DT = 366;
  const DB = 510;
  const door = `
<rect x="${DX - 8}" y="${DT - 8}" width="${DW + 16}" height="${DB - DT + 8}" fill="${C.grey}"/>
<rect x="${DX}" y="${DT}" width="${DW}" height="${DB - DT}" fill="${C.coral}"/>
<rect x="${DX}" y="${DT}" width="12" height="${DB - DT}" fill="${C.coralLt}"/>
<circle cx="${DX + DW / 2}" cy="${DT + 38}" r="19" fill="${C.cream}"/>
<circle cx="${DX + DW / 2}" cy="${DT + 38}" r="13" fill="${C.teal1}"/>
<path d="M${DX + 14},${DT + 76}H${DX + DW - 14}M${DX + 14},${DT + 86}H${DX + DW - 14}M${DX + 14},${DT + 96}H${DX + DW - 14}" stroke="${C.cream}" stroke-width="3.4"/>
<rect x="${DX + DW - 16}" y="${DT + 66}" width="5" height="42" rx="2.5" fill="${C.greyLt}"/>
<rect x="${DX}" y="${DB - 14}" width="${DW}" height="14" fill="${C.greyLt}"/>
<rect x="${DX - 60}" y="${DT - 30}" width="${DW + 104}" height="12" rx="6" fill="${C.cream}"/>
<rect x="${DX - 52}" y="${DT - 18}" width="${DW + 88}" height="6" fill="${C.shade2}"/>`;
  const lamp = `
<rect x="${LX - 3}" y="${DT - 12}" width="6" height="${LY - 16 - DT + 12}" fill="${C.grey}"/>
<path d="M${LX - 10},${LY - 15}Q${LX - 10},${LY - 24} ${LX},${LY - 24}Q${LX + 10},${LY - 24} ${LX + 10},${LY - 15}Z" fill="${C.grey}"/>
<circle cx="${LX}" cy="${LY + 4}" r="22" fill="#ffc35a"/>
<circle cx="${LX}" cy="${LY + 4}" r="15.5" fill="#fffbee"/>
<path d="M${LX - 14},${LY - 2}A15,15 0 0 1 ${LX - 5},${LY - 10.5}" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round"/>`;

  // stoop: three rounded slabs, and a pipe handrail
  const stoop = [
    [DX - 26, DB, DW + 52],
    [DX - 48, DB + 10, DW + 96],
    [DX - 70, DB + 20, DW + 140],
  ]
    .map(([x, y, w], i) => `<rect x="${x}" y="${y}" width="${w}" height="10" rx="5" fill="${i === 0 ? C.cream : C.wall2}"/><rect x="${x + 5}" y="${y + 7}" width="${w - 10}" height="3" fill="${C.shade2}"/>`)
    .join('');
  const rail = `<path d="M${DX + DW + 32},${G}V470Q${DX + DW + 32},456 ${DX + DW + 46},456H${DX + DW + 92}Q${DX + DW + 106},456 ${DX + DW + 106},470V${G}M${DX + DW + 32},488H${DX + DW + 106}" fill="none" stroke="${C.greyLt}" stroke-width="4"/>`;

  // clipped round shrubs, lawn, and the path
  const shrub = (x, r, lit) => `<path d="M${x - r},${G}A${r},${r} 0 0 1 ${x + r},${G}Z" fill="${lit ? C.teal2 : C.teal1}"/><path d="M${x - r},${G}A${r},${r} 0 0 1 ${x + r * 0.2},${G - r * 0.98}A${r * 1.1},${r * 1.1} 0 0 0 ${x - r * 0.55},${G}Z" fill="${lit ? C.sea : C.teal2}" opacity="${lit ? 1 : 0.6}"/>`;
  const pathD = `M${DX - 70},${G}C${DX - 110},572 ${DX - 250},596 ${DX - 330},640H${DX + 20}C${DX + 90},604 ${DX + 150},570 ${DX + DW + 70},${G}Z`;
  const ground = `
<rect x="0" y="${G}" width="1280" height="${640 - G}" fill="${C.ground}"/>
<rect x="0" y="${G}" width="1280" height="10" fill="${C.lawn}"/>
<clipPath id="pathclip"><path d="${pathD}"/></clipPath>
<path d="${pathD}" fill="${C.teal2}"/>
<g clip-path="url(#pathclip)">
  <ellipse cx="${DX + DW / 2}" cy="${G + 4}" rx="220" ry="50" fill="${C.sea}"/>
  <ellipse cx="${DX + DW / 2}" cy="${G + 2}" rx="140" ry="26" fill="${C.aqua}"/>
</g>`;
  // a line of round trees on the horizon, and a mailbox by the path
  const round = (x, r) => `<rect x="${x - 1.5}" y="${G - r * 1.2}" width="3" height="${r * 1.2}" fill="${C.teal1}"/><circle cx="${x}" cy="${f(G - r * 1.75)}" r="${r}" fill="${C.teal1}"/>`;
  const cone = (x, h) => `<path d="M${x},${G - h}C${x + h * 0.14},${f(G - h * 0.5)} ${x + h * 0.17},${f(G - h * 0.2)} ${x + h * 0.15},${G}H${x - h * 0.15}C${x - h * 0.17},${f(G - h * 0.2)} ${x - h * 0.14},${f(G - h * 0.5)} ${x},${G - h}Z" fill="${C.teal1}"/>`;
  const trees = `
${round(40, 15)}${round(70, 22)}${cone(112, 58)}${round(168, 13)}${round(200, 19)}
${cone(318, 46)}${cone(340, 64)}${round(378, 17)}
${round(486, 20)}${round(518, 13)}${cone(566, 52)}
<path d="M0,${G}V${G - 9}H230Q240,${G - 9} 240,${G}ZM410,${G}Q410,${G - 8} 420,${G - 8}H${WL}V${G}Z" fill="${C.teal1}"/>`;
  const mailbox = `
<rect x="707" y="574" width="5" height="36" fill="${C.grey}"/>
<path d="M690,578V568Q690,556 702,556H718Q730,556 730,568V578Z" fill="${C.cream}"/>
<path d="M690,578V568Q690,556 702,556Q708,556 708,568V578Z" fill="${C.shade1}"/>
<rect x="724" y="550" width="3.5" height="16" fill="${C.coral}"/><rect x="724" y="550" width="11" height="7" fill="${C.coral}"/>`;

  // the name, on the stripes
  const words = `
<text transform="translate(69 240) skewX(-12)" font-family="FutB" font-size="98" fill="${C.coral}">Porchlight</text>
<text transform="translate(64 235) skewX(-12)" font-family="FutB" font-size="98" fill="${C.cream}">Porchlight</text>
<text transform="translate(66 352) skewX(-12)" font-family="FutM" font-size="33" letter-spacing="1" fill="${C.cream}">Keep watch over what’s yours.</text>
<text x="60" y="398" font-family="FutM" font-size="14" letter-spacing="5.4" fill="${C.aqua}">YOUR CODE · YOUR DOMAINS · YOUR MAC</text>`;

  return `
${sky}
${clouds}
${stars}
${moon}
${skyStripes}
${roof}
${wall}
${porthole}
${door}
${lamp}
${trees}
${ground}
${mailbox}
${shrub(664, 34, false)}${shrub(722, 24, false)}${shrub(820, 28, true)}${shrub(1196, 38, false)}${shrub(1256, 28, false)}
${stoop}
${rail}
${words}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 31 Streamline

Streamline Moderne at dusk. A cream stucco house with a rounded corner, wrap-around glass block, a porthole, a pipe rail and a pennant on the roof. Three speed stripes run in from the left edge of the sheet, underline the name, and carry on round the house in teal. A globe light is on beside the coral door, and its light is three stepped rings on the wall. The sky is flat bands from deep teal down to coral, with clouds drawn as speed bars. A round-topped mailbox stands by the path. The mark is the globe on its gooseneck arm with the three stripes behind it.
Palette: teal #0d3642 / #124856 / #1a5f6c, sea #4f908e, aqua #8fc9c0, cream #f5ecd8, stucco #d9d0bc, grey #8c989d, coral #ee7a56 / #f5a688, lamp #ffd98a / #fff3cf.
Type: Futura Bold, slanted 12 degrees, for the name; Futura Medium for the tagline and the small tracked capitals.
Tagline: Keep watch over what's yours.
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
