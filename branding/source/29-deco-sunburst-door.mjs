// 29 Deco sunburst door: a stepped limestone entrance whose fanlight is a
// sunburst, and that sunburst is the porch light. Its rays carry on across the
// whole wall in stepped bands of blue.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '29-deco-sunburst-door';
const C = {
  ink: '#0a1330', // deepest night, door glass
  far: '#0c1838',
  night: '#0f1c40',
  blue1: '#14264f',
  blue2: '#1a3264',
  blue3: '#223f77',
  blue4: '#2c4f8f',
  gold: '#dba63c',
  goldLt: '#f2cd76',
  goldDk: '#96691f',
  ivory: '#f5ecd4',
  stone: '#e4d6b0',
  stoneDk: '#c4b388',
  hot: '#fff1c4',
};
const FONTS = { Deco: 'Phosphate-Inline', DecoSolid: 'Phosphate-Solid', FutM: 'Futura-Medium', DidotI: 'Didot-Italic' };
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, a) => `${f(cx + r * Math.cos(rad(a)))},${f(cy + r * Math.sin(rad(a)))}`;

// A ring sector from r0 to r1 between two angles (degrees, 0 = east, -90 = up).
function sector(cx, cy, r0, r1, a0, a1) {
  return (
    `M${pt(cx, cy, r0, a0)}L${pt(cx, cy, r1, a0)}A${r1},${r1} 0 0 1 ${pt(cx, cy, r1, a1)}L${pt(cx, cy, r0, a1)}` +
    (r0 > 0 ? `A${r0},${r0} 0 0 0 ${pt(cx, cy, r0, a0)}` : '') +
    'Z'
  );
}
// Every other wedge of a fan: n wedges over [a0, a1], the even ones drawn.
function rays(cx, cy, r0, r1, a0, a1, n, fill, { odd = false, inset = 0 } = {}) {
  const step = (a1 - a0) / n;
  let d = '';
  for (let i = odd ? 1 : 0; i < n; i += 2) d += sector(cx, cy, r0, r1, a0 + i * step + inset, a0 + (i + 1) * step - inset);
  return `<path d="${d}" fill="${fill}"/>`;
}
// A full turn of straight-sided rays, a wedge centred on straight up.
function burst(cx, cy, r, n, fill) {
  const step = 360 / n;
  let d = '';
  for (let i = 0; i < n; i += 2) {
    const a = -90 - step / 2 + i * step;
    d += `M${cx},${cy}L${pt(cx, cy, r, a)}L${pt(cx, cy, r, a + step)}Z`;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}

// ---- mark: a half-sun over a door, inside a stepped surround (200 grid) ------
const M_OUT = 'M26,188V92H40V70H56V50H76V32H124V50H144V70H160V92H174V188Z';
const M_IN = 'M35,188V101H49V79H65V59H85V41H115V59H135V79H151V101H165V188Z';
function markBody({ body = C.blue1, id = 'm' } = {}) {
  const S = [100, 114];
  const chev = (x) =>
    [136, 148, 160].map((y) => `M${x - 9},${y + 7}L${x},${y}L${x + 9},${y + 7}`).join('');
  return `
<path d="${M_OUT}" fill="${body}"/>
<clipPath id="${id}-in"><path d="${M_IN}"/></clipPath>
<g clip-path="url(#${id}-in)">
  ${rays(S[0], S[1], 30, 150, -180, 0, 9, C.gold)}
  ${rays(S[0], S[1], 30, 150, -180, 0, 9, C.goldLt, { inset: 5.2 })}
</g>
<path d="M${S[0] - 23},${S[1]}A23,23 0 0 1 ${S[0] + 23},${S[1]}Z" fill="${C.hot}"/>
<path d="M${S[0] - 13},${S[1]}A13,13 0 0 1 ${S[0] + 13},${S[1]}Z" fill="${C.goldLt}"/>
<rect x="35" y="114" width="130" height="8" fill="${C.gold}"/>
<rect x="63" y="122" width="74" height="66" fill="${C.ink}"/>
<path d="M66.5,125.5H133.5V188M66.5,125.5V188M100,125.5V188" fill="none" stroke="${C.gold}" stroke-width="3.4"/>
<path d="${chev(83)}${chev(117)}" fill="none" stroke="${C.goldLt}" stroke-width="2.6" stroke-linejoin="miter"/>
<path d="${M_OUT}" fill="none" stroke="${C.gold}" stroke-width="4" stroke-linejoin="miter"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody({ body: C.blue2 }) });

// ---- favicons: redrawn on the pixel grid, five rays that fall on whole pixels --
const PIX = { N: C.blue2, G: C.gold, L: C.goldLt, H: C.hot, D: C.ink, K: C.goldDk };
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
  '....NNNNNNNN....',
  '....NNNGGNNN....',
  '....NNNGGNNN....',
  '..NGNNNGGNNNGN..',
  '..NNGNNNNNNGNN..',
  '..NNNNHHHHNNNN..',
  '.NNNNHHHHHHNNNN.',
  '.GGNHHHHHHHHNGG.',
  '.GGGGGGGGGGGGGG.',
  '.NNNGDDGGDDGNNN.',
  '.NNNGDDGGDDGNNN.',
  '.NNNGDDGGDDGNNN.',
  '.NNNGDDGGDDGNNN.',
  '.NNNGDDGGDDGNNN.',
  '.NNNGDDGGDDGNNN.',
  '.NNNGDDGGDDGNNN.',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const put = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  // stepped surround: [first row, last row, left x, right x]
  const tiers = [
    [1, 3, 11, 20],
    [4, 6, 8, 23],
    [7, 9, 5, 26],
    [10, 12, 3, 28],
    [13, 31, 1, 30],
  ];
  for (const [y0, y1, x0, x1] of tiers) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, 'N');
  // rays: up, the two diagonals, the two flats
  for (let y = 3; y <= 9; y++) {
    put(15, y, 'G');
    put(16, y, 'L');
  }
  for (let i = 0; i < 5; i++) {
    put(10 - i, 11 - i, 'G');
    put(9 - i, 11 - i, 'G');
    put(21 + i, 11 - i, 'G');
    put(22 + i, 11 - i, 'G');
  }
  for (let x = 3; x <= 8; x++) {
    put(x, 14, 'G');
    put(x, 15, 'G');
    put(31 - x, 14, 'G');
    put(31 - x, 15, 'G');
  }
  // the half sun
  const sun = ['....HHHH....', '..HHHHHHHH..', '.HHHHHHHHHH.', 'HHHHLLLLHHHH', 'HHHLLLLLLHHH'];
  sun.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && put(10 + i, 11 + j, ch)));
  // lintel
  for (let x = 3; x <= 28; x++) {
    put(x, 16, 'G');
    put(x, 17, 'G');
  }
  // doors: gold frame, dark leaves, a seam
  for (let y = 18; y <= 31; y++) {
    for (let x = 9; x <= 22; x++) put(x, y, 'D');
    put(9, y, 'G');
    put(10, y, 'G');
    put(21, y, 'G');
    put(22, y, 'G');
    put(15, y, 'G');
    put(16, y, 'G');
  }
  // flutes on the piers
  for (let y = 20; y <= 31; y++) {
    put(4, y, 'K');
    put(6, y, 'K');
    put(25, y, 'K');
    put(27, y, 'K');
  }
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- shared: the light on the wall, in stepped rings of rays ------------------
function wallLight(cx, cy, rings, id) {
  // rings: [[radius, light, dark], ...] from the widest in
  return rings
    .map(
      ([r, a, b], i) => `
<clipPath id="${id}-r${i}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
<g clip-path="url(#${id}-r${i})"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${b}"/>${burst(cx, cy, r + 40, 40, a)}</g>`,
    )
    .join('');
}

// ---- icon -----------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
<clipPath id="ic"><rect width="512" height="512" rx="112"/></clipPath>
<g clip-path="url(#ic)">
  <rect width="512" height="512" fill="${C.ink}"/>
  ${wallLight(256, 284, [[620, C.night, C.ink], [300, C.blue1, C.night], [200, C.blue2, C.blue1]], 'ic')}
  <rect y="452" width="512" height="60" fill="${C.ink}"/>
  <rect y="452" width="512" height="5" fill="${C.gold}"/>
  ${nest({ x: 56, y: 40, w: 400, h: 400, vb: '0 0 200 200', body: markBody({ body: C.blue3, id: 'icm' }) })}
  <rect x="84" y="416" width="344" height="18" fill="${C.ivory}"/>
  <rect x="60" y="434" width="392" height="18" fill="${C.stone}"/>
</g>`,
});

// ---- logo -----------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.goldLt : C.blue1;
  const sub = dark ? C.ivory : C.blue1;
  return `
${nest({ x: 6, y: 4, w: 190, h: 190, vb: '0 0 200 200', body: markBody({ body: dark ? C.blue2 : C.blue1, id: dark ? 'ld' : 'll' }) })}
<text x="414" y="110" text-anchor="middle" font-family="Deco" font-size="74" fill="${ink}">PORCHLIGHT</text>
<path d="M212,130H382M446,130H616" stroke="${C.gold}" stroke-width="2.5"/>
<path d="M212,136H374M454,136H616" stroke="${C.gold}" stroke-width="1"/>
<path d="M394,138A20,20 0 0 1 434,138Z" fill="${C.gold}"/>
<text x="414" y="166" text-anchor="middle" font-family="FutM" font-size="13.5" letter-spacing="3.6" fill="${sub}">NOTHING HIDES ON A LIT PORCH</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', fonts: FONTS, body: logo(true) });

// ---- hero -----------------------------------------------------------------------
function hero() {
  const cx = 330; // the entrance's axis
  const L = [cx, 322]; // the lamp at the foot of the fanlight
  const G = 554; // ground line
  // stepped-corner frame
  const frame = (i, s) =>
    `M${i + s},${i}H${1280 - i - s}V${i + s}H${1280 - i}V${640 - i - s}H${1280 - i - s}V${640 - i}H${i + s}V${640 - i - s}H${i}V${i + s}H${i + s}Z`;

  // the surround, in limestone
  const outer = `M${cx - 116},500V300H${cx - 104}V262H${cx - 90}V230H${cx - 72}V204H${cx - 50}V184H${cx - 26}V170H${cx + 26}V184H${cx + 50}V204H${cx + 72}V230H${cx + 90}V262H${cx + 104}V300H${cx + 116}V500Z`;
  const face = `M${cx - 104},500V312H${cx - 92}V274H${cx - 78}V242H${cx - 60}V216H${cx - 38}V196H${cx + 38}V216H${cx + 60}V242H${cx + 78}V274H${cx + 92}V312H${cx + 104}V500Z`;
  const reveal = `M${cx - 80},500V322A80,80 0 0 1 ${cx + 80},322V500Z`;
  const opening = `M${cx - 68},500V322A68,68 0 0 1 ${cx + 68},322V500Z`;

  // flutes and bands on the piers
  let flutes = '';
  for (const s of [-1, 1]) for (const dx of [86, 93, 100]) flutes += `M${cx + s * dx},334V482`;

  // fanlight: glass in two warm tones, bronze glazing bars, a gold rim
  const fanlight = `
<path d="M${cx - 68},322A68,68 0 0 1 ${cx + 68},322Z" fill="${C.goldLt}"/>
${rays(L[0], L[1], 0, 68, -180, 0, 9, C.hot)}
${Array.from({ length: 8 }, (_, i) => `<path d="M${pt(L[0], L[1], 20, -160 + i * 20)}L${pt(L[0], L[1], 68, -160 + i * 20)}" stroke="${C.goldDk}" stroke-width="2.2"/>`).join('')}
<path d="M${cx - 44},322A44,44 0 0 1 ${cx + 44},322" fill="none" stroke="${C.goldDk}" stroke-width="2.2"/>
<path d="M${cx - 24},322A24,24 0 0 1 ${cx + 24},322Z" fill="${C.gold}"/>
<path d="M${cx - 15},322A15,15 0 0 1 ${cx + 15},322Z" fill="${C.hot}"/>
<path d="M${cx - 68},322A68,68 0 0 1 ${cx + 68},322" fill="none" stroke="${C.gold}" stroke-width="6"/>`;

  // doors: two leaves, chevron grilles, kick plates, long pulls
  const leaf = (x) => {
    let ch = '';
    for (let y = 350; y <= 440; y += 15) ch += `M${x + 11},${y + 13}L${x + 33},${y}L${x + 55},${y + 13}`;
    return `
<rect x="${x}" y="330" width="66" height="170" fill="${C.blue1}"/>
<rect x="${x + 8}" y="340" width="50" height="116" fill="${C.ink}"/>
<clipPath id="lf${x}"><rect x="${x + 8}" y="340" width="50" height="116"/></clipPath>
<g clip-path="url(#lf${x})"><path d="${ch}M${x + 33},340V456" fill="none" stroke="${C.gold}" stroke-width="2.6"/></g>
<rect x="${x + 8}" y="340" width="50" height="116" fill="none" stroke="${C.gold}" stroke-width="2.4"/>
<path d="M${x + 8},468H${x + 58}M${x + 8},476H${x + 58}M${x + 8},484H${x + 58}" stroke="${C.gold}" stroke-width="2.2"/>`;
  };
  const doors = `
<path d="${opening}" fill="${C.ink}"/>
${leaf(cx - 67)}${leaf(cx + 1)}
<rect x="${cx - 1}" y="330" width="2" height="170" fill="${C.ink}"/>
<rect x="${cx - 8}" y="388" width="4" height="52" rx="2" fill="${C.goldLt}"/>
<rect x="${cx + 4}" y="388" width="4" height="52" rx="2" fill="${C.goldLt}"/>
<rect x="${cx - 74}" y="320" width="148" height="10" fill="${C.gold}"/>
<rect x="${cx - 74}" y="328" width="148" height="2.5" fill="${C.goldDk}"/>`;

  const entrance = `
<path d="${outer}" fill="${C.stone}"/>
<path d="${face}" fill="${C.ivory}"/>
<path d="M${cx - 104},312H${cx - 92}V274H${cx - 78}V242H${cx - 60}V216H${cx - 38}V196H${cx + 38}V216H${cx + 60}V242H${cx + 78}V274H${cx + 92}V312H${cx + 104}" fill="none" stroke="${C.stoneDk}" stroke-width="1.6"/>
<rect x="${cx - 6}" y="126" width="12" height="46" fill="${C.ivory}"/>
<rect x="${cx - 19}" y="143" width="11" height="29" fill="${C.stone}"/><rect x="${cx + 8}" y="143" width="11" height="29" fill="${C.stone}"/>
<rect x="${cx - 30}" y="157" width="9" height="15" fill="${C.stoneDk}"/><rect x="${cx + 21}" y="157" width="9" height="15" fill="${C.stoneDk}"/>
<path d="M${cx},108L${cx + 6},126H${cx - 6}Z" fill="${C.gold}"/>
<path d="${reveal}" fill="${C.stoneDk}"/>
<path d="${flutes}" stroke="${C.stoneDk}" stroke-width="3"/>
<rect x="${cx - 104}" y="318" width="24" height="7" fill="${C.gold}"/><rect x="${cx + 80}" y="318" width="24" height="7" fill="${C.gold}"/>
<rect x="${cx - 104}" y="486" width="24" height="7" fill="${C.gold}"/><rect x="${cx + 80}" y="486" width="24" height="7" fill="${C.gold}"/>
${doors}
${fanlight}
<path d="M${cx - 12},196H${cx + 12}L${cx},212Z" fill="${C.gold}"/>
<path d="M${cx - 30},222H${cx + 30}M${cx - 22},228H${cx + 22}" stroke="${C.stoneDk}" stroke-width="2"/>`;

  // three steps, the top one widest lit
  const steps = [
    [cx - 130, 500, 260],
    [cx - 152, 518, 304],
    [cx - 174, 536, 348],
  ]
    .map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="18" fill="${C.ivory}"/><rect x="${x}" y="${y + 12}" width="${w}" height="6" fill="${C.stoneDk}"/>`)
    .join('');
  const spill = `<path d="M${cx - 66},500H${cx + 66}L${cx + 84},512H${cx - 84}ZM${cx - 88},518H${cx + 88}L${cx + 106},530H${cx - 106}ZM${cx - 110},536H${cx + 110}L${cx + 128},548H${cx - 128}Z" fill="${C.hot}"/>`;

  // a cat on the top step, watching the light
  const cat = (x, y) => `
<g transform="translate(${x} ${y})" fill="${C.ink}">
  <path d="M-11,0C-14,-12 -11,-25 -2,-29L3,-29C9,-24 11,-10 9,0Z"/>
  <circle cx="3" cy="-33" r="7.6"/>
  <path d="M-3.6,-37L-3,-46L2.4,-40ZM4,-40L9.6,-46L10.4,-36Z"/>
  <path d="M-9,-3C-22,-2 -23,-17 -16,-20" fill="none" stroke="${C.ink}" stroke-width="4.2" stroke-linecap="round"/>
</g>`;

  // clipped cone topiary in stone tubs, lit on the side that faces the door
  const tub = (x, lit) => `
<path d="M${x},398C${x + 6},438 ${x + 19},474 ${x + 19},497A19,7 0 0 1 ${x - 19},497C${x - 19},474 ${x - 6},438 ${x},398Z" fill="${C.blue2}"/>
<path d="M${x},398C${x + lit * 6},438 ${x + lit * 19},474 ${x + lit * 19},497A19,7 0 0 ${lit > 0 ? 1 : 0} ${x},504Z" fill="${C.blue4}"/>
<rect x="${x - 2.5}" y="502" width="5" height="16" fill="${C.goldDk}"/>
<path d="M${x - 16},522H${x + 16}L${x + 12},${G}H${x - 12}Z" fill="${C.ivory}"/>
<path d="M${x + lit * -16},522H${x}V${G}H${x + lit * -12}Z" fill="${C.stone}"/>
<rect x="${x - 19}" y="516" width="38" height="7" fill="${C.gold}"/>`;

  // the name
  const tx = 908;
  const words = `
<path d="M${tx - 44},178A44,44 0 0 1 ${tx + 44},178Z" fill="${C.night}"/>
${rays(tx, 178, 13, 44, -180, 0, 9, C.gold)}
<path d="M${tx - 11},178A11,11 0 0 1 ${tx + 11},178Z" fill="${C.hot}"/>
<path d="M${tx - 290},178H${tx - 56}M${tx + 56},178H${tx + 290}" stroke="${C.gold}" stroke-width="2.5"/>
<path d="M${tx - 290},185H${tx - 66}M${tx + 66},185H${tx + 290}" stroke="${C.gold}" stroke-width="1"/>
<text x="${tx}" y="296" text-anchor="middle" font-family="Deco" font-size="104" fill="${C.goldLt}">PORCHLIGHT</text>
<path d="M${tx - 290},330H${tx + 290}" stroke="${C.gold}" stroke-width="2.5"/>
<path d="M${tx - 290},337H${tx + 290}" stroke="${C.gold}" stroke-width="1"/>
<path d="M${tx - 34},337H${tx + 34}V343H${tx + 22}V349H${tx - 22}V343H${tx - 34}Z" fill="${C.gold}"/>
<text x="${tx}" y="410" text-anchor="middle" font-family="DidotI" font-size="41" fill="${C.ivory}">Nothing hides on a lit porch.</text>
<text x="${tx}" y="468" text-anchor="middle" font-family="FutM" font-size="14.5" letter-spacing="6" fill="${C.gold}">YOUR CODE · YOUR DOMAINS · YOUR MAC</text>`;

  return `
<rect width="1280" height="640" fill="${C.ink}"/>
<clipPath id="mat"><path d="${frame(27, 12)}"/></clipPath>
<g clip-path="url(#mat)">
<clipPath id="wall"><rect x="0" y="0" width="1280" height="${G}"/></clipPath>
<g clip-path="url(#wall)">
${wallLight(L[0], L[1], [[1300, C.night, C.far], [284, C.blue1, C.night], [228, C.blue2, C.blue1], [176, C.blue3, C.blue2]], 'h')}
</g>
<rect x="0" y="${G}" width="1280" height="${640 - G}" fill="${C.ink}"/>
<path d="M${cx - 300},${G}H${cx + 300}L${cx + 380},640H${cx - 380}Z" fill="${C.night}"/>
<path d="M${cx - 200},${G}H${cx + 200}L${cx + 250},640H${cx - 250}Z" fill="${C.blue1}"/>
<rect x="0" y="${G}" width="1280" height="3" fill="${C.gold}"/>
<rect x="0" y="${G + 8}" width="1280" height="1" fill="${C.gold}"/>
<path d="M40,596${Array.from({ length: 100 }, (_, i) => `L${52 + i * 12},${i % 2 ? 596 : 584}`).join('')}" fill="none" stroke="${C.goldDk}" stroke-width="1.6" stroke-linejoin="miter"/>
${tub(cx - 214, 1)}${tub(cx + 214, -1)}
${entrance}
${steps}
${spill}
${cat(cx - 96, 500)}
</g>
${words}
<path d="${frame(18, 16)}" fill="none" stroke="${C.gold}" stroke-width="2.5"/>
<path d="${frame(27, 12)}" fill="none" stroke="${C.gold}" stroke-width="1"/>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 29 Deco sunburst door

A Deco entrance in pale limestone: a stepped surround with fluted piers, double doors with chevron grilles, and a sunburst fanlight that is itself the porch light. Its rays carry on across the wall as stepped rings of blue, so the whole sheet is lit from the door. A cat on the top step watches it. The mark is the same idea reduced: a half-sun over a door inside the stepped outline; the favicons redraw it with five rays that land on whole pixels.
Palette: midnight #0a1330 / #14264f / #1a3264 / #2c4f8f, gold #dba63c / #f2cd76 / #96691f, limestone #f5ecd4 / #e4d6b0 / #c4b388, lamp #fff1c4.
Type: Phosphate Inline for the name, Didot Italic for the tagline, Futura Medium capitals tracked wide for the small lines.
Tagline: Nothing hides on a lit porch.
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
