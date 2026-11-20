// 21 Motel marquee: a tall roadside motel sign at dusk. A Googie parabola arch
// carries five bouncing letter discs, a kidney panel with the script half of the
// name and an "on all night" box where the vacancy sign would be. Behind it a
// low motel with every porch globe dark except one.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '21-motel-marquee';
const C = {
  ink: '#14112b',
  indigo: '#231c4d',
  violet: '#3b2a66',
  plum: '#6c3570',
  rose: '#b3486b',
  coral: '#e8694f',
  peach: '#f6a468',
  sun: '#ffdca6',
  cream: '#f8ecd2',
  creamDk: '#e0cca6',
  turq: '#2fb8ae',
  turqDk: '#1a7f80',
  tomato: '#d9382c',
  tomatoDk: '#a3231d',
  amber: '#f8b83a',
  hot: '#fff3c4',
  wall: '#2a2053',
  wallDk: '#191536',
  lilac: '#5d4c8a',
};
const f = (n) => Math.round(n * 10) / 10;

// ---- small parts ---------------------------------------------------------------
function twinkle(cx, cy, s, fill) {
  const k = s * 0.14;
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + k)},${f(cy - k)} ${f(cx + s)},${cy}Q${f(cx + k)},${f(cy + k)} ${cx},${f(cy + s)}Q${f(cx - k)},${f(cy + k)} ${f(cx - s)},${cy}Q${f(cx - k)},${f(cy - k)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}
// rays: [angleDeg, length, halfWidth]
function rays(cx, cy, list, fill) {
  const d = list
    .map(([a, len, w]) => {
      const r = (a * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      return `M${f(cx - s * w)},${f(cy + c * w)}L${f(cx + c * len)},${f(cy + s * len)}L${f(cx + s * w)},${f(cy - c * w)}Z`;
    })
    .join('');
  return `<path d="${d}" fill="${fill}"/>`;
}
function starburst(cx, cy, sc, { long = C.cream, short = C.turq, core = C.tomato } = {}) {
  const L = [1, 0.42, 0.7, 0.42, 0.86, 0.42, 0.7, 0.42];
  const outer = [];
  const inner = [];
  for (let i = 0; i < 16; i++) if (i % 2 === 0) outer.push([i * 22.5 - 90, 48 * sc * L[i % 8], 4.2 * sc]);
  for (let i = 0; i < 8; i++) inner.push([i * 45 - 67.5, 24 * sc, 3 * sc]);
  return `${rays(cx, cy, outer, long)}${rays(cx, cy, inner, short)}
<circle cx="${cx}" cy="${cy}" r="${f(9.5 * sc)}" fill="${core}"/>
<circle cx="${cx}" cy="${cy}" r="${f(5.6 * sc)}" fill="${C.amber}"/>
<circle cx="${f(cx - 1.8 * sc)}" cy="${f(cy - 1.8 * sc)}" r="${f(2.2 * sc)}" fill="${C.hot}"/>`;
}
function bulbs(points, r, socket = C.tomatoDk) {
  return points
    .map(
      ([x, y]) =>
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.4)}" fill="${socket}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${C.amber}"/><circle cx="${f(x - r * 0.3)}" cy="${f(y - r * 0.3)}" r="${f(r * 0.42)}" fill="${C.hot}"/>`,
    )
    .join('');
}
// one bouncing letter disc
function disc(cx, cy, r, ch, fill, tilt, size) {
  return `<g transform="rotate(${tilt} ${cx} ${cy})">
<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.cream}"/>
<circle cx="${cx}" cy="${cy}" r="${f(r * 0.85)}" fill="${fill}"/>
<text x="${cx}" y="${f(cy + size * 0.375)}" text-anchor="middle" font-family="Futura" font-weight="700" font-size="${size}" fill="${C.cream}">${ch}</text>
</g>`;
}
const WORD = ['P', 'O', 'R', 'C', 'H'];

// ---- mark: the Googie arch as a porch, a door under it, the globe lit ----------
function markBody({ star = C.amber } = {}) {
  const arch = 'M36,206Q100,-158 164,206';
  return `
<clipPath id="mk"><rect x="0" y="-20" width="200" height="216"/></clipPath>
<g clip-path="url(#mk)">
<path d="${arch}" fill="none" stroke="${C.turqDk}" stroke-width="21"/>
<path d="${arch}" fill="none" stroke="${C.turq}" stroke-width="12"/>
</g>
<rect x="78" y="122" width="44" height="74" fill="${C.cream}"/>
<rect x="83" y="127" width="34" height="69" fill="${C.tomato}"/>
<rect x="88" y="134" width="7" height="7" fill="${C.cream}"/><rect x="96.5" y="142.5" width="7" height="7" fill="${C.cream}"/><rect x="105" y="151" width="7" height="7" fill="${C.cream}"/>
<circle cx="110" cy="170" r="2.8" fill="${C.cream}"/>
<path d="M100,34V70" stroke="${C.turqDk}" stroke-width="4"/>
${rays(100, 86, [[-150, 31, 3.4], [-30, 31, 3.4], [180, 30, 3.4], [0, 30, 3.4], [150, 27, 3.4], [30, 27, 3.4]], C.amber)}
<circle cx="100" cy="86" r="19" fill="${C.tomato}"/>
<circle cx="100" cy="86" r="14.5" fill="${C.amber}"/>
<circle cx="95.5" cy="81.5" r="5.5" fill="${C.hot}"/>
${twinkle(100, 14, 13, star)}
<circle cx="100" cy="14" r="3.2" fill="${C.tomato}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { T: C.turq, t: C.turqDk, R: C.tomato, A: C.amber, H: C.hot, C: C.cream };
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
  '......TTTT......',
  '.....TTTTTT.....',
  '....TTT..TTT....',
  '....TT.AA.TT....',
  '...TTT.AA.TTT...',
  '...TT......TT...',
  '...TT......TT...',
  '..TTT.CCCC.TTT..',
  '..TT..CRRC..TT..',
  '..TT..CRRC..TT..',
  '..TT..CRRC..TT..',
  '.TTT..CRRC..TTT.',
  '.TT...CRRC...TT.',
  '.TT...CRRC...TT.',
  '.TT...CRRC...TT.',
  '.TT...CRRC...TT.',
];
const FAV32 = [
  '...............AA...............',
  '..............AAAA..............',
  '...............AA...............',
  '.............TTTTTT.............',
  '............TTTTTTTT............',
  '...........TTTTttTTTT...........',
  '...........TTT....TTT...........',
  '..........TTTT....TTTT..........',
  '..........TTT..AA..TTT..........',
  '..........TTT.AAAA.TTT..........',
  '.........TTT.AAHAAA.TTT.........',
  '.........TTT.AAAAAA.TTT.........',
  '.........TTT..AAAA..TTT.........',
  '........TTTT...AA...TTTT........',
  '........TTT..........TTT........',
  '........TTT..........TTT........',
  '.......TTTT..........TTTT.......',
  '.......TTT..CCCCCCCC..TTT.......',
  '.......TTT..CRRRRRRC..TTT.......',
  '......TTTT..CRCCCCRC..TTTT......',
  '......TTT...CRCCCCRC...TTT......',
  '......TTT...CRRRRRRC...TTT......',
  '......TTT...CRRRRRRC...TTT......',
  '.....TTTT...CRRRRRCC...TTTT.....',
  '.....TTT....CRRRRRCC....TTT.....',
  '.....TTT....CRRRRRRC....TTT.....',
  '.....TTT....CRRRRRRC....TTT.....',
  '....TTTT....CRRRRRRC....TTTT....',
  '....TTT.....CRRRRRRC.....TTT....',
  '....TTT.....CRRRRRRC.....TTT....',
  '....TTT.....CRRRRRRC.....TTT....',
  '....TTT.....CRRRRRRC.....TTT....',
];
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(FAV32) });

// ---- icon ----------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: '<clipPath id="sq"><rect width="512" height="512" rx="112"/></clipPath>',
  body: `
<g clip-path="url(#sq)">
<rect width="512" height="512" fill="${C.indigo}"/>
<rect y="150" width="512" height="362" fill="${C.violet}"/>
<rect y="262" width="512" height="250" fill="${C.plum}"/>
<rect y="350" width="512" height="162" fill="${C.rose}"/>
<rect y="412" width="512" height="100" fill="${C.coral}"/>
<rect x="300" y="142" width="170" height="16" rx="8" fill="${C.violet}"/>
<rect x="30" y="254" width="150" height="16" rx="8" fill="${C.plum}"/>
<rect x="340" y="342" width="200" height="16" rx="8" fill="${C.rose}"/>
<circle cx="256" cy="226" r="118" fill="#33285f"/>
<circle cx="256" cy="226" r="78" fill="#4a3472"/>
${twinkle(84, 96, 15, C.cream)}${twinkle(420, 84, 10, C.turq)}${twinkle(446, 214, 8, C.cream)}${twinkle(62, 206, 7, C.turq)}
<rect y="456" width="512" height="56" fill="${C.ink}"/>
${nest({ x: 46, y: 22, w: 420, h: 420 * 1.04, vb: '0 0 200 208', body: markBody({ star: C.cream }) })}
</g>`,
});

// ---- logo ----------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.cream : C.indigo;
  const xs = [228, 274, 320, 366, 412];
  const discs = xs
    .map((x, i) => disc(x, i % 2 ? 70 : 78, 22, WORD[i], i % 2 ? C.turqDk : C.tomato, i % 2 ? 6 : -6, 26))
    .join('');
  return `
${nest({ x: 12, y: 10, w: 176, h: 176, vb: '0 0 200 200', body: markBody({ star: dark ? C.cream : C.amber }) })}
<path d="M196,74L209,69H431L444,74L431,79H209Z" fill="${dark ? C.lilac : C.creamDk}"/>
${discs}
<g transform="rotate(-4 520 90)">
<text x="447" y="116" font-family="SignPainter" font-size="104" fill="${dark ? C.tomato : C.turq}" transform="translate(3.5 3.5)">light</text>
<text x="447" y="116" font-family="SignPainter" font-size="104" fill="${dark ? C.cream : C.tomato}">light</text>
</g>
<text x="207" y="139" font-family="Futura" font-weight="700" font-size="13" letter-spacing="8" fill="${ink}">ON ALL NIGHT.</text>
<path d="M207,151H428" stroke="${C.turq}" stroke-width="2.5"/>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero ----------------------------------------------------------------------
function saguaro(x, base, h, w = 13) {
  const a1 = base - h * 0.42;
  const a2 = base - h * 0.56;
  return `<g fill="none" stroke="${C.ink}" stroke-linecap="round" stroke-linejoin="round">
<path d="M${x},${base + 4}V${base - h}" stroke-width="${w}"/>
<path d="M${x},${a1}H${f(x - w * 1.7)}V${f(a1 - h * 0.26)}" stroke-width="${f(w * 0.72)}"/>
<path d="M${x},${a2}H${f(x + w * 1.6)}V${f(a2 - h * 0.2)}" stroke-width="${f(w * 0.72)}"/>
</g>`;
}

function hero() {
  const r = rng(21);
  // long lens-shaped clouds that sit on the seams between the sky bands
  const lens = (x, y, w, h, fill) => `<path d="M${x},${y}Q${x + w / 2},${y - h} ${x + w},${y}Q${x + w / 2},${y + h} ${x},${y}Z" fill="${fill}"/>`;
  const sky = `
<rect width="1280" height="640" fill="${C.indigo}"/>
<rect y="140" width="1280" height="500" fill="${C.violet}"/>
<rect y="262" width="1280" height="378" fill="${C.plum}"/>
<rect y="364" width="1280" height="276" fill="${C.rose}"/>
<rect y="446" width="1280" height="194" fill="${C.coral}"/>
<rect y="512" width="1280" height="128" fill="${C.peach}"/>
${lens(560, 140, 420, 16, C.violet)}${lens(900, 140, 460, 12, C.indigo)}${lens(-80, 140, 300, 12, C.violet)}
${lens(640, 124, 220, 5, C.violet)}${lens(1040, 168, 200, 5, C.indigo)}
${lens(760, 262, 520, 18, C.plum)}${lens(520, 262, 300, 12, C.violet)}${lens(-60, 262, 240, 12, C.plum)}
${lens(700, 238, 260, 6, C.plum)}${lens(1010, 292, 300, 6, C.violet)}
${lens(600, 364, 380, 16, C.rose)}${lens(930, 364, 420, 20, C.plum)}${lens(-40, 364, 200, 12, C.rose)}
${lens(660, 338, 240, 6, C.rose)}${lens(1060, 396, 240, 6, C.plum)}
${lens(690, 446, 460, 14, C.coral)}${lens(1100, 446, 260, 12, C.rose)}${lens(-20, 446, 180, 10, C.coral)}
${lens(520, 512, 300, 9, C.peach)}`;
  const stars = [
    [70, 62, 9, C.cream], [596, 54, 7, C.turq], [690, 86, 11, C.cream], [802, 40, 6, C.cream], [884, 190, 8, C.turq],
    [948, 70, 12, C.cream], [1016, 26, 6, C.turq], [1232, 44, 7, C.cream], [1040, 214, 6, C.cream],
    [742, 204, 5, C.turq], [48, 214, 6, C.turq], [1236, 216, 5, C.turq], [1198, 150, 5, C.cream],
  ]
    .map(([x, y, s, c]) => twinkle(x, y, s, c))
    .join('');
  const moon = `<path d="M1128,58A44,44 0 1 0 1166,128A35,35 0 1 1 1128,58Z" fill="${C.cream}"/>`;
  let dots = '';
  for (let i = 0; i < 54; i++) {
    const x = r() * 1280;
    const y = r() * 250;
    dots += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + r() * 1)}" fill="${C.cream}" opacity="${f(0.35 + r() * 0.45)}"/>`;
  }
  // low sun and mesas
  const sun = `
<clipPath id="above"><rect width="1280" height="560"/></clipPath>
<g clip-path="url(#above)">
<circle cx="606" cy="556" r="124" fill="#f49466"/>
<circle cx="606" cy="556" r="92" fill="#fbbf86"/>
<circle cx="606" cy="556" r="62" fill="${C.sun}"/>
</g>`;
  const mesaFar = `<path d="M0,560V530H44L56,516H132L142,530H330L346,538H470L482,528H528L538,540H664L676,522H700L712,500H780L792,516H842L856,488H948L960,512H1112L1126,496H1218L1230,520H1280V560Z" fill="#8f3f66"/>`;
  const mesaNear = `<path d="M0,560V544H96L110,536H214L226,546H520L540,540H700L716,530H800L812,542H1280V560Z" fill="#5a2c60"/>`;

  // ---- motel ----
  const X0 = 672;
  const top = 462;
  const base = 560;
  const U = 112;
  const LIT = 1;
  let zig = '';
  for (let i = 0, x = 650; x <= 1310; i++, x += 28) zig += `${i ? 'L' : 'M'}${x},${i % 2 ? 430 : 450}`;
  let boards = '';
  for (let x = X0 + 14; x < 1280; x += 14) boards += `M${x},${top}V${base}`;
  const lx = 684 + U * LIT + 34;
  const ly = 474;
  let units = '';
  for (let i = 0; i < 6; i++) {
    const ux = 684 + U * i;
    const lit = i === LIT;
    const dx = ux + 14;
    units += `
<rect x="${dx - 4}" y="480" width="48" height="80" fill="${lit ? C.cream : '#3d2f6e'}"/>
<rect x="${dx}" y="484" width="40" height="76" fill="${lit ? C.tomato : '#17606a'}"/>
<rect x="${dx + 6}" y="492" width="8" height="8" fill="${lit ? C.hot : '#23808a'}"/><rect x="${dx + 16}" y="500" width="8" height="8" fill="${lit ? C.hot : '#23808a'}"/><rect x="${dx + 26}" y="508" width="8" height="8" fill="${lit ? C.hot : '#23808a'}"/>
<circle cx="${dx + 33}" cy="526" r="2.6" fill="${lit ? C.cream : '#4a3a7c'}"/>
<rect x="${ux + 66}" y="490" width="38" height="34" fill="${lit ? '#e9a15f' : '#4a3a7c'}"/>
<rect x="${ux + 69}" y="493" width="32" height="28" fill="${lit ? '#f3b467' : C.wallDk}"/>
<path d="M${ux + 69},493h11l-11,22zM${ux + 101},493h-11l11,22z" fill="${lit ? '#d9764f' : '#33285f'}"/>
<path d="M${ux + 34},470v-6" stroke="${lit ? C.creamDk : '#4a3a7c'}" stroke-width="2"/>`;
    units += lit
      ? `<circle cx="${lx}" cy="${ly}" r="9" fill="${C.amber}"/><circle cx="${lx}" cy="${ly}" r="6" fill="${C.hot}"/>`
      : `<circle cx="${ux + 34}" cy="${ly}" r="6" fill="${C.lilac}"/>`;
  }
  const motel = `
<clipPath id="wall"><rect x="${X0}" y="${top}" width="${1280 - X0}" height="${base - top}"/></clipPath>
<rect x="${X0}" y="${top}" width="${1280 - X0}" height="${base - top}" fill="${C.wall}"/>
<g clip-path="url(#wall)">
<ellipse cx="${lx}" cy="${ly + 22}" rx="132" ry="112" fill="#3a2a66"/>
<ellipse cx="${lx}" cy="${ly + 20}" rx="98" ry="88" fill="#59356d"/>
<ellipse cx="${lx}" cy="${ly + 16}" rx="68" ry="64" fill="#86456b"/>
<ellipse cx="${lx}" cy="${ly + 10}" rx="42" ry="42" fill="#bd5f5e"/>
<ellipse cx="${lx}" cy="${ly + 4}" rx="22" ry="22" fill="#eb9a58"/>
<path d="${boards}" stroke="${C.wallDk}" stroke-width="1.2" opacity="0.5"/>
</g>
${units}
<rect x="${X0 - 12}" y="${base}" width="${1292 - X0}" height="9" fill="#3b2f66"/>
<path d="M${lx - 38},${base}H${lx + 30}L${lx + 96},640H${lx - 132}Z" fill="#33265a"/>
<path d="M${lx - 30},${base}H${lx + 22}L${lx + 50},640H${lx - 86}Z" fill="#553364"/>
<rect x="${lx - 30}" y="${base}" width="52" height="9" fill="#c9705a"/>
<path d="M${lx + 50},560v-15q0,-9 9,-9h10q6,0 6,-6v-10" fill="none" stroke="#e9a15f" stroke-width="3.4" stroke-linecap="round"/>
<path d="M${lx + 52},560l6,-14M${lx + 74},560l-6,-14" stroke="#e9a15f" stroke-width="2.4" stroke-linecap="round"/>
<path d="${zig}V466H650Z" fill="${C.wallDk}"/>
<path d="${zig}" fill="none" stroke="${C.cream}" stroke-width="6" stroke-linejoin="miter"/>
<path d="M650,466H1280" stroke="#3d2f6e" stroke-width="4"/>`;

  // ---- sign ----
  const arch = 'M170,566Q335,-450 500,566';
  const kidney = 'M122,318C118,270 150,252 204,254C300,258 392,262 492,248C536,242 556,268 552,318C548,372 540,410 500,424C440,440 380,428 316,432C260,436 214,444 172,434C134,424 126,372 122,318Z';
  const xs = [151, 243, 335, 427, 519];
  const discs = xs
    .map((x, i) => disc(x, i % 2 ? 180 : 196, 40, WORD[i], i % 2 ? C.turq : C.tomato, i % 2 ? 6 : -6, 46))
    .join('');
  // chaser bulbs up one leg of the arch and down the other
  const P0 = [170, 566];
  const P1 = [335, -450];
  const P2 = [500, 566];
  const curve = Array.from({ length: 401 }, (_, i) => {
    const t = i / 400;
    const u = 1 - t;
    return [u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]];
  });
  const archBulbs = [];
  let carry = 12;
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let d = carry;
    while (d <= len) {
      const t = d / len;
      archBulbs.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      d += 27;
    }
    carry = d - len;
  }
  const sign = `
<rect x="151" y="555" width="34" height="12" rx="2" fill="#3b2f66"/><rect x="485" y="555" width="34" height="12" rx="2" fill="#3b2f66"/>
<circle cx="335" cy="56" r="96" fill="#2c245a"/>
<circle cx="335" cy="56" r="62" fill="#372c68"/>
<path d="${arch}" fill="none" stroke="${C.turqDk}" stroke-width="25"/>
<path d="${arch}" fill="none" stroke="${C.turq}" stroke-width="15"/>
${bulbs(archBulbs.filter(([, y]) => y < 556 && y > 84), 3.2, C.turqDk)}
<path d="M335,56V80" stroke="${C.turqDk}" stroke-width="5"/>
${starburst(335, 54, 0.86)}
<path d="M96,188L128,178H542L574,188L542,198H128Z" fill="${C.creamDk}"/>
${discs}
<path d="${kidney}" fill="${C.turqDk}" transform="translate(7 8)"/>
<path d="${kidney}" fill="${C.cream}" stroke="${C.turq}" stroke-width="11"/>
<path d="${kidney}" fill="none" stroke="${C.tomato}" stroke-width="2.6" vector-effect="non-scaling-stroke" transform="translate(337 342) scale(0.9 0.82) translate(-337 -342)"/>
<g transform="rotate(-4 335 345)">
<text x="210" y="386" font-family="SignPainter" font-size="168" fill="${C.indigo}" transform="translate(6 6)">light</text>
<text x="210" y="386" font-family="SignPainter" font-size="168" fill="${C.tomato}">light</text>
</g>
${twinkle(494, 296, 13, C.amber)}${twinkle(470, 278, 6, C.turq)}
<rect x="179" y="468" width="312" height="62" rx="9" fill="${C.tomatoDk}" transform="translate(5 6)"/>
<rect x="179" y="468" width="312" height="62" rx="9" fill="${C.tomato}"/>
<rect x="187" y="476" width="296" height="46" rx="4" fill="${C.ink}"/>
<text x="338.500" y="508.500" text-anchor="middle" font-family="Futura" font-weight="700" font-size="26" letter-spacing="4.6" fill="${C.amber}">ON ALL NIGHT.</text>`;

  const tuft = (x, sc = 1) =>
    `<path d="M${x},562l${-9 * sc},${-13 * sc}l${6 * sc},${10 * sc}l${-2 * sc},${-17 * sc}l${5 * sc},${15 * sc}l${3 * sc},${-19 * sc}l${2 * sc},${19 * sc}l${6 * sc},${-13 * sc}l${-3 * sc},${18 * sc}Z" fill="${C.ink}"/>`;
  return `
${sky}
${dots}
${stars}
${moon}
${sun}
${mesaFar}
${mesaNear}
${motel}
<rect y="${base + 9}" width="1280" height="${640 - base - 9}" fill="${C.ink}"/>
<rect y="${base}" width="${X0 - 12}" height="9" fill="${C.ink}"/>
<path d="M-20,612H1280" stroke="#2c245a" stroke-width="5" stroke-dasharray="54 46"/>
${saguaro(606, 560, 118, 13)}
${saguaro(62, 560, 74, 10)}
${tuft(112, 1)}${tuft(548, 0.8)}${tuft(650, 1.1)}${tuft(22, 0.7)}
${sign}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 21 Motel marquee

A tall roadside motel sign at dusk: a Googie parabola arch carries five bouncing letter discs, a kidney panel with the second half of the name in script and, where the vacancy sign would hang, a box that reads "on all night". Behind it a low motel under a folded-plate roof, every porch globe dark except one. The mark is the arch as a porch: a door under it and the globe lit.
Palette: dusk bands indigo #231c4d / violet #3b2a66 / plum #6c3570 / rose #b3486b / coral #e8694f / peach #f6a468, cream #f8ecd2, turquoise #2fb8ae, tomato #d9382c, amber #f8b83a, ink #14112b.
Type: Futura Bold capitals on the discs and the box, SignPainter HouseScript for "light".
Tagline: On all night.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg,
  'logo.svg': logoSvg,
  'logo-dark.svg': logoDarkSvg,
  'favicon.svg': favSvg,
  'favicon-32.svg': fav32Svg,
  'icon.svg': iconSvg,
  'hero.svg': heroSvg,
  'notes.md': notes,
});
