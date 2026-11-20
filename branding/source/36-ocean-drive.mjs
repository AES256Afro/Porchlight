// 36 Ocean Drive: tropical Deco at twilight. A pastel stucco front with a
// stepped tower, eyebrow ledges and a porthole, palms either side, the name in
// script on the roof against a violet sky, and a globe left glowing by the door.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '36-ocean-drive';
const C = {
  v0: '#2a1c56',
  v1: '#43287a',
  v2: '#6b3591',
  mag: '#a3458d',
  coral: '#ee8073',
  sea: '#1c5a78',
  plum: '#1b1440',
  lawn: '#292055',
  pink: '#eba6ac',
  shade: '#c9849c',
  lit1: '#f4bdb2',
  lit2: '#fad6c0',
  lit3: '#fff0d4',
  butter: '#f7e2a0',
  cream: '#fff7e8',
  aqua: '#6fd0c2',
  aquaDk: '#1f8f8a',
  glass: '#3a3069',
  flamingo: '#ff8ea3',
};
const FONTS = { Script: 'BrushScriptMT', FutB: 'Futura-Bold', FutM: 'Futura-Medium', DecoS: 'Phosphate-Solid' };
const f = (n) => Math.round(n * 10) / 10;

// ---- helpers ------------------------------------------------------------------------
function twinkle(cx, cy, s, fill) {
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + s * 0.16)},${f(cy - s * 0.16)} ${f(cx + s)},${cy}Q${f(cx + s * 0.16)},${f(cy + s * 0.16)} ${cx},${f(cy + s)}Q${f(cx - s * 0.16)},${f(cy + s * 0.16)} ${f(cx - s)},${cy}Q${f(cx - s * 0.16)},${f(cy - s * 0.16)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}
// one palm frond: a spine that arcs out and droops, with leaflets hanging from it
function frond(cx, cy, ang, len, droop, hang) {
  const a = (ang * Math.PI) / 180;
  const ex = cx + Math.cos(a) * len;
  const ey = cy + Math.sin(a) * len + droop;
  const qx = cx + Math.cos(a) * len * 0.55;
  const qy = cy + Math.sin(a) * len * 0.55 - len * 0.22;
  const n = 11;
  const pt = (t) => [(1 - t) ** 2 * cx + 2 * (1 - t) * t * qx + t * t * ex, (1 - t) ** 2 * cy + 2 * (1 - t) * t * qy + t * t * ey];
  let d = `M${f(cx)},${f(cy)}Q${f(qx)},${f(qy - 5)} ${f(ex)},${f(ey)}`;
  for (let i = n; i >= 1; i--) {
    const t = i / n;
    const [x, y] = pt(t - 0.5 / n);
    const [x2, y2] = pt(t - 1 / n);
    const h = hang * Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.8;
    const side = Math.cos(a) >= 0 ? 1 : -1;
    d += `L${f(x + side * h * 0.28)},${f(y + h)}L${f(x2)},${f(y2 + 2)}`;
  }
  return d + 'Z';
}
function palm(bx, by, cx, cy, { fill = C.plum, scale = 1 } = {}) {
  const mx = (bx + cx) / 2 + (cx > bx ? -1 : 1) * 26 * scale;
  const my = (by + cy) / 2;
  const w0 = 11 * scale;
  const w1 = 6 * scale;
  const trunk = `M${f(bx - w0)},${by}Q${f(mx - (w0 + w1) / 2)},${f(my)} ${f(cx - w1)},${f(cy)}H${f(cx + w1)}Q${f(mx + (w0 + w1) / 2)},${f(my)} ${f(bx + w0)},${by}Z`;
  const specs = [
    [-162, 132, 70, 30], [-136, 150, 34, 34], [-108, 142, 6, 30], [-80, 136, 0, 28], [-52, 148, 16, 32], [-22, 150, 52, 34], [8, 118, 84, 28], [172, 104, 96, 26],
  ];
  const fr = specs.map(([a, l, dr, h]) => frond(cx, cy, a, l * scale, dr * scale, h * scale)).join('');
  return `<path d="${trunk}" fill="${fill}"/><path d="${fr}" fill="${fill}"/><circle cx="${f(cx - 7 * scale)}" cy="${f(cy + 9 * scale)}" r="${f(6 * scale)}" fill="${fill}"/><circle cx="${f(cx + 8 * scale)}" cy="${f(cy + 10 * scale)}" r="${f(6 * scale)}" fill="${fill}"/>`;
}

// ---- mark: the stepped tower, its porthole a lit globe ---------------------------------
function markBody() {
  const tower = 'M52,188V72H64V56H76V42H124V56H136V72H148V188Z';
  return `
<clipPath id="tw"><path d="${tower}"/></clipPath>
<path d="M96,42V16H104V42Z" fill="${C.aquaDk}"/>
<rect x="87" y="31" width="26" height="5" rx="2.5" fill="${C.aquaDk}"/><rect x="91" y="22" width="18" height="4.5" rx="2.2" fill="${C.aquaDk}"/>
<circle cx="100" cy="12" r="5" fill="${C.butter}"/>
<path d="${tower}" fill="${C.pink}"/>
<g clip-path="url(#tw)">
  <rect x="100" y="30" width="60" height="170" fill="${C.shade}"/>
  <circle cx="100" cy="108" r="44" fill="${C.lit1}"/>
  <circle cx="100" cy="108" r="33" fill="${C.lit2}"/>
</g>
<path d="M52,72H148M64,56H136" stroke="${C.aquaDk}" stroke-width="4"/>
<circle cx="100" cy="108" r="22" fill="${C.lit3}" stroke="${C.aquaDk}" stroke-width="6"/>
<circle cx="100" cy="108" r="10" fill="${C.cream}"/>
<rect x="68" y="144" width="64" height="7" rx="3.5" fill="${C.butter}"/>
<rect x="84" y="155" width="32" height="33" fill="${C.aquaDk}"/>
<circle cx="100" cy="167" r="5" fill="${C.butter}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid ---------------------------------------------------------
const PIX = { P: C.pink, S: C.shade, A: C.aquaDk, B: C.butter, W: C.cream, L: C.lit2 };
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
  '.......BB.......',
  '.......AA.......',
  '......AAAA......',
  '.....PPPSSS.....',
  '....PPPPSSSS....',
  '...AAAAAAAAAA...',
  '...PPPLLLLSSS...',
  '...PPLAAAALSS...',
  '...PPLABBALSS...',
  '...PPLABBALSS...',
  '...PPLAAAALSS...',
  '...PPPLLLLSSS...',
  '...PBBBBBBBBS...',
  '...PPPAAAASSS...',
  '...PPPABBASSS...',
  '...PPPAAAASSS...',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const span = (y) => (y >= 12 ? [7, 24] : y >= 9 ? [9, 22] : y >= 6 ? [11, 20] : null);
  for (let y = 6; y < 32; y++) {
    const [a, b] = span(y);
    for (let x = a; x <= b; x++) g[y][x] = x >= 16 ? 'S' : 'P';
  }
  // needle
  for (let y = 2; y <= 5; y++) g[y][15] = g[y][16] = 'A';
  [13, 14, 15, 16, 17, 18].forEach((x) => (g[4][x] = 'A'));
  g[0][15] = g[0][16] = g[1][15] = g[1][16] = 'B';
  // trims
  for (let x = 7; x <= 24; x++) g[12][x] = 'A';
  for (let x = 9; x <= 22; x++) g[9][x] = 'A';
  // globe: glow, ring, light
  for (let y = 13; y <= 24; y++)
    for (let x = 8; x <= 23; x++) {
      const d = Math.hypot(x - 15.5, y - 18.5);
      if (d <= 6.2) g[y][x] = 'L';
      if (d <= 4.9) g[y][x] = 'A';
      if (d <= 3.6) g[y][x] = 'B';
      if (d <= 1.9) g[y][x] = 'W';
    }
  // canopy and door
  for (let x = 9; x <= 22; x++) g[25][x] = 'B';
  for (let y = 27; y <= 31; y++) for (let x = 13; x <= 18; x++) g[y][x] = 'A';
  g[28][15] = g[28][16] = g[29][15] = g[29][16] = 'B';
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon ---------------------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="${C.v0}"/>
  <rect y="120" width="512" height="392" fill="${C.v1}"/>
  <rect y="230" width="512" height="282" fill="${C.v2}"/>
  <rect y="330" width="512" height="182" fill="${C.mag}"/>
  <rect y="420" width="512" height="92" fill="${C.coral}"/>
  <path d="M0,214H120Q134,214 134,222T120,230H0ZM512,316H400Q386,316 386,323T400,330H512Z" fill="${C.v2}"/>
  ${twinkle(92, 86, 14, C.cream)}${twinkle(424, 70, 10, C.cream)}${twinkle(446, 180, 7, C.butter)}${twinkle(62, 170, 6, C.butter)}
  ${palm(30, 540, 60, 300, { scale: 0.95 })}
  ${palm(490, 540, 452, 330, { scale: 0.85 })}
  <g transform="translate(256 264) scale(2.62) translate(-100 -100)">${markBody()}</g>
</g>`,
});

// ---- logo -----------------------------------------------------------------------------------
const logo = (dark) =>
  svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    body: `
${nest({ x: 4, y: 6, w: 188, h: 188, vb: '0 0 200 200', body: markBody() })}
<text x="178" y="126" font-family="Script" font-size="118" fill="${dark ? C.aquaDk : C.pink}" transform="translate(3.5 3.5)">Porchlight</text>
<text x="178" y="126" font-family="Script" font-size="118" fill="${dark ? C.cream : C.v0}">Porchlight</text>
<path d="M196,146H574" stroke="${dark ? C.aqua : C.aquaDk}" stroke-width="3.5" stroke-linecap="round"/>
<text x="198" y="174" font-family="FutM" font-size="15.5" letter-spacing="6.6" fill="${dark ? C.pink : C.v1}">LEAVE THE LIGHT ON.</text>`,
  });

// ---- hero -------------------------------------------------------------------------------------
function hero() {
  const r = rng(36);
  const G = 556; // ground

  const sky = `
<rect width="1280" height="640" fill="${C.v0}"/>
<rect y="132" width="1280" height="508" fill="${C.v1}"/>
<rect y="236" width="1280" height="404" fill="${C.v2}"/>
<rect y="330" width="1280" height="310" fill="${C.mag}"/>
<rect y="412" width="1280" height="228" fill="${C.coral}"/>
<path d="M60,116H360Q374,116 374,124T360,132H60Q46,132 46,124T60,116ZM900,222H1280V236H900Q888,236 888,229T900,222ZM0,214H150Q162,214 162,221T150,228H0Z" fill="${C.v1}"/>
<path d="M420,318H700Q712,318 712,324T700,330H420Q408,330 408,324T420,318ZM1040,308H1280V320H1040Q1030,320 1030,314T1040,308ZM0,316H210Q222,316 222,323T210,330H0Z" fill="${C.mag}"/>
<path d="M0,398H170Q182,398 182,405T170,412H0ZM1090,396H1280V408H1090Q1080,408 1080,402T1090,396Z" fill="${C.coral}"/>`;
  let stars = [[84, 62, 8], [470, 66, 6], [612, 108, 5], [790, 52, 8], [956, 118, 5], [1232, 56, 6], [1010, 46, 4], [236, 170, 4], [706, 176, 4]]
    .map(([x, y, s]) => twinkle(x, y, s, C.cream))
    .join('');
  for (let i = 0; i < 26; i++) stars += `<circle cx="${f(r() * 1280)}" cy="${f(r() * 220)}" r="${f(0.8 + r())}" fill="${C.cream}" opacity="${f(0.4 + r() * 0.4)}"/>`;
  const moon = `<path d="M1150,62A30,30 0 1 0 1176,112A24,24 0 1 1 1150,62Z" fill="${C.cream}"/>`;
  const sea = `
<rect y="476" width="1280" height="${G - 476}" fill="${C.sea}"/>
<path d="M0,484H120M40,494H200M1100,484H1280M1150,494H1250M0,506H90M1180,508H1280" stroke="${C.coral}" stroke-width="2.4" stroke-linecap="round"/>
<rect y="${G - 10}" width="1280" height="10" fill="${C.shade}"/>
<rect y="${G - 12}" width="1280" height="3" fill="${C.butter}"/>`;

  // ---- the wing ----
  const WX0 = 402;
  const WX1 = 1064;
  const WY = 334;
  const win = (x, y, w, h) => `
<rect x="${x - 14}" y="${y - 5}" width="${w + 28}" height="8" fill="${C.shade}"/>
<rect x="${x - 16}" y="${y - 15}" width="${w + 32}" height="10" rx="5" fill="${C.butter}"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.glass}"/>
<path d="M${x + w * 0.5},${y}H${x + w * 0.78}L${x + w * 0.36},${y + h}H${x + w * 0.08}Z" fill="${C.v2}"/>
<path d="M${x},${f(y + h / 3)}H${x + w}M${x},${f(y + (2 * h) / 3)}H${x + w}M${f(x + w / 2)},${y}V${y + h}" stroke="${C.cream}" stroke-width="2.4"/>
<rect x="${x - 1.5}" y="${y - 1.5}" width="${w + 3}" height="${h + 3}" fill="none" stroke="${C.cream}" stroke-width="3"/>`;
  let wins = '';
  const wx = [446, 600, 754, 908];
  wx.forEach((x) => (wins += win(x, 392, 104, 54) + win(x, 478, 104, 54)));
  let hedge = `M${WX0 + 14},${G}`;
  for (let x = WX0 + 14; x < WX1 - 20; x += 38) hedge += `V${G - 12}Q${x},${G - 26} ${x + 19},${G - 26}T${x + 38},${G - 12}`;
  hedge += `V${G}Z`;
  const wing = `
<rect x="${WX0}" y="${WY}" width="${WX1 - WX0}" height="${G - WY}" fill="${C.pink}"/>
<rect x="${WX0}" y="${WY}" width="${WX1 - WX0}" height="7" fill="${C.cream}"/>
<path d="M${WX0},${WY + 17}H${WX1}M${WX0},${WY + 26}H${WX1}M${WX0},${WY + 35}H${WX1}" stroke="${C.aqua}" stroke-width="4"/>
<rect x="${WX1 - 26}" y="${WY}" width="26" height="${G - WY}" fill="${C.butter}"/>
<path d="M${WX1 - 19},${WY + 8}V${G}M${WX1 - 13},${WY + 8}V${G}M${WX1 - 7},${WY + 8}V${G}" stroke="${C.shade}" stroke-width="1.8"/>
<rect x="${WX0}" y="${WY}" width="16" height="${G - WY}" fill="${C.shade}"/>
${wins}
<path d="${hedge}" fill="${C.plum}"/>`;

  // ---- the tower ----
  const TX0 = 262;
  const TX1 = 402;
  const TC = (TX0 + TX1) / 2;
  const TY = 204;
  const towerShape = `M${TX0},${G}V${TY}H${TX0 + 16}V${TY - 18}H${TX0 + 32}V${TY - 36}H${TX1 - 32}V${TY - 18}H${TX1 - 16}V${TY}H${TX1}V${G}Z`;
  const GX = TC; // the globe, hung under the canopy
  const GY = 416;
  const DX = TC - 33;
  const DW = 66;
  const DY = 442;
  const DB = G - 14;
  const tower = `
<clipPath id="bldg"><rect x="${TX0}" y="400" width="${TX1 - TX0}" height="${G - 400}"/></clipPath>
<path d="M${TC - 4},${TY - 36}V92H${TC + 4}V${TY - 36}Z" fill="${C.aquaDk}"/>
<rect x="${TC - 22}" y="150" width="44" height="7" rx="3.5" fill="${C.aqua}"/><rect x="${TC - 16}" y="134" width="32" height="6" rx="3" fill="${C.aqua}"/><rect x="${TC - 10}" y="119" width="20" height="5" rx="2.5" fill="${C.aqua}"/>
<circle cx="${TC}" cy="88" r="7" fill="${C.butter}"/>
<path d="${towerShape}" fill="${C.pink}"/>
<path d="M${TX0},${TY}H${TX1}M${TX0 + 16},${TY - 18}H${TX1 - 16}M${TX0 + 32},${TY - 36}H${TX1 - 32}" stroke="${C.cream}" stroke-width="6"/>
<rect x="${TX0 + 8}" y="${TY + 12}" width="22" height="${G - TY - 12}" fill="${C.butter}"/><rect x="${TX1 - 30}" y="${TY + 12}" width="22" height="${G - TY - 12}" fill="${C.butter}"/>
<path d="M${TX0 + 14},${TY + 12}V${G}M${TX0 + 19},${TY + 12}V${G}M${TX0 + 24},${TY + 12}V${G}M${TX1 - 24},${TY + 12}V${G}M${TX1 - 19},${TY + 12}V${G}M${TX1 - 14},${TY + 12}V${G}" stroke="${C.shade}" stroke-width="1.8"/>
<path d="M${TC - 12},${TY - 26}V${TY + 60}M${TC},${TY - 26}V${TY + 60}M${TC + 12},${TY - 26}V${TY + 60}" stroke="${C.aqua}" stroke-width="5"/>
<circle cx="${TC}" cy="316" r="33" fill="${C.cream}"/>
<circle cx="${TC}" cy="316" r="25" fill="${C.glass}"/>
<path d="M${TC - 25},316H${TC + 25}M${TC},291V341" stroke="${C.cream}" stroke-width="3"/>
<path d="M${TC - 16},330A22,22 0 0 1 ${TC - 4},296" fill="none" stroke="${C.v2}" stroke-width="5" stroke-linecap="round"/>
<rect x="${TX0 + 8}" y="352" width="22" height="${G - 352}" fill="${C.butter}"/><rect x="${TX1 - 30}" y="352" width="22" height="${G - 352}" fill="${C.butter}"/>
<path d="M${TX0 + 14},352V${G}M${TX0 + 19},352V${G}M${TX0 + 24},352V${G}M${TX1 - 24},352V${G}M${TX1 - 19},352V${G}M${TX1 - 14},352V${G}" stroke="${C.shade}" stroke-width="1.8"/>
<path d="M${TC - 12},${356}V${380}M${TC},${356}V${380}M${TC + 12},${356}V${380}" stroke="${C.aqua}" stroke-width="5"/>
<g clip-path="url(#bldg)">
  <circle cx="${GX}" cy="${GY - 6}" r="118" fill="${C.lit1}"/>
  <circle cx="${GX}" cy="${GY - 6}" r="84" fill="${C.lit2}"/>
  <circle cx="${GX}" cy="${GY - 6}" r="50" fill="${C.lit3}"/>
  <path d="M${TX0 + 8},401V${G}M${TX0 + 14},401V${G}M${TX0 + 19},401V${G}M${TX0 + 24},401V${G}M${TX0 + 30},401V${G}M${TX1 - 30},401V${G}M${TX1 - 24},401V${G}M${TX1 - 19},401V${G}M${TX1 - 14},401V${G}M${TX1 - 8},401V${G}" stroke="${C.butter}" stroke-width="1.8"/>
</g>
<rect x="${TX0 - 20}" y="396" width="${TX1 - TX0 + 40}" height="5" fill="${C.shade}"/>
<rect x="${TX0 - 24}" y="384" width="${TX1 - TX0 + 48}" height="12" rx="6" fill="${C.butter}"/>
<path d="M${TX0 - 12},390H${TX1 + 12}" stroke="${C.aqua}" stroke-width="3"/>
<path d="M${DX - 12},${DB}V${DY - 4}H${DX - 6}V${DY - 10}H${DX + DW + 6}V${DY - 4}H${DX + DW + 12}V${DB}Z" fill="${C.cream}"/>
<rect x="${DX}" y="${DY}" width="${DW}" height="${DB - DY}" fill="${C.aquaDk}"/>
<circle cx="${DX + DW / 2}" cy="${DY + 30}" r="15" fill="${C.lit3}" stroke="${C.cream}" stroke-width="3.5"/>
<path d="M${DX + 10},${DY + 60}H${DX + DW - 10}M${DX + 10},${DY + 70}H${DX + DW - 10}M${DX + 10},${DY + 80}H${DX + DW - 10}" stroke="${C.aqua}" stroke-width="3"/>
<circle cx="${DX + DW - 9}" cy="${DY + 52}" r="3.4" fill="${C.butter}"/>
<rect x="${GX - 2}" y="396" width="4" height="7" fill="${C.aquaDk}"/>
<rect x="${GX - 7}" y="401" width="14" height="4" rx="2" fill="${C.aquaDk}"/>
<circle cx="${GX}" cy="${GY}" r="12.5" fill="${C.cream}" stroke="${C.butter}" stroke-width="3"/>

<rect x="${DX - 18}" y="${DB}" width="${DW + 36}" height="7" fill="${C.cream}"/><rect x="${DX - 30}" y="${DB + 7}" width="${DW + 60}" height="7" fill="${C.butter}"/>`;

  // ---- the roof sign ----
  const RY = WY - 32; // rail
  const sign = `
<path d="M470,${RY}V${WY}M560,${RY}V${WY}M650,${RY}V${WY}M740,${RY}V${WY}M830,${RY}V${WY}M920,${RY}V${WY}M1010,${RY}V${WY}M470,${WY}L560,${RY}L650,${WY}L740,${RY}L830,${WY}L920,${RY}L1010,${WY}" stroke="${C.plum}" stroke-width="3" fill="none"/>
<rect x="452" y="${RY - 6}" width="576" height="7" rx="3.5" fill="${C.aqua}"/>
<text x="740" y="${RY - 8}" text-anchor="middle" font-family="Script" font-size="170" fill="${C.aquaDk}" transform="translate(4 4)">Porchlight</text>
<text x="740" y="${RY - 8}" text-anchor="middle" font-family="Script" font-size="170" fill="${C.cream}">Porchlight</text>`;

  // ---- forecourt ----
  const court = `
<rect y="${G}" width="1280" height="${640 - G}" fill="${C.lawn}"/>
<path d="M${DX - 30},${G}H${DX + DW + 30}L560,640H120Z" fill="#6a4a84"/>
<path d="M${DX - 18},${G}H${DX + DW + 18}L470,640H200Z" fill="#b97f9c"/>
<path d="M${DX - 4},${G}H${DX + DW + 4}L396,640H264Z" fill="${C.lit1}"/>
<path d="M0,616H1280" stroke="${C.plum}" stroke-width="2"/>`;
  const flamingo = `
<g transform="translate(492 540) scale(1.15)">
  <path d="M1,60V32M9,60L8,44L13,36" stroke="${C.flamingo}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M-16,24C-15,12 -2,8 9,11C19,14 23,21 19,28C13,36 -4,36 -10,31C-13,29 -16,28 -16,24Z" fill="${C.flamingo}"/>
  <path d="M14,16C22,8 20,-6 12,-14C6,-20 -3,-17 -3,-10" fill="none" stroke="${C.flamingo}" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M-5,-13L-14,-4L-3,-6Z" fill="${C.butter}"/>
  <path d="M-10,-8L-14,-4L-8.500,-5Z" fill="${C.plum}"/>
</g>`;

  return `
${sky}
${stars}
${moon}
${sea}
${palm(1196, G, 1166, 236, { scale: 1.02 })}
${wing}
${sign}
${tower}
${court}
${flamingo}
${palm(148, 600, 118, 214, { scale: 1.12 })}
<text x="1226" y="596" text-anchor="end" font-family="FutM" font-size="25" letter-spacing="8.5" fill="${C.cream}">LEAVE THE LIGHT ON.</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 36 Ocean Drive

Tropical Deco at twilight: a pastel pink stucco front with a stepped tower and needle, butter eyebrow ledges over every window, a porthole, fluted pilasters and aqua racing stripes, palms either side and a lawn flamingo. The name stands on the roof as a script sign against a violet sky, and a globe is left glowing over the aqua door, its light laid on the wall in stepped rings. The mark is the tower with its porthole lit.
Palette: sky #2a1c56 / #43287a / #6b3591 / #a3458d, coral #ee8073, stucco pink #eba6ac / #c9849c, butter #f7e2a0, cream #fff7e8, aqua #6fd0c2 / #1f8f8a, plum #1b1440.
Type: Brush Script for the name, Futura Medium capitals, widely tracked, for the tagline.
Tagline: Leave the light on.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logo(false),
  'logo-dark.svg': logo(true),
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
