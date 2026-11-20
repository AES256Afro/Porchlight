// 33 WPA poster: a 1930s screen-print park poster. A cool moonlit valley in
// flat blues, and one warm thing in it: the porch, its lamp and the light it
// throws down the steps and along the path.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '33-wpa-poster';
const C = {
  paper: '#f2e6c9',
  navy: '#13273a',
  teal: '#25586a',
  mist: '#7fb0ac',
  orange: '#df6a2b',
  yellow: '#f7c545',
};
const FONTS = { Block: 'HelveticaNeue-CondensedBlack', FutB: 'Futura-Bold', FutM: 'Futura-Medium' };
const f = (n) => Math.round(n * 10) / 10;

// ---- shared pieces -----------------------------------------------------------
// A stylised pine: stacked drooping tiers, with a moonlit sliver on the left of each.
function pine(cx, top, base, halfW, n, { fill = C.navy, hi = null, trunk = true } = {}) {
  const H = base - top;
  let d = '';
  let h = '';
  for (let i = 0; i < n; i++) {
    const y0 = top + H * (i / n) * 0.9;
    const y1 = top + H * (((i + 1) / n) * 0.9 + 0.06);
    const w = halfW * (0.26 + 0.74 * ((i + 1) / n));
    const sag = (y1 - y0) * 0.3;
    d += `M${f(cx)},${f(y0)}L${f(cx + w)},${f(y1)}Q${f(cx)},${f(y1 - sag)} ${f(cx - w)},${f(y1)}Z`;
    if (hi)
      h += `M${f(cx - w * 0.1)},${f(y0 + (y1 - y0) * 0.2)}L${f(cx - w * 0.9)},${f(y1 - 1.5)}Q${f(cx - w * 0.45)},${f(y1 - sag * 0.75)} ${f(cx - w * 0.2)},${f(y1 - sag * 1.05)}Z`;
  }
  const tw = Math.max(2, halfW * 0.09);
  return `${trunk ? `<rect x="${f(cx - tw)}" y="${f(base - H * 0.08)}" width="${f(tw * 2)}" height="${f(H * 0.1)}" fill="${fill}"/>` : ''}<path d="${d}" fill="${fill}"/>${hi ? `<path d="${h}" fill="${hi}"/>` : ''}`;
}
function star5(cx, cy, r, fill) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`;
  }
  return `<path d="${d}Z" fill="${fill}"/>`;
}

// ---- mark: a house, the lamp at its peak, the light falling to the door ------
function markBody({ dark = false } = {}) {
  const house = 'M100,12L182,76V188H18V76Z';
  return `
<path d="${house}" fill="${dark ? C.teal : C.navy}"/>
<path d="M100,29L169,83V175H31V83Z" fill="none" stroke="${C.paper}" stroke-width="3.5" stroke-linejoin="miter"/>
<path d="M90,66H110L160,173H40Z" fill="${C.orange}"/>
<path d="M94,70H106L134,173H66Z" fill="${C.yellow}"/>
<path d="M83,173V124Q83,112 100,112Q117,112 117,124V173Z" fill="${C.navy}"/>
<circle cx="109" cy="147" r="3.2" fill="${C.yellow}"/>
<rect x="97.5" y="32" width="5" height="15" fill="${C.paper}"/>
<path d="M91,46H109L115,55H85Z" fill="${C.paper}"/>
<path d="M88,58H112L107,73H93Z" fill="${C.paper}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody({ dark: true }) });

// ---- favicons, on the pixel grid ----------------------------------------------
const PIX = { T: C.teal, N: C.navy, Y: C.yellow, O: C.orange, C: C.paper };
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
  '.......TT.......',
  '......TTTT......',
  '.....TTTTTT.....',
  '....TTTCCTTT....',
  '...TTTTYYTTTT...',
  '..TTTTOYYOTTTT..',
  '.TTTTTOYYOTTTTT.',
  '.TTTTOYYYYOTTTT.',
  '.TTTTOYYYYOTTTT.',
  '.TTTOYYNNYYOTTT.',
  '.TTTOYNNNNYOTTT.',
  '.TTOYYNNNNYYOTT.',
  '.TTOYYNNNNYYOTT.',
  '.TOYYYNNNNYYYOT.',
  '.TTTTTTTTTTTTTT.',
  '................',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  // house: gable from row 1 to 10, walls to row 29
  for (let y = 1; y <= 29; y++) {
    const half = y <= 11 ? 1 + (y - 1) * 1.4 : 15;
    const x0 = Math.round(16 - Math.min(15, half));
    const x1 = Math.round(15 + Math.min(15, half));
    for (let x = x0; x <= x1; x++) g[y][x] = 'T';
  }
  // light: orange cone with a yellow core, from the lamp at row 9
  for (let y = 10; y <= 28; y++) {
    const t = (y - 10) / 18;
    const ho = 2 + t * 10.5;
    const hy = 1 + t * 6;
    for (let x = Math.round(16 - ho); x <= Math.round(15 + ho); x++) g[y][x] = 'O';
    for (let x = Math.round(16 - hy); x <= Math.round(15 + hy); x++) g[y][x] = 'Y';
  }
  // door
  for (let y = 18; y <= 28; y++) for (let x = 13; x <= 18; x++) g[y][x] = 'N';
  g[17][14] = g[17][15] = g[17][16] = g[17][17] = 'N';
  g[23][17] = 'Y';
  // lamp
  [[6, 15], [6, 16], [7, 14], [7, 15], [7, 16], [7, 17]].forEach(([y, x]) => (g[y][x] = 'C'));
  [[8, 14], [8, 15], [8, 16], [8, 17], [9, 15], [9, 16]].forEach(([y, x]) => (g[y][x] = 'Y'));
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon: the same house, filling the square, under a banded night sky -------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="${C.teal}"/>
  <rect y="150" width="512" height="362" fill="${C.mist}"/>
  <path d="M0,118H150Q168,118 168,128T150,138H0ZM512,170H380Q362,170 362,180T380,190H512Z" fill="${C.mist}"/>
  <circle cx="92" cy="78" r="30" fill="${C.paper}"/>
  ${star5(408, 70, 11, C.paper)}${star5(452, 122, 6, C.paper)}${star5(330, 44, 6, C.paper)}
  ${pine(52, 196, 470, 62, 5, { hi: C.teal, trunk: false })}
  ${pine(462, 236, 470, 54, 4, { hi: C.teal, trunk: false })}
  <path d="M256,92L470,262V512H42V262Z" fill="${C.navy}"/>
  <path d="M256,126L444,275V512H68V275Z" fill="none" stroke="${C.paper}" stroke-width="9"/>
  <path d="M230,234H282L420,512H92Z" fill="${C.orange}"/>
  <path d="M240,244H272L348,512H164Z" fill="${C.yellow}"/>
  <path d="M208,512V378Q208,348 256,348Q304,348 304,378V512Z" fill="${C.navy}"/>
  <circle cx="282" cy="440" r="8" fill="${C.yellow}"/>
  <rect x="249" y="158" width="14" height="24" fill="${C.paper}"/>
  <path d="M232,180H280L296,204H216Z" fill="${C.paper}"/>
  <path d="M224,212H288L275,252H237Z" fill="${C.paper}"/>
</g>`,
});

// ---- logo ----------------------------------------------------------------------
const logo = (dark) =>
  svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    body: `
${nest({ x: 14, y: 14, w: 172, h: 172, vb: '0 0 200 200', body: markBody({ dark }) })}
<text x="204" y="119" font-family="Block" font-size="73" letter-spacing="3.2" fill="${dark ? C.paper : C.navy}">PORCHLIGHT</text>
<rect x="206" y="134" width="414" height="5" fill="${C.orange}"/>
<text x="206" y="166" font-family="FutB" font-size="16.5" letter-spacing="5.2" fill="${dark ? C.yellow : C.teal}">LOOK AFTER YOUR OWN HOUSE</text>`,
  });

// ---- hero ----------------------------------------------------------------------
function hero() {
  const X0 = 28;
  const X1 = 1252;
  const Y0 = 28;
  const Y1 = 486; // picture panel
  const B0 = 496;
  const B1 = 612; // caption band

  // sky: three flat bands, the joins broken by long streamlined clouds
  const sky = `
<rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}" fill="${C.teal}"/>
<rect x="${X0}" y="196" width="${X1 - X0}" height="${Y1 - 196}" fill="${C.mist}"/>
<rect x="${X0}" y="276" width="${X1 - X0}" height="60" fill="${C.paper}"/>
<path d="M300,168H640Q654,168 654,177T640,186H300Q286,186 286,177T300,168ZM${X0},146H250Q262,146 262,154T250,162H${X0}ZM520,140H760Q770,140 770,147T760,154H520Q510,154 510,147T520,140Z" fill="${C.mist}"/>
<path d="M${X0},218H336Q346,218 346,225T336,232H${X0}ZM548,202H772Q782,202 782,209T772,216H548Q538,216 538,209T548,202Z" fill="${C.paper}"/>`;
  const moon = `<circle cx="436" cy="92" r="33" fill="${C.paper}"/>`;
  const stars = [
    [250, 62, 6], [330, 110, 4], [560, 64, 5], [640, 108, 4], [176, 104, 4], [704, 62, 6], [520, 112, 3.5],
  ]
    .map(([x, y, r]) => star5(x, y, r, C.paper))
    .join('');

  // far range, moonlit from the left
  const far = `
<path d="M${X0},324V268L92,238L142,256L212,206L262,242L302,228L372,266L432,240L502,214L562,252L642,228L702,260L770,240V324Z" fill="${C.teal}"/>
<path d="M212,206L176,240L198,236L186,264L216,240ZM502,214L466,248L488,244L476,270L506,246ZM92,238L64,264L84,260L76,280L96,262ZM642,228L612,256L632,252L622,274L646,254ZM302,228L282,250L296,248L290,262L304,250Z" fill="${C.mist}"/>`;

  // lake, with the moon laid along it
  const lake = `
<rect x="${X0}" y="318" width="760" height="56" fill="${C.mist}"/>
<path d="M398,324H474M380,331H492M392,338H480M410,345H462" stroke="${C.paper}" stroke-width="3.2" stroke-linecap="round"/>
<path d="M286,326H340M540,325H640M300,336H352M572,335H664" stroke="${C.teal}" stroke-width="2.4" stroke-linecap="round"/>`;

  // far shore: a saw-edge of small pines
  let shore = `M${X0},374`;
  const teeth = [16, 26, 14, 30, 20, 34, 18, 24, 12, 28, 22, 16, 32, 20, 14, 26, 18, 30, 16, 22, 28, 14, 24, 34, 18, 26, 20, 30, 16, 24, 20, 28, 14, 22, 30, 18];
  let sx = X0;
  for (let i = 0; sx < 770; i++) {
    const t = teeth[i % teeth.length] * 0.72;
    const w = 10 + (i % 3) * 3;
    shore += `L${sx + w / 2},${f(374 - t)}L${sx + w},374`;
    sx += w;
  }
  shore += `V414H${X0}Z`;
  const ground = `
<path d="${shore}" fill="${C.navy}"/>
<path d="M${X0},408C220,392 470,388 760,376V${Y1}H${X0}Z" fill="${C.teal}"/>
<rect x="700" y="374" width="${X1 - 700}" height="${Y1 - 374}" fill="${C.teal}"/>`;

  // ---- the house, cropped by the right and top edges ----
  const LX = 936; // lamp
  const EAVE = 156;
  const DECK = 362;
  const WALL0 = 752;
  const sidingYs = [];
  for (let y = EAVE + 20; y < DECK; y += 15) sidingYs.push(y);
  const siding = sidingYs.map((y) => `M${WALL0},${y}H${X1}`).join('');
  const outer = `M${LX - 20},180H${LX + 20}L1108,${DECK}H766Z`;
  const inner = `M${LX - 12},184H${LX + 12}L1034,${DECK}H838Z`;
  const DX = LX - 43;
  const DW = 86;
  const DY = 222;
  const house = `
<clipPath id="outer"><path d="${outer}"/></clipPath>
<clipPath id="inner"><path d="${inner}"/></clipPath>
<path d="M806,112L962,${Y0}H${X1}V112Z" fill="${C.navy}"/>
<path d="M${[44, 60, 76, 92].map((y) => `${f(806 + ((112 - y) / 84) * 156 + 6)},${y}H${X1}`).join('M')}" stroke="${C.teal}" stroke-width="1.6"/>
<path d="M786,118L946,${Y0}H966L806,118Z" fill="${C.paper}"/>
<rect x="1046" y="40" width="80" height="62" fill="${C.teal}"/>
<path d="M1054,96L1080,44H1066L1054,70Z" fill="${C.mist}"/>
<path d="M1046,71H1126M1086,40V102" stroke="${C.paper}" stroke-width="3"/>
<rect x="1043" y="37" width="86" height="68" fill="none" stroke="${C.paper}" stroke-width="5"/>
<rect x="${WALL0}" y="${EAVE}" width="${X1 - WALL0}" height="${DECK - EAVE}" fill="${C.teal}"/>
<path d="${siding}" stroke="${C.navy}" stroke-width="1.6"/>
<path d="${outer}" fill="${C.orange}"/>
<g clip-path="url(#outer)"><path d="${siding}" stroke="${C.navy}" stroke-width="1.6"/></g>
<path d="${inner}" fill="${C.yellow}"/>
<g clip-path="url(#inner)"><path d="${siding}" stroke="${C.orange}" stroke-width="1.6"/></g>
<rect x="1138" y="226" width="88" height="100" fill="${C.navy}"/>
<path d="M1146,318L1174,234H1161L1146,280Z" fill="${C.teal}"/>
<path d="M1182,226V326M1138,276H1226" stroke="${C.paper}" stroke-width="3"/>
<rect x="1135" y="223" width="94" height="106" fill="none" stroke="${C.paper}" stroke-width="5"/>
<rect x="1128" y="329" width="108" height="7" fill="${C.paper}"/>
<rect x="${DX - 7}" y="${DY - 7}" width="${DW + 14}" height="${DECK - DY + 7}" fill="${C.navy}"/>
<rect x="${DX}" y="${DY}" width="${DW}" height="${DECK - DY}" fill="${C.paper}"/>
<rect x="${DX + 11}" y="${DY + 12}" width="27" height="48" fill="${C.yellow}"/><rect x="${DX + 48}" y="${DY + 12}" width="27" height="48" fill="${C.yellow}"/>
<rect x="${DX + 11}" y="${DY + 72}" width="27" height="56" fill="${C.yellow}"/><rect x="${DX + 48}" y="${DY + 72}" width="27" height="56" fill="${C.yellow}"/>
<circle cx="${DX + DW - 9}" cy="${DY + 68}" r="4" fill="${C.navy}"/>
<path d="M800,286L812,352M826,288L829,330M848,292L846,330M800,286Q826,280 850,292M812,332H852V352M806,318H856" stroke="${C.navy}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
<path d="M790,350Q826,366 868,348" stroke="${C.navy}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
<rect x="752" y="${EAVE}" width="9" height="${DECK - EAVE}" fill="${C.navy}"/><rect x="761" y="${EAVE}" width="8" height="${DECK - EAVE}" fill="${C.yellow}"/>
<rect x="1100" y="${EAVE}" width="8" height="${DECK - EAVE}" fill="${C.yellow}"/><rect x="1108" y="${EAVE}" width="9" height="${DECK - EAVE}" fill="${C.navy}"/>
<path d="M712,${EAVE}L768,108H${X1}V${EAVE}Z" fill="${C.navy}"/>
<path d="M740,132H${X1}M756,120H${X1}M726,144H${X1}" stroke="${C.teal}" stroke-width="1.6"/>
<path d="M712,${EAVE}L768,108H776L720,${EAVE}Z" fill="${C.mist}"/>
<rect x="768" y="106" width="${X1 - 768}" height="4" fill="${C.mist}"/>
<rect x="712" y="${EAVE}" width="${X1 - 712}" height="9" fill="${C.paper}"/>
<path d="M${LX},${EAVE + 9}V172" stroke="${C.navy}" stroke-width="3"/>
<path d="M${LX - 15},172H${LX + 15}L${LX + 20},181H${LX - 20}Z" fill="${C.navy}"/>
<path d="M${LX - 17},181H${LX + 17}L${LX + 12},206H${LX - 12}Z" fill="${C.paper}"/>
<path d="M${LX - 17},181L${LX - 12},206M${LX + 17},181L${LX + 12},206M${LX},181V206" stroke="${C.navy}" stroke-width="2.4"/>
<rect x="${LX - 14}" y="206" width="28" height="6" fill="${C.navy}"/>
<rect x="736" y="${DECK}" width="${X1 - 736}" height="12" fill="${C.navy}"/>
<rect x="766" y="${DECK}" width="342" height="5" fill="${C.orange}"/>
<rect x="838" y="${DECK}" width="196" height="5" fill="${C.yellow}"/>`;

  // steps and the lit ground
  const SY = DECK + 12;
  const steps = [0, 1, 2]
    .map((i) => {
      const w = 190 + i * 26;
      const y = SY + i * 17;
      return `<rect x="${LX - w / 2}" y="${y}" width="${w}" height="17" fill="${C.navy}"/><rect x="${LX - w / 2}" y="${y}" width="${w}" height="7" fill="${C.orange}"/><rect x="${LX - w / 2 + 34}" y="${y}" width="${w - 68}" height="7" fill="${C.yellow}"/>`;
    })
    .join('');
  const GY = SY + 51;
  const lit = `
<path d="M${LX - 121},${GY}H${LX + 121}L1150,${Y1}H500Z" fill="${C.orange}"/>
<path d="M${LX - 62},${GY}H${LX + 62}C${LX + 40},${GY + 26} 900,${GY + 40} 786,${Y1}H586C760,${GY + 44} 850,${GY + 30} ${LX - 62},${GY}Z" fill="${C.yellow}"/>
<path d="M880,${GY + 12}H960M836,${GY + 28}H930M760,${GY + 44}H870" stroke="${C.orange}" stroke-width="2.4" stroke-linecap="round"/>`;
  const mailbox = `
<rect x="556" y="428" width="7" height="50" fill="${C.navy}"/>
<path d="M540,480Q546,470 552,478Q558,466 564,478Q570,470 578,480Z" fill="${C.navy}"/>
<path d="M530,430V416Q530,404 544,404H584Q596,404 596,416V430Z" fill="${C.navy}"/>
<path d="M584,404Q596,404 596,416V430H582V416Q582,404 584,404Z" fill="${C.yellow}"/>
<path d="M552,404V388H566V395H556V404Z" fill="${C.orange}"/>`;

  // framing pines on the left, and two behind the house
  const trees = `
${pine(716, 196, 380, 34, 5, { hi: C.teal })}
${pine(676, 240, 380, 26, 4, { hi: C.teal })}
<path d="M${X0},${Y1}V436C110,424 230,434 330,${Y1}Z" fill="${C.navy}"/>
${pine(236, 150, 470, 76, 6, { hi: C.teal })}
${pine(112, 48, 486, 104, 7, { hi: C.teal })}`;

  const band = `
<rect x="${X0}" y="${B0}" width="${X1 - X0}" height="${B1 - B0}" fill="${C.navy}"/>
<text x="60" y="593" font-family="Block" font-size="112" letter-spacing="7" fill="${C.paper}">PORCHLIGHT</text>
<path d="M756,520V540M756,572V592" stroke="${C.mist}" stroke-width="3"/>
${star5(756, 556, 11, C.yellow)}
<text x="1218" y="548" text-anchor="end" font-family="FutB" font-size="30" letter-spacing="7" fill="${C.yellow}">LOOK AFTER</text>
<text x="1218" y="588" text-anchor="end" font-family="FutB" font-size="30" letter-spacing="7" fill="${C.paper}">YOUR OWN HOUSE.</text>`;

  return `
<rect width="1280" height="640" fill="${C.paper}"/>
<clipPath id="panel"><rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}"/></clipPath>
<g clip-path="url(#panel)">
${sky}
${moon}
${stars}
${far}
${lake}
${ground}
${house}
${lit}
${steps}
${mailbox}
${trees}
</g>
${band}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 33 WPA poster

A 1930s park poster, screen-printed in six flat inks: a moonlit valley in cool blues, framed by tall pines, and the one warm thing in it is the porch. The lamp throws a hard-edged cone down the wall, the door and the steps and out along the path to the mailbox. The caption band carries the name in tall block capitals. The mark is a house with the lamp at its peak and the light falling to the door.
Palette: paper #f2e6c9, navy #13273a, teal #25586a, mist #7fb0ac, orange #df6a2b, yellow #f7c545.
Type: Helvetica Neue Condensed Black for the name, as a stand-in for the hand-cut gothic of the period; Futura Bold capitals, widely tracked, for the tagline.
Tagline: Look after your own house.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'mark-dark.svg': markDarkSvg,
  'logo.svg': logo(false),
  'logo-dark.svg': logo(true),
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
