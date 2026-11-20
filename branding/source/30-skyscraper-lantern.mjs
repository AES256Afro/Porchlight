// 30 Skyscraper lantern: a wall lantern built like a Deco spire: a needle, a
// crown of arches with lit triangular windows, a shaft of amber glass between
// chrome fins, setbacks at its shoulders. Its light is drawn as stepped bars.
// The name is lettered in tall monoline capitals; the I is a lantern too.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '30-skyscraper-lantern';
const C = {
  black: '#0a0b0e',
  coal: '#121317',
  graphite: '#1b1d23',
  iron: '#2b2e36',
  steelDk: '#6f7785',
  steel: '#a9b0bc',
  silver: '#d3d8df',
  chrome: '#f0f2f5',
  amber: '#f2a11a',
  amberLt: '#ffcb52',
  hot: '#fff2c6',
  ember1: '#4a3410',
  ember2: '#2d2414',
  paperInk: '#16181d',
};
const FONTS = { FutM: 'Futura-Medium', FutB: 'Futura-Bold' };
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, a) => `${f(cx + r * Math.cos(rad(a)))},${f(cy + r * Math.sin(rad(a)))}`;

// ---- the lantern ----------------------------------------------------------------
// Drawn about x = 0 with the needle's tip at y = 0. `kx` widens it for small sizes.
// `m` is the metal: { lo, mid, hi, top } from shadow to highlight.
function lantern({ kx = 1, m, windows = [3, 5, 7, 9], slits = true, plate = null }) {
  const X = (n) => f(n * kx);
  const tops = [78, 90, 106, 126];
  const radii = [20, 32, 44, 56].map((r) => r * kx);
  const tiers = tops.map((t, i) => ({ r: radii[i], cy: t + radii[i] }));
  const y0 = tiers[3].cy; // foot of the crown
  let out = '';
  if (plate) {
    out += `<path d="M${X(-66)},${y0 - 10}H${X(66)}V${y0 + 2}H${X(80)}V${y0 + 156}H${X(66)}V${y0 + 168}H${X(-66)}V${y0 + 156}H${X(-80)}V${y0 + 2}H${X(-66)}Z" fill="${plate.fill}" stroke="${plate.line}" stroke-width="1.5"/>`;
  }
  // needle and its two collars
  out += `<path d="M0,0L${X(3.4)},78H${X(-3.4)}Z" fill="${m.hi}"/>
<rect x="${X(-5.5)}" y="46" width="${X(11)}" height="3.5" fill="${m.mid}"/>
<rect x="${X(-8)}" y="60" width="${X(16)}" height="4" fill="${m.mid}"/>`;
  // crown: arches from the top down, each larger one overlapping the last
  tiers.forEach(({ r, cy }, i) => {
    const n = windows[i];
    out += `<path d="M${f(-r)},${cy}A${f(r)},${f(r)} 0 0 1 ${f(r)},${cy}Z" fill="${m.mid}"/>`;
    out += `<path d="M${f(-r)},${cy}A${f(r)},${f(r)} 0 0 1 0,${f(cy - r)}L0,${cy}Z" fill="${m.hi}"/>`;
    out += `<path d="M${f(-r)},${cy}A${f(r)},${f(r)} 0 0 1 ${f(r)},${cy}" fill="none" stroke="${m.top}" stroke-width="${f(2.2 * Math.sqrt(kx))}"/>`;
    if (n) {
      const span = i === 0 ? 100 : 136;
      let d = '';
      for (let k = 0; k < n; k++) {
        const a = -90 + (n === 1 ? 0 : -span / 2 + (span * k) / (n - 1));
        const w = (5.2 * kx * 57.3) / (r - 12 * kx); // half-width in degrees at the base
        d += `M${pt(0, cy, r - 3.6 * kx, a)}L${pt(0, cy, r - 13.5 * kx, a + w)}L${pt(0, cy, r - 13.5 * kx, a - w)}Z`;
      }
      out += `<path d="${d}" fill="${C.amberLt}"/>`;
    }
  });
  // collar
  out += `<rect x="${X(-56)}" y="${y0}" width="${X(112)}" height="6" fill="${m.top}"/>
<rect x="${X(-50)}" y="${y0 + 6}" width="${X(100)}" height="5" fill="${m.lo}"/>
<rect x="${X(-44)}" y="${y0 + 11}" width="${X(88)}" height="5" fill="${m.mid}"/>`;
  // glass shaft: amber at the edges, hot in the middle
  const g0 = y0 + 16;
  const g1 = y0 + 142;
  out += `<rect x="${X(-38)}" y="${g0}" width="${X(76)}" height="${g1 - g0}" fill="${C.amber}"/>
<rect x="${X(-27)}" y="${g0}" width="${X(54)}" height="${g1 - g0}" fill="${C.amberLt}"/>
<rect x="${X(-13)}" y="${g0}" width="${X(26)}" height="${g1 - g0}" fill="${C.hot}"/>`;
  // fins and bands
  for (const x of [-38, -14, 14, 38]) {
    const w = Math.abs(x) > 20 ? 7 : 4.6;
    out += `<rect x="${X(x) - (w * Math.sqrt(kx)) / 2}" y="${g0}" width="${f(w * Math.sqrt(kx))}" height="${g1 - g0}" fill="${Math.abs(x) > 20 ? m.mid : m.hi}"/>`;
  }
  for (const [dy, h] of [
    [42, 3.4],
    [84, 3.4],
  ])
    out += `<rect x="${X(-41.5)}" y="${g0 + dy}" width="${X(83)}" height="${h}" fill="${m.lo}"/>`;
  // setbacks at the shoulders, each with a lit slit
  for (const s of [-1, 1]) {
    out += `<rect x="${Math.min(X(s * 41.5), X(s * 54))}" y="${g0 + 42}" width="${X(12.5)}" height="${g1 - g0 - 42}" fill="${s < 0 ? m.hi : m.mid}"/>
<rect x="${Math.min(X(s * 54), X(s * 64))}" y="${g0 + 84}" width="${X(10)}" height="${g1 - g0 - 84}" fill="${m.lo}"/>`;
    if (slits)
      out += `<rect x="${f(X(s * 47.7) - 1.6)}" y="${g0 + 56}" width="3.2" height="${g1 - g0 - 70}" fill="${C.amberLt}"/>`;
  }
  // base and the stepped pendant
  out += `<rect x="${X(-70)}" y="${g1}" width="${X(140)}" height="8" fill="${m.top}"/>
<rect x="${X(-62)}" y="${g1 + 8}" width="${X(124)}" height="6" fill="${m.lo}"/>
<rect x="${X(-46)}" y="${g1 + 14}" width="${X(92)}" height="9" fill="${m.mid}"/>
<rect x="${X(-32)}" y="${g1 + 23}" width="${X(64)}" height="9" fill="${m.hi}"/>
<rect x="${X(-18)}" y="${g1 + 32}" width="${X(36)}" height="9" fill="${m.mid}"/>
<path d="M${X(-4)},${g1 + 41}H${X(4)}L0,${g1 + 72}Z" fill="${m.hi}"/>
<circle cx="0" cy="${g1 + 47}" r="${f(6.5 * Math.sqrt(kx))}" fill="${m.top}"/>`;
  return { body: out, height: g1 + 72, glassY: (g0 + g1) / 2, y0 };
}
const CHROME = { lo: C.steelDk, mid: C.steel, hi: C.silver, top: C.chrome };
const INK = { lo: '#000000', mid: C.graphite, hi: C.iron, top: '#3b3f49' };

// Light as stepped bars: flat bars either side of the glass, shorter the further
// they are from its middle, each stepping down in tone along its length.
// tones: [[fraction of the length, fill], ...] from the far end in.
function lightBars(cx, cy, x0, { lengths, pitch, th, tones }) {
  let out = '';
  lengths.forEach((len, i) => {
    for (const dy of i === 0 ? [0] : [-i * pitch, i * pitch]) {
      for (const sg of [-1, 1]) {
        for (const [fr, fill] of tones) {
          const l = len * fr;
          out += `<rect x="${f(sg > 0 ? cx + x0 : cx - x0 - l)}" y="${f(cy + dy - th / 2)}" width="${f(l)}" height="${th}" fill="${fill}"/>`;
        }
      }
    }
  });
  return out;
}
const TONES = [
  [1, C.ember1],
  [0.66, '#9c6a12'],
  [0.36, C.amber],
];

// ---- lettering: tall monoline capitals, bowls and bars carried high --------------
const GL = {
  P: { w: 44, d: 'M0,160V0H20A24,24 0 0 1 20,48H0' },
  O: { w: 44, d: 'M22,0A22,22 0 0 1 44,22V138A22,22 0 0 1 0,138V22A22,22 0 0 1 22,0Z' },
  R: { w: 44, d: 'M0,160V0H20A24,24 0 0 1 20,48H0M17,48L44,160' },
  C: { w: 44, d: 'M44,36V22A22,22 0 0 0 0,22V138A22,22 0 0 0 44,138V124' },
  H: { w: 44, d: 'M0,0V160M44,0V160M0,48H44' },
  L: { w: 36, d: 'M0,0V160H36' },
  I: { w: 0, d: '' },
  G: { w: 44, d: 'M44,36V22A22,22 0 0 0 0,22V138A22,22 0 0 0 44,138V94H23' },
  T: { w: 44, d: 'M0,0H44M22,0V160' },
};
const WORD = 'PORCHLIGHT';
const GAP = 22;
const WORD_W = [...WORD].reduce((s, ch) => s + GL[ch].w, 0) + GAP * (WORD.length - 1);
// Draws the name `h` tall with its left edge at x and its cap line at y.
function wordmark(x, y, h, { ink, sw = 9, lamp = C.amber, cap = ink }) {
  const k = h / 160;
  let px = 0;
  let d = '';
  let lampX = 0;
  for (const ch of WORD) {
    if (ch === 'I') lampX = px;
    else d += GL[ch].d.replace(/([MLHVA])/g, ' $1').replace(/ M(-?[\d.]+)/g, (_, n) => ` M${f(+n + px)}`).replace(/ H(-?[\d.]+)/g, (_, n) => ` H${f(+n + px)}`).replace(/ L(-?[\d.]+)/g, (_, n) => ` L${f(+n + px)}`).replace(/ A([^ ]+) 0 0 ([01]) (-?[\d.]+)/g, (_, r, sweep, n) => ` A${r} 0 0 ${sweep} ${f(+n + px)}`);
    px += GL[ch].w + GAP;
  }
  return `<g transform="translate(${x} ${y}) scale(${f(k)})">
<path d="${d.trim()}" fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="miter"/>
<rect x="${lampX - sw / 2}" y="22" width="${sw}" height="138" fill="${lamp}"/>
<rect x="${lampX - sw / 2 - 4}" y="14" width="${sw + 8}" height="6" fill="${cap}"/>
<path d="M${lampX},-22L${lampX + 2.6},12H${lampX - 2.6}Z" fill="${cap}"/>
</g>`;
}

// ---- mark: the lantern with three stepped bars of light each side -----------------
function markBody(m) {
  const L = lantern({ kx: 1.34, m, windows: [0, 3, 5, 7], slits: false });
  const s = 188 / L.height;
  const gy = 6 + L.glassY * s;
  const rays = lightBars(100, gy, 54, { lengths: [32, 25, 18, 11], pitch: 14, th: 6.5, tones: [[1, C.amber]] });
  return `${rays}<g transform="translate(100 6) scale(${f(s)})">${L.body}</g>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody(INK) });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody(CHROME) });

// ---- favicons, on the pixel grid ---------------------------------------------------
const PIX = { M: '#5d6573', S: '#9aa2ae', D: '#2b2e36', A: C.amber, L: C.amberLt, H: C.hot };
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
  '.......MM.......',
  '.......MM.......',
  '......MSSM......',
  '.....MSAASM.....',
  '....MSAMMASM....',
  '...MMMMMMMMMM...',
  '....DALHHLAD....',
  '.AA.DALHHLAD.AA.',
  '....DALHHLAD....',
  'AAA.DALHHLAD.AAA',
  '....DALHHLAD....',
  '.AA.DALHHLAD.AA.',
  '...MMMMMMMMMM...',
  '....MSSSSSSM....',
  '......MSSM......',
  '.......MM.......',
];
const FAV32 = [
  '...............MM...............',
  '...............MM...............',
  '...............MM...............',
  '..............MSSM..............',
  '..............MSSM..............',
  '.............MSSSSM.............',
  '............MSSAASSM............',
  '...........MSSAAAASSM...........',
  '..........MSSSSSSSSSSM..........',
  '.........MSSALSSSSLASSM.........',
  '........MSSAALSSSSLAASSM........',
  '.......MMMMMMMMMMMMMMMMMM.......',
  '........SSSSSSSSSSSSSSSS........',
  '.........DDALLHHHHLLADD.........',
  '..AAAA...DDALLHHHHLLADD...AAAA..',
  '..AAAA...DDALLHHHHLLADD...AAAA..',
  '.........DDALLHHHHLLADD.........',
  '.........DDDDDDDDDDDDDD.........',
  'AAAAAA...DDALLHHHHLLADD...AAAAAA',
  'AAAAAA...DDALLHHHHLLADD...AAAAAA',
  '.........DDALLHHHHLLADD.........',
  '.........DDDDDDDDDDDDDD.........',
  '..AAAA...DDALLHHHHLLADD...AAAA..',
  '..AAAA...DDALLHHHHLLADD...AAAA..',
  '.........DDALLHHHHLLADD.........',
  '.......MMMMMMMMMMMMMMMMMM.......',
  '........SSSSSSSSSSSSSSSS........',
  '..........MMMMMMMMMMMM..........',
  '............SSSSSSSS............',
  '..............MMMM..............',
  '...............SS...............',
  '...............MM...............',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- icon ---------------------------------------------------------------------------
function icon() {
  const L = lantern({ kx: 1.5, m: CHROME, windows: [0, 3, 5, 7] });
  const s = 432 / L.height;
  const gy = 40 + L.glassY * s;
  return `
<clipPath id="ic"><rect width="512" height="512" rx="112"/></clipPath>
<g clip-path="url(#ic)">
  <rect width="512" height="512" fill="${C.black}"/>
  <circle cx="256" cy="${f(gy)}" r="236" fill="${C.coal}"/>
  <circle cx="256" cy="${f(gy)}" r="168" fill="${C.graphite}"/>
  ${lightBars(256, gy, 130, { lengths: [98, 80, 62, 44], pitch: 34, th: 15, tones: [[1, '#9c6a12'], [0.56, C.amber]] })}
  <g transform="translate(256 40) scale(${f(s)})">${L.body}</g>
</g>`;
}
const iconSvg = svg({ w: 512, h: 512, vb: '0 0 512 512', body: icon() });

// ---- logo ----------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.silver : C.paperInk;
  const k = 104 / 160;
  const x = 212;
  return `
${nest({ x: 8, y: 5, w: 190, h: 190, vb: '0 0 200 200', body: markBody(dark ? CHROME : INK) })}
${wordmark(x, 34, 104, { ink, sw: 9.5, lamp: C.amber, cap: ink })}
<path d="M${x - 3},156H${f(x + WORD_W * k + 3)}" stroke="${ink}" stroke-width="2.4"/>
<path d="M${x - 3},162H${f(x + WORD_W * k + 3)}" stroke="${ink}" stroke-width="1"/>
<text x="${x - 3}" y="188" font-family="FutM" font-size="15.5" letter-spacing="7.7" fill="${ink}">THE LIGHT STAYS ON</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(true) });

// ---- hero -------------------------------------------------------------------------------
function hero() {
  const LX = 324;
  const L = lantern({ m: CHROME, plate: { fill: '#24272e', line: C.steelDk } });
  const s = 462 / L.height;
  const top = 82;
  const gy = top + L.glassY * s;

  // two moths, drawn to the light
  const moth = (x, y, r, sc) => `
<g transform="translate(${x} ${y}) rotate(${r}) scale(${sc})" fill="${C.silver}">
  <path d="M0,0L-15,-9Q-19,-1 -11,5ZM0,0L15,-9Q19,-1 11,5Z"/>
  <path d="M0,1L-8,11Q-3,13 0,6ZM0,1L8,11Q3,13 0,6Z" fill="${C.steel}"/>
  <ellipse cx="0" cy="2" rx="2.1" ry="7" fill="${C.chrome}"/>
</g>`;

  const WX = 644;
  const WY = 210;
  const words = `
<text x="${WX - 4}" y="${WY - 44}" font-family="FutM" font-size="15" letter-spacing="7.6" fill="${C.steel}">YOUR CODE · YOUR DOMAINS · YOUR MAC</text>
${wordmark(WX, WY, 160, { ink: C.chrome, sw: 10, lamp: C.amberLt, cap: C.chrome })}
<path d="M${WX - 5},${WY + 186}H${WX + WORD_W + 5}" stroke="${C.silver}" stroke-width="3"/>
<path d="M${WX - 5},${WY + 194}H${WX + WORD_W + 5}" stroke="${C.silver}" stroke-width="1.4"/>
<path d="M${WX - 5},${WY + 200}H${WX + WORD_W + 5}" stroke="${C.steelDk}" stroke-width="1"/>
<text x="${WX - 4}" y="${WY + 254}" font-family="FutM" font-size="40" letter-spacing="3.4" fill="${C.amberLt}">The light stays on.</text>`;

  return `
<rect width="1280" height="640" fill="${C.black}"/>
<clipPath id="field"><rect x="0" y="58" width="1280" height="524"/></clipPath>
<g clip-path="url(#field)">
  <circle cx="${LX}" cy="${f(gy)}" r="292" fill="${C.coal}"/>
  <circle cx="${LX}" cy="${f(gy)}" r="214" fill="${C.graphite}"/>
</g>
${lightBars(LX, gy, 106, { lengths: [174, 152, 130, 108, 86, 64], pitch: 17, th: 7, tones: TONES })}
<g transform="translate(${LX} ${top}) scale(${f(s)})">${L.body}</g>
${moth(466, 152, -24, 1.1)}${moth(168, 498, 34, 0.8)}
${words}
<path d="M0,44H1280M0,596H1280" stroke="${C.silver}" stroke-width="3"/>
<path d="M0,52H1280M0,588H1280" stroke="${C.silver}" stroke-width="1.2"/>
<path d="M0,58H1280M0,582H1280" stroke="${C.steelDk}" stroke-width="1"/>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 30 Skyscraper lantern

The chrome side of Deco. A wall lantern built like a 1930 spire: a needle, a crown of stacked arches with lit triangular windows, a shaft of amber glass between chrome fins, setbacks at the shoulders and a stepped pendant. Its light is drawn as flat bars that step shorter above and below the glass and step down in tone along their length, on two rings of lifted black. The name is lettered by hand in tall monoline capitals with the bowls and bars carried high, and its I is a small lantern with a needle of its own. The mark is the lantern with stepped bars of light either side.
Palette: black #0a0b0e, graphite #1b1d23, steel #6f7785 / #a9b0bc, silver #d3d8df, chrome #f0f2f5, amber #f2a11a / #ffcb52, lamp #fff2c6.
Type: the name is drawn, not set: tall monoline capitals. Futura Medium for the tagline and the small tracked capitals.
Tagline: The light stays on.
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
