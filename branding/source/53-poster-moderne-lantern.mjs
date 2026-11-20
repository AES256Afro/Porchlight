// 53 Poster moderne (lantern): concept 35 with a new mark. The poster is kept: the
// monumental lantern, one hard-edged beam, PORCH in the dark and LIGHT in the light.
// The mark is now the lantern itself on its bracket, throwing the beam in hard planes.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '53-poster-moderne-lantern';
const C = {
  black: '#0c0e12',
  night: '#1f2f42',
  steel: '#3f6080',
  steelLt: '#8aa7c0',
  cream: '#f5ebd3',
  white: '#fffaf0',
  ochre: '#dca63f',
  ochreDk: '#ac742a',
  verm: '#d8412a',
  vermDk: '#8f2618',
};
const FONTS = { Block: 'Futura-CondensedExtraBold', FutB: 'Futura-Bold', FutM: 'Futura-Medium' };
const f = (n) => Math.round(n * 10) / 10;

// ---- the lantern, drawn once at hero size and reused -----------------------------
// Origin: the top of the cap. Height about 240, half-width 82.
function lantern(ox, oy, s = 1, id = 'l') {
  const p = (x, y) => `${f(ox + x * s)},${f(oy + y * s)}`;
  const defs = `
<linearGradient id="${id}capL" gradientUnits="userSpaceOnUse" x1="${f(ox - 74 * s)}" y1="0" x2="${f(ox)}" y2="0"><stop offset="0" stop-color="${C.steelLt}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
<linearGradient id="${id}capR" gradientUnits="userSpaceOnUse" x1="${f(ox)}" y1="0" x2="${f(ox + 74 * s)}" y2="0"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="#2c445c"/></linearGradient>
<linearGradient id="${id}gL" gradientUnits="userSpaceOnUse" x1="${f(ox - 68 * s)}" y1="0" x2="${f(ox - 14 * s)}" y2="0"><stop offset="0" stop-color="${C.ochreDk}"/><stop offset="1" stop-color="${C.ochre}"/></linearGradient>
<linearGradient id="${id}gR" gradientUnits="userSpaceOnUse" x1="${f(ox + 14 * s)}" y1="0" x2="${f(ox + 68 * s)}" y2="0"><stop offset="0" stop-color="${C.cream}"/><stop offset="1" stop-color="${C.ochre}"/></linearGradient>
<linearGradient id="${id}gC" gradientUnits="userSpaceOnUse" x1="0" y1="${f(oy + 70 * s)}" x2="0" y2="${f(oy + 180 * s)}"><stop offset="0" stop-color="${C.white}"/><stop offset="1" stop-color="${C.cream}"/></linearGradient>`;
  const body = `
<path d="M${p(0, 0)}L${p(-74, 58)}H${f(ox)}Z" fill="url(#${id}capL)"/>
<path d="M${p(0, 0)}L${p(74, 58)}H${f(ox)}Z" fill="url(#${id}capR)"/>
<path d="M${p(-82, 58)}H${f(ox + 82 * s)}L${p(78, 70)}H${f(ox - 78 * s)}Z" fill="${C.verm}"/>
<path d="M${p(0, 58)}H${f(ox + 82 * s)}L${p(78, 70)}H${f(ox)}Z" fill="${C.vermDk}"/>
<path d="M${p(-68, 70)}H${f(ox - 22 * s)}L${p(-12, 180)}H${f(ox - 38 * s)}Z" fill="url(#${id}gL)"/>
<path d="M${p(-22, 70)}H${f(ox + 22 * s)}L${p(12, 180)}H${f(ox - 12 * s)}Z" fill="url(#${id}gC)"/>
<path d="M${p(22, 70)}H${f(ox + 68 * s)}L${p(38, 180)}H${f(ox + 12 * s)}Z" fill="url(#${id}gR)"/>
<path d="M${p(-22, 70)}L${p(-12, 180)}M${p(22, 70)}L${p(12, 180)}M${p(-68, 70)}L${p(-38, 180)}M${p(68, 70)}L${p(38, 180)}" stroke="${C.black}" stroke-width="${f(3.4 * s)}" stroke-linecap="square"/>
<path d="M${p(-44, 180)}H${f(ox + 44 * s)}L${p(36, 193)}H${f(ox - 36 * s)}Z" fill="${C.black}"/>
<path d="M${p(-18, 193)}H${f(ox)}V${f(oy + 222 * s)}Z" fill="${C.steel}"/>
<path d="M${p(0, 193)}H${f(ox + 18 * s)}L${p(0, 222)}Z" fill="${C.black}"/>
<circle cx="${f(ox)}" cy="${f(oy + 229 * s)}" r="${f(7.5 * s)}" fill="${C.verm}"/>`;
  return { defs, body };
}

// ---- mark: the lantern on its wall bracket, the beam leaving it in hard planes -------
// Drawn in a 200 box. A black disc so it reads on any page; no door.
function markBody(id = 'm') {
  const lamp = lantern(84, 40, 0.62, id);
  return `
<defs><clipPath id="${id}disc"><circle cx="100" cy="100" r="90"/></clipPath>${lamp.defs}</defs>
<circle cx="100" cy="100" r="92" fill="${C.black}"/>
<g clip-path="url(#${id}disc)">
  <path d="M124,84L210,104V210H132L61,152Z" fill="${C.ochre}"/>
  <path d="M124,84L210,132V210H176L78,152Z" fill="${C.cream}"/>
  <path d="M112,112L210,168V210L92,152Z" fill="${C.white}"/>
  <rect x="0" y="22" width="92" height="11" fill="${C.steel}"/>
  <rect x="0" y="22" width="92" height="3" fill="${C.steelLt}"/>
  <rect x="79" y="31" width="10" height="12" fill="${C.steel}"/>
</g>
<circle cx="100" cy="100" r="92" fill="none" stroke="${C.cream}" stroke-width="3.5"/>
${lamp.body}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid ----------------------------------------------------
const PIX = { K: '#24384f', D: C.black, O: C.ochre, C: C.cream, W: C.white, V: C.verm, S: C.steelLt, T: C.steel };
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
const put = (g, rows, x0, y0) => rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && (g[y0 + j][x0 + i] = ch)));
function fav16Rows() {
  const g = Array.from({ length: 16 }, () => Array(16).fill('.'));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 > 8.1 ** 2) continue;
      const upper = x >= 9 && y >= 5 + (x - 9) * 0.5;
      const lower = x >= 6 + (y - 10) * 0.9;
      const core = y >= 7 + (x - 9) * 0.9;
      g[y][x] = upper && lower ? (core ? 'C' : 'O') : 'K';
    }
  put(g, ['...SS...', '..SSSS..', '.SSSSSS.', 'VVVVVVVV', '.OWWWCC.', '.OWWWCC.', '.OWWWCC.', '..OWWC..', '..OWWC..', '..DDDD..', '...VV...'], 2, 1);
  return g.map((r) => r.join(''));
}
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const inDisc = (x, y) => (x - 15.5) ** 2 + (y - 15.5) ** 2 <= 15.6 ** 2;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      if (!inDisc(x, y)) continue;
      const upper = x >= 18 && y >= 11 + (x - 18) * 0.4;
      const lower = x >= 11 + (y - 21) * 0.95;
      const core = y >= 15 + (x - 18) * 0.8 && x >= 14 + (y - 21) * 1.5;
      g[y][x] = upper && lower ? (core ? 'C' : 'O') : 'K';
    }
  for (let x = 0; x <= 12; x++) for (let y = 3; y <= 4; y++) if (inDisc(x, y)) g[y][x] = 'T';
  put(g, [
    '......SS......', '.....SSSS.....', '....SSSSSS....', '...SSSSSSSS...', '..SSSSSSSSSS..', '.SSSSSSSSSSSS.',
    'VVVVVVVVVVVVVV', 'VVVVVVVVVVVVVV',
    '.OOWWWWWWCCCC.', '.OOWWWWWWCCCC.', '.OOWWWWWWCCCC.', '..OOWWWWWCCC..', '..OOWWWWWCCC..', '..OOWWWWWCCC..', '...OOWWWWCC...', '...OOWWWWCC...', '...OOWWWWCC...',
    '...DDDDDDDD...', '....DDDDDD....', '......VV......', '......VV......',
  ], 5, 5);
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(fav16Rows()) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon: the lantern fills the tile, its beam leaving in three planes ------------------
const iconLamp = lantern(206, 84, 1.45, 'i');
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>
<linearGradient id="isky" gradientUnits="userSpaceOnUse" x1="330" y1="200" x2="430" y2="-40"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.steel}"/></linearGradient>
<linearGradient id="idark" gradientUnits="userSpaceOnUse" x1="210" y1="400" x2="20" y2="540"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
${iconLamp.defs}`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="url(#isky)"/>
  <path d="M0,60H206V180L150,345L290,512H0Z" fill="url(#idark)"/>
  <path d="M302,186L512,236V512H290L150,345Z" fill="${C.ochre}"/>
  <path d="M302,186L512,300V512H386L186,345Z" fill="${C.cream}"/>
  <path d="M276,250L512,390V512H470L222,345Z" fill="${C.white}"/>
  <path d="M0,150V186L150,66H112Z" fill="${C.black}"/>
  <path d="M0,150L112,66H121L0,159Z" fill="${C.steel}"/>
  <rect x="0" y="44" width="216" height="24" fill="${C.black}"/>
  <rect x="0" y="44" width="216" height="6" fill="${C.steelLt}"/>
  <rect x="198" y="66" width="16" height="22" fill="${C.black}"/>
  ${iconLamp.body}
</g>`,
});

// ---- logo --------------------------------------------------------------------------------
const logo = (dark) =>
  svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    defs: `<clipPath id="lit"><path d="M392.3,40H640V200H443.7Z"/></clipPath><clipPath id="unlit"><path d="M190,40H392.3L443.7,200H190Z"/></clipPath>`,
    body: `
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 0 200 200', body: markBody('lg') })}
<g font-family="Block" font-size="70" letter-spacing="2.3">
  <text x="206" y="120" fill="${dark ? C.cream : C.black}" clip-path="url(#unlit)">PORCHLIGHT</text>
  <text x="206" y="120" fill="${dark ? C.ochre : C.verm}" clip-path="url(#lit)">PORCHLIGHT</text>
</g>
<text x="207" y="156" font-family="FutM" font-size="12.5" letter-spacing="2.6" fill="${dark ? C.cream : C.black}">SEE WHAT YOU&#8217;VE LEFT OUT IN THE OPEN.</text>`,
  });

// ---- hero --------------------------------------------------------------------------------
function hero() {
  const LX = 430; // lantern axis
  const LY = 70; // top of its cap
  const lamp = lantern(LX, LY, 1, 'h');
  // the beam: from the glass, upper edge to the right margin, lower edge down through the name
  const U0 = [LX + 66, LY + 72];
  const U1 = [1280, 262];
  const L0 = [LX - 38, LY + 180];
  const slope = 1.089;
  const L1 = [L0[0] + (640 - L0[1]) / slope, 640];
  const beam = `M${U0}L${U1}V640H${f(L1[0])}L${L0}Z`;
  const HZ = 410; // horizon
  const hx = L0[0] + (HZ - L0[1]) / slope; // where the horizon meets the beam's edge
  const defs = `
<linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="900" y1="203" x2="943" y2="-75"><stop offset="0" stop-color="${C.black}"/><stop offset="0.3" stop-color="#15202d"/><stop offset="1" stop-color="${C.steel}"/></linearGradient>
<linearGradient id="dark" gradientUnits="userSpaceOnUse" x1="571" y1="445" x2="250" y2="740"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
<linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="${LX}" y1="${LY + 120}" x2="1280" y2="470"><stop offset="0" stop-color="${C.white}"/><stop offset="0.28" stop-color="${C.cream}"/><stop offset="0.78" stop-color="${C.ochre}"/><stop offset="1" stop-color="#c98f33"/></linearGradient>
<linearGradient id="ground" gradientUnits="userSpaceOnUse" x1="0" y1="${HZ}" x2="0" y2="640"><stop offset="0" stop-color="#e3b352"/><stop offset="1" stop-color="${C.ochreDk}"/></linearGradient>
<linearGradient id="post" gradientUnits="userSpaceOnUse" x1="78" y1="0" x2="132" y2="0"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.steel}"/></linearGradient>
<clipPath id="inbeam"><path d="${beam}"/></clipPath>
<clipPath id="outbeam"><path clip-rule="evenodd" d="M0,0H1280V640H0Z${beam}"/></clipPath>
<clipPath id="frame"><rect x="21" y="21" width="1238" height="598"/></clipPath>
${lamp.defs}`;

  const rays = [[1280, 330], [1280, 410], [1280, 520], [1130, 640], [930, 640]]
    .map(([x, y]) => `M${LX + 10},${LY + 125}L${x},${y}`)
    .join('');

  // the door, standing in the beam, and the shadow it throws
  const DX = 1010;
  const DW = 50;
  const DH = 98;
  const door = `
<path d="M${DX - 6},${HZ}H${DX + DW + 6}L1300,${HZ + 6}V${HZ + 27}Z" fill="${C.black}"/>
<rect x="${DX - 7}" y="${HZ - DH - 7}" width="${DW + 14}" height="${DH + 7}" fill="${C.black}"/>
<rect x="${DX}" y="${HZ - DH}" width="${DW}" height="${DH}" fill="${C.verm}"/>
<path d="M${DX},${HZ - DH}H${DX + 17}V${HZ}H${DX}Z" fill="${C.vermDk}"/>
<rect x="${DX + 23}" y="${HZ - DH + 10}" width="19" height="30" fill="none" stroke="${C.vermDk}" stroke-width="2.4"/>
<rect x="${DX + 23}" y="${HZ - DH + 50}" width="19" height="38" fill="none" stroke="${C.vermDk}" stroke-width="2.4"/>
<circle cx="${DX + DW - 7}" cy="${HZ - DH + 54}" r="2.8" fill="${C.cream}"/>
<rect x="${DX - 14}" y="${HZ - 5}" width="${DW + 28}" height="5" fill="${C.black}"/>`;

  // the name: cream in the dark, black where the beam passes over it
  const name = `
<g font-family="Block" font-size="196" letter-spacing="6" text-anchor="middle">
  <text x="643" y="594" fill="${C.cream}" clip-path="url(#outbeam)">PORCHLIGHT</text>
  <text x="643" y="594" fill="${C.black}" clip-path="url(#inbeam)">PORCHLIGHT</text>
</g>`;

  const arm = `
<rect x="78" y="21" width="54" height="${HZ - 21}" fill="url(#post)"/>
<rect x="128" y="60" width="4" height="${HZ - 60}" fill="${C.steelLt}"/>
<path d="M66,${HZ}V${HZ - 12}H144V${HZ}Z" fill="${C.black}"/>
<rect x="66" y="${HZ - 14}" width="78" height="3" fill="${C.steel}"/>
<path d="M132,188V216L334,60H302Z" fill="${C.black}"/>
<path d="M132,188L302,60H309L132,194Z" fill="${C.steel}"/>
<rect x="21" y="44" width="${LX + 12 - 21}" height="16" fill="${C.black}"/>
<rect x="21" y="44" width="${LX + 12 - 21}" height="3.5" fill="${C.steelLt}"/>
<rect x="${LX - 5}" y="58" width="10" height="${LY - 54}" fill="${C.black}"/>`;

  return {
    defs,
    body: `
<rect width="1280" height="640" fill="${C.black}"/>
<g clip-path="url(#frame)">
<path d="M0,0H1280V${U1[1]}L${U0}L${LX + 6},52H0Z" fill="url(#sky)"/>
<path d="M0,52H${LX + 6}L${L0}L${f(L1[0])},640H0Z" fill="url(#dark)"/>
<path d="M21,${HZ}H${f(hx)}" stroke="${C.steel}" stroke-width="2"/>
<path d="${beam}" fill="url(#beam)"/>
<g clip-path="url(#inbeam)">
  <rect x="0" y="${HZ}" width="1280" height="${640 - HZ}" fill="url(#ground)"/>
  <path d="${rays}" stroke="${C.white}" stroke-width="1.3" opacity="0.55"/>
  <path d="M0,${HZ}H1280" stroke="${C.ochreDk}" stroke-width="2"/>
</g>
${door}
${name}
${arm}
${lamp.body}
<path d="M1170,56H1214" stroke="${C.verm}" stroke-width="5"/>
<text x="1214" y="90" text-anchor="end" font-family="FutM" font-size="20" letter-spacing="5.4" fill="${C.cream}">SEE WHAT YOU&#8217;VE LEFT OUT IN THE OPEN.</text>
<text x="1214" y="118" text-anchor="end" font-family="FutM" font-size="12.5" letter-spacing="4.2" fill="${C.steelLt}">YOUR REPOS · YOUR SERVERS · YOUR COMPUTER</text>
</g>
<rect x="21" y="21" width="1238" height="598" fill="none" stroke="${C.cream}" stroke-width="3"/>`,
  };
}
const h = hero();
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, defs: h.defs, body: h.body });

const notes = `# 53 Poster moderne (lantern)

Concept 35 with a mark that is plainly a porch light. The poster is kept as it was: a monumental faceted lantern on a post and bracket, airbrushed from steel blue to black, one hard-edged beam cutting the sheet, and the name changing as the beam crosses it, PORCH in the dark and LIGHT in the light. The mark is now the lantern itself, large, hung from its bracket, with the beam leaving it as three hard planes; the door is gone from the mark, the icon and the favicons.
Palette: black #0c0e12, night #1f2f42, steel blue #3f6080 / #8aa7c0, cream #f5ebd3, ochre #dca63f / #ac742a, vermilion #d8412a.
Type: Futura Condensed ExtraBold for the name, Futura Medium capitals, tracked, for the tagline and the small line.
Tagline: See what you've left out in the open.
From: 35 Poster moderne
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
