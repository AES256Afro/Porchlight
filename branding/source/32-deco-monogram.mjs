// 32 Deco monogram: a jeweller's monogram. The P's stem is a panelled front
// door standing on two steps; its bowl is the lamp beside the door and the fan
// of light it throws. Black, ivory and one gold.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '32-deco-monogram';
const C = {
  black: '#0b0b0c',
  soft: '#151516',
  ivory: '#f3ead8',
  gold: '#c9a24a',
  ink: '#121213',
};
const FONTS = { DidotI: 'Didot-Italic' };
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, a) => `${f(cx + r * Math.cos(rad(a)))},${f(cy + r * Math.sin(rad(a)))}`;
const sector = (cx, cy, r0, r1, a0, a1) =>
  `M${pt(cx, cy, r0, a0)}L${pt(cx, cy, r1, a0)}A${r1},${r1} 0 0 1 ${pt(cx, cy, r1, a1)}L${pt(cx, cy, r0, a1)}A${r0},${r0} 0 0 0 ${pt(cx, cy, r0, a0)}Z`;
const rect = (x0, y0, x1, y1) => `M${x0},${y0}H${x1}V${y1}H${x0}Z`;

// ---- the monogram, on a 200 grid ---------------------------------------------------
// ink: the P itself; gold: the lamp and its rays.
function monogram({ ink = C.ink, gold = C.gold, knob = true } = {}) {
  const B = [100, 70]; // the lamp, on the door frame
  let fan = '';
  for (let i = 0; i < 9; i += 2) fan += sector(B[0], B[1], 18, 40, -90 + i * 20 + 1.6, -90 + (i + 1) * 20 - 1.6);
  // door frame, then the leaf with two sunk panels (even-odd cuts the grooves)
  const frame = rect(56, 18, 100, 172) + rect(62, 24, 94, 172);
  const leaf =
    rect(64.5, 26.5, 91.5, 172) +
    rect(69, 31.5, 87, 88) +
    rect(71.2, 33.7, 84.8, 85.8) +
    rect(69, 97, 87, 165) +
    rect(71.2, 99.2, 84.8, 162.8);
  return `
<path d="${frame}" fill="${ink}" fill-rule="evenodd"/>
<path d="${leaf}" fill="${ink}" fill-rule="evenodd"/>
<path d="M46,172H110V180H120V188H36V180H46Z" fill="${ink}"/>
<path d="M100,21.5A48.5,48.5 0 0 1 100,118.5" fill="none" stroke="${ink}" stroke-width="7"/>
<path d="${fan}" fill="${gold}"/>
<path d="M100,${B[1] - 11}A11,11 0 0 1 100,${B[1] + 11}Z" fill="${gold}"/>
${knob ? `<circle cx="89.3" cy="92.5" r="2.3" fill="${gold}"/>` : ''}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: `<g transform="translate(5 -3)">${monogram()}</g>` });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: `<g transform="translate(5 -3)">${monogram({ ink: C.ivory })}</g>` });

// An emerald-cut frame: a rectangle with its corners cut, as a jeweller cuts a stone.
const cut = (cx, cy, hw, hh, c) =>
  `M${cx - hw + c},${cy - hh}H${cx + hw - c}L${cx + hw},${cy - hh + c}V${cy + hh - c}L${cx + hw - c},${cy + hh}H${cx - hw + c}L${cx - hw},${cy + hh - c}V${cy - hh + c}Z`;

// ---- favicons: the monogram on a black cut-corner tile ------------------------------
const PIX = { K: C.black, I: C.ivory, G: C.gold };
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
  '..KKKKKKKKKKKK..',
  '.KKKKKKKKKKKKKK.',
  'KKKKIIIIIIIIKKKK',
  'KKKKIIIGGGGIIKKK',
  'KKKKIIIGGGGGIIKK',
  'KKKKIIIGGGGGIIKK',
  'KKKKIIIGGGGGIIKK',
  'KKKKIIIGGGGIIKKK',
  'KKKKIIIIIIIIKKKK',
  'KKKKIIIKKKKKKKKK',
  'KKKKIIIKKKKKKKKK',
  'KKKKIIIKKKKKKKKK',
  'KKKKIIIKKKKKKKKK',
  'KKKIIIIIKKKKKKKK',
  '.KIIIIIIIKKKKKK.',
  '..KKKKKKKKKKKK..',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('K'));
  const put = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  const box = (x0, y0, x1, y1, ch) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch);
  };
  // cut corners
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4 - i; j++) for (const [x, y] of [[j, i], [31 - j, i], [j, 31 - i], [31 - j, 31 - i]]) put(x, y, '.');
  // bowl: an ivory ring to the right of the stem, about (15, 11.5)
  const cx = 14.5;
  const cy = 11.5;
  for (let y = 2; y <= 21; y++)
    for (let x = 15; x <= 26; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= 9.7 && d > 7.3) put(x, y, 'I');
    }
  // three rays on whole pixels: flat, and the two diagonals
  box(18, 11, 20, 12, 'G');
  for (let i = 0; i < 3; i++) {
    put(17 + i, 8 - i, 'G');
    put(18 + i, 8 - i, 'G');
    put(17 + i, 15 + i, 'G');
    put(18 + i, 15 + i, 'G');
  }
  box(15, 10, 16, 13, 'G'); // the lamp
  // stem: door frame, a gap, the leaf
  box(8, 2, 14, 26, 'I');
  box(9, 3, 13, 26, 'K');
  box(10, 4, 12, 26, 'I');
  put(11, 9, 'K');
  put(11, 10, 'K');
  put(11, 11, 'K');
  put(11, 12, 'K');
  put(11, 17, 'K');
  put(11, 18, 'K');
  put(11, 19, 'K');
  put(11, 20, 'K');
  put(11, 21, 'K');
  put(11, 22, 'K');
  // two steps
  box(6, 26, 16, 27, 'I');
  box(4, 28, 18, 29, 'I');
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon -------------------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
<rect width="512" height="512" rx="112" fill="${C.black}"/>
<path d="${cut(256, 256, 204, 204, 58)}" fill="none" stroke="${C.gold}" stroke-width="5"/>
<path d="${cut(256, 256, 189, 189, 50)}" fill="none" stroke="${C.gold}" stroke-width="1.6"/>
${nest({ x: 76, y: 66, w: 380, h: 380, vb: '0 0 200 200', body: monogram({ ink: C.ivory }) })}`,
});

// ---- logo ---------------------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.ivory : C.ink;
  return `
${nest({ x: 2, y: 2, w: 196, h: 196, vb: '0 0 200 200', body: `<g transform="translate(5 -3)">${monogram({ ink })}</g>` })}
<text x="196" y="104" font-family="Copperplate" font-size="46" letter-spacing="9.5" fill="${ink}">PORCHLIGHT</text>
<path d="M198,126H386M414,126H612" stroke="${C.gold}" stroke-width="1.6"/>
<path d="M400,119L407,126L400,133L393,126Z" fill="${C.gold}"/>
<text x="405" y="160" text-anchor="middle" font-family="DidotI" font-size="21.5" fill="${ink}">Know what’s on your doorstep.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(true) });

// ---- hero ------------------------------------------------------------------------------------
function hero() {
  const cx = 640;
  const fy = 214; // centre of the stone
  const diamond = (x, y, r) => `<path d="M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z" fill="${C.gold}"/>`;
  // quarter fans of hairlines in the corners of the border
  const corner = (x, y, sx, sy) => {
    let d = '';
    for (const a of [9, 27, 45, 63, 81]) d += `M${pt(0, 0, 16, a)}L${pt(0, 0, a === 45 ? 62 : a === 27 || a === 63 ? 52 : 42, a)}`;
    return `<g transform="translate(${x} ${y}) scale(${sx} ${sy})"><path d="${d}" stroke="${C.gold}" stroke-width="1.6" fill="none"/><path d="M0,0H9A9,9 0 0 1 0,9Z" fill="${C.gold}"/></g>`;
  };
  // fine lines either side of the stone, stepping shorter above and below
  let wings = '';
  [
    [0, 318],
    [-9, 276],
    [9, 276],
    [-18, 234],
    [18, 234],
  ].forEach(([dy, len]) => {
    for (const s of [-1, 1]) wings += `M${cx + s * 146},${fy + dy}H${cx + s * (146 + len)}`;
  });
  return `
<rect width="1280" height="640" fill="${C.black}"/>
<path d="${cut(640, 320, 616, 296, 34)}" fill="none" stroke="${C.gold}" stroke-width="2.4"/>
<path d="${cut(640, 320, 606, 286, 30)}" fill="none" stroke="${C.gold}" stroke-width="1"/>
${corner(52, 52, 1, 1)}${corner(1228, 52, -1, 1)}${corner(52, 588, 1, -1)}${corner(1228, 588, -1, -1)}
<path d="${wings}" stroke="${C.gold}" stroke-width="1.5"/>
${diamond(cx - 474, fy, 7)}${diamond(cx + 474, fy, 7)}
<path d="${cut(cx, fy, 128, 150, 34)}" fill="${C.soft}" stroke="${C.gold}" stroke-width="3"/>
<path d="${cut(cx, fy, 118, 140, 29)}" fill="none" stroke="${C.gold}" stroke-width="1"/>
${nest({ x: cx - 130, y: fy - 129, w: 260, h: 260, vb: '0 0 200 200', body: `<g transform="translate(5 -3)">${monogram({ ink: C.ivory })}</g>` })}
<text x="${cx + 12.5}" y="460" text-anchor="middle" font-family="Copperplate" font-size="62" letter-spacing="25" fill="${C.ivory}">PORCHLIGHT</text>
<path d="M${cx - 250},490H${cx - 18}M${cx + 18},490H${cx + 250}" stroke="${C.gold}" stroke-width="1.5"/>
${diamond(cx, 490, 6)}
<text x="${cx}" y="538" text-anchor="middle" font-family="DidotI" font-size="32" fill="${C.ivory}">Know what’s on your doorstep.</text>
<text x="${cx + 4}" y="582" text-anchor="middle" font-family="Copperplate" font-size="12" letter-spacing="8" fill="${C.gold}">YOUR REPOS · YOUR SERVERS · YOUR COMPUTER</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 32 Deco monogram

Logo first: a jeweller's monogram. The stem of the P is a panelled front door in its frame, standing on two steps; the bowl is the lamp beside the door and the fan of light it throws, closed by one arc. Everything else is kept spare: the monogram set in an emerald-cut frame, the name in engraver's capitals tracked wide, fine gold lines stepping away either side, and quarter fans of hairlines in the corners. The favicons put the P on a black cut-corner tile and keep three rays that fall on whole pixels.
Palette: black #0b0b0c / #151516, ivory #f3ead8, gold #c9a24a, ink #121213 on light pages.
Type: Copperplate in tracked capitals for the name and the small line, Didot Italic for the tagline.
Tagline: Know what's on your doorstep.
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
