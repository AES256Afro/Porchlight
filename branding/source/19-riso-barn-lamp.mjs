// 19 Riso barn lamp: a two-colour risograph print. A gooseneck barn lamp
// with an enamel shade hangs over a board-and-batten front door; its cone of
// light falls across the door, the mat and the steps. Two inks only, Federal
// Blue and Orange, overprinting (multiply) into a dark brown third colour.
// Halftone screens at different angles, a little misregistration, paper grain.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '19-riso-barn-lamp';
const PAPER = '#f2ead6';
const BLUE = '#3d5588'; // riso Federal Blue
const ORANGE = '#ff6c2f'; // riso Orange
const BROWN = '#3a2115'; // blue x orange x paper, for flat small sizes

const f = (n) => +n.toFixed(2);

// ---- halftone -------------------------------------------------------------
// Dots on a global screen (origin 0,0) at `angle`, `pitch` apart; radius from
// the tone (0..1) at each dot centre, so coverage follows the tone.
function halftone({ angle, pitch, tone, box: [x0, y0, x1, y1] }) {
  const a = (angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const us = corners.map(([x, y]) => (x * ca + y * sa) / pitch);
  const vs = corners.map(([x, y]) => (-x * sa + y * ca) / pitch);
  let out = '';
  for (let i = Math.floor(Math.min(...us)) - 1; i <= Math.ceil(Math.max(...us)) + 1; i++)
    for (let j = Math.floor(Math.min(...vs)) - 1; j <= Math.ceil(Math.max(...vs)) + 1; j++) {
      const x = (i * ca - j * sa) * pitch;
      const y = (i * sa + j * ca) * pitch;
      if (x < x0 - pitch || x > x1 + pitch || y < y0 - pitch || y > y1 + pitch) continue;
      const t = Math.min(1, tone(x, y));
      if (!(t > 0.02)) continue;
      const r = t <= 0.78 ? pitch * Math.sqrt(t / Math.PI) : pitch * (0.498 + ((t - 0.78) / 0.22) * 0.23);
      out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;
    }
  return out;
}

// geometry tests
const inRect = (x, y, [ax, ay, bx, by]) => x >= ax && x <= bx && y >= ay && y <= by;
function inPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

// Paper grain: ink starved in specks and a faint mottle.
function grainFilter(id, seed, freq = 0.75) {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -7 0 0 0 5.15" result="speck"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${seed + 7}" result="m"/>
  <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0.55 0 0 0.74" result="mottle"/>
  <feComposite in="speck" in2="mottle" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="mask"/>
  <feComposite in="SourceGraphic" in2="mask" operator="in"/>
</filter>`;
}

// ---- the hero scene ---------------------------------------------------------
function heroSvg() {
  const P = [36, 36, 644, 604]; // printed panel
  const LX = 318; // lamp axis
  const DY = -22; // the lamp sits this far above its first position
  const RIM = 210 + DY;
  const cone = [[214, RIM], [422, RIM], [552, 604], [84, 604]];
  const inCone = (x, y) => y >= RIM - 2 && inPoly(x, y, cone);
  const coneT = (y) => (y - RIM) / (604 - RIM);
  const door = [212, 244, 424, 512];
  const casing = [194, 226, 442, 512];
  const win = [478, 250, 604, 412];
  const glass = [490, 262, 592, 400];
  const plate = [142, 96 + DY, 164, 150 + DY];
  const steps = [
    { tread: [150, 512, 486, 526], riser: [150, 526, 486, 548] },
    { tread: [128, 548, 508, 560], riser: [128, 560, 508, 580] },
    { tread: [106, 580, 530, 592], riser: [106, 592, 530, 604] },
  ];
  // shrubs: clusters of round leaves, hand placed
  const shrubL = [[44, 470, 24], [76, 462, 22], [104, 476, 18], [126, 494, 14], [36, 500, 30], [78, 496, 28], [114, 512, 20], [50, 540, 36], [100, 548, 30], [132, 540, 16]];
  const shrubR = [[604, 466, 24], [574, 476, 20], [548, 492, 15], [632, 488, 26], [600, 500, 28], [562, 512, 22], [540, 530, 16], [622, 540, 34], [574, 548, 30]];
  const inShrub = (x, y) => [...shrubL, ...shrubR].some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);

  // blue screen: night everywhere, washed out inside the cone
  const blueTone = (x, y) => {
    if (!inRect(x, y, P)) return 0;
    if (inShrub(x, y)) return 0; // solid shapes printed separately
    if (inRect(x, y, door) || inRect(x, y, glass)) return 0;
    const lit = inCone(x, y);
    const t = coneT(y);
    for (const s of steps) {
      if (inRect(x, y, s.tread)) return lit ? 0 : 0.26;
      if (inRect(x, y, s.riser)) return lit ? lerp(0.34, 0.5, t) : 0.74;
    }
    if (inRect(x, y, casing) || inRect(x, y, win)) return lit ? 0 : 0.3;
    if (y > 512) return lit ? 0.4 : 0.78; // ground beside the steps
    // wall: a touch darker toward the top of the sheet
    if (lit) return lerp(0.1, 0.26, t);
    return lerp(0.66, 0.54, (y - 36) / 470);
  };
  // orange screen: the cone, densest under the shade
  const orangeTone = (x, y) => {
    if (!inRect(x, y, P)) return 0;
    if (inCone(x, y)) {
      const t = coneT(y);
      const half = 104 + t * 126;
      const across = Math.abs(x - LX) / half;
      return lerp(0.92, 0.34, t) * (1 - 0.28 * across * across);
    }
    return 0;
  };

  const blueDots = halftone({ angle: 15, pitch: 9, tone: blueTone, box: P });
  const orangeDots = halftone({ angle: 45, pitch: 8.5, tone: orangeTone, box: P });

  // siding lines across the wall (not over door, casing, window)
  let siding = '';
  for (let y = 70; y < 512; y += 34) {
    const segs = [[36, 644]];
    const cut = (a, b) => {
      for (let k = segs.length - 1; k >= 0; k--) {
        const [s, e] = segs[k];
        if (b <= s || a >= e) continue;
        segs.splice(k, 1, ...[[s, a], [b, e]].filter(([p, q]) => q - p > 1));
      }
    };
    if (y >= casing[1]) cut(casing[0], casing[2]);
    if (y >= win[1] - 2 && y <= win[3] + 12) cut(win[0] - 10, win[2] + 10);
    if (y >= plate[1] - 4 && y <= plate[3] + 4) cut(plate[0] - 4, plate[2] + 4);
    for (const [a, b] of segs) siding += `<rect x="${a}" y="${y}" width="${b - a}" height="2.6"/>`;
  }

  // door: solid planks, seams knocked out, ledges and brace with lit top edges
  const seams = [265, 318, 371].map((x) => `<rect x="${x - 1}" y="${door[1]}" width="2.2" height="${door[3] - door[1]}" fill="${PAPER}"/>`).join('');
  const ledge = (y) => `<rect x="222" y="${y}" width="192" height="30" fill="${BLUE}"/><rect x="222" y="${y}" width="192" height="3" fill="${PAPER}"/><rect x="222" y="${y + 27}" width="192" height="1.6" fill="${PAPER}" opacity="0.9"/>`;
  const brace = `<path d="M232 448 L402 316 L414 328 L244 460 Z" fill="${BLUE}"/><path d="M232 448 L402 316 L404 319 L234 451 Z" fill="${PAPER}"/>`;
  const doorBlue = `<rect x="${door[0]}" y="${door[1]}" width="${door[2] - door[0]}" height="${door[3] - door[1]}"/>${seams}${ledge(286)}${ledge(448)}${brace}
  <rect x="${casing[0]}" y="${casing[1]}" width="${casing[2] - casing[0]}" height="3"/><rect x="${casing[0] - 6}" y="${casing[1] - 6}" width="${casing[2] - casing[0] + 12}" height="6"/>`;

  // window
  const winBlue = `<rect x="${glass[0]}" y="${glass[1]}" width="${glass[2] - glass[0]}" height="${glass[3] - glass[1]}"/>
  <rect x="539" y="262" width="4" height="138" fill="${PAPER}"/><rect x="490" y="329" width="102" height="4" fill="${PAPER}"/>
  <rect x="468" y="412" width="146" height="4"/>`;

  // lamp hardware (printed in both inks, so it overprints to the darkest brown)
  const shade = `M304 168 C282 172 252 186 230 200 L214 206 L422 206 L406 200 C384 186 354 172 332 168 Z`;
  const hardware = (ink) => `<g transform="translate(0 ${DY})"><rect x="142" y="96" width="22" height="54" rx="5"/>
  <path stroke="${ink}" d="M160 116 C 226 116 246 70 288 70 C 318 70 318 96 318 150" fill="none" stroke-width="10" stroke-linecap="round"/>
  <path stroke="${ink}" d="M160 142 L 222 106" fill="none" stroke-width="4" stroke-linecap="round"/>
  <rect x="307" y="146" width="22" height="24" rx="3"/>
  <path d="${shade}"/>
  <rect x="210" y="203" width="216" height="8" rx="4"/></g>`;

  // underside of the shade: white enamel, the bulb
  const underside = `<g transform="translate(0 ${DY})"><path d="M218 210 A100 15 0 0 0 418 210 Z" fill="${PAPER}"/></g>`;
  const undersideOrange = `<g transform="translate(0 ${DY})"><path d="M240 211 A78 12 0 0 0 396 211 Z"/><path d="M290 211 A28 15 0 0 0 346 211 Z" fill="${ORANGE}"/><path d="M296 211 A22 11 0 0 0 340 211 Z" fill="${PAPER}"/></g>`;

  // moths, in blue; inside the cone they overprint brown
  const moth = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 -6 C2 -6 2 6 0 8 C-2 6 -2 -6 0 -6 Z M1 -3 C8 -12 16 -8 14 -2 C12 2 6 2 1 0 Z M-1 -3 C-8 -12 -16 -8 -14 -2 C-12 2 -6 2 -1 0 Z M1 1 C7 2 10 6 7 9 C4 10 2 6 1 3 Z M-1 1 C-7 2 -10 6 -7 9 C-4 10 -2 6 -1 3 Z"/><path d="M0 -6 L-3 -11 M0 -6 L3 -11" fill="none" stroke="${BLUE}" stroke-width="0.8"/></g>`;
  const moths = moth(240, 204, 0.95, -20) + moth(404, 210, 0.85, 24) + moth(452, 296, 0.75, -8) + moth(176, 262, 0.7, 14);

  // doormat on the porch floor
  const matOrange = `<rect x="246" y="503" width="144" height="10" rx="1.5"/>`;
  let matBlue = '';
  for (let x = 252; x < 388; x += 10) matBlue += `<rect x="${x}" y="503" width="4" height="10"/>`;

  // shrubs: clusters of round leaves with a few paper leaf marks
  const shrubDisks = [...shrubL, ...shrubR].map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('');
  const leafMarks = [...shrubL, ...shrubR]
    .filter(([, , r]) => r >= 18)
    .map(([cx, cy, r], k) => {
      const a = (k * 47) % 360;
      const x = cx + Math.cos((a * Math.PI) / 180) * r * 0.45;
      const y = cy - r * 0.35;
      return `<path d="M${f(x - 5)} ${f(y)} q5 -6 10 0" fill="none" stroke="${PAPER}" stroke-width="2" stroke-linecap="round"/>`;
    })
    .join('');
  const shrubs = shrubDisks + leafMarks;

  // steps: nosing lines, and short end lines where each step meets the next
  const nosing =
    steps.map((s) => `<rect x="${s.riser[0]}" y="${s.riser[1]}" width="${s.riser[2] - s.riser[0]}" height="4"/>`).join('') +
    steps.map((s) => `<rect x="${s.tread[0]}" y="${s.tread[1]}" width="3" height="${s.riser[3] - s.tread[1]}"/><rect x="${s.tread[2] - 3}" y="${s.tread[1]}" width="3" height="${s.riser[3] - s.tread[1]}"/>`).join('') +
    `<rect x="36" y="511" width="608" height="2"/>`;

  const knob = `<circle cx="402" cy="386" r="7"/>`;
  const knobHole = `<circle cx="402" cy="386" r="10" fill="${PAPER}"/>`;

  const defs = `${grainFilter('gB', 3)}${grainFilter('gO', 11)}
<clipPath id="panel"><rect x="${P[0]}" y="${P[1]}" width="${P[2] - P[0]}" height="${P[3] - P[1]}"/></clipPath>`;

  // text block on bare paper
  const TX = 692;
  const text = `
  <text x="${TX - 4}" y="300" font-family="DIN Condensed" font-weight="700" font-size="150" letter-spacing="-1" textLength="548" lengthAdjust="spacingAndGlyphs">PORCHLIGHT</text>
  <g font-family="DIN Condensed" font-weight="700" font-size="47" letter-spacing="1.2">
    <text x="${TX}" y="400">A LIGHT LEFT ON OVER</text>
    <text x="${TX}" y="450">YOUR OWN FRONT DOOR.</text>
  </g>
  <text x="${TX}" y="586" font-family="DIN Condensed" font-weight="700" font-size="19" letter-spacing="2.6">LEAKED KEYS · OLD PACKAGES · YOUR DOMAINS · THIS MAC</text>`;
  const regMark = (x, y) => `<g fill="none" stroke-width="1.4"><circle cx="${x}" cy="${y}" r="9"/><path d="M${x - 15} ${y}h30M${x} ${y - 15}v30"/></g>`;

  const body = `
<rect width="1280" height="640" fill="${PAPER}"/>
<g style="mix-blend-mode:multiply" filter="url(#gB)">
  <g fill="${BLUE}" stroke="${BLUE}" stroke-width="0">
    <g clip-path="url(#panel)">${blueDots}${siding}${shrubs}${nosing}</g>
    ${doorBlue}
    ${winBlue}
    ${knobHole}
    ${hardware(BLUE)}
    ${underside}
    <g clip-path="url(#panel)">${moths}${matBlue}</g>
    ${text}
    <g stroke="${BLUE}">${regMark(1228, 52)}</g>
  </g>
</g>
<g style="mix-blend-mode:multiply" filter="url(#gO)">
  <g transform="translate(3.5 -2.5) rotate(0.12 640 320)" fill="${ORANGE}">
    <g clip-path="url(#panel)">${orangeDots}</g>
    ${hardware(ORANGE)}
    ${undersideOrange}
    ${knob}
    ${matOrange}
    <rect x="${TX - 2}" y="322" width="546" height="13"/>
    <g stroke="${ORANGE}">${regMark(1228, 52)}</g>
  </g>
</g>`;
  return svg({ w: 1280, h: 640, defs, body });
}

// ---- the mark: lamp, cone and door, in two inks ------------------------------
// Drawn on a 200 grid. `dots` false gives a flat version for small sizes.
function markBody({ grain = true, shift = [2.4, -1.8] } = {}) {
  const LX = 112;
  const RIM = 98;
  const cone = [[62, RIM], [162, RIM], [196, 186], [28, 186]];
  const orangeTone = (x, y) => {
    if (y < RIM || y > 186 || !inPoly(x, y, cone)) return 0;
    const t = (y - RIM) / (186 - RIM);
    return lerp(0.95, 0.42, t);
  };
  const dots = halftone({ angle: 45, pitch: 7.2, tone: orangeTone, box: [20, RIM, 200, 190] });
  const shade = `M104 64 C94 68 80 78 70 90 L60 96 L164 96 L154 90 C144 78 130 68 120 64 Z`;
  const hw = (ink) => `<rect x="18" y="26" width="12" height="36" rx="3"/>
  <path d="M28 40 C 62 40 70 16 94 16 C 112 16 112 30 112 50" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
  <path d="M28 56 L 60 34" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>
  <rect x="105" y="48" width="14" height="17" rx="2"/>
  <path d="${shade}"/><rect x="57" y="94" width="110" height="6" rx="3"/>`;
  const blue = `${hw(BLUE)}
  <path d="M84 186 V128 H140 V186 Z"/>
  <rect x="111" y="128" width="2" height="58" fill="${PAPER}"/>
  <path d="M60 99 A52 9 0 0 0 164 99 Z" fill="${PAPER}"/>
  <rect x="20" y="186" width="184" height="6" rx="1"/>`;
  const orange = `${hw(ORANGE)}<g>${dots}</g>
  <path d="M74 100 A38 7 0 0 0 150 100 Z"/>
  <path d="M${LX - 16} 100 A16 8.5 0 0 0 ${LX + 16} 100 Z"/><path d="M${LX - 12} 100 A12 6 0 0 0 ${LX + 12} 100 Z" fill="${PAPER}"/>
  <circle cx="130" cy="160" r="3.4"/>`;
  return { blue, orange, shift, grain };
}

function markSvgDoc({ w = 512, h = 512, grain = true } = {}) {
  const m = markBody({ grain });
  const defs = grain ? `${grainFilter('mB', 5, 1.1)}${grainFilter('mO', 9, 1.1)}` : '';
  const body = `
<g style="mix-blend-mode:multiply"${grain ? ' filter="url(#mB)"' : ''}><g fill="${BLUE}">${m.blue}</g></g>
<g style="mix-blend-mode:multiply"${grain ? ' filter="url(#mO)"' : ''}><g fill="${ORANGE}" transform="translate(${m.shift[0]} ${m.shift[1]})">${m.orange}</g></g>`;
  return svg({ w, h, vb: '0 -8 224 224', defs, body });
}

// ---- logo -----------------------------------------------------------------
function logoSvg() {
  const m = markBody({});
  const defs = `${grainFilter('lB', 5, 1.1)}${grainFilter('lO', 9, 1.1)}`;
  const body = `
<g style="mix-blend-mode:multiply" filter="url(#lB)"><g fill="${BLUE}">
  <g transform="translate(14 16) scale(0.80)">${m.blue}</g>
  <text x="206" y="146" font-family="DIN Condensed" font-weight="700" font-size="128" letter-spacing="-0.5" textLength="414" lengthAdjust="spacingAndGlyphs">PORCHLIGHT</text>
</g></g>
<g style="mix-blend-mode:multiply" filter="url(#lO)"><g fill="${ORANGE}" transform="translate(2 -1.5)">
  <g transform="translate(14 16) scale(0.80)">${m.orange}</g>
  <rect x="208" y="160" width="412" height="9"/>
</g></g>`;
  return svg({ w: 640, h: 200, defs, body });
}

// ---- icon: a print on a paper tile ---------------------------------------
function iconSvg() {
  const LX = 270;
  const RIM = 214;
  const cone = [[150, RIM], [390, RIM], [470, 512], [70, 512]];
  const tile = [0, 0, 512, 512];
  const inCone = (x, y) => y >= RIM && inPoly(x, y, cone);
  const door = [196, 300, 344, 448];
  const blueTone = (x, y) => {
    if (inRect(x, y, door)) return 0;
    if (y > 452) return inCone(x, y) ? 0.36 : 0.74;
    if (inCone(x, y)) return lerp(0.1, 0.24, (y - RIM) / 240);
    return 0.56;
  };
  const orangeTone = (x, y) => (inCone(x, y) ? lerp(0.95, 0.4, (y - RIM) / 300) * (1 - 0.25 * ((x - LX) / (120 + (y - RIM) * 0.33)) ** 2) : 0);
  const bd = halftone({ angle: 15, pitch: 19, tone: blueTone, box: tile });
  const od = halftone({ angle: 45, pitch: 18, tone: orangeTone, box: tile });
  const shade = `M256 150 C232 158 196 180 172 200 L146 210 L394 210 L368 200 C344 180 308 158 284 150 Z`;
  const hw = (ink) => `<rect x="34" y="70" width="28" height="88" rx="8"/>
  <path d="M58 104 C 140 104 156 44 216 44 C 266 44 270 74 270 118" fill="none" stroke="${ink}" stroke-width="18" stroke-linecap="round"/>
  <path d="M58 146 L 132 96" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round"/>
  <rect x="252" y="112" width="36" height="42" rx="6"/>
  <path d="${shade}"/><rect x="138" y="204" width="264" height="16" rx="8"/>`;
  const defs = `<clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath>`;
  const body = `
<g clip-path="url(#tile)">
<rect width="512" height="512" fill="${PAPER}"/>
<g style="mix-blend-mode:multiply"><g fill="${BLUE}">
  ${bd}
  <rect x="${door[0]}" y="${door[1]}" width="${door[2] - door[0]}" height="${door[3] - door[1]}"/>
  <rect x="${LX - 3}" y="${door[1]}" width="6" height="${door[3] - door[1]}" fill="${PAPER}"/>
  <rect x="${door[0] - 20}" y="448" width="${door[2] - door[0] + 40}" height="10"/>
  ${hw(BLUE)}
  <path d="M148 219 A122 22 0 0 0 392 219 Z" fill="${PAPER}"/>
</g></g>
<g style="mix-blend-mode:multiply"><g fill="${ORANGE}" transform="translate(6 -4)">
  ${od}
  ${hw(ORANGE)}
  <path d="M176 220 A94 16 0 0 0 364 220 Z"/>
  <path d="M${LX - 38} 220 A38 19 0 0 0 ${LX + 38} 220 Z"/><path d="M${LX - 29} 220 A29 14 0 0 0 ${LX + 29} 220 Z" fill="${PAPER}"/>
  <circle cx="318" cy="384" r="9"/>
</g></g>
</g>`;
  return svg({ w: 512, h: 512, defs, body });
}

// ---- favicon: 16 x 16, flat inks, pixel-snapped ---------------------------
// B blue, O orange, D overprint brown, W paper
const FAV = [
  '................',
  '.....BBB........',
  'B...B...B.......',
  'BBBB....B.......',
  'B.......BB......',
  '.......BBBB.....',
  '.....BBBBBBBB...',
  '....BBBBBBBBBB..',
  '.....OOOWWOOO...',
  '....OOOOOOOOOO..',
  '....OOOOOOOOOO..',
  '...OOODDDDDDOOO.',
  '...OOODDDDDDOOO.',
  '..OOOODDDDDDOOOO',
  '..OOOODDDDDDOOOO',
  'BBBBBBBBBBBBBBBB',
];
function pixelsSvg(map, pal, size) {
  let body = '';
  map.forEach((row, y) => {
    if (row.length !== size) throw new Error(`row ${y} is ${row.length}`);
    let x = 0;
    while (x < size) {
      const ch = row[x];
      let e = x + 1;
      while (e < size && row[e] === ch) e++;
      if (ch !== '.') body += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${pal[ch]}"/>`;
      x = e;
    }
  });
  return svg({ w: size, h: size, vb: `0 0 ${size} ${size}`, crisp: true, body });
}
const favPal = { B: BLUE, O: ORANGE, D: BROWN, W: '#fff6e2' };

// 32 favicon: flat inks, the cone in two steps and a pixel halftone edge
const FAV32 = [
  '................................',
  '................................',
  '.........BBBBBB.................',
  '.......BBBBBBBBBB...............',
  'BB....BBB......BBB..............',
  'BB...BBB........BB..............',
  'BBBBBBB.........BB..............',
  'BBBBBB..........BB..............',
  'BB...BB.......BBBBBB............',
  'BB............BBBBBB............',
  '.............BBBBBBBB...........',
  '............BBBBBBBBBB..........',
  '..........BBBBBBBBBBBBBB........',
  '.......BBBBBBBBBBBBBBBBBBBB.....',
  '.....BBBBBBBBBBBBBBBBBBBBBBBB...',
  '.....BBBBBBBBBBBBBBBBBBBBBBBB...',
  '......OOOOOOOOWWWWWWOOOOOOOO....',
  '......OOOOOOOOOWWWWOOOOOOOOO....',
  '.....OOOOOOOOOOOOOOOOOOOOOOOO...',
  '.....OOOOOOOOOOOOOOOOOOOOOOOO...',
  '....OOOOOOOOOOOOOOOOOOOOOOOOOO..',
  '....OOOOOOODDDDDDDDDDDDOOOOOOO..',
  '...OOOOOOOODDDDDDDDDDDDOOOOOOOO.',
  '...OOOOOOOODDDDDDDDDDDDOOOOOOOO.',
  '..OOOOOOOOODDDDDDDDDDDDOOOOOOOOO',
  '..OOOOOOOOODDDDDDDDDODDOOOOOOOOO',
  '..OOOOOOOOODDDDDDDDDDDDOOOOOOOOO',
  '..OOOOOOOOODDDDDDDDDDDDOOOOOOOOO',
  '..OOOOOOOOODDDDDDDDDDDDOOOOOOOOO',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  '................................',
];

const notes = `# 19 Riso barn lamp

A two-colour risograph print: a gooseneck barn lamp with an enamel shade hangs over a board-and-batten front door, and its cone of light falls across the door, the mat and the steps. Two inks only, overprinted (multiply) so the lamp and the lit door turn a third, dark brown; halftone screens at 15° and 45°, the orange drum a few pixels out of register, paper grain.
Palette: paper #f2ead6, riso Federal Blue #3d5588, riso Orange #ff6c2f, overprint about #3a2115.
Type: DIN Condensed Bold, uppercase, set tight for the name and tracked for the tagline and footer line.
`;

writeConcept(SLUG, {
  'mark.svg': markSvgDoc({}),
  'logo.svg': logoSvg(),
  'favicon.svg': pixelsSvg(FAV, favPal, 16),
  'favicon-32.svg': pixelsSvg(FAV32, favPal, 32),
  'icon.svg': iconSvg(),
  'hero.svg': heroSvg(),
  'notes.md': notes,
});
