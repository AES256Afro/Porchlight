// 11 Stained glass: a leaded fanlight over a front door, its panes radiating
// like a sunrise around a small glass lantern; the light left on in the hall
// shines through it onto the step.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '11-stained-glass';
const G = {
  came: '#2a2724',
  cameHi: '#5b554c',
  hot: '#fbe6aa',
  amber: '#f1b453',
  amberDk: '#d98a2b',
  gold: '#f6cf7c',
  clear: '#efe2bf',
  clear2: '#e2d1a4',
  ruby: '#a52331',
  rubyLt: '#c8434a',
  blue: '#1f417c',
  blueLt: '#2f5c9e',
  green: '#1f5c40',
  greenLt: '#2f7c55',
  door: '#1b2a3a',
  doorHi: '#26394d',
  doorLo: '#121c27',
  stone: '#6f695e',
  stoneLt: '#9d927b',
  stoneDk: '#4a4640',
  brick: '#35221e',
  mortar: '#211613',
  cream: '#f3e4bd',
  muted: '#cbb98f',
  ink: '#1c2b3a',
};
const f = (n) => Math.round(n * 100) / 100;

function pol(cx, cy, r, a) {
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}
// annular sector, angles in radians (upper half: PI..2PI)
function sector(cx, cy, r1, r2, a0, a1) {
  const p1 = pol(cx, cy, r1, a0);
  const p2 = pol(cx, cy, r2, a0);
  const p3 = pol(cx, cy, r2, a1);
  const p4 = pol(cx, cy, r1, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (r1 <= 0.01) return `M${f(cx)},${f(cy)}L${f(p2[0])},${f(p2[1])}A${f(r2)},${f(r2)} 0 ${large} 1 ${f(p3[0])},${f(p3[1])}Z`;
  return `M${f(p1[0])},${f(p1[1])}L${f(p2[0])},${f(p2[1])}A${f(r2)},${f(r2)} 0 ${large} 1 ${f(p3[0])},${f(p3[1])}L${f(p4[0])},${f(p4[1])}A${f(r1)},${f(r1)} 0 ${large} 0 ${f(p1[0])},${f(p1[1])}Z`;
}

const MOTTLE = `
<radialGradient id="m1" cx="0.3" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<radialGradient id="m2" cx="0.7" cy="0.6" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<radialGradient id="m3" cx="0.5" cy="0.8" r="0.7"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.22"/></radialGradient>
<radialGradient id="m4" cx="0.45" cy="0.2" r="0.8"><stop offset="0" stop-color="#fff3cf" stop-opacity="0.3"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0.04"/><stop offset="1" stop-color="#000000" stop-opacity="0.12"/></radialGradient>`;

// The fanlight. cx, cy: centre of the flat bottom edge; R: outer radius.
function fanlight(cx, cy, R, { n = 7, detail = true, seed = 3, border = true } = {}) {
  const r = rng(seed);
  const rh = R * 0.3;
  const rm = R * 0.62;
  const ro = border ? R * 0.86 : R;
  const lw = Math.max(1, R * 0.034);
  const A0 = Math.PI;
  const span = Math.PI;
  const angs = Array.from({ length: n + 1 }, (_, k) => A0 + (span * k) / n);
  const outerCols = [G.blue, G.green, G.ruby, G.blue, G.ruby, G.green, G.blue];
  const outerLt = { [G.blue]: G.blueLt, [G.green]: G.greenLt, [G.ruby]: G.rubyLt };
  let pieces = '';
  const piece = (d, fill, k) => {
    pieces += `<path d="${d}" fill="${fill}"/>`;
    if (detail) pieces += `<path d="${d}" fill="url(#m${1 + (k % 4)})"/>`;
  };
  let k = 0;
  // inner ring: warm, near the light; each wedge split in two
  for (let i = 0; i < n; i++) {
    const am = (angs[i] + angs[i + 1]) / 2;
    piece(sector(cx, cy, rh, rm, angs[i], am), i % 2 ? G.gold : G.amber, k++);
    piece(sector(cx, cy, rh, rm, am, angs[i + 1]), i % 2 ? G.amber : G.gold, k++);
  }
  // outer ring: jewels, a lighter tip piece near the rim
  const rt = rm + (ro - rm) * 0.62;
  for (let i = 0; i < n; i++) {
    const c = outerCols[i % outerCols.length];
    piece(sector(cx, cy, rm, rt, angs[i], angs[i + 1]), c, k++);
    piece(sector(cx, cy, rt, ro, angs[i], angs[i + 1]), outerLt[c], k++);
  }
  // border of clear panes and small jewels
  const nb = 3 * n;
  const bAngs = Array.from({ length: nb + 1 }, (_, j) => A0 + (span * j) / nb);
  if (border)
    for (let j = 0; j < nb; j++) {
      const jewel = j % 3 === 1;
      const col = jewel ? [G.ruby, G.blue, G.green][Math.floor(j / 3) % 3] : j % 2 ? G.clear : G.clear2;
      piece(sector(cx, cy, ro, R, bAngs[j], bAngs[j + 1]), col, k++);
    }
  // hub: a little lantern in hot glass
  piece(sector(cx, cy, 0, rh, A0, A0 + span), G.hot, 2);
  const s = rh / 30;
  const L = (x, y) => `${f(cx + x * s)},${f(cy + y * s)}`;
  const roof = `M${L(0, -27)}L${L(8.5, -17)}L${L(-8.5, -17)}Z`;
  const glass = `M${L(-6.5, -17)}L${L(6.5, -17)}L${L(5, -5)}L${L(-5, -5)}Z`;
  const base = `M${L(-6, -5)}L${L(6, -5)}L${L(3, 0)}L${L(-3, 0)}Z`;
  pieces += `<path d="${roof}" fill="${G.green}"/><path d="${base}" fill="${G.green}"/><path d="${glass}" fill="#fff8e0"/>`;
  // seeds: small bubbles in the glass
  if (detail) {
    let seeds = '';
    for (let q = 0; q < Math.round(R * 0.9); q++) {
      const rr = rh + r() * (R - rh);
      const a = A0 + 0.04 + r() * (span - 0.08);
      const [x, y] = pol(cx, cy, rr, a);
      seeds += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(R * (0.004 + r() * 0.006))}" fill="#ffffff" opacity="${f(0.2 + r() * 0.25)}"/>`;
    }
    pieces += seeds;
  }
  // lead: arcs and radials
  let lead = '';
  const arc = (rr) => {
    const [x0, y0] = pol(cx, cy, rr, A0);
    const [x1, y1] = pol(cx, cy, rr, A0 + span);
    return `M${f(x0)},${f(y0)}A${f(rr)},${f(rr)} 0 0 1 ${f(x1)},${f(y1)}`;
  };
  lead += arc(rh) + arc(rm) + arc(rt) + arc(ro);
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pol(cx, cy, rh, angs[i]);
    const [x1, y1] = pol(cx, cy, ro, angs[i]);
    lead += `M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}`;
  }
  for (let i = 0; i < n; i++) {
    const am = (angs[i] + angs[i + 1]) / 2;
    const [x0, y0] = pol(cx, cy, rh, am);
    const [x1, y1] = pol(cx, cy, rm, am);
    lead += `M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}`;
  }
  if (border)
    for (let j = 1; j < nb; j++) {
      const [x0, y0] = pol(cx, cy, ro, bAngs[j]);
      const [x1, y1] = pol(cx, cy, R, bAngs[j]);
      lead += `M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}`;
    }
  lead += `M${roof.slice(1)}M${glass.slice(1)}M${base.slice(1)}`;
  const frame = `${arc(R)}Z`;
  return `
${pieces}
<path d="${lead}" fill="none" stroke="${G.came}" stroke-width="${f(lw)}" stroke-linejoin="round" stroke-linecap="round"/>
${detail ? `<path d="${lead}" fill="none" stroke="${G.cameHi}" stroke-width="${f(lw * 0.28)}" stroke-linejoin="round" transform="translate(${f(-lw * 0.18)} ${f(-lw * 0.18)})"/>` : ''}
<path d="${frame}" fill="none" stroke="${G.came}" stroke-width="${f(lw * 1.4)}"/>
<path d="M${f(cx - R)},${f(cy)}H${f(cx + R)}" stroke="${G.came}" stroke-width="${f(lw * 1.6)}"/>`;
}

// ---- mark: arched doorway with the fanlight over a dark door ----------------
function markBody({ detail = true } = {}) {
  const cx = 100;
  const cy = 102;
  const R = 70;
  return `
<path d="M${cx - 88},196V${cy}A88,88 0 0 1 ${cx + 88},${cy}V196Z" fill="${G.stone}"/>
<path d="M${cx - 88},${cy}A88,88 0 0 1 ${cx + 88},${cy}" fill="none" stroke="${G.stoneLt}" stroke-width="3"/>
<path d="M${cx - 9},${cy - 90}H${cx + 9}L${cx + 6},${cy - 70}H${cx - 6}Z" fill="${G.stoneLt}" stroke="${G.stoneDk}" stroke-width="1.5"/>
<path d="M${cx - R - 4},${cy}A${R + 4},${R + 4} 0 0 1 ${cx + R + 4},${cy}Z" fill="${G.came}"/>
${fanlight(cx, cy, R, { detail })}
<rect x="${cx - R - 4}" y="${cy + 2}" width="${2 * R + 8}" height="10" fill="${G.stoneLt}"/>
<rect x="${cx - R}" y="${cy + 12}" width="${2 * R}" height="${196 - cy - 12}" fill="${G.door}"/>
<rect x="${cx - R + 12}" y="${cy + 24}" width="${R - 18}" height="34" rx="1" fill="${G.doorLo}"/>
<rect x="${cx + 6}" y="${cy + 24}" width="${R - 18}" height="34" rx="1" fill="${G.doorLo}"/>
<rect x="${cx - R + 14}" y="${cy + 26}" width="${R - 22}" height="30" fill="${G.doorHi}"/>
<rect x="${cx + 8}" y="${cy + 26}" width="${R - 22}" height="30" fill="${G.doorHi}"/>
<rect x="${cx - R + 12}" y="${cy + 66}" width="${R - 18}" height="${196 - cy - 66}" fill="${G.doorLo}"/>
<rect x="${cx + 6}" y="${cy + 66}" width="${R - 18}" height="${196 - cy - 66}" fill="${G.doorLo}"/>
<circle cx="${cx + 2}" cy="${cy + 64}" r="3.4" fill="${G.amber}"/>
<rect x="0" y="194" width="200" height="6" fill="${G.stoneDk}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody(), defs: MOTTLE });

// ---- favicon -----------------------------------------------------------------
// 16-unit grid, whole pixels: five panes in three jewel colours around an
// amber hub, 1px came lines and outline, a stone lintel and the door below.
const FAV16 = [
  '................',
  '......KKKK......',
  '....KKrrrrKK....',
  '...KggKrrKggK...',
  '..KgggKrrKgggK..',
  '.KbKggKrrKggKbK.',
  '.KbbKgKKKKgKbbK.',
  'KbbbbKahhaKbbbbK',
  'KbbbbKaaaaKbbbbK',
  'LLLLLLLLLLLLLLLL',
  'sDDDDDDddDDDDDDs',
  'sDddddDddDddddDs',
  'sDddddDddDddddDs',
  'sDDDDDDddDaDDDDs',
  'sDddddDddDddddDs',
  'sDddddDddDddddDs',
];
const FPAL = { K: G.came, r: G.rubyLt, g: G.greenLt, b: G.blueLt, a: G.amber, h: G.hot, L: '#b5a88e', s: G.stone, D: G.doorHi, d: '#142030' };
function pixRects(rows, pal) {
  let out = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let e = x + 1;
      while (e < row.length && row[e] === ch) e++;
      if (ch !== '.') out += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${pal[ch]}"/>`;
      x = e;
    }
  });
  return out;
}
const favSvg = svg({ w: 16, h: 16, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16, FPAL) });
// the 32 is the same pixel drawing at 2x, kept crisp
const fav32Svg = svg({ w: 32, h: 32, vb: '0 0 16 16', crisp: true, body: pixRects(FAV16, FPAL) });

// ---- icon --------------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: MOTTLE,
  body: `
<rect width="512" height="512" rx="112" fill="${G.brick}"/>
${nest({ x: 40, y: 34, w: 432, h: 432, vb: '0 0 200 200', body: markBody() })}`,
});

// ---- logo --------------------------------------------------------------------
const logoSvg = svg({
  w: 640,
  h: 200,
  vb: '0 0 640 200',
  defs: MOTTLE,
  body: `
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 0 200 200', body: markBody() })}
<text x="212" y="124" font-family="Optima" font-size="84" letter-spacing="0.5" fill="${G.ink}">Porchlight</text>
<path d="M216,148H560" stroke="${G.amberDk}" stroke-width="2"/>
<circle cx="572" cy="148" r="4" fill="${G.ruby}"/><circle cx="586" cy="148" r="4" fill="${G.blueLt}"/><circle cx="600" cy="148" r="4" fill="${G.green}"/>`,
});

// ---- hero --------------------------------------------------------------------
function hero() {
  const R0 = rng(5);
  const cx = 400;
  const cy = 300;
  const R = 150;
  const doorTop = cy + 16;
  const stepY = 590;
  // brick
  let bricks = '';
  const tones = ['#35221e', '#3a2620', '#30201c', '#3d2822', '#33211d'];
  for (let row = 0; row < 32; row++) {
    const y = row * 20;
    const off = row % 2 ? -30 : 0;
    for (let x = off; x < 1280; x += 60) bricks += `<rect x="${x + 2}" y="${y + 2}" width="56" height="16" fill="${tones[Math.floor(R0() * tones.length)]}"/>`;
  }
  // door panels
  const dx0 = cx - R;
  const dw = 2 * R;
  const panel = (x, y, w, h) => `
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${G.doorLo}"/>
<path d="M${x + w},${y}V${y + h}H${x}L${x + 6},${y + h - 6}H${x + w - 6}V${y + 6}Z" fill="${G.doorHi}"/>
<rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" fill="${G.door}"/>
<path d="M${x + 10},${y + 10}H${x + w - 10}" stroke="${G.doorHi}" stroke-width="2"/>`;
  const leafW = dw / 2;
  const doorSvg = `
<rect x="${dx0}" y="${doorTop}" width="${dw}" height="${stepY - doorTop}" fill="${G.door}"/>
${[0, 1]
  .map((i) => {
    const x = dx0 + i * leafW;
    return panel(x + 22, doorTop + 24, leafW - 44, 92) + panel(x + 22, doorTop + 136, leafW - 44, 112);
  })
  .join('')}
<path d="M${cx},${doorTop}V${stepY}" stroke="${G.doorLo}" stroke-width="4"/>
<rect x="${cx - 46}" y="${doorTop + 258}" width="34" height="9" rx="2" fill="${G.amberDk}"/>
<path d="M${cx - 44},${doorTop + 259}H${cx - 14}" stroke="${G.gold}" stroke-width="1.6"/>
<circle cx="${cx + 18}" cy="${doorTop + 214}" r="7" fill="${G.amberDk}"/>
<circle cx="${cx + 16}" cy="${doorTop + 212}" r="2.6" fill="${G.gold}"/>`;
  // stone surround: pilasters and an archivolt with a keystone
  const AR = R + 34;
  const surround = `
<path d="M${cx - AR},${cy}A${AR},${AR} 0 0 1 ${cx + AR},${cy}L${cx + R + 4},${cy}A${R + 4},${R + 4} 0 0 0 ${cx - R - 4},${cy}Z" fill="${G.stone}"/>
${Array.from({ length: 13 }, (_, i) => {
  const a = Math.PI + (Math.PI * i) / 12;
  const [x0, y0] = pol(cx, cy, R + 4, a);
  const [x1, y1] = pol(cx, cy, AR, a);
  return i === 0 || i === 12 ? '' : `<path d="M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}" stroke="${G.stoneDk}" stroke-width="2"/>`;
}).join('')}
<path d="M${cx - AR},${cy}A${AR},${AR} 0 0 1 ${cx + AR},${cy}" fill="none" stroke="${G.stoneLt}" stroke-width="3"/>
<path d="M${cx - 20},${cy - AR - 10}H${cx + 20}L${cx + 13},${cy - R - 2}H${cx - 13}Z" fill="${G.stoneLt}"/>
<path d="M${cx - 20},${cy - AR - 10}H${cx + 20}" stroke="#c3b69a" stroke-width="3"/>
<rect x="${cx - AR - 26}" y="${cy - 6}" width="${AR - R + 26}" height="18" fill="${G.stoneLt}"/>
<rect x="${cx + R}" y="${cy - 6}" width="${AR - R + 26}" height="18" fill="${G.stoneLt}"/>
<rect x="${cx - AR - 18}" y="${cy + 12}" width="${AR - R + 10}" height="${stepY - cy - 12}" fill="${G.stone}"/>
<rect x="${cx + R + 8}" y="${cy + 12}" width="${AR - R + 10}" height="${stepY - cy - 12}" fill="${G.stone}"/>
<path d="M${cx - R - 8},${cy + 12}V${stepY}M${cx + R + 8},${cy + 12}V${stepY}" stroke="#b5a88e" stroke-width="3"/>
${[0, 1, 2, 3].map((i) => `<path d="M${cx - AR - 6 + i * 6},${cy + 30}V${stepY - 14}M${cx + R + 16 + i * 6},${cy + 30}V${stepY - 14}" stroke="${G.stoneDk}" stroke-width="1.6"/>`).join('')}
<rect x="${cx - R - 4}" y="${cy + 2}" width="${2 * R + 8}" height="14" fill="${G.stoneLt}"/>`;
  // the fanlight's light thrown onto the step and path, flipped and stretched
  const throwLight = `
<g opacity="0.36" transform="translate(${cx} ${stepY + 5}) scale(1.3 -0.12) translate(${-cx} ${-cy})">
  ${fanlight(cx, cy, R, { detail: false })}
</g>`;
  // glow of the hall light on the stone around the arch
  return `
<defs>
${MOTTLE}
<radialGradient id="spill" cx="0.5" cy="0.62" r="0.5"><stop offset="0" stop-color="#f6c46a" stop-opacity="0.28"/><stop offset="1" stop-color="#f6c46a" stop-opacity="0"/></radialGradient>
<linearGradient id="pave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c470" stop-opacity="0.2"/><stop offset="1" stop-color="#f3c470" stop-opacity="0.02"/></linearGradient>
<linearGradient id="stepface" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a8170"/><stop offset="1" stop-color="#4a463f"/></linearGradient>
</defs>
<rect width="1280" height="640" fill="${G.mortar}"/>
${bricks}
${surround}
<path d="M${cx - R - 4},${cy}A${R + 4},${R + 4} 0 0 1 ${cx + R + 4},${cy}Z" fill="${G.came}"/>
${fanlight(cx, cy, R)}
<rect x="${cx - R - 4}" y="${cy + 2}" width="${2 * R + 8}" height="14" fill="${G.stoneLt}"/>
${doorSvg}
<rect x="0" y="${stepY + 24}" width="1280" height="${640 - stepY - 24}" fill="#1d1714"/>
<path d="M0,${stepY + 24}H1280" stroke="#2c241f" stroke-width="2"/>
<rect x="${cx - AR - 60}" y="${stepY}" width="${2 * AR + 120}" height="12" fill="#a89c82"/>
<rect x="${cx - AR - 60}" y="${stepY + 12}" width="${2 * AR + 120}" height="28" fill="url(#stepface)"/>
<path d="M${cx - AR - 60},${stepY + 40}H${cx + AR + 60}" stroke="#14100e" stroke-width="3"/>
${throwLight}
<path d="M${cx - 230},${stepY + 42}H${cx + 230}L${cx + 330},640H${cx - 330}Z" fill="url(#pave)"/>

<text x="1000" y="290" text-anchor="middle" font-family="Optima" font-size="108" letter-spacing="1" fill="${G.cream}">Porchlight</text>
<path d="M${1000 - 150},322H${1000 + 150}" stroke="${G.amberDk}" stroke-width="1.6"/>
<circle cx="${1000 - 14}" cy="322" r="4.5" fill="${G.rubyLt}"/><circle cx="1000" cy="322" r="4.5" fill="${G.gold}"/><circle cx="${1000 + 14}" cy="322" r="4.5" fill="${G.blueLt}"/>
<text x="1000" y="378" text-anchor="middle" font-family="Optima" font-style="italic" font-size="31" fill="${G.muted}">A light left on over</text>
<text x="1000" y="416" text-anchor="middle" font-family="Optima" font-style="italic" font-size="31" fill="${G.muted}">your own front door.</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 11 Stained glass

A leaded fanlight over a front door: panes radiate like a sunrise from a small glass lantern at the hub, warm near the light and jewel-toned at the rim, with a border of clear panes and small jewels. The hero throws the fanlight's colours onto the step.
Palette: came #2a2724, amber #f1b453 / gold #f6cf7c / hot #fbe6aa, ruby #a52331, blue #1f417c, green #1f5c40, door #1b2a3a, stone #6f695e, brick #35221e.
Type: Optima, regular for the name and italic for the tagline.
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
