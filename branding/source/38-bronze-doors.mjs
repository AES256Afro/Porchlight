// 38 Bronze doors: a cast bronze tablet in low relief, like the door panels of a
// 1930s bank. A lantern hangs over a stepped entrance and its light falls as
// alternate raised rays. Relief is drawn with flat tones only: every raised form
// has a light edge up and to the left and a dark edge down and to the right.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '38-bronze-doors';
const C = {
  stone: '#0e1211', // the wall the tablet hangs on
  deep: '#22160a', // bronze in shadow, the door opening
  low: '#7a5524', // far bronze
  mid: '#a3742f', // raised bronze
  face: '#c4944a', // nearest bronze
  hl: '#f0d28c', // light edge
  pol: '#fff1c4', // metal polished by hands and by the light
  // verdigris: the sunk ground and the far relief have gone green
  vDeep: '#0e2320',
  vField: '#1b3b36',
  vRise: '#2a584f',
  vEdge: '#4f8b7d',
};
const FONTS = { Cast: 'Phosphate-Solid' };
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;

// raised: light edge up-left, dark edge down-right. sunk: the reverse.
const up = (d, face, o = 2.5, hl = C.hl, sh = C.deep) =>
  `<path d="${d}" fill="${hl}" transform="translate(${-o} ${-o})"/><path d="${d}" fill="${sh}" transform="translate(${o} ${o})"/><path d="${d}" fill="${face}"/>`;
const down = (d, face, o = 2.5, hl = C.hl, sh = C.deep) =>
  `<path d="${d}" fill="${sh}" transform="translate(${-o} ${-o})"/><path d="${d}" fill="${hl}" transform="translate(${o} ${o})"/><path d="${d}" fill="${face}"/>`;
// the same, for relief that has gone green
const upV = (d, o = 2) => up(d, C.vRise, o, C.vEdge, C.vDeep);
const box = (x0, y0, x1, y1) => `M${f(x0)},${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`;

// wedges of light from (ox, oy): every other one between a0 and a1
function rays(ox, oy, a0, a1, count, r) {
  // an odd count, so the first and the last wedge are both raised
  let d = '';
  const stepDeg = (a1 - a0) / count;
  for (let i = 0; i < count; i += 2) {
    const a = a0 + i * stepDeg;
    const p = (deg) => `${f(ox + r * Math.cos(rad(deg)))},${f(oy + r * Math.sin(rad(deg)))}`;
    d += `M${ox},${oy}L${p(a)}L${p(a + stepDeg)}Z`;
  }
  return d;
}

// the lantern, hanging: (cx, top) is where its rod meets the ceiling; s scales it
function lantern(cx, top, s, o = 1.6) {
  const X = (n) => f(cx + n * s);
  const Y = (n) => f(top + n * s);
  const rod = `M${X(-1.6)},${Y(0)}H${X(1.6)}V${Y(12)}H${X(-1.6)}Z`;
  const cap = `M${X(-7)},${Y(12)}H${X(7)}V${Y(17)}H${X(14)}V${Y(22)}H${X(20)}V${Y(28)}H${X(-20)}V${Y(22)}H${X(-14)}V${Y(17)}H${X(-7)}Z`;
  const glass = `M${X(-17)},${Y(28)}H${X(17)}L${X(11)},${Y(64)}H${X(-11)}Z`;
  const base = `M${X(-14)},${Y(64)}H${X(14)}V${Y(69)}H${X(8)}V${Y(74)}H${X(3)}L${X(0)},${Y(82)}L${X(-3)},${Y(74)}H${X(-8)}V${Y(69)}H${X(-14)}Z`;
  const bars = `M${X(-5.6)},${Y(28)}L${X(-3.7)},${Y(64)}M${X(5.6)},${Y(28)}L${X(3.7)},${Y(64)}`;
  return `${up(rod, C.mid, o)}${up(glass, C.pol, o)}<path d="${bars}" stroke="${C.mid}" stroke-width="${f(1.5 * s)}" fill="none"/>${up(cap, C.face, o)}${up(base, C.face, o)}`;
}

// a doorway with a stepped head, cut deep; (cx, yb) is the middle of its sill
function doorway(cx, yb, w, h, s, withLeaves = true) {
  const hw = w / 2;
  const st = s; // size of one step
  const d = `M${f(cx - hw)},${yb}V${f(yb - h + 2 * st)}H${f(cx - hw + st)}V${f(yb - h + st)}H${f(cx - hw + 2 * st)}V${f(yb - h)}H${f(cx + hw - 2 * st)}V${f(yb - h + st)}H${f(cx + hw - st)}V${f(yb - h + 2 * st)}H${f(cx + hw)}V${yb}Z`;
  let out = down(d, C.deep, Math.max(1.4, st * 0.22));
  if (withLeaves) {
    // two leaves with chevrons, and one escutcheon polished bright
    const lx0 = cx - hw + st * 0.9;
    const lx1 = cx + hw - st * 0.9;
    const top = yb - h + 2 * st + st * 0.9;
    out += `<path d="${box(lx0, top, lx1, yb)}" fill="#3a2812"/>`;
    let chev = '';
    const n = 4;
    const gap = (yb - top - st) / n;
    for (let i = 0; i < n; i++) {
      const y = top + st * 0.9 + i * gap;
      chev += `M${f(lx0)},${f(y + gap * 0.55)}L${cx},${f(y)}L${f(lx1)},${f(y + gap * 0.55)}`;
    }
    out += `<path d="${chev}" fill="none" stroke="${C.low}" stroke-width="${f(st * 0.42)}"/>`;
    out += `<path d="M${cx},${f(top)}V${yb}" stroke="${C.deep}" stroke-width="${f(st * 0.3)}"/>`;
    const hy = f(yb - (yb - top) * 0.42);
    const e = st * 0.62;
    out += `<path d="M${cx},${f(hy - e * 1.25)}L${f(cx + e)},${hy}L${cx},${f(+hy + e * 1.25)}L${f(cx - e)},${hy}Z" fill="${C.pol}"/>`;
  }
  return out;
}

// ---- the motif on a 200 grid: used for the mark and the icon -------------------
function motif() {
  const fieldClip = 'M36,26H164V36H174V164H164V174H36V164H26V36H36Z';
  const o = [100, 64];
  return `
<clipPath id="fld"><path d="${fieldClip}"/></clipPath>
${down(fieldClip, C.vField, 2.2)}
<g clip-path="url(#fld)">
  ${upV(rays(o[0], o[1], 4, 176, 13, 190), 1.5)}
  ${up('M0,200V160H44V142H64V200Z M200,200V160H156V142H136V200Z', C.mid, 1.6)}
  ${up('M64,200V120H136V200Z', C.face, 1.8)}
  ${doorway(100, 174, 44, 42, 7, true)}
</g>
<circle cx="${o[0] - 1.2}" cy="${o[1] - 1.2}" r="28" fill="${C.hl}"/><circle cx="${o[0] + 1.4}" cy="${o[1] + 1.4}" r="28" fill="${C.deep}"/><circle cx="${o[0]}" cy="${o[1]}" r="28" fill="${C.low}"/>
${lantern(100, 26, 0.86, 1.4)}`;
}
const PLAQUE = 'M24,12H176V24H188V176H176V188H24V176H12V24H24Z';
const markBody = () => `${up(PLAQUE, C.mid, 2.6)}${motif()}`;
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons on the pixel grid -------------------------------------------------
const PIX = { H: C.hl, S: C.deep, T: C.vField, t: C.vRise, B: C.mid, L: C.face, P: C.pol, D: '#160e06', W: C.low };
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
  '.HHHHHHHHHHHHHH.',
  'HTTTTTTLLTTTTTTS',
  'HTTTTTLLLLTTTTTS',
  'HTTTTTPPPPTTTTTS',
  'HTTTTTPPPPTTTTTS',
  'HTTTtTPPPPTtTTTS',
  'HTTtTTTPPTTTtTTS',
  'HTtTTHHHHHHTTtTS',
  'HtTTTLLLLLLTTTtS',
  'HTTTTLLDDLLTTTTS',
  'HHHHHLDDDDLHHHHS',
  'HBBBBLDDDDLBBBBS',
  'HBBBBLDPPDLBBBBS',
  'HBBBBLDDDDLBBBBS',
  'HBBBBLDDDDLBBBBS',
  '.SSSSSSSSSSSSSS.',
];
function fav32Rows() {
  const n = 32;
  const g = Array.from({ length: n }, () => Array(n).fill('T'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < n && y >= 0 && y < n) g[y][x] = ch;
  };
  const r = (x0, y0, x1, y1, ch) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch);
  };
  // rays from the lantern
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = (Math.atan2(y + 0.5 - 8.5, x + 0.5 - 16) * 180) / Math.PI;
    if (a < 6 || a > 174) continue;
    if (Math.floor((a - 6) / (168 / 11)) % 2 === 0) set(x, y, 't');
  }
  // stepped entrance
  r(2, 25, 29, 30, 'B');
  r(2, 25, 29, 25, 'H');
  r(6, 21, 25, 30, 'B');
  r(6, 21, 25, 21, 'H');
  r(10, 16, 21, 30, 'L');
  r(10, 16, 21, 16, 'H');
  r(12, 22, 19, 30, 'D');
  r(13, 21, 18, 21, 'D');
  r(14, 20, 17, 20, 'D');
  r(15, 25, 16, 27, 'P');
  // lantern
  r(15, 1, 16, 2, 'L');
  r(14, 3, 17, 3, 'L');
  r(12, 4, 19, 5, 'L');
  r(12, 6, 19, 9, 'P');
  r(13, 10, 18, 12, 'P');
  r(13, 13, 18, 13, 'L');
  r(15, 14, 16, 14, 'L');
  // bevelled edge of the tablet
  for (let i = 0; i < n; i++) {
    set(i, 0, 'H');
    set(0, i, 'H');
    set(i, n - 1, 'S');
    set(n - 1, i, 'S');
  }
  for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) set(x, y, '.');
  return g.map((row) => row.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- icon: the tablet itself, full bleed -----------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  body: `
<clipPath id="ico"><rect width="512" height="512" rx="112"/></clipPath>
<g clip-path="url(#ico)">
  <rect width="512" height="512" fill="${C.hl}"/>
  <rect x="9" y="9" width="512" height="512" rx="112" fill="${C.deep}"/>
  <rect x="7" y="7" width="498" height="498" rx="106" fill="${C.mid}"/>
</g>
${nest({ x: 24, y: 24, w: 464, h: 464, vb: '14 14 172 172', body: motif() })}`,
});

// ---- logo -----------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.hl : '#4a2e12';
  const edge = dark ? '#7a5524' : '#c9a15a';
  const sub = dark ? '#d9b874' : '#6e4a20';
  return svg({
    w: 640,
    h: 200,
    fonts: FONTS,
    body: `
${nest({ x: 12, y: 10, w: 180, h: 180, vb: '0 0 200 200', body: markBody() })}
<text x="216" y="111" font-family="Cast" font-size="70" fill="${edge}" letter-spacing="1.5" transform="translate(2.2 2.2)">PORCHLIGHT</text>
<text x="216" y="111" font-family="Cast" font-size="70" fill="${ink}" letter-spacing="1.5">PORCHLIGHT</text>
<path d="M217,130H623" stroke="${ink}" stroke-width="3"/>
<path d="M217,137H623" stroke="${edge}" stroke-width="1.4"/>
<text x="420" y="166" text-anchor="middle" font-family="Copperplate" font-weight="700" font-size="19.5" letter-spacing="1.2" fill="${sub}">Keep watch over what’s yours.</text>`,
  });
}

// ---- hero -----------------------------------------------------------------------
function hero() {
  const X0 = 82;
  const X1 = 1198;
  const Y0 = 74;
  const Y1 = 566;
  const BT = 200; // relief band
  const BB = 492;
  const O = [640, 258];
  // the frame of the tablet: bevel out, flat band, bevel in
  const frame = `
<rect x="46" y="40" width="1200" height="576" fill="#050707"/>
<rect x="40" y="32" width="1200" height="576" fill="${C.mid}"/>
<path d="M40,32H1240L1230,42H50Z" fill="${C.hl}"/>
<path d="M40,32L50,42V598L40,608Z" fill="${C.face}"/>
<path d="M40,608L50,598H1230L1240,608Z" fill="${C.deep}"/>
<path d="M1240,32L1230,42V598L1240,608Z" fill="#4a3113"/>
<path d="M74,66H1206L1198,74H82Z" fill="${C.deep}"/>
<path d="M74,66L82,74V566L74,574Z" fill="#33210e"/>
<path d="M74,574L82,566H1198L1206,574Z" fill="${C.hl}"/>
<path d="M1206,66L1198,74V566L1206,574Z" fill="${C.face}"/>
<rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}" fill="${C.vField}"/>`;
  const bolt = (x, y) =>
    `<circle cx="${x - 1.2}" cy="${y - 1.2}" r="6.5" fill="${C.hl}"/><circle cx="${x + 1.4}" cy="${y + 1.4}" r="6.5" fill="${C.deep}"/><circle cx="${x}" cy="${y}" r="6.2" fill="${C.face}"/><path d="M${x - 3.5},${y}h7" stroke="${C.deep}" stroke-width="1.6"/>`;
  const bolts = [[62, 54], [1218, 54], [62, 586], [1218, 586], [640, 54], [640, 586]].map(([x, y]) => bolt(x, y)).join('');

  // the name, cast proud of the frieze
  const NAME = { y: 173, size: 116, ls: 24 };
  const nameAt = (dx, dy, fill) =>
    `<text x="${640 + NAME.ls / 2 + dx}" y="${NAME.y + dy}" text-anchor="middle" font-family="Cast" font-size="${NAME.size}" letter-spacing="${NAME.ls}" fill="${fill}">PORCHLIGHT</text>`;
  const chev = (x, dir) => {
    let d = '';
    for (let i = 0; i < 3; i++) {
      const cx = x + dir * i * 16;
      d += `M${cx},${100}L${cx + dir * 17},${132}L${cx},${164}H${cx - dir * 9}L${cx + dir * 8},${132}L${cx - dir * 9},${100}Z`;
    }
    return up(d, C.mid, 1.8);
  };
  const frieze = `
${chev(116, 1)}${chev(1164, -1)}
${nameAt(-2.6, -2.6, C.hl)}${nameAt(3.4, 3.4, C.vDeep)}${nameAt(0, 0, C.face)}
${up(box(X0, 190, X1, 200), C.face, 1.6)}`;

  // the relief band
  const tier = (x0, x1, top, face) => up(`M${x0},${BB}V${top}H${x1}V${BB}Z`, face, 2.4);
  const flutes = (xa, xb, top) => {
    let o = '';
    const n = Math.round((xb - xa) / 19) - 1;
    const gap = (xb - xa) / (n + 1);
    for (let i = 1; i <= n; i++) {
      const x = f(xa + i * gap);
      o += `<path d="M${x},${top + 12}V${BB - 4}" stroke="${C.deep}" stroke-width="3.4"/><path d="M${x + 2.6},${top + 12}V${BB - 4}" stroke="${C.hl}" stroke-width="1.3" opacity="0.8"/>`;
    }
    return o;
  };
  const star = (x, y, s) => {
    const d = `M${x},${y - s}L${x + s * 0.2},${y - s * 0.2}L${x + s},${y}L${x + s * 0.2},${y + s * 0.2}L${x},${y + s}L${x - s * 0.2},${y + s * 0.2}L${x - s},${y}L${x - s * 0.2},${y - s * 0.2}Z`;
    return up(d, C.pol, 1.2, C.pol, C.vDeep);
  };
  const stars = [[150, 300, 16], [232, 372, 9], [112, 420, 8], [318, 316, 7], [196, 452, 6], [404, 250, 6]]
    .map(([x, y, s]) => star(x, y, s) + star(1280 - x, y, s))
    .join('');
  // a row of small diamonds over the door
  let studs = '';
  for (let i = -2; i <= 2; i++) studs += `M${640 + i * 26},${346}l7,7l-7,7l-7,-7Z`;
  const band = `
<clipPath id="band"><rect x="${X0}" y="${BT}" width="${X1 - X0}" height="${BB - BT}"/></clipPath>
<g clip-path="url(#band)">
  ${upV(rays(O[0], O[1], 0, 180, 31, 900), 2)}
  ${stars}
  ${tier(246, 1034, 458, C.low)}${flutes(246, 328, 458)}${flutes(952, 1034, 458)}
  ${tier(328, 952, 426, '#8c6429')}${flutes(328, 410, 426)}${flutes(870, 952, 426)}
  ${tier(410, 870, 388, C.mid)}${flutes(410, 520, 388)}${flutes(760, 870, 388)}
  ${tier(520, 760, 332, C.face)}
  ${up(studs, C.pol, 1.2, C.pol, C.deep)}
  ${doorway(640, BB, 132, 122, 12, true)}
</g>
<circle cx="${O[0] - 2}" cy="${O[1] - 2}" r="57" fill="${C.hl}"/><circle cx="${O[0] + 2.4}" cy="${O[1] + 2.4}" r="57" fill="${C.deep}"/><circle cx="${O[0]}" cy="${O[1]}" r="57" fill="${C.low}"/>
<circle cx="${O[0]}" cy="${O[1]}" r="48" fill="none" stroke="${C.deep}" stroke-width="2.2"/><circle cx="${O[0] + 1.5}" cy="${O[1] + 1.5}" r="48" fill="none" stroke="${C.hl}" stroke-width="1" opacity="0.7"/>
${lantern(640, 200, 1.24, 2)}
${up(box(X0, BB, X1, BB + 10), C.face, 1.6)}`;

  // the motto, cast like the name but small
  const motto = (dx, dy, fill) =>
    `<text x="${641.5 + dx}" y="${547 + dy}" text-anchor="middle" font-family="Copperplate" font-weight="700" font-size="33" letter-spacing="3" fill="${fill}">Keep watch over what’s yours.</text>`;
  const dia = (x) => up(`M${x},${526}l9,9l-9,9l-9,-9Z`, C.face, 1.3);
  return `
<rect width="1280" height="640" fill="${C.stone}"/>
${frame}
${bolts}
${frieze}
${band}
${motto(2, 2, C.vDeep)}${motto(0, 0, C.hl)}
${dia(262)}${dia(1018)}
<path d="M110,535H238M286,535H312M968,535H994M1042,535H1170" stroke="${C.vDeep}" stroke-width="3"/>
<path d="M110,537.6H238M286,537.6H312M968,537.6H994M1042,537.6H1170" stroke="${C.vEdge}" stroke-width="1.2"/>`;
}
const heroSvg = svg({ w: 1280, h: 640, fonts: FONTS, body: hero() });

const notes = `# 38 Bronze doors

A cast bronze tablet in low relief, like a panel from the doors of a 1930s bank: a lantern hangs over a stepped entrance and its light falls as alternate raised rays across the field. The sunk ground and the far relief have gone green with verdigris; the entrance, the frame and the letters are bare bronze, and only the lantern glass, the door's escutcheon and the stars are polished bright. There is no blur or gradient: every raised form has a light edge above and to the left and a dark one below and to the right. The mark is the middle of the tablet.
Palette: bronze #7a5524 / #a3742f / #c4944a, light edge #f0d28c, shadow #22160a, polished #fff1c4, verdigris #1b3b36 / #2a584f / #4f8b7d, wall #0e1211.
Type: Phosphate Solid capitals for the name, Copperplate Bold for the tagline.
Tagline: Keep watch over what's yours.
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
