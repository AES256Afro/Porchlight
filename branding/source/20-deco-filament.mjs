// 20 Deco filament: an Art Deco emblem. A tall bulb inside a stepped arch,
// a sunburst of fine rays behind it, and a filament bent into a small house
// with a keyhole for a door. Gold line work on green-black, with cream.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '20-deco-filament';
const C = {
  night: '#0b1712',
  panel: '#0f2019',
  glass: '#13291f',
  gold: '#c9a55c',
  goldLt: '#ead08f',
  goldDk: '#8a6a33',
  cream: '#efe3c4',
  amber: '#ffbf5a',
  hot: '#fff3d4',
  ink: '#0e1d16',
};
const f = (n) => +n.toFixed(2);

// ---- the emblem, on a 240 grid -------------------------------------------------
// centre line x = 120; bulb centre (120, 96)
const BX = 120;
const BY = 96;
const OUTER = 'M52 226 V98 H62 V80 H72 V64 A48 48 0 0 1 168 64 V80 H178 V98 H188 V226 Z';
const INNER = 'M60 218 V106 H70 V88 H80 V64 A40 40 0 0 1 160 64 V88 H170 V106 H180 V218 Z';
const BULB = `M107 152 C107 136 89 124 89 97 A31 31 0 0 1 151 97 C151 124 133 136 133 152 Z`;

function sunburst({ cx = BX, cy = BY, n = 44, r0 = 38, rLong = 220, rShort = 64, wedge = 4.2, line = 0.9, color = C.gold, opacity = 1 }) {
  let out = '';
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 - Math.PI / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    if (k % 2 === 0) {
      // a long wedge, a hair wide at its root
      const w0 = 0.25;
      const w1 = wedge / 2;
      const p = [
        [cx + ca * r0 - sa * w0, cy + sa * r0 + ca * w0],
        [cx + ca * rLong - sa * w1, cy + sa * rLong + ca * w1],
        [cx + ca * rLong + sa * w1, cy + sa * rLong - ca * w1],
        [cx + ca * r0 + sa * w0, cy + sa * r0 - ca * w0],
      ];
      out += `<path d="M${p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z"/>`;
    } else {
      out += `<path d="M${f(cx + ca * (r0 + 4))} ${f(cy + sa * (r0 + 4))}L${f(cx + ca * rShort)} ${f(cy + sa * rShort)}" stroke="${color}" stroke-width="${line}" fill="none"/>`;
    }
  }
  return `<g fill="${color}" opacity="${opacity}">${out}</g>`;
}

// The filament: one wire, two lead-in supports, bent into a house with a
// keyhole door. Light is drawn as three strokes of falling heat, not a blur.
function filament({ scale = 1 } = {}) {
  const house = 'M108 122 V100 L120 87 L132 100 V122';
  const leads = 'M108 122 L114 140 M132 122 L126 140';
  const key = 'M120 103.2 a3.2 3.2 0 1 1 -0.01 0 Z M118.6 108.4 h2.8 l1.2 6.6 h-5.2 Z';
  const w = (n) => f(n * scale);
  return `
  <path d="${leads}" fill="none" stroke="${C.goldDk}" stroke-width="${w(1.1)}" stroke-linecap="round"/>
  <path d="${house}" fill="none" stroke="${C.amber}" stroke-opacity="0.22" stroke-width="${w(8)}" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${house}" fill="none" stroke="${C.amber}" stroke-opacity="0.45" stroke-width="${w(4.2)}" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${house}" fill="none" stroke="${C.hot}" stroke-width="${w(1.7)}" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${key}" fill="${C.amber}"/>
  <circle cx="108" cy="122" r="${w(1.3)}" fill="${C.goldLt}"/><circle cx="132" cy="122" r="${w(1.3)}" fill="${C.goldLt}"/>`;
}

function emblem({ rays = true, raysN = 44, fine = true } = {}) {
  return `
<path d="${OUTER}" fill="${C.panel}"/>
<clipPath id="inner-${raysN}"><path d="${INNER}"/></clipPath>
${rays ? `<g clip-path="url(#inner-${raysN})">${sunburst({ n: raysN })}</g>` : ''}
<path d="${OUTER}" fill="none" stroke="${C.gold}" stroke-width="3.2" stroke-linejoin="miter"/>
<path d="${INNER}" fill="none" stroke="${C.gold}" stroke-width="1.1" stroke-linejoin="miter"/>
<!-- keystone -->
<path d="M113 13 H127 L125 22 H115 Z" fill="${C.gold}"/>
<!-- glass, with a dark gap ring so the rays stop short of it -->
<path d="${BULB}" fill="${C.panel}" stroke="${C.panel}" stroke-width="9"/>
<path d="${BULB}" fill="${C.glass}" stroke="${C.gold}" stroke-width="2.6"/>
${fine ? `<path d="M99 80 A24 24 0 0 1 114 71" fill="none" stroke="${C.cream}" stroke-width="1.5" stroke-linecap="round" opacity="0.75"/>
<path d="M96 104 C97 116 104 126 108 134" fill="none" stroke="${C.cream}" stroke-width="0.9" stroke-linecap="round" opacity="0.45"/>` : ''}
<!-- glass stem (mount) -->
<path d="M114 140 C116 146 116 148 112 152 H128 C124 148 124 146 126 140 Z" fill="none" stroke="${C.goldDk}" stroke-width="1"/>
${filament()}
<!-- cap: collar, threads, insulator, tip -->
<rect x="104" y="151" width="32" height="6" rx="1.5" fill="${C.gold}"/>
<g fill="${C.gold}" stroke="${C.ink}" stroke-width="1.2">
  <rect x="106" y="157" width="28" height="7" rx="3.5"/>
  <rect x="107" y="164" width="26" height="7" rx="3.5"/>
  <rect x="108" y="171" width="24" height="7" rx="3.5"/>
</g>
<path d="M110 178 H130 L126 186 H114 Z" fill="${C.ink}" stroke="${C.gold}" stroke-width="1"/>
<rect x="115" y="186" width="10" height="5" rx="2" fill="${C.goldLt}"/>
<!-- stepped plinth -->
<g fill="${C.panel}" stroke="${C.gold}" stroke-width="1.2">
  <rect x="94" y="197" width="52" height="6"/>
  <rect x="84" y="203" width="72" height="7"/>
  <rect x="74" y="210" width="92" height="8"/>
</g>`;
}

// ---- mark ------------------------------------------------------------------
const markSvg = svg({ w: 512, h: 512, vb: '0 0 240 240', body: emblem({}) });

// ---- favicon 16: pixel-drawn ---------------------------------------------------
// T tile, g glass, G gold, D gold dark, A amber filament, H hot core, K insulator
const FAV16 = [
  '.TTTTTTTTTTTTTT.',
  'TTTTTTGGGGTTTTTT',
  'TTTTGGggggGGTTTT',
  'TTTGgggHHgggGTTT',
  'TTTGggHggHggGTTT',
  'TTTGgHggggHgGTTT',
  'TTTGgHgAAgHgGTTT',
  'TTTGgHgAAgHgGTTT',
  'TTTTGHggggHGTTTT',
  'TTTTTGggggGTTTTT',
  'TTTTTTGGGGTTTTTT',
  'TTTTTTDDDDTTTTTT',
  'TTTTTTGGGGTTTTTT',
  'TTTTTTTKKTTTTTTT',
  'TTTTTTTLLTTTTTTT',
  '.TTTTTTTTTTTTTT.',
];
// 32 x 32, set span by span (symmetric about x = 15.5)
const FAV32 = (() => {
  const g = Array.from({ length: 32 }, () => Array(32).fill('T'));
  const span = (y, a, b, ch) => { for (let x = a; x <= b; x++) g[y][x] = ch; };
  const pair = (y, a, ch) => { g[y][a] = ch; g[y][31 - a] = ch; };
  // rounded tile corners
  for (const [y, n] of [[0, 3], [1, 1], [30, 1], [31, 3]]) { span(y, 0, n - 1, '.'); span(y, 32 - n, 31, '.'); }
  // glass: outline G, inside g
  const glass = [[3, 13], [4, 11], [5, 10], [6, 9], [7, 8], [8, 8], [9, 7], [10, 7], [11, 7], [12, 7], [13, 7], [14, 8], [15, 8], [16, 9], [17, 10], [18, 11], [19, 12]];
  for (const [y, a] of glass) { span(y, a, 31 - a, 'g'); pair(y, a, 'G'); }
  span(3, 13, 18, 'G');
  pair(4, 12, 'G');
  // filament house: hot core H, warm A beside it
  span(6, 15, 16, 'H');
  pair(7, 14, 'H'); pair(8, 13, 'H'); pair(9, 12, 'H');
  for (let y = 10; y <= 14; y++) pair(y, 12, 'H');
  pair(7, 15, 'A'); pair(9, 13, 'A');
  // keyhole door
  span(10, 15, 16, 'A'); for (let y = 11; y <= 14; y++) span(y, 14, 17, 'A');
  // lead-in wires to the stem
  pair(15, 13, 'D'); pair(16, 14, 'D'); pair(17, 14, 'D'); span(18, 15, 16, 'D');
  // cap
  span(20, 12, 19, 'G'); span(21, 12, 19, 'D'); span(22, 12, 19, 'G'); span(23, 12, 19, 'D'); span(24, 13, 18, 'G');
  span(25, 13, 18, 'K'); span(26, 14, 17, 'K'); span(27, 14, 17, 'L');
  return g.map((r) => r.join(''));
})();
const favPal = { T: C.night, g: '#183526', G: C.gold, D: C.goldDk, A: C.amber, H: C.hot, K: '#060d0a', L: C.goldLt };

function pixelsSvg(map, pal, size) {
  let body = '';
  map.forEach((row, y) => {
    if ([...row].length !== size) throw new Error(`row ${y} is ${row.length}: ${row}`);
    let x = 0;
    while (x < size) {
      const ch = row[x];
      let e = x + 1;
      while (e < size && row[e] === ch) e++;
      if (ch !== '.') body += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${pal[ch]}"/>`;
      x = e;
    }
  });
  return svg({ w: size, h: size, vb: `0 0 ${size} ${size}`, crisp: true, body });
}

// ---- icon: emblem on a green tile with a field of rays -------------------------
function iconSvg() {
  const body = `
<clipPath id="tile"><rect x="0" y="0" width="512" height="512" rx="108"/></clipPath>
<g clip-path="url(#tile)">
  <rect width="512" height="512" fill="${C.night}"/>
  ${sunburst({ cx: 256, cy: 214, n: 64, r0: 120, rLong: 520, rShort: 300, wedge: 9, line: 2.2, color: C.gold, opacity: 0.32 })}
  <rect x="14" y="14" width="484" height="484" rx="96" fill="none" stroke="${C.gold}" stroke-width="4"/>
  <g transform="translate(256 262) scale(2.06) translate(-120 -120)">${emblem({ raysN: 36 })}</g>
</g>`;
  return svg({ w: 512, h: 512, body });
}

// ---- logo ------------------------------------------------------------------------
function logoSvg() {
  const ink = C.ink;
  const body = `
<g transform="translate(22 6) scale(0.79)">${emblem({ raysN: 40 })}</g>
<g fill="${ink}">
  <text x="399" y="127" text-anchor="middle" font-family="Didot" font-size="48" letter-spacing="6.2">PORCHLIGHT</text>
</g>
<g stroke="${C.goldDk}" fill="none">
  <path d="M200 70 H598" stroke-width="1.4"/><path d="M200 75 H598" stroke-width="0.7"/>
  <path d="M200 146 H598" stroke-width="0.7"/><path d="M200 151 H598" stroke-width="1.4"/>
</g>
<path d="M399 66 l4 4 l-4 4 l-4 -4 Z M399 142 l4 4 l-4 4 l-4 -4 Z" fill="${C.goldDk}"/>`;
  return svg({ w: 640, h: 200, body });
}

// ---- hero --------------------------------------------------------------------------
function heroSvg() {
  // Deco border: double rule with stepped corners
  const border = (i, sw, op = 1) => {
    const s = 18; // step
    const x0 = i;
    const y0 = i;
    const x1 = 1280 - i;
    const y1 = 640 - i;
    return `<path d="M${x0 + s} ${y0} H${x1 - s} V${y0 + s} H${x1} V${y1 - s} H${x1 - s} V${y1} H${x0 + s} V${y1 - s} H${x0} V${y0 + s} H${x0 + s} Z" fill="none" stroke="${C.gold}" stroke-width="${sw}" opacity="${op}"/>`;
  };
  // fluted columns either side of the arch (thin vertical lines)
  let flutes = '';
  for (const [x0, x1] of [[96, 176], [544, 624]]) for (let x = x0; x <= x1; x += 8) flutes += `<path d="M${x} 196 V588" stroke="${C.gold}" stroke-width="0.8" opacity="${0.16 + 0.1 * Math.sin((x - x0) / 26)}"/>`;
  const S = 2.22; // emblem scale
  const EX = 360;
  const EY = 324;
  const T = 924; // text axis
  const text = `
  <text x="${T}" y="184" text-anchor="middle" font-family="Didot" font-size="16" letter-spacing="7" fill="${C.gold}">CODE · DOMAINS · THIS MAC</text>
  <g stroke="${C.gold}" fill="none">
    <path d="M${T - 280} 222 H${T - 14}" stroke-width="1.2"/><path d="M${T + 14} 222 H${T + 280}" stroke-width="1.2"/>
    <path d="M${T - 280} 227 H${T - 22}" stroke-width="0.6"/><path d="M${T + 22} 227 H${T + 280}" stroke-width="0.6"/>
  </g>
  <path d="M${T} 215 l8 9 l-8 9 l-8 -9 Z" fill="${C.gold}"/>
  <text x="${T + 4}" y="316" text-anchor="middle" font-family="Didot" font-size="66" letter-spacing="8.6" fill="${C.cream}">PORCHLIGHT</text>
  <g stroke="${C.gold}" fill="none">
    <path d="M${T - 280} 352 H${T + 280}" stroke-width="0.6"/><path d="M${T - 280} 357 H${T + 280}" stroke-width="1.2"/>
  </g>
  <path d="M${T - 40} 357 h80 v6 h-12 v5 h-56 v-5 h-12 Z" fill="${C.gold}"/>
  <text x="${T}" y="422" text-anchor="middle" font-family="Didot" font-style="italic" font-size="31" fill="${C.cream}">A light left on over your own front door.</text>
  <text x="${T}" y="484" text-anchor="middle" font-family="Didot" font-size="13" letter-spacing="6" fill="${C.gold}" opacity="0.9">RUNS ON YOUR OWN COMPUTER</text>`;
  const body = `
<rect width="1280" height="640" fill="${C.night}"/>
<linearGradient id="fade" x1="0" x2="1" y1="0" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="scale(1280 1)"><stop offset="0.3" stop-color="#fff"/><stop offset="0.52" stop-color="#000"/></linearGradient>
<mask id="left" maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="640"><rect x="32" y="32" width="1216" height="576" fill="url(#fade)"/></mask>
<g mask="url(#left)">${sunburst({ cx: EX, cy: EY + (96 - 120) * S, n: 72, r0: 150, rLong: 560, rShort: 260, wedge: 7, line: 1, color: C.gold, opacity: 0.18 })}</g>
${border(22, 2.2)}${border(31, 0.8, 0.8)}
<g transform="translate(${EX} ${EY}) scale(${S}) translate(-120 -120)">${emblem({ raysN: 52 })}</g>
${text}`;
  return svg({ w: 1280, h: 640, body });
}

const notes = `# 20 Deco filament

An Art Deco emblem: a tall bulb inside a stepped arch with a keystone, a sunburst of fine gold rays behind it, and a filament bent into a small house whose door is a keyhole. The light is drawn as layered strokes and rays, never a blur.
Palette: green-black #0b1712 / #0f2019, glass #13291f, gold #c9a55c / #ead08f / #8a6a33, cream #efe3c4, filament #ffbf5a / #fff3d4.
Type: Didot, tracked capitals for the name, Didot Italic for the tagline, small tracked Didot capitals for the secondary lines.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logoSvg(),
  'favicon.svg': pixelsSvg(FAV16, favPal, 16),
  'favicon-32.svg': pixelsSvg(FAV32, favPal, 32),
  'icon.svg': iconSvg(),
  'hero.svg': heroSvg(),
  'notes.md': notes,
});
