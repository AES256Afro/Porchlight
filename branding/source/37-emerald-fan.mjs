// 37 Emerald fan: a Gatsby-era emblem. A fan of gold rays opens from a lamp
// above an arched door, and the lit opening in the door is a keyhole.
// Emerald, gold and cream; the name is split five letters either side of the door.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '37-emerald-fan';
const C = {
  deep: '#06261d', // door, darkest ground
  ground: '#0a3a2c', // banner ground
  fan: '#0f5a43', // fan blade
  fanLt: '#17755a', // alternate blade
  gold: '#d6b160',
  goldLt: '#f2da94',
  goldDk: '#987733',
  cream: '#fbf0d2',
  amber: '#ffc861',
};
const FONTS = { Deco: 'Phosphate-Inline', DecoSolid: 'Phosphate-Solid', DidotI: 'Didot-Italic' };
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;
const P = (cx, cy, r, deg) => [f(cx + r * Math.cos(rad(deg))), f(cy + r * Math.sin(rad(deg)))];

// ---- the emblem ---------------------------------------------------------------
// Fan: pivot (cx, cy), radius R, N blades opening from A0 to A1 (screen degrees,
// -90 is straight up). Door: an arch that starts just under the lamp and stands
// on a step at yb. Everything scales from R; `k` scales stroke weights.
const A0 = -190;
const A1 = 10;
function emblem({ cx, cy, R, yb, k = 1, N = 13, pal = C, dots = true, fine = true, doorW = 0.6 }) {
  const step = (A1 - A0) / N;
  const chord = 2 * R * Math.sin(rad(step / 2));
  const rs = f(chord * 0.58);
  const w = (n) => f(n * k);
  let out = '';

  // blades, alternating two greens, each with a scalloped tip
  for (let i = 0; i < N; i++) {
    const b0 = A0 + i * step;
    const b1 = b0 + step;
    const [x0, y0] = P(cx, cy, R, b0);
    const [x1, y1] = P(cx, cy, R, b1);
    out += `<path d="M${cx},${cy}L${x0},${y0}A${rs},${rs} 0 0 1 ${x1},${y1}Z" fill="${i % 2 ? pal.fan : pal.fanLt}"/>`;
  }
  // blade seams
  if (fine) {
    let seams = '';
    for (let i = 1; i < N; i++) {
      const [x0, y0] = P(cx, cy, R * 0.42, A0 + i * step);
      const [x1, y1] = P(cx, cy, R * 0.995, A0 + i * step);
      seams += `M${x0},${y0}L${x1},${y1}`;
    }
    out += `<path d="${seams}" stroke="${pal.goldDk}" stroke-width="${w(1)}" fill="none"/>`;
  }
  // gold rays: a long kite on every other blade, a short one with a bead between
  for (let i = 0; i < N; i++) {
    const c = A0 + (i + 0.5) * step;
    const long = i % 2 === 0;
    const r0 = R * 0.3;
    const r1 = R * (long ? 0.74 : 0.6);
    const r2 = R * (long ? 1.0 : 0.76);
    const d = long ? 2.9 : 2.2;
    const a = P(cx, cy, r0, c);
    const b = P(cx, cy, r1, c - d);
    const t = P(cx, cy, r2, c);
    const e = P(cx, cy, r1, c + d);
    out += `<path d="M${a}L${b}L${t}L${e}Z" fill="${long ? pal.gold : pal.goldLt}"/>`;
    if (!long && dots) {
      const [bx, by] = P(cx, cy, R * 0.88, c);
      out += `<circle cx="${bx}" cy="${by}" r="${f(R * 0.028)}" fill="${pal.goldLt}"/>`;
    }
  }
  // scalloped rim
  let rim = `M${P(cx, cy, R, A0)}`;
  for (let i = 0; i < N; i++) rim += `A${rs},${rs} 0 0 1 ${P(cx, cy, R, A0 + (i + 1) * step)}`;
  out += `<path d="M${cx},${cy}L${rim.slice(1)}Z" fill="none" stroke="${pal.gold}" stroke-width="${w(3)}" stroke-linejoin="round"/>`;
  // hub: two gold arcs and the lamp
  const arc = (r) => `M${P(cx, cy, r, A0)}A${f(r)},${f(r)} 0 1 1 ${P(cx, cy, r, A1)}`;
  out += `<path d="${arc(R * 0.3)}L${cx},${cy}Z" fill="${pal.deep}"/>`;
  out += `<path d="${arc(R * 0.3)}" fill="none" stroke="${pal.gold}" stroke-width="${w(2.4)}"/>`;
  if (fine) out += `<path d="${arc(R * 0.37)}" fill="none" stroke="${pal.goldLt}" stroke-width="${w(1)}"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="${f(R * 0.15)}" fill="${pal.gold}"/>
<circle cx="${cx}" cy="${cy}" r="${f(R * 0.095)}" fill="${pal.amber}"/>
<circle cx="${cx}" cy="${cy}" r="${f(R * 0.05)}" fill="${pal.cream}"/>`;

  // the door, joined to the lamp by a small keystone
  const dw = R * doorW;
  out += `<path d="M${f(cx - R * 0.045)},${f(cy + R * 0.1)}H${f(cx + R * 0.045)}L${f(cx + R * 0.085)},${f(cy + R * 0.22)}H${f(cx - R * 0.085)}Z" fill="${pal.gold}"/>`;
  const x0 = f(cx - dw / 2);
  const x1 = f(cx + dw / 2);
  const top = cy + R * 0.2; // crown of the arch
  const ya = f(top + dw / 2);
  const rr = f(dw / 2);
  const stepH = f(R * 0.07);
  const yd = f(yb - stepH);
  const door = `M${x0},${yd}V${ya}A${rr},${rr} 0 0 1 ${x1},${ya}V${yd}Z`;
  out += `<path d="${door}" fill="${pal.deep}" stroke="${pal.gold}" stroke-width="${w(3)}" stroke-linejoin="miter"/>`;
  if (fine) {
    const i = dw * 0.11;
    out += `<path d="M${f(x0 + i)},${yd}V${ya}A${f(rr - i)},${f(rr - i)} 0 0 1 ${f(x1 - i)},${ya}V${yd}" fill="none" stroke="${pal.goldDk}" stroke-width="${w(1)}"/>`;
  }
  // the keyhole: a lit opening
  const hr = dw * 0.2;
  const hy = ya - dw * 0.02;
  const ky = yd - dw * 0.12;
  const n1 = dw * 0.09;
  const n2 = dw * 0.27;
  out += `<path d="M${f(cx - n1)},${f(hy)}L${f(cx - n2)},${f(ky)}H${f(cx + n2)}L${f(cx + n1)},${f(hy)}Z" fill="${pal.cream}"/>
<circle cx="${cx}" cy="${f(hy)}" r="${f(hr)}" fill="${pal.cream}"/>
<circle cx="${cx}" cy="${f(hy)}" r="${f(hr * 0.5)}" fill="${pal.amber}"/>`;
  // the step
  out += `<rect x="${f(x0 - dw * 0.2)}" y="${yd}" width="${f(dw * 1.4)}" height="${stepH}" fill="${pal.gold}"/>`;
  return out;
}

// ---- mark -----------------------------------------------------------------------
const markBody = (pal = C) => emblem({ cx: 100, cy: 98, R: 86, yb: 194, k: 0.8, pal, doorW: 0.56 });
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });
const DARK = { ...C, fan: '#136b50', fanLt: '#1d8667', deep: '#07291f' };
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody(DARK) });

// ---- favicons, on the pixel grid ----------------------------------------------
const PIX = { E: '#0f5a43', F: '#17755a', D: C.deep, G: C.gold, L: C.goldLt, C: C.cream, A: C.amber };
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
  '.EEEEEEEEEEEEEE.',
  'EEEEEEGGGGEEEEEE',
  'EEELLLGGGGLLLEEE',
  'EELLLLGGGGLLLLEE',
  'EELLLLLGGLLLLLEE',
  'EGGLLLLGGLLLLGGE',
  'EGGGGLLDDLLGGGGE',
  'EGGGGGDAADGGGGGE',
  'EEEEEDDDDDDEEEEE',
  'EEEEDDDCCDDDEEEE',
  'EEEEDDCCCCDDEEEE',
  'EEEEDDCCCCDDEEEE',
  'EEEEDDDCCDDDEEEE',
  'EEEEDDDCCDDDEEEE',
  'EEEEDDCCCCDDEEEE',
  '.EEGGGGGGGGGGEE.',
];
function fav32Rows() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('E'));
  const set = (x, y, ch) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y][x] = ch;
  };
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [31, 0], [30, 0], [31, 1], [0, 31], [1, 31], [0, 30], [31, 31], [30, 31], [31, 30]]) set(x, y, '.');
  // the fan: nine gold blades, alternating two golds, green seams, scalloped tips
  const px = 16;
  const py = 15.5;
  const R = 13.6;
  const N = 9;
  const a0 = -188;
  const st = 196 / N;
  for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) {
    const dx = x + 0.5 - px;
    const dy = y + 0.5 - py;
    const r = Math.hypot(dx, dy);
    let a = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (a > 90) a -= 360;
    const t = (a - a0) / st;
    if (t < 0 || t >= N) continue;
    const frac = t - Math.floor(t);
    const edge = Math.min(frac, 1 - frac) * rad(st) * r; // distance to the nearest seam, in pixels
    const lim = R + 1.2 * Math.sin(Math.PI * frac) - 1.2;
    if (r > lim) continue;
    if (r < 4.6) continue;
    if (edge < 0.5 && r > 5.5) continue;
    set(x, y, Math.floor(t) % 2 ? 'L' : 'G');
  }
  // hub and lamp
  for (let y = 9; y < 19; y++) for (let x = 10; x < 22; x++) {
    const r = Math.hypot(x + 0.5 - px, y + 0.5 - py);
    if (r < 4.6 && y < 16) set(x, y, 'D');
    if (r < 2.9) set(x, y, r < 1.5 ? 'C' : 'A');
  }
  // door, arched
  for (let y = 18; y <= 29; y++) for (let x = 10; x <= 21; x++) {
    if (y >= 23 || Math.hypot(x + 0.5 - 16, y + 0.5 - 23.5) < 6.1) set(x, y, 'D');
  }
  // keyhole
  for (let y = 20; y <= 25; y++) for (let x = 12; x <= 19; x++) if (Math.hypot(x + 0.5 - 16, y + 0.5 - 22.5) < 2.4) set(x, y, 'C');
  for (let y = 24; y <= 28; y++) {
    const hw = y < 26 ? 1 : y < 28 ? 2 : 3;
    for (let x = 16 - hw; x <= 15 + hw; x++) set(x, y, 'C');
  }
  // step
  for (let x = 7; x <= 24; x++) set(x, 30, 'G');
  for (let x = 9; x <= 22; x++) set(x, 29, x < 10 || x > 21 ? 'G' : g[29][x]);
  return g.map((r) => r.join(''));
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16) });
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 32 32', crisp: true, body: pixRects(fav32Rows()) });

// ---- frame with stepped corners -------------------------------------------------
function steppedFrame(x, y, w, h, s, n = 2) {
  // a rectangle whose corners step inward n times by s
  const pts = [];
  const X0 = x;
  const X1 = x + w;
  const Y0 = y;
  const Y1 = y + h;
  const q = n * s;
  // top-left corner, going clockwise
  for (let i = n; i >= 1; i--) pts.push([X0 + (n - i) * s, Y0 + i * s], [X0 + (n - i + 1) * s, Y0 + i * s]);
  pts.push([X0 + q, Y0]);
  for (let i = 1; i <= n; i++) pts.push([X1 - q + (i - 1) * s, Y0 + (i - 1) * s], [X1 - q + (i - 1) * s, Y0 + i * s]);
  pts.push([X1, Y0 + q]);
  for (let i = 1; i <= n; i++) pts.push([X1 - (i - 1) * s, Y1 - q + (i - 1) * s], [X1 - i * s, Y1 - q + (i - 1) * s]);
  pts.push([X1 - q, Y1]);
  for (let i = 1; i <= n; i++) pts.push([X0 + q - (i - 1) * s, Y1 - (i - 1) * s], [X0 + q - (i - 1) * s, Y1 - i * s]);
  pts.push([X0, Y1 - q]);
  return `M${pts.map(([a, b]) => `${f(a)},${f(b)}`).join('L')}Z`;
}
// a quarter fan for a corner, opening clockwise from a0 through 90 degrees
function cornerFan(cx, cy, r, a0, color) {
  let rays = '';
  let dots = '';
  for (let i = 0; i <= 6; i++) {
    const a = a0 + i * 15;
    const long = i % 2 === 0;
    rays += `M${P(cx, cy, r * 0.34, a)}L${P(cx, cy, r * (long ? 1 : 0.7), a)}`;
    if (!long) dots += `<circle cx="${P(cx, cy, r * 0.84, a)[0]}" cy="${P(cx, cy, r * 0.84, a)[1]}" r="2.2" fill="${color}"/>`;
  }
  const arc = (q) => `M${P(cx, cy, r * q, a0)}A${f(r * q)},${f(r * q)} 0 0 1 ${P(cx, cy, r * q, a0 + 90)}`;
  return `<path d="${rays}" stroke="${color}" stroke-width="2" stroke-linecap="round" fill="none"/>${dots}
<path d="${arc(0.34)}" stroke="${color}" stroke-width="2" fill="none"/><path d="${arc(0.2)}" stroke="${color}" stroke-width="1.2" fill="none"/>`;
}

// ---- icon ---------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  body: `
<rect width="512" height="512" rx="112" fill="${C.ground}"/>
<rect x="26" y="26" width="460" height="460" rx="88" fill="none" stroke="${C.goldDk}" stroke-width="3"/>
${emblem({ cx: 256, cy: 244, R: 212, yb: 470, k: 1.9, fine: true, doorW: 0.56 })}`,
});

// ---- logo ---------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.goldLt : '#0a3a2c';
  const sub = dark ? C.cream : '#0f5a43';
  const rule = dark ? C.gold : C.goldDk;
  return svg({
    w: 640,
    h: 200,
    fonts: FONTS,
    body: `
${nest({ x: 10, y: 8, w: 184, h: 184, vb: '0 0 200 200', body: markBody(dark ? DARK : C) })}
<text x="214" y="112" font-family="Deco" font-size="72" fill="${ink}" textLength="404" lengthAdjust="spacingAndGlyphs">PORCHLIGHT</text>
<path d="M214,134H388M444,134H618" stroke="${rule}" stroke-width="1.6"/>
<path d="M416,126l8,8l-8,8l-8,-8Z" fill="${rule}"/>
<path d="M398,134h6M428,134h6" stroke="${rule}" stroke-width="1.6"/>
<text x="416" y="170" text-anchor="middle" font-family="DidotI" font-size="23" fill="${sub}">See who’s at the door.</text>`,
  });
}

// ---- hero ---------------------------------------------------------------------
function hero() {
  const cx = 640;
  const cy = 272;
  const R = 196;
  const yb = 538;
  // fine rays carried on from the fan to the frame
  let far = '';
  const N = 13;
  const step = (A1 - A0) / N;
  for (let i = 0; i < N; i++) {
    const c = A0 + (i + 0.5) * step;
    far += `M${P(cx, cy, R + 26, c)}L${P(cx, cy, 900, c)}`;
    if (i < N - 1) {
      const b = A0 + (i + 1) * step;
      far += `M${P(cx, cy, R + 58, b)}L${P(cx, cy, 900, b)}`;
    }
  }
  const inner = steppedFrame(38, 38, 1204, 564, 14, 2);
  // underline beneath each half of the name: three rules stepping shorter
  const under = (x0, x1, dir) => {
    const len = x1 - x0;
    let o = '';
    [0, 1, 2].forEach((i) => {
      const cut = i * 46;
      const a = dir > 0 ? x0 : x0 + cut;
      const b = dir > 0 ? x1 - cut : x1;
      o += `<path d="M${a},${478 + i * 9}H${b}" stroke="${i === 0 ? C.gold : C.goldDk}" stroke-width="${i === 0 ? 3 : 2}"/>`;
    });
    return o;
  };
  // Each half of the name is set letter by letter to the same width (412). PORCH is
  // five wide letters and LIGHT has the I, so PORCH is drawn 5% narrower and LIGHT 7%
  // wider, and the rest is made up in the spacing. Advances are Phosphate Inline's own
  // at 150, measured in Chrome.
  const word = (txt, x0, adv, total, sx, size = 138, width = 412) => {
    const sc = size / 150;
    const gap = (width - total * sc * sx) / (txt.length - 1);
    const xs = adv.map((a, i) => f(a * sc + (i * gap) / sx)).join(' ');
    return `<text transform="translate(${x0} 458) scale(${sx} 1)" x="${xs}" y="0" font-family="Deco" font-size="${size}" fill="${C.goldLt}">${txt}</text>`;
  };
  return `
<rect width="1280" height="640" fill="${C.ground}"/>
<clipPath id="in"><path d="${inner}"/></clipPath>
<g clip-path="url(#in)">
  <path d="${far}" stroke="${C.fan}" stroke-width="2" fill="none"/>
</g>
<path d="${steppedFrame(24, 24, 1232, 592, 14, 2)}" fill="none" stroke="${C.gold}" stroke-width="3"/>
<path d="${inner}" fill="none" stroke="${C.goldDk}" stroke-width="1.4"/>
${cornerFan(64, 64, 66, 0, C.goldDk)}
${cornerFan(1216, 64, 66, 90, C.goldDk)}
${cornerFan(1216, 576, 66, 180, C.goldDk)}
${cornerFan(64, 576, 66, 270, C.goldDk)}

${emblem({ cx, cy, R, yb, k: 1.5 })}
<rect x="${cx - 104}" y="${yb}" width="208" height="8" fill="${C.goldDk}"/>

${word('PORCH', 100, [0, 85.3, 196.3, 283.4, 375.1], 467.6, 0.95)}
${word('LIGHT', 768, [0, 66.1, 110.5, 215.1, 307.5], 377.4, 1.07)}
${under(100, 512, 1)}
${under(768, 1180, -1)}

<path d="M270,578H436M844,578H1010" stroke="${C.goldDk}" stroke-width="1.6"/>
<path d="M452,571l7,7l-7,7l-7,-7ZM828,571l7,7l-7,7l-7,-7Z" fill="${C.gold}"/>
<text x="640" y="590" text-anchor="middle" font-family="DidotI" font-size="38" fill="${C.cream}">See who’s at the door.</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, fonts: FONTS, body: hero() });

const notes = `# 37 Emerald fan

A Gatsby-era emblem: a fan of gold rays opens from a lamp set above an arched door, and the lit opening in that door is a keyhole. On the banner the name is split, five letters either side of the door, inside a gold frame with stepped corners and quarter fans; the fan's rays carry on faintly to the frame.
Palette: emerald #06261d / #0a3a2c / #0f5a43 / #17755a, gold #d6b160 / #f2da94 / #987733, cream #fbf0d2, amber #ffc861.
Type: Phosphate Inline capitals for the name, Didot Italic for the tagline.
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
