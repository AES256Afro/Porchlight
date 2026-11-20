// 09 Atomic sign: a 1950s roadside sign whose arrow of chaser bulbs points
// at your own front door, with a starburst on top.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '09-atomic-sign';
const C = {
  night0: '#0a282d',
  night1: '#0d3138',
  night2: '#113c43',
  night3: '#174a52',
  ground: '#082022',
  ground2: '#0c2a2c',
  orange: '#e8642c',
  orangeDk: '#b4461b',
  cream: '#f6e7c8',
  creamDk: '#e2cfa8',
  aqua: '#62c6b9',
  aquaDk: '#3a948a',
  amber: '#f7b733',
  hot: '#fff4cc',
  teal: '#0b2e33',
  steel: '#1f3b40',
};
const f = (n) => Math.round(n * 10) / 10;

// ---- geometry helpers --------------------------------------------------------
const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
};
// points every `gap` along a polyline (array of points)
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
const bez = (p0, p1, p2, p3, n = 120) => Array.from({ length: n + 1 }, (_, i) => cubic(p0, p1, p2, p3, i / n));

function bulbs(points, r, { lit = C.amber, hot = C.hot, socket = C.orangeDk } = {}) {
  return points
    .map(
      ([x, y]) =>
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + r * 0.35)}" fill="${socket}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${lit}"/><circle cx="${f(x - r * 0.3)}" cy="${f(y - r * 0.3)}" r="${f(r * 0.42)}" fill="${hot}"/>`,
    )
    .join('');
}

// Starburst: list of [angleDeg, length, halfWidth]
function burst(cx, cy, rays, fill) {
  const d = rays
    .map(([a, len, w]) => {
      const r = (a * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      return `M${f(cx - s * w)},${f(cy + c * w)}L${f(cx + c * len)},${f(cy + s * len)}L${f(cx + s * w)},${f(cy - c * w)}Z`;
    })
    .join('');
  return `<path d="${d}" fill="${fill}"/>`;
}
function bigBurst(cx, cy, sc = 1, light = false) {
  const outer = [];
  const inner = [];
  const L = [1, 0.46, 0.74, 0.46, 0.9, 0.46, 0.66, 0.46];
  for (let i = 0; i < 16; i++) {
    const a = i * 22.5 - 90;
    outer.push([a, 60 * sc * L[i % 8], (i % 2 ? 3.2 : 4.6) * sc]);
  }
  for (let i = 0; i < 8; i++) inner.push([i * 45 - 90 + 22.5, 30 * sc, 3 * sc]);
  return `${burst(cx, cy, outer, light ? C.aquaDk : C.cream)}${burst(cx, cy, inner, light ? C.amber : C.aqua)}
<circle cx="${cx}" cy="${cy}" r="${f(11 * sc)}" fill="${C.orange}"/>
<circle cx="${cx}" cy="${cy}" r="${f(6.5 * sc)}" fill="${C.amber}"/>
<circle cx="${f(cx - 2 * sc)}" cy="${f(cy - 2 * sc)}" r="${f(2.6 * sc)}" fill="${C.hot}"/>`;
}
function twinkle(cx, cy, s, fill) {
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + s * 0.16)},${f(cy - s * 0.16)} ${f(cx + s)},${cy}Q${f(cx + s * 0.16)},${f(cy + s * 0.16)} ${cx},${f(cy + s)}Q${f(cx - s * 0.16)},${f(cy + s * 0.16)} ${f(cx - s)},${cy}Q${f(cx - s * 0.16)},${f(cy - s * 0.16)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}

// mid-century door with three staggered lights
function door(x, y, w, h, { frame = C.cream, body = C.orange, glass = C.hot, fw = 4 } = {}) {
  const q = w * 0.17;
  const lights = [
    [x + w * 0.22, y + h * 0.2],
    [x + w * 0.42, y + h * 0.33],
    [x + w * 0.62, y + h * 0.46],
  ];
  return `<rect x="${x - fw}" y="${y - fw}" width="${w + 2 * fw}" height="${h + fw}" fill="${frame}"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${body}"/>
${lights.map(([lx, ly]) => `<rect x="${f(lx)}" y="${f(ly)}" width="${f(q)}" height="${f(q)}" fill="${glass}"/>`).join('')}
<circle cx="${f(x + w * 0.84)}" cy="${f(y + h * 0.56)}" r="${f(w * 0.05)}" fill="${C.cream}"/>`;
}

// ---- mark: the canted sign panel, ringed with bulbs, script P, starburst ----
function markBody(light = true) {
  const outer = 'M28,84L166,64Q178,62.5 177,75L169,166Q168,177 157,178L45,189Q31,190 31,177Z';
  const inner = 'M47,98L160,82L153,161L49,171Z';
  const mid = [[38,91],[168,72],[160,168],[41,181],[38,91]];
  return `
<path d="M121,70V36" stroke="${C.aquaDk}" stroke-width="5"/>
${bigBurst(121, 34, 0.52, light)}
<path d="${outer}" fill="${C.orange}"/>
<path d="${inner}" fill="${C.cream}"/>
${bulbs(along(mid, 16.4, 3), 3.7)}
<g transform="rotate(-7.5 100 134)">
  <text x="104" y="168" text-anchor="middle" font-family="SignPainter" font-size="124" fill="${C.orange}" transform="translate(5 4)">P</text>
  <text x="104" y="168" text-anchor="middle" font-family="SignPainter" font-size="124" fill="${C.teal}">P</text>
</g>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons: drawn on the pixel grid -----------------------------------------
const PIX = { O: C.orange, A: C.amber, H: C.hot, C: C.cream, T: C.teal, S: C.orange, s: C.aquaDk };
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
  '...........A....',
  '..........AOA...',
  '...........A....',
  '...........s....',
  '........OAOAOAO.',
  '.OAOAOAOCCCCCCA.',
  '.OCCCTTTTTCCCCO.',
  '.ACCCTTCCTTSCCA.',
  '.OCCCTTCCTTSCCO.',
  '.ACCCTTTTTSSCCA.',
  '.OCCCTTSSSSCCCO.',
  '.ACCCTTSCCCCCCA.',
  '.OCCCTTSCCCCCCO.',
  '.ACCCTTSCCCCCCA.',
  '.OCCCCSSOAOAOAO.',
  '.AOAOAOA........',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const top = (x) => (x <= 10 ? 10 : x <= 19 ? 9 : 8);
  const bot = (x) => (x <= 10 ? 29 : x <= 19 ? 28 : 27);
  for (let x = 2; x <= 29; x++)
    for (let y = top(x); y <= bot(x); y++) {
      const ring = x <= 4 || x >= 27 || y <= top(x) + 2 || y >= bot(x) - 2;
      g[y][x] = ring ? 'O' : 'C';
    }
  // bulbs on the middle line of the ring
  for (let x = 3; x <= 28; x++) {
    if (x % 3 === 0) {
      g[top(x) + 1][x] = 'A';
      g[bot(x) - 1][x] = 'A';
    }
  }
  for (let y = 12; y <= 26; y++) {
    if (y % 3 === 0) {
      g[y][3] = 'A';
      g[y][28] = 'A';
    }
  }
  const P = [
    'TTTTTTTT..',
    'TTTTTTTTT.',
    'TTT....TTT',
    'TTT....TTT',
    'TTT....TTT',
    'TTTTTTTTT.',
    'TTTTTTTT..',
    'TTT.......',
    'TTT.......',
    'TTT.......',
    'TTT.......',
    'TTT.......',
  ];
  const px = 11;
  const py = 13;
  P.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'T' && g[py + j + 1][px + i + 1] === 'C') g[py + j + 1][px + i + 1] = 'S'; }));
  P.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'T') g[py + j][px + i] = 'T'; }));
  const star = ['...A...', '.A.A.A.', '..AOA..', 'AAOHOAA', '..AOA..', '.A.A.A.', '...A...'];
  star.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') g[j][20 + i] = ch; }));
  g[7][23] = 's';
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon --------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
<rect x="0" y="0" width="512" height="512" rx="112" fill="${C.night1}"/>
<path d="M0,370H512V400Q512,512 400,512H112Q0,512 0,400Z" fill="${C.ground}"/>
${twinkle(70, 90, 14, C.aqua)}${twinkle(118, 150, 7, C.cream)}${twinkle(430, 300, 9, C.aqua)}
${nest({ x: 36, y: 40, w: 440, h: 440, vb: '0 0 200 200', body: markBody(false) })}`,
});

// ---- logo --------------------------------------------------------------------
const logoSvg = svg({
  w: 640,
  h: 200,
  vb: '0 0 640 200',
  body: `
<rect x="18" y="18" width="164" height="164" rx="34" fill="${C.night1}"/>
${nest({ x: 24, y: 22, w: 154, h: 154, vb: '0 0 200 200', body: markBody(false) })}
<text x="212" y="128" font-family="SignPainter" font-size="112" fill="${C.orange}" transform="translate(4 4)">Porchlight</text>
<text x="212" y="128" font-family="SignPainter" font-size="112" fill="${C.teal}">Porchlight</text>
<path d="M232,150C330,140 470,136 606,146" fill="none" stroke="${C.orange}" stroke-width="5" stroke-linecap="round"/>
<text x="236" y="182" font-family="Futura" font-weight="500" font-size="15" letter-spacing="4.5" fill="${C.teal}">LEFT ON FOR YOU · ALL NIGHT</text>`,
});

// ---- hero --------------------------------------------------------------------
function hero() {
  const r = rng(9);
  // sky in flat screen-print bands
  const sky = `
<rect width="1280" height="640" fill="${C.night0}"/>
<rect y="170" width="1280" height="470" fill="${C.night1}"/>
<rect y="330" width="1280" height="310" fill="${C.night2}"/>
<rect y="450" width="1280" height="190" fill="${C.night3}"/>`;
  const stars = [
    [64, 70, 9, C.cream], [210, 40, 5, C.aqua], [700, 60, 12, C.aqua], [790, 150, 6, C.cream], [900, 48, 8, C.cream],
    [1010, 120, 13, C.aqua], [1160, 64, 7, C.cream], [1230, 200, 5, C.aqua], [80, 330, 6, C.aqua], [1110, 300, 8, C.cream],
  ]
    .map(([x, y, s, c]) => twinkle(x, y, s, c))
    .join('');
  let dots = '';
  for (let i = 0; i < 46; i++) {
    const x = r() * 1280;
    const y = r() * 380;
    dots += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.9 + r() * 1.1)}" fill="${C.cream}" opacity="${f(0.35 + r() * 0.5)}"/>`;
  }

  // ---- house (right) ----
  const HX0 = 740;
  const HX1 = 1236;
  const wallTop = 446;
  const base = 566;
  // butterfly roof: two slopes meeting in a valley
  const roof = `M${HX0 - 34},${404}L${980},${438}L${HX1 + 30},${386}L${HX1 + 30},${400}L${980},${452}L${HX0 - 34},${418}Z`;
  const wallPoly = `M${HX0},${414}L980,${446}L${HX1},${398}V${base}H${HX0}Z`;
  let siding = '';
  for (let x = HX0 + 12; x < HX1; x += 12) siding += `M${x},380V${base}`;
  // breeze-block screen
  let breeze = '';
  for (let by = 0; by < 4; by++)
    for (let bx = 0; bx < 4; bx++) {
      const x = 1110 + bx * 26;
      const y = 456 + by * 26;
      breeze += `<rect x="${x}" y="${y}" width="24" height="24" fill="${C.creamDk}"/><circle cx="${x + 12}" cy="${y + 12}" r="8.5" fill="${C.night2}"/><circle cx="${x + 12}" cy="${y + 12}" r="3" fill="${C.creamDk}"/>`;
    }
  // the porch light pool: stepped bands, warm on teal
  const LX = 1016;
  const LY = 478;
  const pool = `
<clipPath id="wallclip"><path d="${wallPoly}"/></clipPath>
<path d="${wallPoly}" fill="#25463f"/>
<g clip-path="url(#wallclip)">
  <ellipse cx="${LX}" cy="${LY + 14}" rx="168" ry="122" fill="#34574a"/>
  <ellipse cx="${LX}" cy="${LY + 12}" rx="116" ry="90" fill="#4f6d54"/>
  <ellipse cx="${LX}" cy="${LY + 10}" rx="70" ry="58" fill="#77865c"/>
  <ellipse cx="${LX}" cy="${LY + 6}" rx="34" ry="30" fill="#a09a62"/>
</g>
<path d="M944,${base}H988L1034,640H896Z" fill="#1b3d37"/>
<path d="M952,${base}H980L1004,610H926Z" fill="#2c4c3f"/>`;
  // sputnik porch lamp
  const spokes = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const len = i % 2 ? 15 : 21;
    spokes.push([LX + Math.cos(a) * len, LY + Math.sin(a) * len, i % 3 === 0 ? C.aqua : C.amber]);
  }
  const lamp = `
<path d="M${LX + 22},${LY}H${LX + 34}" stroke="${C.steel}" stroke-width="4"/>
<rect x="${LX + 32}" y="${LY - 9}" width="5" height="18" fill="${C.steel}"/>
${spokes.map(([x, y]) => `<path d="M${LX},${LY}L${f(x)},${f(y)}" stroke="${C.cream}" stroke-width="2"/>`).join('')}
${spokes.map(([x, y, c]) => `<circle cx="${f(x)}" cy="${f(y)}" r="3.2" fill="${c}"/>`).join('')}
<circle cx="${LX}" cy="${LY}" r="10" fill="${C.amber}"/>
<circle cx="${LX}" cy="${LY}" r="6.5" fill="${C.hot}"/>`;
  const house = `
${pool}

<g clip-path="url(#wallclip)"><path d="${siding}" stroke="${C.night0}" stroke-width="1.4" opacity="0.45"/></g>
<rect x="${HX0 + 26}" y="462" width="150" height="70" fill="${C.night0}"/>
<path d="M${HX0 + 26},532L${HX0 + 96},462H${HX0 + 120}L${HX0 + 50},532Z" fill="${C.night3}"/>
<path d="M${HX0 + 101},462V532" stroke="${C.cream}" stroke-width="4"/>
<rect x="${HX0 + 22}" y="458" width="158" height="78" fill="none" stroke="${C.cream}" stroke-width="5"/>
<rect x="${HX0 + 16}" y="536" width="170" height="10" fill="${C.creamDk}"/>
<path d="M${HX0 + 34},536l8,-26l6,26M${HX0 + 52},536l12,-30l2,30M${HX0 + 70},536l4,-20l8,20" fill="${C.aquaDk}"/>
${door(944, 478, 44, 88, { fw: 6 })}
<rect x="928" y="${base}" width="76" height="8" fill="${C.creamDk}"/>
${breeze}
${lamp}
<path d="${roof}" fill="${C.cream}"/>
<path d="M${HX0 - 34},418L980,452L${HX1 + 30},400V408L980,460L${HX0 - 34},426Z" fill="${C.orange}"/>
<rect x="${HX0}" y="${base}" width="${HX1 - HX0}" height="6" fill="${C.night0}"/>`;

  // ---- sign (left) ----
  const panel = 'M150,118L652,94Q668,93 665,109L640,252Q637,266 622,267L170,284Q150,285 150,265Z';
  const panelInner = 'M166,132L640,110L618,250L168,267Z';
  // bulbs along the panel border
  const border = [[158, 112], [656, 88], [630, 272], [160, 290], [158, 112]];
  const border2 = [[150, 118], [652, 94], [665, 109], [640, 252], [622, 267], [170, 284], [150, 265], [150, 118]];
  const borderBulbs = along(border2, 24, 8);
  // pylon
  const pylon = `
<path d="M300,${base + 4}L332,280H372L392,${base + 4}Z" fill="${C.aquaDk}"/>
<path d="M336,${base + 4}L346,280H358L360,${base + 4}Z" fill="${C.cream}"/>`;
  // readerboard with the tagline
  const RB = { x: 200, y: 322, w: 470, h: 108 };
  const reader = `
<rect x="${RB.x - 10}" y="${RB.y - 10}" width="${RB.w + 20}" height="${RB.h + 20}" rx="6" fill="${C.orange}"/>
<rect x="${RB.x}" y="${RB.y}" width="${RB.w}" height="${RB.h}" fill="${C.cream}"/>
<path d="M${RB.x},${RB.y + 54}H${RB.x + RB.w}" stroke="${C.creamDk}" stroke-width="2"/>
<path d="M${RB.x},${RB.y + 8}H${RB.x + RB.w}M${RB.x},${RB.y + 46}H${RB.x + RB.w}M${RB.x},${RB.y + 62}H${RB.x + RB.w}M${RB.x},${RB.y + 100}H${RB.x + RB.w}" stroke="${C.creamDk}" stroke-width="1.2"/>
<text x="${RB.x + RB.w / 2}" y="${RB.y + 40}" text-anchor="middle" font-family="Futura" font-weight="700" font-size="27" letter-spacing="3.2" fill="${C.teal}">A LIGHT LEFT ON OVER</text>
<text x="${RB.x + RB.w / 2}" y="${RB.y + 94}" text-anchor="middle" font-family="Futura" font-weight="700" font-size="27" letter-spacing="3.2" fill="${C.teal}">YOUR OWN FRONT DOOR.</text>`;
  // the arrow: bulbs sweeping from the sign down to the door
  const A = [[660, 200], [800, 206], [930, 250], [972, 372]];
  const aPts = bez(A[0], A[1], A[2], A[3]);
  const aPath = `M${A[0][0]},${A[0][1]}C${A[1][0]},${A[1][1]} ${A[2][0]},${A[2][1]} ${A[3][0]},${A[3][1]}`;
  const tip = [978, 414];
  const head = `M${tip[0] - 30},368L${tip[0] + 26},363L${tip[0]},${tip[1]}Z`;
  const arrow = `
<path d="${aPath}" fill="none" stroke="${C.cream}" stroke-width="34"/>
<path d="${head}" fill="${C.cream}" stroke="${C.cream}" stroke-width="10" stroke-linejoin="round"/>
<path d="${aPath}" fill="none" stroke="${C.orange}" stroke-width="24"/>
<path d="${head}" fill="${C.orange}"/>
<path d="M${tip[0] - 15},372L${tip[0] + 12},369L${tip[0]},${tip[1] - 16}Z" fill="${C.orangeDk}"/>
${bulbs(along(aPts, 22, 10).slice(0, -1), 4.6)}`;

  return `
${sky}
${dots}
${stars}
<rect y="${base}" width="1280" height="${640 - base}" fill="${C.ground}"/>
<rect y="${base + 22}" width="1280" height="8" fill="${C.ground2}"/>
${house}
${pylon}
${arrow}
<path d="M520,96V60" stroke="${C.steel}" stroke-width="6"/>
${bigBurst(520, 56, 0.95)}
<path d="${panel}" fill="${C.orange}"/>
<path d="${panelInner}" fill="${C.cream}"/>
<path d="M176,258L610,242" stroke="${C.aqua}" stroke-width="5" stroke-linecap="round"/>
${bulbs(borderBulbs, 4.4, { socket: C.orangeDk })}
<text x="400" y="230" text-anchor="middle" font-family="SignPainter" font-size="132" fill="${C.orange}" transform="translate(5 5) rotate(-2.6 400 200)">Porchlight</text>
<text x="400" y="230" text-anchor="middle" font-family="SignPainter" font-size="132" fill="${C.teal}" transform="rotate(-2.6 400 200)">Porchlight</text>
${reader}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 09 Atomic sign

A 1950s roadside sign: script name on a canted panel ringed with chaser bulbs, a starburst topper, and an arrow of bulbs that points at your own front door; the tagline sits on the changeable-letter readerboard. The mark is that panel in small, with a script P; the favicons are drawn on the pixel grid.
Palette: night #0a282d / #113c43 / #174a52, orange #e8642c, cream #f6e7c8, aqua #62c6b9, amber #f7b733, deep teal ink #0b2e33.
Type: SignPainter HouseScript for the name, Futura Bold and Medium caps for the readerboard and small lines.
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
