// 18 Neon sign: "Porchlight" bent in amber tube from hand-drawn centre lines
// (not a font outline), a coral porch-bulb with an amber filament, mounted
// on dark brick over the front door with standoffs, a transformer and its
// cable. Glow is the same tube paths stroked wider at falling opacity.
import { svg, writeConcept, rng } from '../lib/svg.mjs';
import { Grid } from '../lib/pixel.mjs';

const SLUG = '18-neon-sign';
const C = {
  brick: ['#3a231e', '#3f2620', '#35201b', '#452a22', '#3a2420', '#2f1c18', '#48302a', '#3c2520'],
  mortar: '#1a1311',
  amber: '#ffae45',
  amberCore: '#fff4dc',
  coral: '#ff7657',
  coralCore: '#ffe6dc',
  glassOff: '#4a3a34',
  steel: '#3b3f42',
  night: '#1d1412',
};
const SLANT = Math.tan((10 * Math.PI) / 180);

// ---- path helpers: absolute M/L/C only ---------------------------------------
function parse(d) {
  const out = [];
  const re = /([MLC])([^MLC]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    out.push({ cmd: m[1], nums });
  }
  return out;
}
function mapPath(d, f) {
  return parse(d)
    .map(({ cmd, nums }) => {
      const pts = [];
      for (let i = 0; i < nums.length; i += 2) {
        const [x, y] = f(nums[i], nums[i + 1]);
        pts.push(`${+x.toFixed(2)} ${+y.toFixed(2)}`);
      }
      return cmd + pts.join(' ');
    })
    .join('');
}
function pathLength(d) {
  let len = 0;
  let px = 0;
  let py = 0;
  for (const { cmd, nums } of parse(d)) {
    if (cmd === 'M') [px, py] = nums;
    else if (cmd === 'L') {
      for (let i = 0; i < nums.length; i += 2) {
        len += Math.hypot(nums[i] - px, nums[i + 1] - py);
        [px, py] = [nums[i], nums[i + 1]];
      }
    } else if (cmd === 'C') {
      for (let i = 0; i < nums.length; i += 6) {
        const [x1, y1, x2, y2, x, y] = nums.slice(i, i + 6);
        let lx = px;
        let ly = py;
        for (let k = 1; k <= 48; k++) {
          const t = k / 48;
          const u = 1 - t;
          const bx = u * u * u * px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x;
          const by = u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y;
          len += Math.hypot(bx - lx, by - ly);
          lx = bx;
          ly = by;
        }
        [px, py] = [x, y];
      }
    }
  }
  return len;
}

// ---- the letters: centre lines, baseline 0, x-height 52, caps 114 -------------
const GLYPHS = {
  P: { w: 88, d: ['M24 -56C30 -52 38 -50 48 -50C70 -50 88 -61 88 -81C88 -100 70 -114 40 -114C28 -114 21 -110 21 -104C21 -80 19 -40 16 0'] },
  o: { w: 44, d: ['M24 0C36 0 44 -11 44 -26C44 -42 34 -52 22 -52C9 -52 0 -40 0 -26C0 -13 6 -5 13 -2'] },
  r: { w: 34, d: ['M4 0C4 -18 4 -34 4 -42C4 -50 10 -54 18 -54C26 -54 31 -50 33 -44'] },
  c: { w: 43, d: ['M42 -42C37 -50 30 -53 22 -53C8 -53 0 -40 0 -26C0 -10 9 0 22 0C31 0 38 -4 43 -10'] },
  h: {
    w: 61,
    d: ['M0 -100C4 -111 10 -114 12 -104C13 -80 11 -30 10 0', 'M11 -31C16 -46 25 -54 35 -54C46 -54 53 -47 53 -34L53 -8C53 -2 56 1 62 0'],
  },
  l: { w: 22, d: ['M0 -100C4 -111 11 -114 13 -104C14 -80 12 -30 12 -10C12 -2 16 1 23 0'] },
  i: { w: 14, d: ['M4 -50C4 -30 3 -14 3 -8C3 -2 7 1 14 0', 'M4 -75L7 -73'] },
  g: {
    w: 46,
    d: ['M40 -44C34 -51 28 -53 22 -53C8 -53 0 -40 0 -27C0 -12 9 -4 20 -4C31 -4 40 -12 42 -24', 'M45 -52C45 -30 45 0 44 20C43 40 32 50 18 50C6 50 -2 44 -4 36'],
  },
  t: { w: 22, d: ['M8 -84C8 -50 7 -20 7 -8C7 -2 11 1 18 0', 'M-4 -52L22 -54'] },
};
const KERN = { Po: 16, or: 14, rc: 10, ch: 14, hl: 13, li: 13, ig: 14, gh: 17, ht: 14 };
// standoff positions (glyph-local), one or two per long stroke
const SUPPORTS = { P: [[20, -30], [84, -90]], h: [[11, -66]], l: [[13, -60]], g: [[45, -10]], t: [[8, -30]], o: [[44, -30]], c: [[0, -26]] };

function layoutWord(word) {
  let x = 0;
  const paths = [];
  const supports = [];
  [...word].forEach((ch, i) => {
    const g = GLYPHS[ch];
    const sk = (px, py) => [px + x - py * SLANT, py];
    for (const d of g.d) paths.push(mapPath(d, sk));
    for (const [sx, sy] of SUPPORTS[ch] || []) supports.push(sk(sx, sy));
    const next = word[i + 1];
    x += g.w + (next ? KERN[ch + next] ?? 14 : 0);
  });
  return { paths, supports, width: x };
}

// The porch bulb (coral globe, amber filament), centred on 0,0; ~ -66..54
const BULB = {
  coral: [
    'M-12 22C-12 10 -34 0 -34 -26C-34 -52 -18 -66 0 -66C18 -66 34 -52 34 -26C34 0 12 10 12 22',
    'M-14 32L14 32',
    'M-11 42L11 42',
    'M-5 52L5 52',
  ],
  amber: ['M-6 20L-6 -10C-6 -20 0 -22 0 -13C0 -22 6 -20 6 -10L6 20'],
  rays: ['M-46 -60L-54 -68', 'M0 -80L0 -91', 'M46 -60L54 -68'],
};

// ---- rendering a tube -----------------------------------------------------------
// glow layers: [width, opacity] from wide to narrow; groups are opaque inside
// so overlapping strokes do not stack into blotches.
const GLOW = [
  [128, 0.035],
  [92, 0.045],
  [64, 0.06],
  [44, 0.085],
  [30, 0.12],
  [20, 0.2],
  [14, 0.3],
];
// the glow layers are softened a little so the steps between them blend
const GLOW_FILTER = `<filter id="nglow" filterUnits="userSpaceOnUse" x="-3000" y="-3000" width="6000" height="6000"><feGaussianBlur stdDeviation="3.5"/></filter>`;
function tubeSet(paths, color, core, { w = 8, electrode = 5, glow = GLOW, scaleW = 1, before = '' } = {}) {
  const cap = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  let s = `<g filter="url(#nglow)" style="mix-blend-mode:screen">`;
  for (const [gw, op] of glow) {
    s += `<g opacity="${op}">${paths.map((d) => `<path d="${d}" ${cap} stroke="${color}" stroke-width="${gw * scaleW}"/>`).join('')}</g>`;
  }
  s += '</g>' + before;
  // unlit glass and electrode ends, then the lit gas, then the hot core
  s += paths.map((d) => `<path d="${d}" ${cap} stroke="${C.glassOff}" stroke-width="${w * scaleW}"/>`).join('');
  for (const d of paths) {
    const L = pathLength(d);
    const e = Math.min(electrode, L * 0.2);
    const dash = `stroke-dasharray="${(L - 2 * e).toFixed(2)} ${(2 * e + 1).toFixed(2)}" stroke-dashoffset="${(-e).toFixed(2)}"`;
    s += `<path d="${d}" ${cap} stroke="${color}" stroke-width="${w * scaleW}" ${dash}/>`;
    s += `<path d="${d}" ${cap} stroke="${core}" stroke-width="${w * 0.38 * scaleW}" ${dash}/>`;
  }
  return s;
}
// standoffs: small glass-and-steel barrels on the wall, lit from the tube
function supportsSvg(pts, r = 6.5) {
  return pts
    .map(
      ([x, y]) =>
        `<circle cx="${(x + 1.2).toFixed(1)}" cy="${(y + 1.6).toFixed(1)}" r="${r}" fill="#140d0b" opacity=".7"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#3a302c"/>` +
        `<path d="M${(x - r * 0.8).toFixed(1)} ${(y - r * 0.2).toFixed(1)}A${r * 0.85} ${r * 0.85} 0 0 1 ${(x + r * 0.3).toFixed(1)} ${(y - r * 0.8).toFixed(1)}" fill="none" stroke="#d79a58" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>`,
    )
    .join('');
}
function clipsSvg(pts, w = 8) {
  // the wire tie over the tube at each standoff
  return pts
    .map(([x, y]) => `<path d="M${(x - w * 0.75).toFixed(1)} ${(y + 1).toFixed(1)}L${(x + w * 0.75).toFixed(1)} ${(y - 1).toFixed(1)}" stroke="#2b2421" stroke-width="1.6" stroke-linecap="round"/>`)
    .join('');
}

function wordSvg({ glow = GLOW, supports = true } = {}) {
  const { paths, supports: sp } = layoutWord('Porchlight');
  return tubeSet(paths, C.amber, C.amberCore, { glow, before: supports ? supportsSvg(sp) : '' });
}
function bulbSvg({ glow = GLOW, rays = true, w = 8 } = {}) {
  const coral = [...BULB.coral, ...(rays ? BULB.rays : [])];
  return (
    tubeSet(coral, C.coral, C.coralCore, { glow, w, electrode: 5 }) +
    tubeSet(BULB.amber, C.amber, C.amberCore, { glow: glow.slice(2), w: w * 0.8, electrode: 4 })
  );
}

// ---- brick ---------------------------------------------------------------------
function brickWall(W, H, { bw = 76, bh = 24, m = 5, seed = 7, x0 = 0, y0 = 0 } = {}) {
  const r = rng(seed);
  let s = `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${C.mortar}"/>`;
  const rows = Math.ceil(H / (bh + m)) + 1;
  for (let j = 0; j < rows; j++) {
    const y = y0 + j * (bh + m) - 3;
    const off = j % 2 ? -bw / 2 : 0;
    for (let x = x0 + off - m; x < x0 + W; x += bw + m) {
      const c = C.brick[Math.floor(r() * C.brick.length)];
      const ww = bw - Math.round(r() * 2);
      s += `<rect x="${x.toFixed(1)}" y="${y}" width="${ww}" height="${bh}" rx="1.6" fill="${c}"/>`;
      s += `<path d="M${(x + 2).toFixed(1)} ${y + 1}H${(x + ww - 2).toFixed(1)}" stroke="#5a3a30" stroke-width="1" opacity="${(0.25 + r() * 0.35).toFixed(2)}"/>`;
      if (r() < 0.12) {
        // a chipped corner
        const cx = r() < 0.5 ? x : x + ww;
        const dir = cx === x ? 1 : -1;
        s += `<path d="M${cx.toFixed(1)} ${y + bh}l${dir * (5 + r() * 6)} 0l${-dir * (5 + r() * 4)} ${-(4 + r() * 5)}z" fill="${C.mortar}"/>`;
      }
      if (r() < 0.25) {
        s += `<circle cx="${(x + 8 + r() * (ww - 16)).toFixed(1)}" cy="${(y + 5 + r() * (bh - 10)).toFixed(1)}" r="${(0.8 + r() * 1.2).toFixed(1)}" fill="#24160f" opacity=".7"/>`;
      }
    }
  }
  return s;
}

// ---- hero ----------------------------------------------------------------------
const WS = 1.32; // word scale in the hero
const word = layoutWord('Porchlight');
const heroWordX = 344;
const heroBaseY = 318;
const heroDefs = GLOW_FILTER + `
  <radialGradient id="vig" cx="50%" cy="46%" r="72%">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity=".55"/>
  </radialGradient>
  <linearGradient id="box" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4a4f53"/><stop offset="1" stop-color="#2c2f32"/>
  </linearGradient>
  <linearGradient id="casing" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8f7462"/><stop offset="1" stop-color="#5b4a40"/>
  </linearGradient>`;

const tagline = (() => {
  const t = 'A light left on over your own front door.';
  const font = `font-family="'Arial Rounded MT Bold', 'Arial Rounded MT', 'Avenir Next', sans-serif" font-size="25" letter-spacing="1.4" text-anchor="middle"`;
  const at = `x="648" y="470"`;
  return `
  <g opacity=".07" style="mix-blend-mode:screen"><text ${at} ${font} fill="${C.coral}" stroke="${C.coral}" stroke-width="34" stroke-linejoin="round">${t}</text></g>
  <g opacity=".12" style="mix-blend-mode:screen"><text ${at} ${font} fill="${C.coral}" stroke="${C.coral}" stroke-width="16" stroke-linejoin="round">${t}</text></g>
  <g opacity=".35" style="mix-blend-mode:screen"><text ${at} ${font} fill="${C.coral}" stroke="${C.coral}" stroke-width="7" stroke-linejoin="round">${t}</text></g>
  <text ${at} ${font} fill="${C.coral}" stroke="${C.coral}" stroke-width="2.2" stroke-linejoin="round">${t}</text>
  <text ${at} ${font} fill="${C.coralCore}">${t}</text>`;
})();

const heroSvg = svg({
  w: 1280,
  h: 640,
  vb: '0 0 1280 640',
  defs: heroDefs,
  body: `
  ${brickWall(1280, 640)}
  <rect width="1280" height="640" fill="#0d0706" opacity=".38"/>
  <rect width="1280" height="640" fill="url(#vig)"/>
  <!-- the top of the front door below the sign -->
  <rect x="460" y="566" width="376" height="20" fill="url(#casing)"/>
  <rect x="452" y="560" width="392" height="7" rx="1.5" fill="#a88a73"/>
  <rect x="452" y="567" width="392" height="3" fill="#3a2c25" opacity=".6"/>
  <rect x="460" y="586" width="34" height="54" fill="#5e4c42"/>
  <rect x="802" y="586" width="34" height="54" fill="#5e4c42"/>
  <rect x="494" y="586" width="308" height="54" fill="#15282a"/>
  <rect x="494" y="586" width="308" height="6" fill="#0c1718"/>
  <rect x="520" y="604" width="256" height="36" rx="10" fill="none" stroke="#1d3537" stroke-width="3"/>
  <!-- transformer and cable -->
  <path d="M1108 480C1108 432 1092 412 1076 398C1064 387 1058 372 1058 352" fill="none" stroke="#0e0b0a" stroke-width="7" stroke-linecap="round"/>
  <path d="M1106 476C1106 434 1091 415 1075 401" fill="none" stroke="#3c3331" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>
  <rect x="1078" y="414" width="12" height="7" rx="1.5" fill="#55504c" transform="rotate(42 1084 417)"/>
  <circle cx="1058" cy="350" r="7" fill="#151110"/><circle cx="1057" cy="349" r="3.4" fill="#2c2624"/>
  <g>
    <rect x="1070" y="478" width="118" height="78" rx="4" fill="url(#box)"/>
    <rect x="1070" y="478" width="118" height="3" rx="1.5" fill="#6a7074"/>
    <rect x="1086" y="496" width="58" height="22" rx="2" fill="#c9bfa8" opacity=".75"/>
    <path d="M1092 503H1136M1092 509H1124M1092 514H1130" stroke="#3b3a36" stroke-width="1.6" opacity=".7"/>
    ${[[1078, 486], [1180, 486], [1078, 548], [1180, 548]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#24272a"/><circle cx="${x - 0.6}" cy="${y - 0.6}" r="1" fill="#7a8084"/>`).join('')}
    <rect x="1096" y="556" width="14" height="10" fill="#202325"/>
  </g>
  <!-- the sign -->
  <g transform="translate(${heroWordX} ${heroBaseY}) scale(${WS})">${wordSvg()}</g>
  <g transform="translate(262 300) scale(1.3)">${bulbSvg()}</g>
  ${tagline}`,
});

// ---- mark & icon -------------------------------------------------------------------
const markSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: GLOW_FILTER,
  body: `
  <rect width="512" height="512" rx="104" fill="${C.night}"/>
  <g transform="translate(256 262) scale(2.6)">${bulbSvg({ glow: GLOW.slice(1) })}</g>`,
});
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  defs: GLOW_FILTER + `<clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath>
  <radialGradient id="iv" cx="50%" cy="45%" r="70%"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>`,
  body: `
  <g clip-path="url(#tile)">
    ${brickWall(512, 512, { bw: 92, bh: 30, m: 6, seed: 3 })}
    <rect width="512" height="512" fill="#0d0706" opacity=".4"/>
    <rect width="512" height="512" fill="url(#iv)"/>
    <g transform="translate(256 268) scale(2.75)">${bulbSvg({ glow: GLOW.slice(1) })}</g>
  </g>`,
});

// ---- favicon: the bulb alone, hand-placed on the 16 grid ----------------------
// 1px coral tube on whole pixels, a 1px darker coral halo outside it, a 2px
// amber filament and two base threads; no blur at this size.
const FAV16 = [
  '..nnnnnnnnnnnn..',
  '.nnnnnhhhhnnnnn.',
  'nnnnnhcccchnnnnn',
  'nnnnhcnnnnchnnnn',
  'nnnhcnnnnnnchnnn',
  'nnnhcnnnnnnchnnn',
  'nnnhcnnaannchnnn',
  'nnnhcnnnnnnchnnn',
  'nnnnhcnnnnchnnnn',
  'nnnnnhcnnchnnnnn',
  'nnnnnhcnnchnnnnn',
  'nnnnnhcccchnnnnn',
  'nnnnnnhhhhnnnnnn',
  'nnnnnnhcchnnnnnn',
  '.nnnnnnhhnnnnnn.',
  '..nnnnnnnnnnnn..',
];
const favSvg = svg({
  w: 16,
  h: 16,
  vb: '0 0 16 16',
  crisp: true,
  body: new Grid(16, 16).stamp(FAV16, { n: C.night, c: C.coral, h: '#55221a', a: C.amber }).toPaths(),
});
const fav32Svg = svg({
  w: 32,
  h: 32,
  vb: '0 0 32 32',
  defs: GLOW_FILTER,
  body: `
  <rect width="32" height="32" rx="7" fill="${C.night}"/>
  <g transform="translate(16 17.4) scale(0.205)">${bulbSvg({ glow: [[40, 0.12], [22, 0.28]], rays: false, w: 11 })}</g>`,
});

// ---- logo: a sign panel -------------------------------------------------------------
const LWS = 0.76;
const logoSvg = svg({
  w: 640,
  h: 200,
  vb: '0 0 640 200',
  defs: GLOW_FILTER + `<clipPath id="panel"><rect x="4" y="4" width="632" height="192" rx="22"/></clipPath>`,
  body: `
  <g clip-path="url(#panel)">
    <rect x="4" y="4" width="632" height="192" fill="${C.night}"/>
    <g transform="translate(92 106) scale(0.92)">${bulbSvg({ glow: GLOW.slice(1) })}</g>
    <g transform="translate(176 124) scale(${LWS})">${wordSvg({ glow: GLOW.slice(1) })}</g>
  </g>`,
});

const notes = `# 18 Neon sign

"Porchlight" bent in amber tube from hand-drawn centre lines, beside a coral porch bulb with an amber filament, mounted on dark brick over the front door with standoffs, a transformer and its cable; tube ends go dark at the electrodes. The glow is the tube paths themselves stroked wider at falling opacity, so it follows the letters.
Palette: amber tube #ffae45 (core #fff4dc), coral tube #ff7657 (core #ffe6dc), brick #3a231e to #48302a, mortar #1a1311, night #1d1412.
Type: hand-constructed monoline script for the name; tagline in Arial Rounded MT Bold, treated as tube.
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
console.log('word width', word.width);
