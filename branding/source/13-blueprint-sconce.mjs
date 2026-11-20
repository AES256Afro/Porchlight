// 13 Blueprint sconce: a general-arrangement drawing of a porch lantern,
// front elevation and section, with a title block. One amber accent: the lamp.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '13-blueprint-sconce';
const C = {
  ground: '#0f3a66',
  groundDeep: '#0b2f55',
  line: '#eef5fc',
  pale: '#9fcbef',
  faint: '#5f8fbd',
  amber: '#ffb44a',
};
const MONO = 'Menlo';
const TITLE = 'DIN Condensed';

// Lantern profile in drawing units (x centred on 0, y down from the finial).
const LANTERN = {
  finial: `<circle cx="0" cy="6" r="5"/><path d="M-3 11h6v5h-6Z"/>`,
  cap: 'M-10 16H10L58 42H-58Z',
  lip: 'M-64 42H64V50H-64Z',
  band: 'M-54 50H54V58H-54Z',
  glassOuter: 'M-52 58H52L42 166H-42Z',
  glassInner: 'M-44 64H44L36.6 160H-36.6Z',
  bottomBand: 'M-46 166H46V174H-46Z',
  pan: 'M-42 174H42L22 190H-22Z',
  tip: 'M-6 190H6L0 206Z',
  plate: 'M-30 30A30 30 0 0 1 30 30V214A30 30 0 0 1 -30 214Z',
  socket: 'M-8 138H8V160H-8Z',
  bulb: 'M-7 138C-7 128 -20 124 -20 108A20 20 0 1 1 20 108C20 124 7 128 7 138Z',
  filament: 'M-4.5 136L-6 113M4.5 136L6 113M-6 113l2 -3l2 3l2 -3l2 3l2 -3',
};

// In the hero, strokes are in screen pixels (non-scaling); in the tiles they scale with the drawing.
let NSS = true;
const VE = () => (NSS ? 'vector-effect="non-scaling-stroke"' : '');
const S = (w, extra = '', fill = 'none') => `fill="${fill}" stroke-width="${w}" ${VE()} stroke-linejoin="round" ${extra}`;

function frontElevation({ heavy = 2, thin = 1.1, ground = C.ground } = {}) {
  const L = LANTERN;
  let b = '';
  // wall plate behind
  b += `<path d="${L.plate}" stroke="${C.line}" ${S(heavy, '', `${ground}`)}/>`;
  b += `<circle cx="0" cy="226" r="3.4" stroke="${C.line}" ${S(thin, '', `none`)}/><path d="M-2.4 226h4.8" stroke="${C.line}" ${S(thin)}/>`;
  // lantern, filled with ground so it hides the plate
  b += `<g fill="${ground}" stroke="${C.line}" stroke-width="${heavy}" stroke-linejoin="round">`;
  for (const k of ['cap', 'lip', 'band', 'glassOuter', 'bottomBand', 'pan', 'tip']) b += `<path d="${L[k]}" ${VE()}/>`;
  b += `<g>${L.finial.replace(/\/>/g, ` ${VE()}/>`)}</g>`;
  b += `</g>`;
  b += `<path d="${L.glassInner}" stroke="${C.line}" ${S(thin)}/>`;
  // corner posts' inner edges reflected in the glass
  b += `<path d="M-30 70L-27 150" stroke="${C.pale}" ${S(thin * 0.8, 'stroke-dasharray="3 3"')}/>`;
  // lamp: the one amber thing on the sheet
  b += `<path d="${L.bulb}" stroke="${C.amber}" ${S(heavy * 0.9)}/>`;
  b += `<path d="${L.filament}" stroke="${C.amber}" ${S(thin)}/>`;
  b += `<path d="${L.socket}" stroke="${C.line}" ${S(thin, '', `${ground}`)}/><path d="M-8 144H8M-8 149H8M-8 154H8" stroke="${C.pale}" ${S(thin * 0.8)}/>`;
  return b;
}

function sectionView({ heavy = 2, thin = 1.1 } = {}) {
  // wall face at x=0, lantern centre at x=150
  let b = '';
  // wall, hatched, with break lines top and bottom
  b += `<path d="M-36 -14L-24 -20L-14 -10L0 -18V258L-12 250L-24 262L-36 254Z" fill="url(#hatch)" stroke="none"/>`;
  b += `<path d="M0 -18V258" stroke="${C.line}" ${S(heavy)}/>`;
  b += `<path d="M-36 -14L-24 -20L-14 -10L0 -18M-36 254L-24 262L-12 250L0 258" stroke="${C.line}" ${S(thin)}/>`;
  // plate in section
  b += `<path d="M0 0H8V244H0Z" stroke="${C.line}" ${S(heavy, '', `url(#hatch2)`)}/>`;
  // arm (a tube) and its scroll
  const arm = 'M8 214H118C140 214 150 212 150 204';
  b += `<path d="${arm}" fill="none" stroke="${C.line}" stroke-width="11" stroke-linecap="butt" vector-effect="non-scaling-stroke"/>`;
  b += `<path d="${arm}" fill="none" stroke="${C.ground}" stroke-width="7.4" stroke-linecap="butt" vector-effect="non-scaling-stroke"/>`;
  b += `<path d="M24 218C22 240 56 244 58 228C59 218 46 216 44 224" stroke="${C.line}" ${S(heavy * 0.9)}/>`;
  // lantern in section, centred at 150: cut metal drawn heavy and filled
  b += `<g transform="translate(150 0)">`;
  b += `<path d="M-10 16H10L58 42H64V50H54V58H-54V50H-64V42H-58Z" stroke="${C.line}" ${S(heavy, '', `url(#hatch2)`)}/>`;
  b += `<path d="M-46 166H46V174H42L22 190H-22L-42 174H-46Z" stroke="${C.line}" ${S(heavy, '', `url(#hatch2)`)}/>`;
  b += `<path d="${LANTERN.tip}" stroke="${C.line}" ${S(heavy, '', `${C.ground}`)}/>`;
  b += `<g fill="${C.ground}" stroke="${C.line}">${LANTERN.finial.replace(/\/>/g, ` stroke-width="${heavy}" vector-effect="non-scaling-stroke"/>`)}</g>`;
  // cut glass: double thin lines on both faces
  b += `<path d="M-52 58L-42 166M-49 58L-39.2 166M52 58L42 166M49 58L39.2 166" stroke="${C.line}" ${S(thin)}/>`;
  // the far corner posts, seen beyond the cut
  b += `<path d="M-44 64L-36.6 160M44 64L36.6 160" stroke="${C.pale}" ${S(thin * 0.8, 'stroke-dasharray="5 3"')}/>`;
  b += `<path d="${LANTERN.bulb}" stroke="${C.amber}" ${S(heavy * 0.9)}/>`;
  b += `<path d="${LANTERN.filament}" stroke="${C.amber}" ${S(thin)}/>`;
  b += `<path d="${LANTERN.socket}" stroke="${C.line}" ${S(thin, '', `url(#hatch2)`)}/>`;
  b += `</g>`;
  return b;
}

// A dimension: extension lines, a line with arrows and a centred figure.
function dimH(x1, x2, y, ext1, ext2, label, k) {
  const tx = (x1 + x2) / 2;
  return (
    `<path d="M${x1} ${ext1}V${y + 4}M${x2} ${ext2}V${y + 4}" stroke="${C.pale}" ${S(0.8)}/>` +
    `<path d="M${x1} ${y}H${x2}" stroke="${C.pale}" ${S(1)} marker-start="url(#ar)" marker-end="url(#ar)"/>` +
    `<text x="${tx}" y="${y - 3 / k}" font-size="${12 / k}" text-anchor="middle" fill="${C.line}" font-family="${MONO}" stroke="none">${label}</text>`
  );
}
function dimV(y1, y2, x, ext1, ext2, label, k) {
  const ty = (y1 + y2) / 2;
  return (
    `<path d="M${ext1} ${y1}H${x - 4}M${ext2} ${y2}H${x - 4}" stroke="${C.pale}" ${S(0.8)}/>` +
    `<path d="M${x} ${y1}V${y2}" stroke="${C.pale}" ${S(1)} marker-start="url(#ar)" marker-end="url(#ar)"/>` +
    `<text x="${x - 4 / k}" y="${ty}" font-size="${12 / k}" text-anchor="middle" fill="${C.line}" font-family="${MONO}" transform="rotate(-90 ${x - 4 / k} ${ty})" stroke="none">${label}</text>`
  );
}
const CL = (d) => `<path d="${d}" stroke="${C.pale}" ${S(0.9, 'stroke-dasharray="14 3 2 3"')}/>`;

function defs({ hatch = 7 } = {}) {
  return `
<marker id="ar" viewBox="0 0 12 8" refX="12" refY="4" markerWidth="12" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1L12 4L0 7Z" fill="${C.pale}"/></marker>
<pattern id="hatch" width="${hatch}" height="${hatch}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V${hatch}" stroke="${C.pale}" stroke-width="0.7"/></pattern>
<pattern id="hatch2" width="${hatch * 0.6}" height="${hatch * 0.6}" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="${hatch}" height="${hatch}" fill="${C.ground}"/><path d="M0 0V${hatch}" stroke="${C.pale}" stroke-width="0.6"/></pattern>
<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1"/></pattern>
<pattern id="grid5" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/></pattern>
<filter id="paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="3" seed="4" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.02  0 0 0 0 0.08  0 0 0 0 0.16  0 0 0 0.55 -0.12"/></filter>`;
}

function hero() {
  const W = 1280;
  const H = 640;
  const k = 1.4;
  const FX = 196;
  const FY = 122;
  const SX = 452;
  let b = `<rect width="${W}" height="${H}" fill="${C.ground}"/>`;
  b += `<rect width="${W}" height="${H}" filter="url(#paper)"/>`;
  b += `<rect width="${W}" height="${H}" fill="url(#grid)"/><rect width="${W}" height="${H}" fill="url(#grid5)"/>`;
  // sheet borders and zone marks
  b += `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="${C.line}" stroke-width="1"/>`;
  b += `<rect x="32" y="32" width="${W - 64}" height="${H - 64}" fill="none" stroke="${C.line}" stroke-width="2"/>`;
  b += `<g font-family="${MONO}" font-size="10" fill="${C.pale}" text-anchor="middle">`;
  for (let i = 0; i < 8; i++) {
    const x = 32 + ((W - 64) / 8) * (i + 0.5);
    b += `<text x="${x}" y="29">${i + 1}</text><text x="${x}" y="${H - 21}">${i + 1}</text>`;
    if (i) {
      const xl = 32 + ((W - 64) / 8) * i;
      b += `<path d="M${xl} 18V32M${xl} ${H - 32}V${H - 18}" stroke="${C.line}" stroke-width="1"/>`;
    }
  }
  for (let i = 0; i < 4; i++) {
    const y = 32 + ((H - 64) / 4) * (i + 0.5) + 4;
    b += `<text x="25" y="${y}">${'ABCD'[i]}</text><text x="${W - 25}" y="${y}">${'ABCD'[i]}</text>`;
    if (i) {
      const yl = 32 + ((H - 64) / 4) * i;
      b += `<path d="M18 ${yl}H32M${W - 32} ${yl}H${W - 18}" stroke="${C.line}" stroke-width="1"/>`;
    }
  }
  b += `</g>`;

  // front elevation
  b += `<g transform="translate(${FX} ${FY}) scale(${k})">`;
  b += frontElevation({ heavy: 2.2, thin: 1.1 });
  b += CL('M0 -20V246') + CL('M-84 108H84');
  b += dimH(-64, 64, -46, 38, 38, '256', k);
  b += dimV(0, 206, -92, -12, -12, '412', k);
  b += dimV(58, 166, 82, 60, 50, '216', k);
  // section arrows A on the centre line
  for (const [y, ty] of [[-24, -26], [252, 262]]) {
    b += `<path d="M0 ${y}H18" stroke="${C.line}" ${S(2)} marker-end="url(#ar)"/>`;
    b += `<text x="26" y="${ty + 4}" font-family="${MONO}" font-size="${13 / k}" font-weight="700" fill="${C.line}">A</text>`;
  }
  b += `</g>`;

  // section A-A
  b += `<g transform="translate(${SX} ${FY}) scale(${k})">`;
  b += sectionView({ heavy: 2.2, thin: 1.1 });
  b += CL('M150 -26V230') + CL('M60 108H232');
  b += dimH(0, 150, 276, 250, 212, '300', k);
  // light: where it falls, as a polar curve from the lamp
  b += `<path d="M150 114C134 150 90 204 110 238C126 264 174 264 190 238C210 204 166 150 150 114Z" stroke="${C.amber}" ${S(1.1, 'stroke-dasharray="2 4" stroke-linecap="round"')}/>`;
  b += `</g>`;

  // leaders ending in numbered balloons; the key is in the right column
  const balloon = (x1, y1, x2, y2, n, col = C.line) =>
    `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${C.pale}" stroke-width="0.9"/><circle cx="${x1}" cy="${y1}" r="2.2" fill="${C.pale}"/>` +
    `<circle cx="${x2}" cy="${y2}" r="10" fill="${C.ground}" stroke="${col}" stroke-width="1.3"/><text x="${x2}" y="${y2 + 4.2}" font-family="${MONO}" font-size="12" font-weight="700" fill="${col}" text-anchor="middle">${n}</text>`;
  const fx = (x) => FX + x * k;
  const sx = (x) => SX + x * k;
  const yy = (y) => FY + y * k;
  b += balloon(fx(34), yy(28), 326, 112, '1');
  b += balloon(sx(150 - 47.5), yy(118), 532, 300, '2');
  b += balloon(sx(150 + 14), yy(100), 784, 292, '3', C.amber);
  b += balloon(sx(4), yy(160), 384, 352, '4');

  // view titles
  const vt = (x, n, t) =>
    `<circle cx="${x - 92}" cy="557" r="13" fill="none" stroke="${C.line}" stroke-width="1.4"/><text x="${x - 92}" y="562" font-family="${MONO}" font-size="13" font-weight="700" fill="${C.line}" text-anchor="middle">${n}</text>` +
    `<text x="${x - 70}" y="555" font-family="${MONO}" font-size="13" font-weight="700" fill="${C.line}">${t}</text>` +
    `<path d="M${x - 70} 561H${x + 80}" stroke="${C.line}" stroke-width="1.2"/><text x="${x - 70}" y="576" font-family="${MONO}" font-size="10.5" fill="${C.pale}">SCALE 1:2</text>`;
  b += vt(FX + 6, '1', 'FRONT ELEVATION');
  b += vt(SX + 220, '2', 'SECTION A-A');

  // right column: name, tagline, notes, title block
  const RX = 808;
  const RW = 1236 - RX;
  b += `<text x="${RX - 4}" y="178" font-family="${TITLE}" font-weight="700" font-size="118" fill="${C.line}" textLength="${RW - 6}" lengthAdjust="spacing">PORCHLIGHT</text>`;
  b += `<text x="${RX}" y="214" font-family="${MONO}" font-size="15.6" fill="${C.line}">A light left on over your own front door.</text>`;
  b += `<path d="M${RX} 232H${RX + RW}" stroke="${C.pale}" stroke-width="1"/>`;
  b += `<g font-family="${MONO}" font-size="11.5" fill="${C.pale}">`;
  b += `<text x="${RX}" y="258" fill="${C.line}" font-weight="700">GENERAL NOTES</text>`;
  [
    '1. RUNS ON THIS COMPUTER. NOTHING LEAVES UNLESS',
    '   YOU CHOOSE.',
    '2. DOMAINS ARE WATCHED ONLY ONCE A DNS RECORD',
    '   PROVES THEM YOURS.',
    '3. KEYS, PACKAGES AND THIS MAC, CHECKED FROM INSIDE.',
  ].forEach((t, i) => (b += `<text x="${RX}" y="${278 + i * 16}" xml:space="preserve">${t}</text>`));
  b += `<text x="${RX}" y="370" fill="${C.line}" font-weight="700">KEY</text>`;
  const key = [
    [0, 0, '1', 'CAP, SPUN BRASS', C.pale],
    [0, 1, '2', 'GLASS, CLEAR, 3 THK', C.pale],
    [1, 0, '3', 'LAMP, 2700 K, LEFT ON', C.amber],
    [1, 1, '4', 'WALL PLATE AND ARM', C.pale],
  ];
  for (const [c, r, n, t, col] of key) {
    const x = RX + c * 214;
    const y = 390 + r * 18;
    b += `<circle cx="${x + 7}" cy="${y - 4}" r="7" fill="none" stroke="${col}" stroke-width="1"/><text x="${x + 7}" y="${y - 0.5}" font-size="9.5" font-weight="700" text-anchor="middle" fill="${col}">${n}</text><text x="${x + 20}" y="${y}" fill="${col}">${t}</text>`;
  }
  b += `</g>`;

  // title block
  const TY = 424;
  const rows = [TY, TY + 46, TY + 76, TY + 106, TY + 136];
  const TB = TY + 166;
  b += `<g stroke="${C.line}" fill="none"><rect x="${RX}" y="${TY}" width="${RW}" height="${TB - TY}" stroke-width="2"/>`;
  for (const y of rows.slice(1)) b += `<path d="M${RX} ${y}H${RX + RW}" stroke-width="1"/>`;
  b += `<path d="M${RX + 300} ${TY}V${rows[1]}M${RX + 140} ${rows[2]}V${rows[4]}M${RX + 290} ${rows[2]}V${TB}M${RX + 140} ${rows[4]}V${TB}" stroke-width="1"/>`;
  b += `</g>`;
  const cell = (x, y, label, value, size = 12, bold = false) =>
    `<text x="${x + 7}" y="${y + 11}" font-family="${MONO}" font-size="8" fill="${C.pale}" letter-spacing="0.6">${label}</text>` +
    `<text x="${x + 7}" y="${y + (bold ? 38 : 25)}" font-family="${bold ? TITLE : MONO}" font-size="${size}" fill="${C.line}"${bold ? ' font-weight="700" letter-spacing="1.5"' : ''}>${value}</text>`;
  b += cell(RX, TY, 'PROJECT', 'PORCHLIGHT', 25, true);
  b += cell(RX + 300, TY, 'DWG NO', 'PL-001', 22, true);
  b += cell(RX, rows[1], 'TITLE', 'PORCH LANTERN, GENERAL ARRANGEMENT');
  b += cell(RX, rows[2], 'SCALE', '1:2');
  b += cell(RX + 140, rows[2], 'DATE', '2026-11-19');
  b += cell(RX + 290, rows[2], 'SHEET', '1 OF 1');
  b += cell(RX, rows[3], 'DRAWN', 'ON THIS MAC');
  b += cell(RX + 140, rows[3], 'CHECKED', 'BY YOU');
  b += cell(RX + 290, rows[3], 'REV', 'A');
  b += cell(RX, rows[4], 'UNITS', 'MM');
  b += cell(RX + 140, rows[4], 'LAMP', 'LEFT ON');
  b += cell(RX + 290, rows[4], 'DOOR', 'YOUR OWN');
  return svg({ w: W, h: H, defs: defs({ hatch: 6 }), body: b });
}

// The mark: the elevation on a blueprint tile, centre lines running off.
function tile({ heavy, thin, grid = true, frame = false }) {
  const k = 0.74;
  NSS = false;
  let b = `<rect x="8" y="8" width="240" height="240" rx="44" fill="${C.ground}"/>`;
  b += `<clipPath id="tc"><rect x="8" y="8" width="240" height="240" rx="44"/></clipPath>`;
  b += `<g clip-path="url(#tc)">`;
  if (grid) b += `<rect width="256" height="256" fill="url(#grid16)"/>`;
  b += `<path d="M128 14V242M24 ${42 + 108 * k}H232" stroke="${C.pale}" stroke-width="${thin}" stroke-dasharray="12 3 2 3" fill="none"/>`;
  b += `<g transform="translate(128 ${42}) scale(${k})">${frontElevation({ heavy: heavy / k, thin: thin / k })}</g>`;
  NSS = true;
  // one dimension above, arrows only
  b += `<path d="M${128 - 64 * k} 30V${42 + 38 * k}M${128 + 64 * k} 30V${42 + 38 * k}" stroke="${C.pale}" stroke-width="${thin * 0.8}"/>`;
  b += `<path d="M${128 - 64 * k} 30H${128 + 64 * k}" stroke="${C.pale}" stroke-width="${thin}" marker-start="url(#ar2)" marker-end="url(#ar2)"/>`;
  if (frame) b += `<rect x="20" y="20" width="216" height="216" rx="32" fill="none" stroke="${C.pale}" stroke-opacity="0.5" stroke-width="${thin}"/>`;
  b += `</g>`;
  const d =
    defs() +
    `<marker id="ar2" viewBox="0 0 12 8" refX="12" refY="4" markerWidth="${thin * 7}" markerHeight="${thin * 5}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1L12 4L0 7Z" fill="${C.pale}"/></marker>` +
    `<pattern id="grid16" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/></pattern>`;
  return { defs: d, body: b };
}

function markSvg() {
  const t = tile({ heavy: 2.6, thin: 1.3 });
  return svg({ w: 512, h: 512, vb: '0 0 256 256', defs: t.defs, body: t.body });
}
function iconSvg() {
  const t = tile({ heavy: 3.4, thin: 1.6, frame: true });
  return svg({ w: 512, h: 512, vb: '0 0 256 256', defs: t.defs, body: t.body });
}
function icon128Svg() {
  // at 128 the strokes are rendered at half size, so draw them heavier
  const t = tile({ heavy: 2.2, thin: 1.1, frame: true });
  return svg({ w: 128, h: 128, vb: '0 0 256 256', defs: t.defs, body: t.body });
}

function faviconSvg() {
  const b = `
<rect width="16" height="16" rx="2" fill="${C.ground}"/>
<path d="M0 8.5H4M12 8.5H16" stroke="${C.pale}" stroke-width="1" stroke-opacity="0.8"/>
<rect x="7" y="1" width="2" height="1" fill="${C.line}"/>
<rect x="6" y="2" width="4" height="1" fill="${C.line}"/>
<rect x="4" y="3" width="8" height="1" fill="${C.line}"/>
<rect x="4.5" y="4.5" width="7" height="7" fill="none" stroke="${C.line}" stroke-width="1"/>
<rect x="7" y="6" width="2" height="4" fill="${C.amber}"/>
<rect x="6" y="12" width="4" height="1" fill="${C.line}"/>
<rect x="7" y="13" width="2" height="1" fill="${C.line}"/>`;
  return svg({ w: 16, h: 16, vb: '0 0 16 16', body: b });
}
function favicon32Svg() {
  const b = `
<rect width="32" height="32" rx="4" fill="${C.ground}"/>
<path d="M0 16.5H7M25 16.5H32M16.5 0V3" stroke="${C.pale}" stroke-width="1" stroke-dasharray="4 1 1 1"/>
<rect x="14" y="3" width="4" height="2" fill="${C.line}"/>
<path d="M13 5H19L24 8H8Z" fill="${C.line}"/>
<rect x="7" y="8" width="18" height="2" fill="${C.line}"/>
<path d="M9.5 10.5H22.5L21 23.5H11Z" fill="none" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
<rect x="14" y="12" width="4" height="5" rx="2" fill="${C.amber}"/>
<rect x="15" y="17" width="2" height="3" fill="${C.amber}"/>
<rect x="10" y="24" width="12" height="2" fill="${C.line}"/>
<path d="M13 26H19L16 29Z" fill="${C.line}"/>`;
  return svg({ w: 32, h: 32, vb: '0 0 32 32', body: b });
}

function logoSvg() {
  const t = tile({ heavy: 2.4, thin: 1.2 });
  let b = nest({ x: 14, y: 14, w: 172, h: 172, vb: '0 0 256 256', body: `<defs>${t.defs}</defs>` + t.body });
  b += `<text x="208" y="120" font-family="${TITLE}" font-weight="700" font-size="92" fill="${C.ground}" textLength="410" lengthAdjust="spacing">PORCHLIGHT</text>`;
  b += `<path d="M210 138H618" stroke="${C.ground}" stroke-width="1.5"/>`;
  b += `<text x="210" y="160" font-family="${MONO}" font-size="13" letter-spacing="1.2" fill="${C.ground}">DWG PL-001  ·  SCALE 1:2  ·  CHECKED BY YOU</text>`;
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 13 Blueprint sconce

A general-arrangement drawing of a porch lantern: front elevation, section A-A with the wall and the arm hatched, dimensions, centre lines and a title block whose notes describe the product ("checked by you"). The only amber on the sheet is the lamp and where its light falls.
Palette: blueprint #0f3a66, line #eef5fc, pale cyan #9fcbef, amber #ffb44a.
Type: DIN Condensed Bold for the name, Menlo for annotation and the title block.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(),
  'logo.svg': logoSvg(),
  'favicon.svg': faviconSvg(),
  'favicon-32.svg': favicon32Svg(),
  'icon.svg': iconSvg(),
  'icon-128.svg': icon128Svg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
