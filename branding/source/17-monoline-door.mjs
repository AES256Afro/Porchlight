// 17 Monoline door: one path draws the ground, an arched front door with its
// spoked fanlight and lever handle, and a wall lantern on a bracket; the line
// then runs on as the ground the name stands on. One amber dot is the bulb.
// Built from true arcs: arch 30, lantern cap 16, corners 10 and 6.
// Where a stroke has to double back (fanlight bar, handle, finial, bracket)
// it retraces itself exactly, so it still reads, and animates, as one line.
import { svg, writeConcept } from '../lib/svg.mjs';
import { Grid } from '../lib/pixel.mjs';

const SLUG = '17-monoline-door';
const C = {
  paper: '#f6f1e7',
  char: '#26282b',
  night: '#1c1e21',
  cream: '#efe7d8',
  amber: '#f2a234',
  amberNight: '#ffb547',
  dim: '#a9a296',
};
const SANS = `font-family="'Avenir Next', 'Avenir', sans-serif" font-weight="600"`;
const SANS_REG = `font-family="'Avenir Next', 'Avenir', sans-serif" font-weight="400"`;

// Design units: 200 box, figure centred. GROUND is the y of the ground line.
const DX = -1;
const DY = -8;
const GROUND = 162 + DY;
const BULB = [152 + DX, 91 + DY, 7];

function linePath({ s = 1, tx = 0, ty = 0, groundTo = 182 + DX } = {}) {
  const X = (x) => +(tx + s * (x + DX)).toFixed(2);
  const Y = (y) => +(ty + s * (y + DY)).toFixed(2);
  const R = (r) => +(s * r).toFixed(2);
  const A = (r, sweep, x, y) => `A${R(r)} ${R(r)} 0 0 ${sweep} ${X(x)} ${Y(y)}`;
  const gx = +(tx + s * groundTo).toFixed(2);
  return [
    `M${X(20)} ${Y(162)}H${X(50)}`, // ground, left
    A(10, 0, 60, 152), // up into the left jamb
    `V${Y(80)}`,
    A(30, 1, 120, 80), // the arch
    // fanlight: bar to the hub, two spokes out to the arch and back, bar on
    `H${X(90)}L${X(105)} ${Y(54.02)}L${X(90)} ${Y(80)}L${X(75)} ${Y(54.02)}L${X(90)} ${Y(80)}`,
    `H${X(60)}H${X(120)}`,
    `V${Y(116)}`, // right jamb down to the bracket
    `H${X(146)}`, // bracket arm
    A(6, 0, 152, 110),
    `V${Y(106)}`, // into the lantern's foot
    `H${X(142)}`,
    A(6, 1, 136, 100),
    `V${Y(76)}`, // cage, left side
    A(16, 1, 152, 60), // cap, left half
    `V${Y(54)}V${Y(60)}`, // finial (and back)
    A(16, 1, 168, 76), // cap, right half
    `H${X(136)}H${X(168)}`, // cap's rim (and back)
    `V${Y(100)}`, // cage, right side
    A(6, 1, 162, 106),
    `H${X(152)}`, // foot closed
    `V${Y(110)}`,
    A(6, 1, 146, 116), // back along the bracket
    `H${X(120)}`,
    `V${Y(130)}H${X(108)}H${X(120)}`, // lever handle (and back)
    `V${Y(152)}`,
    A(10, 0, 130, 162), // out onto the ground
    `H${gx}`,
  ].join('');
}

function figure({ s = 1, tx = 0, ty = 0, sw = 7.5, line, dot, groundTo }) {
  const d = linePath({ s, tx, ty, groundTo });
  const [bx, by, br] = BULB;
  return `<path d="${d}" fill="none" stroke="${line}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${+(tx + s * bx).toFixed(2)}" cy="${+(ty + s * by).toFixed(2)}" r="${+(s * br).toFixed(2)}" fill="${dot}"/>`;
}

// ---- mark -----------------------------------------------------------------
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: figure({ line: C.char, dot: C.amber }) });
const markDarkSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 200 200',
  body: `<rect width="200" height="200" fill="${C.night}"/>${figure({ line: C.cream, dot: C.amberNight })}`,
});

// ---- favicon: hand-placed pixels on the 16 grid ------------------------------
// Stepped arch with a handle nub, the lantern as an outlined box with a 2x2
// amber bulb on its bracket, the ground line; on the dark tile.
const FAV16 = [
  '..nnnnnnnnnnnn..',
  '.nnnnnnnnnnnnnn.',
  'nnnnnnnnnnnnnnnn',
  'nnnnnccnnnnccnnn',
  'nnnncnncnnccccnn',
  'nnncnnnncncnncnn',
  'nnncnnnncncaacnn',
  'nnncnnnncncaacnn',
  'nnncnnnncncnncnn',
  'nnncnnnccnccccnn',
  'nnncnnnncnncnnnn',
  'nnncnnnnccccnnnn',
  'nnncnnnncnnnnnnn',
  'nccccccccccccccn',
  '.nnnnnnnnnnnnnn.',
  '..nnnnnnnnnnnn..',
];
const favSvg = svg({
  w: 16,
  h: 16,
  vb: '0 0 16 16',
  crisp: true,
  body: new Grid(16, 16).stamp(FAV16, { n: C.night, c: C.cream, a: C.amberNight }).toPaths(),
});
const fav32Svg = svg({
  w: 32,
  h: 32,
  vb: '0 0 32 32',
  body: `
  <rect width="32" height="32" rx="7" fill="${C.night}"/>
  <g fill="none" stroke="${C.cream}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 27H6a1 1 0 0 0 1-1V13a5 5 0 0 1 10 0V26a1 1 0 0 0 1 1H29"/>
    <path d="M17 19.5H14.5"/>
    <path d="M17 24H24V22"/>
    <path d="M21 14V21H27V14Z"/>
    <path d="M24 8.5V6.5"/>
  </g>
  <path d="M20.5 12a3.5 3.5 0 0 1 7 0z" fill="${C.cream}"/>
  <circle cx="24" cy="17.5" r="1.8" fill="${C.amberNight}"/>`,
});

// ---- logo: the ground runs on under the name ---------------------------------
const LS = 0.94;
const LTX = 8;
const LTY = 100 - 100 * LS;
const lGround = LTY + LS * GROUND;
const logoBody = (line, dot, ink) =>
  figure({ s: LS, tx: LTX, ty: LTY, sw: 7, line, dot, groundTo: (622 - LTX) / LS }) +
  `<text x="190" y="${(lGround - 3.5 - 9).toFixed(1)}" ${SANS} font-size="56" letter-spacing="5.6" fill="${ink}">PORCHLIGHT</text>`;
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logoBody(C.char, C.amber, C.char) });
const logoDarkSvg = svg({
  w: 640,
  h: 200,
  vb: '0 0 640 200',
  body: `<rect width="640" height="200" fill="${C.night}"/>` + logoBody(C.cream, C.amberNight, C.cream),
});

// ---- icon -----------------------------------------------------------------
const iconSvg = svg({
  w: 512,
  h: 512,
  vb: '0 0 512 512',
  body: `
  <rect width="512" height="512" rx="114" fill="${C.night}"/>
  ${figure({ s: 2.1, tx: 256 - 100 * 2.1, ty: 256 - 100 * 2.1, sw: 16, line: C.cream, dot: C.amberNight })}`,
});

// ---- hero -----------------------------------------------------------------
const HS = 2.55;
const HTX = 96 - 15 * HS;
const HTY = 422 - GROUND * HS;
const hGround = HTY + GROUND * HS;
const heroSvg = svg({
  w: 1280,
  h: 640,
  vb: '0 0 1280 640',
  body: `
  <rect width="1280" height="640" fill="${C.night}"/>
  ${figure({ s: HS, tx: HTX, ty: HTY, sw: 10, line: C.cream, dot: C.amberNight, groundTo: (1196 - HTX) / HS })}
  <text x="560" y="${(hGround - 5 - 16).toFixed(1)}" ${SANS} font-size="86" letter-spacing="8.6" fill="${C.cream}">PORCHLIGHT</text>
  <text x="562" y="${(hGround + 60).toFixed(1)}" ${SANS_REG} font-size="28" letter-spacing="0.4" fill="${C.dim}">A light left on over your own front door.</text>`,
});

const notes = `# 17 Monoline door

One line draws the path to an arched front door (with its spoked fanlight and lever handle), climbs into a caged wall lantern on its bracket, and runs on as the ground the name stands on; a single amber dot is the bulb. True arcs with shared radii, round caps, and a stroke matched to the wordmark's stems; where it doubles back it retraces itself exactly, so it could be drawn (or animated) in one pass.
Palette: charcoal #26282b on paper #f6f1e7, amber #f2a234; dark: night #1c1e21, cream line #efe7d8, amber #ffb547.
Type: Avenir Next Demi Bold capitals, tracked +0.1 em, standing on the line; tagline in Avenir Next Regular. Dark variants: mark-dark.svg, logo-dark.svg.
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
