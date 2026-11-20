// 16 Seventies badge: a house outline built from stacked 1970s stripes
// (mustard, orange, rust, brown) that radiate from a lantern hung over the
// front door. SuperClarendon Black with a stacked offset shadow.
import { svg, writeConcept } from '../lib/svg.mjs';

const SLUG = '16-seventies-badge';
const C = {
  night: '#2b170e',
  brown: '#5b2f18',
  rust: '#a63f1b',
  orange: '#e06a24',
  mustard: '#eeaa2e',
  cream: '#f6e7c6',
  ink: '#20110a',
};
const SERIF = `font-family="SuperClarendon, 'Rockwell', serif" font-weight="900"`;
const COND = `font-family="'Avenir Next Condensed', 'Futura', sans-serif" font-weight="600"`;

// The house the stripes are built around (200-unit badge space).
const CORE = 'M100 56L140 92L140 144L60 144L60 92Z';
const BAND = 9;

// The badge: offsets of CORE drawn as round-joined strokes, widest first.
function badge({ rim = null } = {}) {
  let s = '';
  if (rim) s += `<path d="${CORE}" fill="${rim}" stroke="${rim}" stroke-width="${2 * (4 * BAND + 6)}" stroke-linejoin="round"/>`;
  const order = [
    [4, C.brown],
    [3, C.rust],
    [2, C.orange],
    [1, C.mustard],
  ];
  for (const [k, c] of order) s += `<path d="${CORE}" fill="${c}" stroke="${c}" stroke-width="${2 * BAND * k}" stroke-linejoin="round"/>`;
  s += `<path d="${CORE}" fill="${C.cream}"/>`;
  s += lantern();
  s += door();
  return `<g>${s}</g>`;
}

// Pendant lantern hung from the gable, with short rays.
function lantern() {
  const b = C.brown;
  return `
  <g stroke-linecap="round">
    <path d="M100 58.5V66" stroke="${b}" stroke-width="2.2"/>
    <circle cx="100" cy="61.5" r="2.1" fill="none" stroke="${b}" stroke-width="1.6"/>
    <path d="M95.5 66.5h9l7 7.5h-23z" fill="${b}" stroke="${b}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="91.5" y="74" width="17" height="18.5" rx="3.5" fill="${C.mustard}" stroke="${b}" stroke-width="2.4"/>
    <circle cx="100" cy="83" r="4.2" fill="${C.cream}"/>
    <path d="M95 77.5v10" stroke="${C.cream}" stroke-width="1.6" opacity=".85"/>
    <path d="M94 92.5h12l-2.5 4h-7z" fill="${b}" stroke="${b}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="100" cy="99" r="1.8" fill="${b}"/>
    <g stroke="${C.orange}" stroke-width="3">
      <path d="M115.5 83h6.5"/><path d="M84.5 83H78"/>
      <path d="M113.4 92.6l5.2 3.8"/><path d="M86.6 92.6l-5.2 3.8"/>
      <path d="M113.4 73.4l4.4-3.2"/><path d="M86.6 73.4l-4.4-3.2"/>
    </g>
  </g>`;
}

function door() {
  return `
  <path d="M84 144V122a16 16 0 0 1 32 0V144z" fill="${C.rust}"/>
  <path d="M88.5 144V122a11.5 11.5 0 0 1 23 0V144" fill="none" stroke="${C.cream}" stroke-width="2"/>
  <circle cx="106.5" cy="130" r="2.2" fill="${C.mustard}"/>`;
}

// ---- mark -----------------------------------------------------------------
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: badge() });

// ---- favicon: redrawn on the 16 grid ---------------------------------------
// Pixel-snapped: a house of three stripes with a lit door. Straight runs sit
// on whole pixels; only the roof slopes are anti-aliased.
const favSvg = svg({
  w: 16,
  h: 16,
  vb: '0 0 16 16',
  body: `
  <path d="M8 0.6L15.4 7.2V16H0.6V7.2Z" fill="${C.brown}"/>
  <path d="M8 3L13.2 7.7V14H2.8V7.7Z" fill="${C.orange}"/>
  <path d="M8 5.6L11 8.4V12H5V8.4Z" fill="${C.mustard}"/>
  <rect x="7" y="8" width="2" height="4" fill="${C.rust}"/>`,
});
const fav32Svg = svg({
  w: 32,
  h: 32,
  vb: '0 0 32 32',
  body: `
  <path d="M16 1L30.5 14V31H1.5V14Z" fill="${C.brown}"/>
  <path d="M16 4.6L27.5 15.2V28H4.5V15.2Z" fill="${C.rust}"/>
  <path d="M16 8.2L24.5 16V25H7.5V16Z" fill="${C.orange}"/>
  <path d="M16 11.6L21.5 16.8V22H10.5V16.8Z" fill="${C.cream}"/>
  <rect x="14" y="13" width="4" height="4" rx="1" fill="${C.mustard}" stroke="${C.brown}" stroke-width="1"/>
  <rect x="14" y="19" width="4" height="3" fill="${C.rust}"/>`,
});

// ---- logo -----------------------------------------------------------------
function stacked(text, x, y, size, front, layers, extra = '') {
  // 1970s offset echo: back layers first
  let s = '';
  layers.forEach(([d, c]) => {
    s += `<text x="${x + d}" y="${y + d}" ${SERIF} font-size="${size}" fill="${c}" ${extra}>${text}</text>`;
  });
  s += `<text x="${x}" y="${y}" ${SERIF} font-size="${size}" fill="${front}" ${extra}>${text}</text>`;
  return s;
}

const logoSvg = svg({
  w: 640,
  h: 200,
  vb: '0 0 640 200',
  body: `
  <g transform="translate(20 4) scale(0.96)">${badge()}</g>
  ${stacked('Porchlight', 220, 110, 56, C.brown, [
    [5, C.mustard],
    [2.5, C.orange],
  ])}
  <text x="222" y="142" ${COND} font-size="17" letter-spacing="3.4" fill="${C.rust}">YOUR CODE · YOUR SITES · YOUR MAC</text>`,
});

// ---- icon -----------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
  <rect x="16" y="16" width="480" height="480" rx="108" fill="${C.night}"/>
  <rect x="32" y="32" width="448" height="448" rx="94" fill="none" stroke="${C.brown}" stroke-width="6"/>
  <g transform="translate(256 262) scale(2.05) translate(-100 -100)">${badge({ rim: C.cream })}</g>`,
});

// ---- hero -----------------------------------------------------------------
function swoosh() {
  const d = 'M-60 548C220 600 520 520 760 482S1120 440 1340 436';
  const cols = [C.mustard, C.orange, C.rust, C.brown];
  return cols
    .map((c, k) => `<path d="${d}" transform="translate(0 ${k * 30})" fill="none" stroke="${c}" stroke-width="31"/>`)
    .join('');
}

const stars = [
  [610, 92, 2.2], [742, 58, 1.6], [880, 120, 2], [1012, 70, 1.5], [1220, 210, 1.8], [540, 210, 1.4], [96, 120, 1.8], [168, 64, 1.4], [70, 300, 1.4], [1085, 160, 1.3],
]
  .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.cream}" opacity=".8"/>`)
  .join('');

const heroSvg = svg({
  w: 1280,
  h: 640,
  vb: '0 0 1280 640',
  body: `
  <rect width="1280" height="640" fill="${C.night}"/>
  ${stars}
  <path d="M1176 86a44 44 0 1 0 38 66a36 36 0 1 1 -38 -66z" fill="${C.cream}"/>
  ${swoosh()}
  <g transform="translate(318 330) scale(2.55) translate(-100 -100)">${badge({ rim: C.cream })}</g>
  <text x="626" y="236" ${COND} font-size="20" letter-spacing="5" fill="${C.mustard}">YOUR CODE · YOUR SITES · YOUR MAC</text>
  ${stacked('Porchlight', 620, 336, 92, C.cream, [
    [12, C.rust],
    [8, C.orange],
    [4, C.mustard],
  ])}
  <text x="624" y="398" ${COND} font-size="31" letter-spacing="0.6" fill="${C.cream}">A light left on over your own front door.</text>`,
});

const notes = `# 16 Seventies badge

A house drawn as stacked 1970s stripes that radiate from a lantern hung over the front door, like a rainbow sticker or a van stripe. The wordmark uses the period's stacked offset echo, and the stripes swoop across the banner.
Palette: night #2b170e, brown #5b2f18, rust #a63f1b, orange #e06a24, mustard #eeaa2e, cream #f6e7c6.
Type: SuperClarendon Black (wordmark), Avenir Next Condensed Demi Bold (secondary line and tagline).
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
