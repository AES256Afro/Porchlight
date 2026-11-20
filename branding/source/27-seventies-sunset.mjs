// 27 Seventies sunset: concept 16's stripes, let out of their badge. They are a
// sunset now, behind a house in silhouette, and the porch light is the one
// bright point in front of it. No brown.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '27-seventies-sunset';
const C = {
  sky0: '#0a2130',
  sky1: '#0e2b3c',
  sky2: '#133748',
  ridge: '#0f3040',
  hill: '#0a2230',
  front: '#071821',
  house: '#06141c',
  pane: '#12303f',
  tomato: '#de4a2c',
  orange: '#f1802b',
  mustard: '#f4b63f',
  cream: '#f9edc9',
  hot: '#fffbe6',
  navy: '#0c2433',
};
const FONTS = { Soft: 'Georgia-BoldItalic', FutM: 'Futura-Medium' };
const f = (n) => Math.round(n * 100) / 100;
const BANDS = [C.tomato, C.orange, C.mustard, C.cream];

// A gabled house with a chimney and a porch, as one silhouette. Origin is the
// middle of the front step; `s` scales it. The door stands at x = 0.
function house(s = 1, { fill = C.house, pane = C.pane, light = true, detail = true } = {}) {
  const p = (x, y) => `${f(x * s)},${f(y * s)}`;
  const body = `M${p(-78, 0)}V${f(-70 * s)}L${p(-88, -70)}L${p(-10, -138)}L${p(22, -110)}V${f(-132 * s)}H${f(38 * s)}V${f(-96 * s)}L${p(68, -70)}H${f(150 * s)}L${p(160, -62)}V${f(-56 * s)}H${f(150 * s)}V0Z`;
  let out = `<path d="${body}" fill="${fill}"/>`;
  if (detail) {
    out += `
<path d="M${p(-44, -14)}h${f(24 * s)}v${f(-34 * s)}h${f(-24 * s)}z M${p(88, -14)}h${f(40 * s)}v${f(-28 * s)}h${f(-40 * s)}z M${p(-18, -84)}h${f(16 * s)}v${f(-16 * s)}h${f(-16 * s)}z" fill="${pane}"/>
<path d="M${p(-32, -14)}v${f(-34 * s)}M${p(108, -14)}v${f(-28 * s)}" stroke="${fill}" stroke-width="${f(2.4 * s)}"/>
<path d="M${p(8, 0)}V${f(-50 * s)}H${f(38 * s)}V0Z" fill="${pane}"/>`;
  }
  if (light) {
    out += `
<circle cx="${f(50 * s)}" cy="${f(-52 * s)}" r="${f(22 * s)}" fill="none" stroke="${C.mustard}" stroke-width="${f(1.8 * s)}" opacity="0.5"/>
<circle cx="${f(50 * s)}" cy="${f(-52 * s)}" r="${f(13 * s)}" fill="none" stroke="${C.mustard}" stroke-width="${f(2.6 * s)}"/>
<circle cx="${f(50 * s)}" cy="${f(-52 * s)}" r="${f(6.4 * s)}" fill="${C.hot}"/>`;
  }
  return out;
}

function pine(x, y, h, fill) {
  const w = h * 0.42;
  let d = '';
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const top = y - h + (i * h * 0.8) / tiers;
    const bot = top + h * 0.36;
    const hw = (w / 2) * (0.42 + (0.58 * (i + 1)) / tiers);
    d += `M${f(x)},${f(top)}L${f(x + hw)},${f(bot)}H${f(x - hw)}Z`;
  }
  d += `M${f(x - w * 0.06)},${f(y - h * 0.1)}h${f(w * 0.12)}V${f(y)}h${f(-w * 0.12)}Z`;
  return `<path d="${d}" fill="${fill}"/>`;
}

// ---- mark: the sun, the hill, the house, the light -----------------------------
function markBody() {
  const rings = [94, 73, 52, 31].map((r, i) => `<circle cx="100" cy="100" r="${r}" fill="${BANDS[i]}"/>`).join('');
  return `
<clipPath id="sun"><circle cx="100" cy="100" r="94"/></clipPath>
${rings}
<g clip-path="url(#sun)">
  <path d="M0,150Q100,128 200,150V200H0Z" fill="${C.navy}"/>
  <path d="M58,146V104L50,104L96,62L112,76V64H124V87L142,104H134V146Z" fill="${C.navy}"/>
</g>
<circle cx="114" cy="120" r="10.5" fill="none" stroke="${C.mustard}" stroke-width="2.6"/>
<circle cx="114" cy="120" r="5.6" fill="${C.hot}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid ---------------------------------------------------
const PIX = { T: C.tomato, O: C.orange, M: C.mustard, C: C.cream, N: C.navy, H: C.hot };
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
function favRows(n) {
  const g = Array.from({ length: n }, () => Array(n).fill('.'));
  const c = n / 2 - 0.5;
  const R = n / 2;
  const radii = n === 16 ? [8.2, 6.1, 4.2, 2.4] : [16.2, 12.4, 8.7, 5.0];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > R + 0.2) continue;
      let ch = '.';
      ['T', 'O', 'M', 'C'].forEach((k, i) => { if (d <= radii[i]) ch = k; });
      g[y][x] = ch;
    }
  const stamp = (rows, x0, y0) => rows.forEach((row, j) => [...row].forEach((ch, i) => {
    const x = x0 + i;
    const y = y0 + j;
    if (ch === '.' || y >= n || x >= n) return;
    if (ch === 'n') { if (g[y][x] !== '.') g[y][x] = 'N'; } else g[y][x] = ch;
  }));
  if (n === 16) {
    stamp([
      '......NN.N......',
      '.....NNNNN......',
      '....NNNNNNN.....',
      '...NNNNNNNNN....',
      '....NNNNNNN.....',
      '....NNNNHNN.....',
      '....NNNNNNN.....',
      'nnnnNNNNNNNnnnnn',
      'nnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnn',
    ], 0, 5);
  } else {
    stamp([
      '.............NN..NN.............',
      '............NNNN.NN.............',
      '...........NNNNNNNN.............',
      '..........NNNNNNNNNN............',
      '.........NNNNNNNNNNNN...........',
      '........NNNNNNNNNNNNNN..........',
      '.......NNNNNNNNNNNNNNNN.........',
      '.........NNNNNNNNNNNN...........',
      '.........NNNNNNNNMNNN...........',
      '.........NNNNNNNMHMNN...........',
      '.........NNNNNNNNMNNN...........',
      '.........NNNNNNNNNNNN...........',
      '.........NNNNNNNNNNNN...........',
      'nnnnnnnnnNNNNNNNNNNNNnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
    ], 0, 10);
  }
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(favRows(16)) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(favRows(32)) });

// ---- icon ------------------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="${C.sky1}"/>
  ${[236, 186, 136, 86].map((r, i) => `<circle cx="256" cy="330" r="${r}" fill="${BANDS[i]}"/>`).join('')}
  <path d="M0,372Q256,318 512,372V512H0Z" fill="${C.front}"/>
  <g transform="translate(236 356)">${house(1.5, { fill: C.front, detail: false, light: false })}</g>
  <circle cx="311" cy="278" r="24" fill="none" stroke="${C.mustard}" stroke-width="6"/>
  <circle cx="311" cy="278" r="12.5" fill="${C.hot}"/>
</g>`,
});

// ---- wordmark ----------------------------------------------------------------------------
// Georgia Bold Italic, fattened and rounded with a stroke of its own colour.
function word(x, y, size, fill, extra = '') {
  return `<text x="${x}" y="${y}" font-family="Soft" font-size="${size}" letter-spacing="${f(size * 0.04)}" fill="${fill}" stroke="${fill}" stroke-width="${f(size * 0.1)}" stroke-linejoin="round" ${extra}>Porchlight</text>`;
}
function stripes(x, y, w, t, gap = 0) {
  return [C.mustard, C.orange, C.tomato]
    .map((c, i) => `<rect x="${x}" y="${f(y + i * (t + gap))}" width="${f(w - i * w * 0.14)}" height="${t}" rx="${t / 2}" fill="${c}"/>`)
    .join('');
}

function logo(dark) {
  const ink = dark ? C.cream : C.navy;
  return svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    body: `
${nest({ x: 14, y: 14, w: 172, h: 172, vb: '0 0 200 200', body: markBody() })}
${word(208, 110, 67, ink)}
${stripes(208, 132, 250, 5, 2.5)}
<text x="208" y="178" font-family="FutM" font-size="15" letter-spacing="5" fill="${ink}">LEAVE THE LIGHT ON</text>`,
  });
}

// ---- hero ------------------------------------------------------------------------------------
function hero() {
  const r = rng(27);
  const SX = 962;
  const SY = 474;
  const sun = [270, 214, 158, 102].map((rad, i) => `<circle cx="${SX}" cy="${SY}" r="${rad}" fill="${BANDS[i]}"/>`).join('');

  let stars = '';
  for (let i = 0; i < 64; i++) {
    const x = r() * 1280;
    const y = r() * 330;
    if (Math.hypot(x - SX, y - SY) < 292) continue;
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + r() * 1.3)}" fill="${C.cream}" opacity="${f(0.35 + r() * 0.55)}"/>`;
  }

  // far ridge with pines, in front of the sun's foot
  const ridge = `<path d="M0,452C160,424 330,446 500,436C640,428 720,452 860,446C1000,440 1110,420 1280,440V640H0Z" fill="${C.ridge}"/>`;
  const farPines = [[34, 446, 54], [70, 444, 40], [470, 438, 46], [512, 438, 62], [552, 440, 38], [1168, 430, 58], [1208, 432, 42], [1250, 436, 66]]
    .map(([x, y, h]) => pine(x, y, h, C.ridge))
    .join('');
  // the hill the house stands on
  const hill = `<path d="M0,520C200,500 420,512 600,496C760,482 860,470 962,470C1070,470 1170,486 1280,478V640H0Z" fill="${C.hill}"/>`;
  const nearPines = [[716, 488, 118], [766, 482, 82], [1166, 480, 150], [1220, 482, 96]].map(([x, y, h]) => pine(x, y, h, C.house)).join('');
  // the path down from the door
  const path = `<path d="M964,470C960,500 918,520 856,540C776,566 716,590 706,640H612C626,584 716,552 806,528C876,508 930,496 934,470Z" fill="${C.ridge}"/>`;
  const front = `<path d="M0,596C240,570 520,600 780,590C980,582 1120,560 1280,570V640H0Z" fill="${C.front}"/>`;

  return `
<rect width="1280" height="640" fill="${C.sky0}"/>
<rect y="118" width="1280" height="522" fill="${C.sky1}"/>
<rect y="356" width="1280" height="284" fill="${C.sky2}"/>
${stars}
${sun}
${ridge}${farPines}
${hill}
${path}
${nearPines}
<g transform="translate(926 472)">${house(1.02)}</g>
${front}
${[[34, 612, 150], [98, 604, 104], [150, 612, 70]].map(([x, y, h]) => pine(x, y, h, C.house)).join('')}
<text x="76" y="172" font-family="FutM" font-size="15.5" letter-spacing="5.4" fill="${C.mustard}">YOUR CODE · YOUR DOMAINS · YOUR MAC</text>
${word(78, 280, 106, C.cream)}
${stripes(76, 312, 380, 8, 4)}
<text x="76" y="402" font-family="FutM" font-size="37" letter-spacing="0.4" fill="${C.cream}">Leave the light on.</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 27 Seventies sunset

Concept 16's stripes, let out of their badge and without the brown: they are a sunset now, four bands going down behind a house in silhouette among the pines, and the porch light by the door is the one bright point in front of it. The name is in a fat, soft italic of the period (in the manner of Cooper Black) over a three-stripe underline. The mark is the sun with the hill, the house and the light cut into it.
Palette: dusk teal #0a2130 / #0e2b3c / #133748, silhouette #06141c, tomato #de4a2c, orange #f1802b, mustard #f4b63f, cream #f9edc9, lamp white #fffbe6.
Type: Georgia Bold Italic, fattened and rounded with its own outline, for the name; Futura Medium for the tagline and the small tracked capitals.
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
