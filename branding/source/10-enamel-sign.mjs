// 10 Enamel sign: a porcelain enamel sign, bottle green with a cream rim and
// a red keyline, chipped at the screw holes, with a porch lantern emblem.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '10-enamel-sign';
const C = {
  green: '#17473b',
  greenDk: '#0f3329',
  greenLt: '#1f5848',
  cream: '#f2e9d2',
  creamDk: '#d9cdaf',
  red: '#b8322a',
  iron: '#16140f',
  ground: '#b9b8ad', // grey ground coat seen at a chip
  rust: '#7a3b1c',
  amber: '#f2b134',
  hot: '#ffe8a8',
  brass: '#b08d48',
  brassLt: '#e2c27e',
  brassDk: '#5e4720',
  brick: '#3b2a24',
  mortar: '#1c1613',
};
const f = (n) => Math.round(n * 10) / 10;

// A chip: an irregular flake of enamel gone, showing ground coat then iron.
function chip(cx, cy, r, seed, { rot = 0 } = {}) {
  const R = rng(seed);
  const n = 9;
  const outer = [];
  const inner = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2 + (R() - 0.5) * 0.5;
    const ro = r * (0.65 + R() * 0.5);
    outer.push([cx + Math.cos(a) * ro, cy + Math.sin(a) * ro * 0.8]);
    const ri = ro * (0.55 + R() * 0.2);
    inner.push([cx + Math.cos(a) * ri + (R() - 0.5) * 0.8, cy + Math.sin(a) * ri * 0.8]);
  }
  const p = (pts) => 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L') + 'Z';
  return `<path d="${p(outer)}" fill="${C.ground}"/><path d="${p(inner)}" fill="${C.iron}"/><path d="${p(inner.slice(0, 4))}" fill="${C.rust}" opacity="0.55"/>`;
}

// Domed brass screw in a hole.
function screw(cx, cy, r, ang = 30) {
  const a = (ang * Math.PI) / 180;
  const dx = Math.cos(a) * r * 0.62;
  const dy = Math.sin(a) * r * 0.62;
  return `<circle cx="${cx}" cy="${cy}" r="${f(r * 1.25)}" fill="${C.iron}"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.brass}"/>
<path d="M${f(cx - r * 0.7)},${f(cy - r * 0.2)}A${r},${r} 0 0 1 ${f(cx + r * 0.2)},${f(cy - r * 0.72)}" stroke="${C.brassLt}" stroke-width="${f(r * 0.28)}" fill="none" stroke-linecap="round"/>
<path d="M${f(cx - dx)},${f(cy - dy)}L${f(cx + dx)},${f(cy + dy)}" stroke="${C.brassDk}" stroke-width="${f(r * 0.26)}" stroke-linecap="round"/>`;
}

// Porch lantern emblem, flat like a stencil: about 100 x 100 around (0,0).
// fg: body colour, glass: amber, light: rays colour
function lamp({ fg, glass = C.amber, hot = C.hot, rays = true, ray = fg, bg }) {
  let r = '';
  if (rays) {
    const angs = [-60, -35, -10, 15, 40];
    for (const a0 of angs) {
      const a = (a0 * Math.PI) / 180;
      const x1 = 12 + Math.cos(a) * 34;
      const y1 = -2 + Math.sin(a) * 34;
      const x2 = 12 + Math.cos(a) * 47;
      const y2 = -2 + Math.sin(a) * 47;
      r += `M${f(x1)},${f(y1)}L${f(x2)},${f(y2)}`;
    }
  }
  return `
<g>
  ${rays ? `<path d="${r}" stroke="${ray}" stroke-width="5" stroke-linecap="round"/>` : ''}
  <rect x="-44" y="-22" width="10" height="62" rx="4" fill="${fg}"/>
  <path d="M-36,32C-18,34-6,30-2,22" fill="none" stroke="${fg}" stroke-width="6" stroke-linecap="round"/>
  <path d="M-36,14C-22,14-16,20-14,26" fill="none" stroke="${fg}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M-12,22H16L12,28H-8Z" fill="${fg}"/>
  <rect x="-16" y="16" width="36" height="7" rx="1.5" fill="${fg}"/>
  <path d="M-16,-18H20L17,16H-13Z" fill="${fg}"/>
  <path d="M-11,-13H15L12.5,11H-8.5Z" fill="${glass}"/>
  <path d="M2,-10C6,-5 6.5,0 2,4.5C-2.5,0-2,-5 2,-10Z" fill="${hot}"/>
  <path d="M-3.6,-14L-2,13M7.6,-14L6,13" stroke="${fg}" stroke-width="3"/>
  <path d="M-22,-18H26L18,-28C10,-36-6,-36-14,-28Z" fill="${fg}"/>
  <rect x="-1" y="-42" width="6" height="9" rx="2" fill="${fg}"/>
  <circle cx="2" cy="-44" r="4.4" fill="${fg}"/>
</g>`;
}

// ---- mark: a round enamel badge ----------------------------------------------
function badge({ chips = true } = {}) {
  return `
<circle cx="100" cy="100" r="96" fill="${C.creamDk}"/>
<circle cx="100" cy="100" r="94" fill="${C.cream}"/>
<circle cx="100" cy="100" r="77" fill="${C.red}"/>
<circle cx="100" cy="100" r="73" fill="${C.green}"/>
<g transform="translate(96 104) scale(1.02)">${lamp({ fg: C.cream, ray: C.cream })}</g>
<path d="M40,58C60,28 104,18 140,34" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="7" stroke-linecap="round"/>
<path d="M30,92C32,78 36,70 42,62" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="3" stroke-linecap="round"/>
${chips ? chip(100, 15, 7.5, 3) + chip(100, 186, 8, 5) : ''}
${screw(100, 15, 4.6, 20)}${screw(100, 186, 4.6, -40)}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: badge() });

// ---- favicons ----------------------------------------------------------------
const favSvg = svg({
  w: 16,
  h: 16,
  vb: '0 0 16 16',
  body: `
<rect width="16" height="16" rx="3.5" fill="${C.cream}"/>
<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="${C.green}"/>
<rect x="7" y="2" width="2" height="1" fill="${C.cream}"/>
<path d="M8,3L11.5,5.5V6H4.5V5.5Z" fill="${C.cream}"/>
<rect x="5" y="6" width="6" height="5" fill="${C.cream}"/>
<rect x="6" y="7" width="4" height="3" fill="${C.amber}"/>
<rect x="5" y="11" width="6" height="1" fill="${C.cream}"/>
<rect x="7" y="12" width="2" height="1" fill="${C.cream}"/>`,
});
const fav32Svg = svg({
  w: 32,
  h: 32,
  vb: '0 0 32 32',
  body: `
<rect width="32" height="32" rx="7" fill="${C.cream}"/>
<rect x="2.5" y="2.5" width="27" height="27" rx="5" fill="${C.red}"/>
<rect x="3.5" y="3.5" width="25" height="25" rx="4" fill="${C.green}"/>
<rect x="15" y="5" width="2" height="2" fill="${C.cream}"/>
<path d="M16,7L22,11V12H10V11Z" fill="${C.cream}"/>
<rect x="11" y="12" width="10" height="10" fill="${C.cream}"/>
<rect x="13" y="14" width="6" height="6" fill="${C.amber}"/>
<rect x="15" y="15" width="2" height="4" fill="${C.hot}"/>
<rect x="11" y="22" width="10" height="2" fill="${C.cream}"/>
<rect x="13" y="24" width="6" height="2" fill="${C.cream}"/>`,
});

// ---- icon: a small square enamel plate -------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
<rect x="8" y="8" width="496" height="496" rx="96" fill="${C.creamDk}"/>
<rect x="12" y="12" width="488" height="488" rx="92" fill="${C.cream}"/>
<rect x="52" y="52" width="408" height="408" rx="58" fill="${C.red}"/>
<rect x="62" y="62" width="388" height="388" rx="50" fill="${C.green}"/>
<g transform="translate(250 268) scale(2.85)">${lamp({ fg: C.cream, ray: C.cream })}</g>
<path d="M92,170C120,110 190,84 268,88" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="16" stroke-linecap="round"/>
${chip(48, 48, 22, 11)}${chip(464, 464, 18, 12)}
${screw(48, 48, 11, 30)}${screw(464, 48, 11, -10)}${screw(48, 464, 11, 60)}${screw(464, 464, 11, 0)}`,
});

// ---- logo --------------------------------------------------------------------
const logoSvg = svg({
  w: 640,
  h: 200,
  vb: '0 0 640 200',
  body: `
${nest({ x: 14, y: 14, w: 172, h: 172, vb: '0 0 200 200', body: badge() })}
<text x="210" y="112" font-family="Gill Sans" font-weight="700" font-size="47" letter-spacing="4" fill="${C.green}">PORCHLIGHT</text>
<rect x="212" y="128" width="392" height="4" fill="${C.red}"/>
<text x="212" y="158" font-family="Gill Sans" font-weight="600" font-size="13" letter-spacing="3.7" fill="${C.green}">LEFT ON · LOOKED AFTER · AT HOME</text>`,
});

// ---- hero --------------------------------------------------------------------
function hero() {
  const R = rng(21);
  // brick wall
  let bricks = '';
  const tones = ['#3b2a24', '#35261f', '#41302a', '#32231e', '#3e2c22'];
  for (let row = 0; row < 30; row++) {
    const y = row * 22;
    const off = row % 2 ? -34 : 0;
    for (let x = off; x < 1280; x += 68) {
      bricks += `<rect x="${x + 2}" y="${y + 2}" width="64" height="18" rx="1.5" fill="${tones[Math.floor(R() * tones.length)]}"/>`;
    }
  }
  // two gooseneck lamps and their scallops of light
  const lamps = [400, 880];
  const scallop = (x) =>
    `<path d="M${x - 46},108C${x - 150},210 ${x - 262},420 ${x - 290},640H${x + 290}C${x + 262},420 ${x + 150},210 ${x + 46},108Z" fill="url(#scallop)"/>`;
  const goose = (x) => `
<circle cx="${x}" cy="18" r="13" fill="${C.greenDk}"/>
<circle cx="${x}" cy="18" r="5" fill="${C.green}"/>
<path d="M${x},20C${x + 8},34 ${x + 6},48 ${x},62" fill="none" stroke="${C.greenDk}" stroke-width="8" stroke-linecap="round"/>
<path d="M${x - 54},106C${x - 50},76 ${x - 26},62 ${x},62C${x + 26},62 ${x + 50},76 ${x + 54},106Z" fill="${C.green}"/>
<path d="M${x - 40},96C${x - 34},80 ${x - 20},71 ${x - 6},68" fill="none" stroke="${C.greenLt}" stroke-width="5" stroke-linecap="round"/>
<path d="M${x - 46},90C${x - 44},86 ${x - 41},82 ${x - 38},79" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2.5" stroke-linecap="round"/>
<ellipse cx="${x}" cy="106" rx="54" ry="6.5" fill="${C.cream}"/>
<ellipse cx="${x}" cy="107" rx="40" ry="4.2" fill="${C.hot}"/>
<rect x="${x - 5}" y="56" width="10" height="8" rx="2" fill="${C.greenDk}"/>`;

  // sign geometry
  const S = { x: 132, y: 178, w: 1016, h: 352, r: 30 };
  const rim = 18;
  const key = 5;
  const EX = S.x + 200;
  const EY = S.y + S.h / 2;
  const chips = [
    chip(S.x + 30, S.y + 30, 20, 31),
    chip(S.x + S.w - 30, S.y + S.h - 30, 16, 32),
    chip(S.x + S.w - 30, S.y + 30, 10, 33),
    chip(S.x + 30, S.y + S.h - 30, 12, 37),
  ].join('');
  const TX = S.x + 672;
  return `
<defs>
  <radialGradient id="scallopR" cx="0.5" cy="0" r="1">
    <stop offset="0" stop-color="#ffcf7a" stop-opacity="0.55"/>
    <stop offset="0.45" stop-color="#f0a650" stop-opacity="0.22"/>
    <stop offset="1" stop-color="#f0a650" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="scallop" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffd58a" stop-opacity="0.5"/>
    <stop offset="0.35" stop-color="#f5ad58" stop-opacity="0.22"/>
    <stop offset="0.75" stop-color="#f5ad58" stop-opacity="0.06"/>
    <stop offset="1" stop-color="#f5ad58" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.13"/>
    <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.02"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="signlight" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffe2a8" stop-opacity="0.22"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0.18"/>
  </linearGradient>
  <radialGradient id="pool" cx="0.5" cy="0" r="0.75" fx="0.5" fy="0">
    <stop offset="0" stop-color="#ffe3ad" stop-opacity="0.34"/>
    <stop offset="0.5" stop-color="#ffd48a" stop-opacity="0.12"/>
    <stop offset="1" stop-color="#ffd48a" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="signclip"><rect x="${S.x}" y="${S.y}" width="${S.w}" height="${S.h}" rx="${S.r}"/></clipPath>
</defs>
<rect width="1280" height="640" fill="${C.mortar}"/>
${bricks}
${lamps.map(scallop).join('')}
<rect x="${S.x + 10}" y="${S.y + 22}" width="${S.w}" height="${S.h}" rx="${S.r}" fill="#000000" opacity="0.45"/>
<rect x="${S.x}" y="${S.y}" width="${S.w}" height="${S.h}" rx="${S.r}" fill="${C.creamDk}"/>
<rect x="${S.x + 2}" y="${S.y + 2}" width="${S.w - 4}" height="${S.h - 4}" rx="${S.r - 2}" fill="${C.cream}"/>
<rect x="${S.x + rim}" y="${S.y + rim}" width="${S.w - 2 * rim}" height="${S.h - 2 * rim}" rx="${S.r - 10}" fill="${C.red}"/>
<rect x="${S.x + rim + key}" y="${S.y + rim + key}" width="${S.w - 2 * (rim + key)}" height="${S.h - 2 * (rim + key)}" rx="${S.r - 13}" fill="${C.green}"/>
<circle cx="${EX}" cy="${EY}" r="122" fill="${C.cream}"/>
<circle cx="${EX}" cy="${EY}" r="110" fill="${C.red}"/>
<circle cx="${EX}" cy="${EY}" r="106" fill="${C.cream}"/>
<g transform="translate(${EX - 4} ${EY + 6}) scale(1.62)">${lamp({ fg: C.green, ray: C.red })}</g>
<text x="${TX + 3}" y="${S.y + 176}" text-anchor="middle" font-family="Gill Sans" font-weight="700" font-size="72" letter-spacing="6.5" fill="${C.cream}">PORCHLIGHT</text>
<rect x="${TX - 288}" y="${S.y + 200}" width="576" height="5" fill="${C.red}"/>
<text x="${TX + 2}" y="${S.y + 244}" text-anchor="middle" font-family="Gill Sans" font-weight="600" font-size="19" letter-spacing="2.7" fill="${C.cream}">A LIGHT LEFT ON OVER YOUR OWN FRONT DOOR.</text>
<g clip-path="url(#signclip)">
  <rect x="${S.x}" y="${S.y}" width="${S.w}" height="${S.h}" fill="url(#signlight)"/>
  ${lamps.map((x) => `<ellipse cx="${x}" cy="${S.y}" rx="330" ry="300" fill="url(#pool)"/>`).join('')}
  <path d="M${S.x - 40},${S.y + 140}L${S.x + 260},${S.y - 20}L${S.x + 420},${S.y - 20}L${S.x + 60},${S.y + 260}Z" fill="url(#sheen)"/>
  <path d="M${S.x + 470},${S.y + 26}C${S.x + 620},${S.y + 12} ${S.x + 800},${S.y + 12} ${S.x + 960},${S.y + 30}" stroke="#ffffff" stroke-opacity="0.2" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${chips}
</g>
${screw(S.x + 30, S.y + 30, 9, 25)}${screw(S.x + S.w - 30, S.y + 30, 9, -15)}${screw(S.x + 30, S.y + S.h - 30, 9, 70)}${screw(S.x + S.w - 30, S.y + S.h - 30, 9, 5)}
${lamps.map(goose).join('')}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 10 Enamel sign

A porcelain enamel sign, the kind screwed beside a front door: bottle-green field, cream rolled rim, red keyline, chipped to the iron at the screw holes, with a stencil-flat porch lantern. The hero hangs it on brick under two gooseneck lamps.
Palette: green #17473b / #0f3329, cream #f2e9d2, keyline red #b8322a, amber #f2b134, iron #16140f, brass #b08d48, brick #3b2a24.
Type: Gill Sans Bold caps, tracked wide as sign lettering; Gill Sans SemiBold for the small lines.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logoSvg,
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
