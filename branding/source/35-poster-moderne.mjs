// 35 Poster moderne: in the manner of the great French railway posters. A
// monumental lantern on a long bracket, one hard-edged beam cutting the sheet
// corner to corner, a small red door standing in it, and the name set so the
// beam passes through it: PORCH in the dark, LIGHT in the light.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '35-poster-moderne';
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

// ---- mark: a disc, half night and half light, the lantern at the join -------------
function markBody() {
  return `
<clipPath id="disc"><circle cx="100" cy="100" r="90"/></clipPath>
<circle cx="100" cy="100" r="92" fill="${C.black}"/>
<g clip-path="url(#disc)">
  <path d="M84,58L210,92V210H138L58,112Z" fill="${C.ochre}"/>
  <path d="M84,70L210,128V178L64,112Z" fill="${C.cream}"/>
  <path d="M142,166V128H164V166ZM164,166L214,186V200L142,166Z" fill="${C.black}"/>
  <rect x="146" y="132" width="14" height="34" fill="${C.verm}"/>
</g>
<circle cx="100" cy="100" r="92" fill="none" stroke="${C.cream}" stroke-width="3.5"/>
<path d="M62,22L30,54H62Z" fill="${C.steelLt}"/>
<path d="M62,22L94,54H62Z" fill="${C.steel}"/>
<path d="M26,54H98L95,62H29Z" fill="${C.verm}"/>
<path d="M33,62H52L56,112H44Z" fill="${C.ochre}"/>
<path d="M52,62H72L68,112H56Z" fill="${C.white}"/>
<path d="M72,62H91L80,112H68Z" fill="${C.cream}"/>
<path d="M52,62L56,112M72,62L68,112M33,62L44,112M91,62L80,112" stroke="${C.black}" stroke-width="2.6"/>
<path d="M41,112H83L79,119H45Z" fill="${C.black}" stroke="${C.cream}" stroke-width="1.4"/>
<path d="M54,120H70L62,134Z" fill="${C.verm}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid ----------------------------------------------------
const PIX = { K: '#1b2a3b', D: C.black, O: C.ochre, C: C.cream, W: C.white, V: C.verm, S: C.steelLt };
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
function fav16Rows() {
  const g = Array.from({ length: 16 }, () => Array(16).fill('.'));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 > 8.1 ** 2) continue;
      const upper = x >= 7 && y >= 4.6 + (x - 7) * 0.4;
      const lower = x >= 5.4 + (y - 7) * 0.72;
      g[y][x] = upper && lower ? 'O' : 'K';
    }
  const put = (rows, x0, y0) => rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && (g[y0 + j][x0 + i] = ch)));
  put(['..SS..', '.SSSS.', 'VVVVVV', '.WWWW.', '.WWWW.', '..WW..', '..VV..'], 2, 1);
  put(['VV', 'VV', 'VV', 'DDD'], 10, 9);
  g[12][13] = 'D';
  return g.map((r) => r.join(''));
}
const FAV16 = fav16Rows();
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const inDisc = (x, y) => (x - 15.5) ** 2 + (y - 15.5) ** 2 <= 15.6 ** 2;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      if (!inDisc(x, y)) continue;
      // beam: below the upper edge and right of the lower edge, from the lamp at about (9,13)
      const upper = y >= 9 + (x - 13) * 0.28 && x >= 13;
      const lower = x >= 9 + (y - 17) * 0.82;
      const core = y >= 11 + (x - 13) * 0.46 && x >= 9 + (y - 17) * 1.9;
      g[y][x] = upper && lower ? (core ? 'C' : 'O') : 'K';
    }
  // lantern
  const put = (rows, x0, y0) => rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && (g[y0 + j][x0 + i] = ch)));
  put(['....SS....', '...SSSS...', '..SSSSSS..', '.SSSSSSSS.', 'VVVVVVVVVV', '.OWWWWCCC.', '.OWWWWCCC.', '.OOWWWCCC.', '..OWWWCC..', '..OWWWCC..', '..OOWWCC..', '..DDDDDD..', '....VV....', '....VV....'], 4, 3);
  // door and its shadow
  for (let y = 19; y <= 25; y++) for (let x = 21; x <= 24; x++) g[y][x] = 'V';
  [[26, 21], [26, 22], [26, 23], [26, 24], [26, 25], [26, 26], [27, 24], [27, 25], [27, 26], [27, 27]].forEach(([y, x]) => inDisc(x, y) && (g[y][x] = 'D'));
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon ------------------------------------------------------------------------------
const iconLamp = lantern(170, 62, 1.25, 'i');
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>
<linearGradient id="isky" gradientUnits="userSpaceOnUse" x1="330" y1="170" x2="420" y2="-40"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.steel}"/></linearGradient>
<linearGradient id="idark" gradientUnits="userSpaceOnUse" x1="210" y1="400" x2="20" y2="540"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
<linearGradient id="ibeam" gradientUnits="userSpaceOnUse" x1="180" y1="200" x2="512" y2="470"><stop offset="0" stop-color="${C.white}"/><stop offset="0.3" stop-color="${C.cream}"/><stop offset="1" stop-color="${C.ochre}"/></linearGradient>
${iconLamp.defs}`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="url(#isky)"/>
  <path d="M0,45H170V140L122,290L320,512H0Z" fill="url(#idark)"/>
  <path d="M255,150L512,214V512H320L122,290Z" fill="url(#ibeam)"/>
  <path d="M250,400H512V512H320L222,400Z" fill="${C.ochre}"/>
  <path d="M386,400H430L560,452V486Z" fill="${C.black}"/>
  <rect x="382" y="312" width="52" height="88" fill="${C.black}"/>
  <rect x="389" y="319" width="38" height="81" fill="${C.verm}"/>
  <circle cx="420" cy="364" r="3.6" fill="${C.cream}"/>
  <path d="M0,120V154L128,56H96Z" fill="${C.black}"/>
  <path d="M0,120L96,56H104L0,128Z" fill="${C.steel}"/>
  <rect x="0" y="34" width="178" height="22" fill="${C.black}"/>
  <rect x="0" y="34" width="178" height="5" fill="${C.steelLt}"/>
  <rect x="163" y="54" width="14" height="12" fill="${C.black}"/>
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
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 0 200 200', body: markBody() })}
<g font-family="Block" font-size="70" letter-spacing="2.3">
  <text x="206" y="120" fill="${dark ? C.cream : C.black}" clip-path="url(#unlit)">PORCHLIGHT</text>
  <text x="206" y="120" fill="${dark ? C.ochre : C.verm}" clip-path="url(#lit)">PORCHLIGHT</text>
</g>
<text x="207" y="156" font-family="FutM" font-size="15.5" letter-spacing="5.2" fill="${dark ? C.cream : C.black}">LIGHTS ON. EYES OPEN.</text>`,
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
<path d="M640,78H684" stroke="${C.verm}" stroke-width="5"/>
<text x="1214" y="87" text-anchor="end" font-family="FutM" font-size="26" letter-spacing="9.5" fill="${C.cream}">LIGHTS ON. EYES OPEN.</text>
</g>
<rect x="21" y="21" width="1238" height="598" fill="none" stroke="${C.cream}" stroke-width="3"/>`,
  };
}
const h = hero();
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, defs: h.defs, body: h.body });

const notes = `# 35 Poster moderne

A poster in the manner of the 1930s French railway and liner posters: a monumental faceted lantern hung from a post and bracket, airbrushed from steel blue to black, and one hard-edged beam that cuts the sheet from the lamp to the far corner. A small red door stands in the beam and throws a long shadow. The name runs the full width in condensed capitals and changes as the beam crosses it: PORCH in the dark, LIGHT in the light. The mark is a disc split the same way, the lantern at the join.
Palette: black #0c0e12, night #1f2f42, steel blue #3f6080 / #8aa7c0, cream #f5ebd3, ochre #dca63f / #ac742a, vermilion #d8412a.
Type: Futura Condensed ExtraBold for the name, Futura Medium capitals, widely tracked, for the tagline.
Tagline: Lights on. Eyes open.
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
