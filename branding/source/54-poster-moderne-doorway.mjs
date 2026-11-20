// 54 Poster moderne (doorway): the poster language of 35, seen closer. The lantern is
// on the wall beside a real doorway, and its beam falls across the door and the steps.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '54-poster-moderne-doorway';
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

// A doorway in a 0..w by 0..h box at x, y: frame, hood, transom, vermilion door, steps.
function doorway(x, y, w, h, { steps = 3, sw = 0.16, sh = 0.065, id = 'd' } = {}) {
  const fw = w * 0.075;
  const hood = h * 0.05;
  const tr = h * 0.13; // transom height
  let out = `
<rect x="${f(x - fw)}" y="${f(y - fw)}" width="${f(w + 2 * fw)}" height="${f(h + fw)}" fill="${C.black}"/>
<rect x="${f(x - fw * 2.4)}" y="${f(y - fw - hood)}" width="${f(w + fw * 4.8)}" height="${f(hood)}" fill="${C.black}"/>
<rect x="${f(x - fw * 2.4)}" y="${f(y - fw - hood)}" width="${f(w + fw * 4.8)}" height="${f(hood * 0.3)}" fill="${C.steelLt}"/>
<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(tr)}" fill="${C.white}"/>
<path d="M${f(x + w / 2)},${f(y)}V${f(y + tr)}" stroke="${C.black}" stroke-width="${f(fw * 0.45)}"/>
<rect x="${f(x)}" y="${f(y + tr + fw * 0.6)}" width="${f(w)}" height="${f(h - tr - fw * 0.6)}" fill="${C.verm}"/>
<rect x="${f(x)}" y="${f(y + tr + fw * 0.6)}" width="${f(w * 0.3)}" height="${f(h - tr - fw * 0.6)}" fill="${C.vermDk}"/>
<rect x="${f(x + w * 0.42)}" y="${f(y + h * 0.27)}" width="${f(w * 0.42)}" height="${f(h * 0.24)}" fill="none" stroke="${C.vermDk}" stroke-width="${f(fw * 0.4)}"/>
<rect x="${f(x + w * 0.42)}" y="${f(y + h * 0.58)}" width="${f(w * 0.42)}" height="${f(h * 0.32)}" fill="none" stroke="${C.vermDk}" stroke-width="${f(fw * 0.4)}"/>
<circle cx="${f(x + w * 0.2)}" cy="${f(y + h * 0.6)}" r="${f(fw * 0.42)}" fill="${C.cream}"/>`;
  for (let i = 0; i < steps; i++) {
    const ex = w * sw * (i + 1.4);
    const sy = y + h + i * h * sh;
    out += `<rect x="${f(x - ex)}" y="${f(sy)}" width="${f(w + 2 * ex)}" height="${f(h * sh)}" fill="${i % 2 ? C.cream : C.white}"/><rect x="${f(x - ex)}" y="${f(sy + h * sh * 0.62)}" width="${f(w + 2 * ex)}" height="${f(h * sh * 0.38)}" fill="${C.black}"/>`;
  }
  return out;
}

// ---- mark: lantern, beam, doorway on its steps; three ideas in four shapes ------------
function markBody(id = 'm') {
  const lamp = lantern(62, 22, 0.5, id);
  return `
<defs><clipPath id="${id}t"><rect x="14" y="14" width="172" height="172" rx="20"/></clipPath>${lamp.defs}</defs>
<rect x="10" y="10" width="180" height="180" rx="24" fill="${C.black}"/>
<g clip-path="url(#${id}t)">
  <path d="M92,56L190,74V190H128L44,112Z" fill="${C.ochre}"/>
  <path d="M92,60L190,118V190H152L56,112Z" fill="${C.cream}"/>
  <rect x="96" y="160" width="94" height="30" fill="${C.ochre}"/>
  ${doorway(126, 86, 40, 74, { steps: 2, sw: 0.2, sh: 0.11, id })}
</g>
<rect x="10" y="10" width="180" height="180" rx="24" fill="none" stroke="${C.cream}" stroke-width="3.5"/>
${lamp.body}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid ----------------------------------------------------
const PIX = { K: '#24384f', D: C.black, O: C.ochre, C: C.cream, W: C.white, V: C.verm, S: C.steelLt };
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
  '.KKKKKKKKKKKKKK.',
  'KKKSSKKKKKKKKKKK',
  'KKSSSSKKKKKKKKKK',
  'KVVVVVVKKKKKKKKK',
  'KKWWWWOOOOKKKKKK',
  'KKWWWWCCOOOOOKKK',
  'KKKWWCCDDDDDDOOK',
  'KKKVVCCDWWWWDOOK',
  'KKKKKOCDVVVVDCOK',
  'KKKKKKODVVVVDCCK',
  'KKKKKKKDVVVVDCCK',
  'KKKKKKKDVVVVDCCK',
  'KKKKKKKDVVVVDCCK',
  'KKKKKKWWWWWWWWCK',
  'KKKKKWWWWWWWWWWK',
  '.KKKKKKKKKKKKKK.',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('K'));
  [[0, 0], [0, 1], [1, 0], [0, 31], [0, 30], [1, 31], [31, 0], [30, 0], [31, 1], [31, 31], [30, 31], [31, 30]].forEach(([y, x]) => (g[y][x] = '.'));
  for (let y = 1; y < 31; y++)
    for (let x = 1; x < 31; x++) {
      const upper = x >= 13 && y >= 8 + (x - 13) * 0.2;
      const lower = x >= 8 + (y - 16) * 1.0;
      const core = y >= 10 + (x - 13) * 0.6;
      if (upper && lower) g[y][x] = core ? 'C' : 'O';
    }
  const put = (rows, x0, y0) => rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && (g[y0 + j][x0 + i] = ch)));
  put(['....SS....', '...SSSS...', '..SSSSSS..', '.SSSSSSSS.', 'VVVVVVVVVV', '.OWWWWCCC.', '.OWWWWCCC.', '.OOWWWCCC.', '..OWWWCC..', '..OWWWCC..', '..DDDDDD..', '....VV....'], 3, 3);
  put(['DDDDDDDDDDDD', 'DDDDDDDDDDDD', '.DWWWWWWWWD.', '.DWWWWWWWWD.', '.DVVVVVVVVD.', '.DVVVVVVVVD.', '.DVVVVVVVVD.', '.DVVVVVVVVD.', '.DVCVVVVVVD.', '.DVVVVVVVVD.', '.DVVVVVVVVD.', '.DVVVVVVVVD.', '.DVVVVVVVVD.', '.DVVVVVVVVD.', 'WWWWWWWWWWWW', 'DDDDDDDDDDDD'], 16, 11);
  put(['WWWWWWWWWWWWWWWW', 'DDDDDDDDDDDDDDDD'], 14, 27);
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon ------------------------------------------------------------------------------
const iconLamp = lantern(150, 50, 1.2, 'i');
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>
<linearGradient id="isky" gradientUnits="userSpaceOnUse" x1="330" y1="170" x2="420" y2="-40"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.steel}"/></linearGradient>
<linearGradient id="idark" gradientUnits="userSpaceOnUse" x1="210" y1="400" x2="20" y2="540"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
${iconLamp.defs}`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="url(#isky)"/>
  <path d="M0,0H150V130L104,266L300,512H0Z" fill="url(#idark)"/>
  <path d="M230,134L512,186V512H300L104,266Z" fill="${C.ochre}"/>
  <path d="M230,146L512,300V512H366L140,266Z" fill="${C.cream}"/>
  <rect x="230" y="424" width="300" height="100" fill="${C.ochre}"/>
  ${doorway(318, 208, 112, 196, { steps: 2, sw: 0.2, sh: 0.11, id: 'i' })}
  <rect x="0" y="30" width="160" height="20" fill="${C.black}"/>
  <rect x="0" y="30" width="160" height="5" fill="${C.steelLt}"/>
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
    defs: `<clipPath id="lit"><path d="M372,40H640V200H452Z"/></clipPath><clipPath id="unlit"><path d="M190,40H372L452,200H190Z"/></clipPath>`,
    body: `
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 0 200 200', body: markBody('lg') })}
<g font-family="Block" font-size="70" letter-spacing="2.3">
  <text x="206" y="120" fill="${dark ? C.cream : C.black}" clip-path="url(#unlit)">PORCHLIGHT</text>
  <text x="206" y="120" fill="${dark ? C.ochre : C.verm}" clip-path="url(#lit)">PORCHLIGHT</text>
</g>
<text x="207" y="156" font-family="FutM" font-size="14.5" letter-spacing="3.6" fill="${dark ? C.cream : C.black}">NOTHING LEFT OUT IN THE OPEN.</text>`,
  });

// ---- hero --------------------------------------------------------------------------------
function hero() {
  const LX = 330;
  const LY = 62;
  const S = 0.92;
  const lamp = lantern(LX, LY, S, 'h');
  const U0 = [LX + 62 * S, LY + 72 * S];
  const U1 = [1280, 176];
  const L0 = [LX - 38 * S, LY + 180 * S];
  const slope = 1.62; // steeper than 35
  const L1 = [L0[0] + (640 - L0[1]) / slope, 640];
  const beam = `M${f(U0[0])},${f(U0[1])}L${U1}V640H${f(L1[0])}L${f(L0[0])},${f(L0[1])}Z`;
  const HZ = 506; // where the wall meets the ground
  const hx = L0[0] + (HZ - L0[1]) / slope;
  const defs = `
<linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="900" y1="150" x2="930" y2="-70"><stop offset="0" stop-color="${C.black}"/><stop offset="0.35" stop-color="#15202d"/><stop offset="1" stop-color="${C.steel}"/></linearGradient>
<linearGradient id="dark" gradientUnits="userSpaceOnUse" x1="470" y1="430" x2="180" y2="740"><stop offset="0" stop-color="${C.black}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
<linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="${LX}" y1="${LY + 110}" x2="1280" y2="520"><stop offset="0" stop-color="${C.white}"/><stop offset="0.3" stop-color="${C.cream}"/><stop offset="0.8" stop-color="${C.ochre}"/><stop offset="1" stop-color="#c98f33"/></linearGradient>
<linearGradient id="ground" gradientUnits="userSpaceOnUse" x1="0" y1="${HZ}" x2="0" y2="640"><stop offset="0" stop-color="#e3b352"/><stop offset="1" stop-color="${C.ochreDk}"/></linearGradient>
<clipPath id="inbeam"><path d="${beam}"/></clipPath>
<clipPath id="outbeam"><path clip-rule="evenodd" d="M0,0H1280V640H0Z${beam}"/></clipPath>
<clipPath id="frame"><rect x="21" y="21" width="1238" height="598"/></clipPath>
${lamp.defs}`;
  // courses of the wall, drawn only where the beam shows them
  let courses = '';
  for (let y = 150; y < HZ; y += 44) courses += `M0,${y}H1280`;
  const DX = 972;
  const DW = 150;
  const DT = 196;
  const DH = HZ - 3 * 18 - DT; // door height so three steps land on the ground line
  const name = `
<g font-family="Block" font-size="158" text-anchor="start">
  <text x="46" y="598" textLength="800" lengthAdjust="spacing" fill="${C.cream}" clip-path="url(#outbeam)">PORCHLIGHT</text>
  <text x="46" y="598" textLength="800" lengthAdjust="spacing" fill="${C.black}" clip-path="url(#inbeam)">PORCHLIGHT</text>
</g>`;
  const arm = `
<rect x="60" y="34" width="26" height="170" fill="${C.steel}"/>
<rect x="82" y="34" width="4" height="170" fill="${C.steelLt}"/>
<path d="M86,170V196L262,60H232Z" fill="#2a4159"/>
<path d="M86,170L232,60H239L86,176Z" fill="${C.steelLt}"/>
<rect x="60" y="44" width="${LX + 12 - 60}" height="16" fill="#2a4159"/>
<rect x="60" y="44" width="${LX + 12 - 60}" height="3.5" fill="${C.steelLt}"/>
<rect x="${LX - 5}" y="58" width="10" height="${LY - 54}" fill="#2a4159"/>`;
  return {
    defs,
    body: `
<rect width="1280" height="640" fill="${C.black}"/>
<g clip-path="url(#frame)">
<path d="M0,0H1280V${U1[1]}L${f(U0[0])},${f(U0[1])}L${LX + 6},52H0Z" fill="url(#sky)"/>
<path d="M0,52H${LX + 6}L${f(L0[0])},${f(L0[1])}L${f(L1[0])},640H0Z" fill="url(#dark)"/>
<path d="M21,${HZ}H${f(hx)}" stroke="${C.steel}" stroke-width="2"/>
<path d="${beam}" fill="url(#beam)"/>
<g clip-path="url(#inbeam)">
  <path d="${courses}" stroke="${C.ochreDk}" stroke-width="1.4" opacity="0.5"/>
  <rect x="0" y="${HZ}" width="1280" height="${640 - HZ}" fill="url(#ground)"/>
  <path d="M0,${HZ}H1280" stroke="${C.ochreDk}" stroke-width="2"/>
  <path d="M${DX + DW + 60},${HZ}L1400,${HZ + 60}V${HZ + 110}L${DX + DW - 20},${HZ}Z" fill="${C.black}" opacity="0.85"/>
</g>
${doorway(DX, DT, DW, DH, { steps: 3, sw: 0.14, sh: 18 / DH, id: 'h' })}
${name}
${arm}
${lamp.body}
<path d="M1170,58H1214" stroke="${C.verm}" stroke-width="5"/>
<text x="1214" y="92" text-anchor="end" font-family="FutM" font-size="22" letter-spacing="6.4" fill="${C.cream}">NOTHING LEFT OUT IN THE OPEN.</text>
<text x="1214" y="120" text-anchor="end" font-family="FutM" font-size="12.5" letter-spacing="4.2" fill="${C.steelLt}">YOUR REPOS · YOUR SERVERS · YOUR COMPUTER</text>
</g>
<rect x="21" y="21" width="1238" height="598" fill="none" stroke="${C.cream}" stroke-width="3"/>`,
  };
}
const h = hero();
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, defs: h.defs, body: h.body });

const notes = `# 54 Poster moderne (doorway)

The poster language of 35, seen closer, so it is plainly a porch. The faceted lantern hangs from a wall bracket beside a real doorway with its hood, transom, red door and three stone steps, and one hard-edged beam falls from the lamp across the wall, the door and the steps. The name sits on one line beside the steps and the beam cuts it at a steeper angle: PORCH in the dark, LIGHT in the light. The mark is the same three things, lantern, beam and doorway on its steps, in a square tile.
Palette: black #0c0e12, night #1f2f42, steel blue #3f6080 / #8aa7c0, cream #f5ebd3, ochre #dca63f / #ac742a, vermilion #d8412a.
Type: Futura Condensed ExtraBold for the name, Futura Medium capitals, tracked, for the tagline and the small line.
Tagline: Nothing left out in the open.
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
