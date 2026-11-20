// 26 Bulb arrow: a fairground sign. The stem of the P is a lit front door, and
// its bowl is a great arrow studded with bulbs that curls round to point at it.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '26-bulb-arrow';
const C = {
  night: '#0d1836',
  night2: '#122250',
  sea: '#14285c',
  seaLt: '#1d3672',
  post: '#22366f',
  red: '#d32e2c',
  redDk: '#8a171c',
  cream: '#f7ecd0',
  creamDk: '#dccfa9',
  amber: '#f6b02c',
  amberDk: '#cf8514',
  hot: '#fff4c8',
  plank: '#1b2038',
  plank2: '#222843',
  ink: '#0a122b',
};
const FONTS = { Fair: 'AmericanTypewriter-CondensedBold', Slab: 'Rockwell-Bold' };
const f = (n) => Math.round(n * 100) / 100;

// points every `gap` along a polyline
function along(points, gap, offset = 0) {
  const out = [];
  let carry = offset;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let d = carry;
    while (d <= len) {
      const t = d / len;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      d += gap;
    }
    carry = d - len;
  }
  return out;
}
function bulbs(points, r, { lit = C.amber, hot = C.hot, socket = C.redDk } = {}) {
  return points
    .map(
      ([x, y]) =>
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.36)}" fill="${socket}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${lit}"/><circle cx="${f(x - r * 0.28)}" cy="${f(y - r * 0.28)}" r="${f(r * 0.44)}" fill="${hot}"/>`,
    )
    .join('');
}

// ---- the P: door stem, arrow bowl (200 box) ------------------------------------
const AX = 124; // centre of the bowl
const AY = 82;
const AR = 44;
const BAND = 30;
const arrowLine = (() => {
  const pts = [[84, AY - AR], [AX, AY - AR]];
  for (let a = -88; a <= 90; a += 2) pts.push([AX + Math.cos((a * Math.PI) / 180) * AR, AY + Math.sin((a * Math.PI) / 180) * AR]);
  pts.push([AX - 4, AY + AR]);
  return pts;
})();
const ARROW = `M70,${AY - AR}H${AX}A${AR},${AR} 0 0 1 ${AX},${AY + AR}H${AX - 5}`;
const HEAD = `M${AX - 4},${AY + AR - 31}L${AX - 4},${AY + AR + 31}L${AX - 39},${AY + AR}Z`;

function door({ frame = C.cream } = {}) {
  return `
<rect x="18" y="178" width="72" height="7" fill="${frame}"/>
<rect x="26" y="18.5" width="56" height="159.5" fill="${frame}"/>
<rect x="31.5" y="24" width="45" height="154" fill="${C.amber}"/>
<rect x="38" y="33" width="32" height="50" fill="${C.hot}"/>
<path d="M54,33V83M38,58H70" stroke="${C.amber}" stroke-width="3"/>
<rect x="39.2" y="94" width="29.6" height="30" fill="none" stroke="${C.amberDk}" stroke-width="2.6"/>
<rect x="39.2" y="134" width="29.6" height="34" fill="none" stroke="${C.amberDk}" stroke-width="2.6"/>
<circle cx="71.5" cy="129" r="3.3" fill="${C.ink}"/>`;
}
function markBody({ outline = C.cream, frame = C.cream } = {}) {
  const pts = along(arrowLine, 13.6, 9);
  return `
<path d="${ARROW}" fill="none" stroke="${outline}" stroke-width="${BAND + 9}"/>
<path d="${HEAD}" fill="${outline}" stroke="${outline}" stroke-width="9" stroke-linejoin="round"/>
<path d="${ARROW}" fill="none" stroke="${C.red}" stroke-width="${BAND}"/>
<path d="${HEAD}" fill="${C.red}"/>
${bulbs(pts, 4.3)}
${bulbs([[AX - 19, AY + AR]], 4.3)}
${door({ frame })}`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 -2 200 200', body: markBody({ outline: 'none', frame: C.ink }) });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 -2 200 200', body: markBody() });

// ---- favicons, on the pixel grid --------------------------------------------------
const PIX = { R: C.red, A: C.amber, H: C.hot, C: C.cream, N: C.ink, D: C.amberDk };
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
  '................',
  '.AAAAARRRRRRR...',
  '.AHHHARRRHRRRR..',
  '.AHHHARRRRRRRRR.',
  '.AHHHA.....RRRR.',
  '.AAAAA......RRR.',
  '.AAAAA....R.RHR.',
  '.AAAAA...RR.RRR.',
  '.AAAAA..RRRRRRR.',
  '.AANAA.RRRRRRR..',
  '.AAAAA..RRRRRR..',
  '.AAAAA...RR.....',
  '.AAAAA....R.....',
  '.AAAAA..........',
  '.AAAAA..........',
  'CCCCCCC.........',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const put = (x, y, ch) => { if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch; };
  const rect = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch); };
  // arrow bowl: a ring's right half joined to two bars
  const cx = 19.5;
  const cy = 12.5;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (x >= 20 && d >= 4.6 && d <= 9.9) put(x, y, 'R');
    }
  rect(12, 3, 19, 7, 'R');
  rect(19, 18, 19, 22, 'R');
  // head, pointing left at the door
  const head = [[18, 13, 27], [17, 14, 26], [16, 15, 25], [15, 16, 24], [14, 17, 23], [13, 18, 22], [12, 19, 21], [11, 20, 20]];
  head.forEach(([x, y0, y1]) => rect(x, y0, x, y1, 'R'));
  // bulbs
  [[14, 5], [18, 5], [22, 5], [25, 8], [27, 12], [25, 17], [21, 20], [16, 20]].forEach(([x, y]) => { put(x, y, 'H'); });
  // door
  rect(1, 2, 10, 29, 'C');
  rect(2, 3, 9, 29, 'A');
  rect(3, 4, 8, 11, 'H');
  rect(3, 8, 8, 8, 'A');
  rect(5, 4, 6, 11, 'A');
  rect(3, 14, 8, 18, 'D'); rect(4, 15, 7, 17, 'A');
  rect(3, 22, 8, 27, 'D'); rect(4, 23, 7, 26, 'A');
  put(8, 20, 'N'); put(8, 21, 'N');
  rect(0, 30, 11, 30, 'C');
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- shared scenery ------------------------------------------------------------------
function twinkle(cx, cy, s, fill) {
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + s * 0.15)},${f(cy - s * 0.15)} ${f(cx + s)},${cy}Q${f(cx + s * 0.15)},${f(cy + s * 0.15)} ${cx},${f(cy + s)}Q${f(cx - s * 0.15)},${f(cy + s * 0.15)} ${f(cx - s)},${cy}Q${f(cx - s * 0.15)},${f(cy - s * 0.15)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}

// ---- icon -------------------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: `<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>`,
  body: `
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="${C.night}"/>
  <rect y="436" width="512" height="76" fill="${C.plank}"/>
  <path d="M0,436H512" stroke="${C.plank2}" stroke-width="6"/>
  <path d="M96,436H236L330,512H40Z" fill="#4a3a3c"/>
  <path d="M110,436H222L268,512H84Z" fill="#8a6234"/>
  ${twinkle(392, 356, 15, C.cream)}${twinkle(446, 404, 8, C.amber)}${twinkle(452, 70, 9, C.cream)}
  ${nest({ x: 44, y: 28, w: 440, h: 440, vb: '0 0 200 200', body: markBody() })}
</g>`,
});

// ---- logo ----------------------------------------------------------------------------------
function shade(text, x, y, size, face, shadeCol, n, attrs = '') {
  let s = '';
  for (let i = n; i >= 1; i--) s += `<text x="${x + i}" y="${y + i}" font-family="Fair" font-size="${size}" fill="${shadeCol}" ${attrs}>${text}</text>`;
  s += `<text x="${x}" y="${y}" font-family="Fair" font-size="${size}" fill="${face}" ${attrs}>${text}</text>`;
  return s;
}
function logo(dark) {
  const face = dark ? C.cream : C.night;
  return svg({
    w: 640,
    h: 200,
    vb: '0 0 640 200',
    fonts: FONTS,
    body: `
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 -2 200 200', body: dark ? markBody() : markBody({ outline: 'none', frame: C.ink }) })}
${shade('PORCHLIGHT', 198, 116, 72, face, C.red, 4, 'letter-spacing="1"')}
<text x="200" y="158" font-family="Slab" font-size="15" letter-spacing="4.3" fill="${face}">SEE WHO’S AT THE DOOR</text>`,
  });
}

// ---- hero -------------------------------------------------------------------------------------
function hero() {
  const r = rng(26);
  const DECK = 548;
  const HORIZON = 452;

  let stars = '';
  for (let i = 0; i < 70; i++) {
    const x = r() * 1280;
    const y = r() * 420;
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + r() * 1.2)}" fill="${C.cream}" opacity="${f(0.3 + r() * 0.5)}"/>`;
  }
  const tw = [[52, 150, 8], [330, 128, 6], [498, 148, 9], [1236, 330, 6], [700, 84, 5], [930, 60, 7], [1206, 262, 4]]
    .map(([x, y, s]) => twinkle(x, y, s, C.cream))
    .join('');

  // moon and its path on the water
  const MOONX = 1228;
  const moon = `<circle cx="${MOONX}" cy="176" r="26" fill="${C.cream}"/><circle cx="${MOONX - 11}" cy="169" r="26" fill="${C.night}"/>`;
  let glitter = '';
  for (let i = 0; i < 9; i++) {
    const y = HORIZON + 10 + i * 10;
    const w = 14 + i * 6 + r() * 12;
    glitter += `<rect x="${f(MOONX - w / 2 + (r() - 0.5) * 16)}" y="${y}" width="${f(w)}" height="2.6" rx="1.3" fill="${C.cream}" opacity="${f(0.75 - i * 0.05)}"/>`;
  }
  // festoon lights between the posts
  const P1 = 548;
  const P2 = 1150;
  const swag = (x0, y0, x1, y1, sag) => {
    const mx = (x0 + x1) / 2;
    const my = Math.max(y0, y1) + sag;
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = 1 - t;
      pts.push([u * u * x0 + 2 * u * t * mx + t * t * x1, u * u * y0 + 2 * u * t * (2 * my - (y0 + y1) / 2) + t * t * y1]);
    }
    return pts;
  };
  const swags = [swag(-40, 30, P1, 70, 30), swag(P1, 70, P2, 70, 26), swag(P2, 70, 1320, 34, 28)];
  const cols = [C.amber, C.cream, C.red];
  let festoon = '';
  let k = 0;
  swags.forEach((pts) => {
    festoon += `<path d="M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L')}" fill="none" stroke="${C.post}" stroke-width="2.2"/>`;
    along(pts, 44, 26).forEach(([x, y]) => {
      const c = cols[k++ % 3];
      festoon += `<rect x="${f(x - 2.2)}" y="${f(y)}" width="4.4" height="5" fill="${C.post}"/><circle cx="${f(x)}" cy="${f(y + 10)}" r="6" fill="${c}"/><circle cx="${f(x - 1.8)}" cy="${f(y + 8)}" r="2.1" fill="${C.hot}" opacity="0.9"/>`;
    });
  });

  // boardwalk
  let deck = `<rect y="${DECK}" width="1280" height="${640 - DECK}" fill="${C.plank}"/>`;
  [DECK, DECK + 30, DECK + 62].forEach((y, i) => {
    deck += `<rect y="${y}" width="1280" height="3" fill="${C.ink}"/>`;
    for (let x = 60 + i * 110 + r() * 60; x < 1280; x += 250 + r() * 90) deck += `<rect x="${f(x)}" y="${y + 3}" width="3" height="${i === 2 ? 30 : i === 1 ? 29 : 27}" fill="${C.ink}"/>`;
  });
  // pool of light from the door
  const pool = `
<path d="M112,${DECK + 13}H268L520,640H-40Z" fill="#2c2a45"/>
<path d="M120,${DECK + 13}H262L420,640H30Z" fill="#4c3b3f"/>
<path d="M128,${DECK + 13}H256L330,640H96Z" fill="#84603a"/>`;
  let deckLines = '';
  [DECK + 30, DECK + 62].forEach((y) => { deckLines += `<rect y="${y}" width="560" height="3" fill="${C.ink}" opacity="0.55"/>`; });

  // the cat who is at the door
  const cat = `
<g transform="translate(300 ${DECK + 62}) scale(1.08)">
  <ellipse cx="34" cy="3" rx="46" ry="5" fill="${C.ink}" opacity="0.5"/>
  <path d="M-2,2C-14,2 -20,-10 -18,-24C-17,-34 -12,-40 -10,-46C-14,-52 -14,-60 -10,-66L-9,-78L-1,-70C2,-71 6,-71 9,-70L17,-78L18,-66C22,-60 21,-52 17,-46C22,-38 26,-28 26,-16C26,-8 24,-2 20,2Z" fill="${C.ink}"/>
  <path d="M20,2C34,3 44,-2 44,-12C44,-18 39,-21 36,-18" fill="none" stroke="${C.ink}" stroke-width="6.5" stroke-linecap="round"/>
  <path d="M-13.5,-46C-15,-40 -19,-34 -18.5,-24" fill="none" stroke="${C.amber}" stroke-width="2" stroke-linecap="round"/>
  <path d="M-9.4,-76.5L-10.4,-66.5C-13.6,-61 -13.6,-54.5 -10.6,-49" fill="none" stroke="${C.amber}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;

  // the main board
  const BX0 = 520;
  const BX1 = 1180;
  const BY0 = 172;
  const BY1 = 340;
  const BCX = (BX0 + BX1) / 2;
  const q = 20; // concave corners
  const bump = 92;
  const board = `M${BX0 + q},${BY0}H${BCX - bump}A${bump},${bump * 0.42} 0 0 1 ${BCX + bump},${BY0}H${BX1 - q}A${q},${q} 0 0 0 ${BX1},${BY0 + q}V${BY1 - q}A${q},${q} 0 0 0 ${BX1 - q},${BY1}H${BX0 + q}A${q},${q} 0 0 0 ${BX0},${BY1 - q}V${BY0 + q}A${q},${q} 0 0 0 ${BX0 + q},${BY0}Z`;
  const rim = [];
  // bulbs round the rim, on a line inset from the edge
  const ins = 15;
  const rimPts = [[BX0 + q + 8, BY0 + ins], [BCX - bump - 4, BY0 + ins]];
  for (let a = 180; a <= 360; a += 6) rimPts.push([BCX + Math.cos((a * Math.PI) / 180) * (bump - 6), BY0 + ins + Math.sin((a * Math.PI) / 180) * (bump * 0.42 - 2)]);
  rimPts.push([BCX + bump + 4, BY0 + ins], [BX1 - q - 8, BY0 + ins]);
  rim.push(...along(rimPts, 25.4, 0));
  rim.push(...along([[BX1 - ins, BY0 + q + 12], [BX1 - ins, BY1 - q - 12]], 25, 4));
  rim.push(...along([[BX1 - q - 8, BY1 - ins], [BX0 + q + 8, BY1 - ins]], 25.35, 0));
  rim.push(...along([[BX0 + ins, BY1 - q - 12], [BX0 + ins, BY0 + q + 12]], 25, 4));

  const sign = `
<rect x="${P1 - 6}" y="70" width="12" height="${DECK - 70}" fill="${C.post}"/>
<rect x="${P2 - 6}" y="70" width="12" height="${DECK - 70}" fill="${C.post}"/>
<circle cx="${P1}" cy="66" r="8" fill="${C.cream}"/><circle cx="${P2}" cy="66" r="8" fill="${C.cream}"/>
<path d="${board}" fill="${C.ink}" transform="translate(7 8)"/>
<path d="${board}" fill="${C.cream}"/>
<path d="${board}" fill="${C.red}" transform="translate(${BCX} ${(BY0 + BY1) / 2}) scale(0.984 0.94) translate(${-BCX} ${-(BY0 + BY1) / 2})"/>
<rect x="${BX0 + 34}" y="${BY0 + 34}" width="${BX1 - BX0 - 68}" height="${BY1 - BY0 - 68}" rx="4" fill="none" stroke="${C.cream}" stroke-width="2.5"/>
${bulbs(rim, 5.2)}
${twinkle(BCX, BY0 - 13, 15, C.amber)}
${shade('PORCHLIGHT', BCX, BY1 - 55, 103, C.cream, C.redDk, 7, 'letter-spacing="1.5" text-anchor="middle"')}`;

  // the tagline board, hung on chains
  const TX0 = 600;
  const TX1 = 1100;
  const TY0 = 384;
  const TY1 = 444;
  const chain = (x) => {
    let s = '';
    for (let y = BY1 + 2; y < TY0 - 2; y += 9) s += `<ellipse cx="${x}" cy="${y + 4}" rx="3" ry="4.6" fill="none" stroke="${C.creamDk}" stroke-width="1.8"/>`;
    return s;
  };
  const tag = `
${chain(TX0 + 44)}${chain(TX1 - 44)}
<rect x="${TX0 + 6}" y="${TY0 + 7}" width="${TX1 - TX0}" height="${TY1 - TY0}" rx="6" fill="${C.ink}"/>
<rect x="${TX0}" y="${TY0}" width="${TX1 - TX0}" height="${TY1 - TY0}" rx="6" fill="${C.cream}"/>
<rect x="${TX0 + 7}" y="${TY0 + 7}" width="${TX1 - TX0 - 14}" height="${TY1 - TY0 - 14}" rx="2" fill="none" stroke="${C.red}" stroke-width="2"/>
<text x="${(TX0 + TX1) / 2}" y="${TY1 - 20}" text-anchor="middle" font-family="Slab" font-size="27" letter-spacing="3.4" fill="${C.night}">SEE WHO’S AT THE DOOR.</text>`;

  return `
<rect width="1280" height="640" fill="${C.night}"/>
<rect y="300" width="1280" height="160" fill="${C.night2}"/>
${stars}${tw}${moon}
<rect y="${HORIZON}" width="1280" height="${DECK - HORIZON}" fill="${C.sea}"/>
<rect y="${HORIZON}" width="1280" height="3" fill="${C.seaLt}"/>
${glitter}
${deck}
${pool}
${deckLines}
${sign}
${tag}
${festoon}
${nest({ x: 70, y: DECK - 178 * 2.2, w: 440, h: 440, vb: '0 0 200 200', body: markBody() })}
${cat}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', fonts: FONTS, body: hero() });

const notes = `# 26 Bulb arrow

A boardwalk sign at night. The P is built from two things: its stem is a lit front door, and its bowl is a great red arrow studded with bulbs that curls round and points back at the door. Beside it the name stands on a fairground board ringed with bulbs, the tagline hangs beneath on chains, festoon lights run between the posts, and a cat waits in the light on the boards. The mark is the P on its own.
Palette: night #0d1836 / #122250, sea #14285c, fairground red #d32e2c / #8a171c, cream #f7ecd0, amber #f6b02c, bulb white #fff4c8.
Type: American Typewriter Condensed Bold capitals with a block shade for the name; Rockwell Bold tracked capitals for the tagline.
Tagline: See who's at the door.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'mark-dark.svg': markDarkSvg,
  'logo.svg': logo(false),
  'logo-dark.svg': logo(true),
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
