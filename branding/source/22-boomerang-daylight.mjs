// 22 Boomerang (daylight): the atomic style on a light page. Cream paper with a
// Formica scatter of boomerangs and starbursts, the name in sign-painter's
// script, and a small mid-century house front whose globe hangs from a
// boomerang bracket beside the door.
import { svg, nest, writeConcept, rng } from '../lib/svg.mjs';

const SLUG = '22-boomerang-daylight';
const C = {
  cream: '#f5ead2',
  tan: '#e9dbb9',
  white: '#fffaf0',
  aqua: '#62c4bb',
  aquaMid: '#46b0a7',
  aquaDk: '#23908b',
  tomato: '#e2472f',
  tomatoDk: '#b93422',
  mustard: '#efb42b',
  glow1: '#fdf1c9',
  glow2: '#fbe196',
  char: '#2a292e',
};
const f = (n) => Math.round(n * 10) / 10;

// ---- pattern parts -------------------------------------------------------------
const BOOM = 'M-46,28C-44,0 -24,-26 4,-30C30,-33 52,-18 60,6C62,13 55,17 50,12C40,-4 24,-10 6,-8C-14,-5 -28,10 -36,30C-39,37 -47,35 -46,28Z';
function boom(cx, cy, sc, rot, fill) {
  return `<path d="${BOOM}" transform="translate(${f(cx)} ${f(cy)}) rotate(${rot}) scale(${sc})" fill="${fill}"/>`;
}
function boomLine(cx, cy, sc, rot, stroke, w = 2.4) {
  return `<path d="${BOOM}" transform="translate(${f(cx)} ${f(cy)}) rotate(${rot}) scale(${sc})" fill="none" stroke="${stroke}" stroke-width="${w}" vector-effect="non-scaling-stroke"/>`;
}
// atomic starburst: crossed lines, the long ones tipped with dots
function lineStar(cx, cy, r, stroke, w = 2.2, rot = 0) {
  let d = '';
  let dots = '';
  for (let i = 0; i < 8; i++) {
    const a = ((i * 22.5 + rot) * Math.PI) / 180;
    const len = i % 2 ? r * 0.55 : r;
    const c = Math.cos(a) * len;
    const s = Math.sin(a) * len;
    d += `M${f(cx - c)},${f(cy - s)}L${f(cx + c)},${f(cy + s)}`;
    if (i % 4 === 0) dots += `<circle cx="${f(cx - c)}" cy="${f(cy - s)}" r="${f(w * 1.3)}" fill="${stroke}"/><circle cx="${f(cx + c)}" cy="${f(cy + s)}" r="${f(w * 1.3)}" fill="${stroke}"/>`;
  }
  return `<path d="${d}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>${dots}`;
}
// tapered rays: [angleDeg, r0, r1, halfWidth]
function rays(cx, cy, list, fill) {
  const d = list
    .map(([a, r0, r1, w]) => {
      const r = (a * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      return `M${f(cx + c * r0 - s * w)},${f(cy + s * r0 + c * w)}L${f(cx + c * r1)},${f(cy + s * r1)}L${f(cx + c * r0 + s * w)},${f(cy + s * r0 - c * w)}Z`;
    })
    .join('');
  return `<path d="${d}" fill="${fill}"/>`;
}
const ring = (n, r0, long, short, w, skip = () => false, off = 0) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n + off;
    if (!skip(a, i)) out.push([a, r0, i % 2 ? short : long, w]);
  }
  return out;
};

// ---- mark: a boomerang bracket holding a lit globe ------------------------------
const ARM = 'M22,188C30,110 50,48 90,30C124,16 158,28 178,58C183,66 175,73 168,67C152,52 128,50 108,62C78,82 58,132 42,190C38,200 20,198 22,188Z';
function markBody({ arm = C.aquaDk, armHi = C.aqua, ray = C.tomato } = {}) {
  return `
${rays(150, 124, ring(12, 33, 50, 41, 3.6, (a) => a > 240 && a < 318, -90), ray)}
<path d="M168,64L153,100" stroke="${arm}" stroke-width="4.5" stroke-linecap="round"/>
<path d="${ARM}" fill="${arm}"/>
<path d="M36,178C46,116 62,62 96,42C122,28 148,36 164,54" fill="none" stroke="${armHi}" stroke-width="4.5" stroke-linecap="round"/>
<circle cx="150" cy="124" r="26" fill="${C.mustard}"/>
<circle cx="142" cy="115" r="8" fill="${C.glow1}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });
const markDarkSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody({ arm: C.aqua, armHi: '#a6e3dc' }) });

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { T: C.aquaDk, t: C.aqua, R: C.tomato, M: C.mustard, H: C.glow1 };
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
  '......TTTTT.....',
  '....TTTTTTTTT...',
  '...TTTT....TTT..',
  '..TTTT.......T..',
  '..TTT....R..T.R.',
  '..TTT.....MMM...',
  '.TTT.....MMMMM..',
  '.TTT....RMHMMMR.',
  '.TTT.....MMMMM..',
  '.TT.......MMM...',
  '.TT......R...R..',
  '.TT.........R...',
  '.TT.............',
  '.T..............',
  '.T..............',
];
const FAV32 = [
  '................................',
  '...........TTTTTTTT.............',
  '.........TTTTTTTTTTTT...........',
  '.......TTTTTTTTTTTTTTTT.........',
  '......TTTTTTTT....TTTTTT........',
  '.....TTTTTTT........TTTTT.......',
  '.....TTTTTT...........TTTT......',
  '....TTTTTT.............TTT......',
  '....TTTTT...............T.......',
  '...TTTTTT..............TT.......',
  '...TTTTT........R......T.....R..',
  '...TTTTT.........R.....T....R...',
  '...TTTTT..........R.MMMMMM.R....',
  '..TTTTT............MMMMMMMM.....',
  '..TTTTT...........MMMMMMMMMM....',
  '..TTTTT..........MMMHHMMMMMMM...',
  '..TTTTT......RRR.MMHHHMMMMMMM.RR',
  '..TTTT...........MMMHMMMMMMMM...',
  '..TTTT...........MMMMMMMMMMMM...',
  '..TTTT............MMMMMMMMMM....',
  '..TTTT.............MMMMMMMM.....',
  '.TTTT.............R.MMMMMM.R....',
  '.TTTT............R..........R...',
  '.TTTT...........R.....RR.....R..',
  '.TTT..................RR........',
  '.TTT..................RR........',
  '.TTT............................',
  '.TTT............................',
  '.TT.............................',
  '.TT.............................',
  '.TT.............................',
  '................................',
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
<rect width="512" height="512" fill="${C.aqua}"/>
${boom(92, 86, 1.25, -24, C.aquaMid)}${boom(452, 152, 1.05, 62, C.aquaMid)}${boom(84, 452, 1.1, 150, C.aquaMid)}${boom(300, 478, 0.9, 24, C.aquaMid)}
${lineStar(424, 64, 26, C.white, 3, 10)}${lineStar(48, 268, 18, C.white, 2.6, 0)}${lineStar(452, 430, 20, C.white, 2.8, 20)}
<circle cx="343" cy="296" r="150" fill="#8ad6ce"/>
<circle cx="343" cy="296" r="106" fill="#b6e6df"/>
${nest({ x: 46, y: 46, w: 420, h: 420, vb: '0 0 200 200', body: markBody({ arm: C.char, armHi: '#57555c', ray: C.tomato }) })}
</g>`,
});

// ---- logo ----------------------------------------------------------------------
function logo(dark) {
  const ink = dark ? C.cream : C.char;
  return `
${nest({ x: 14, y: 12, w: 172, h: 172, vb: '0 0 200 200', body: dark ? markBody({ arm: C.aqua, armHi: '#a6e3dc' }) : markBody() })}
<text x="206" y="122" font-family="SignPainter" font-size="122" fill="${dark ? C.tomato : C.aqua}" transform="translate(4.5 4.5)">Porchlight</text>
<text x="206" y="122" font-family="SignPainter" font-size="122" fill="${ink}">Porchlight</text>
<path d="M214,146C290,139 380,137 452,142" fill="none" stroke="${C.tomato}" stroke-width="5" stroke-linecap="round"/>
<path d="M536,144C560,143 584,144 606,147" fill="none" stroke="${C.tomato}" stroke-width="5" stroke-linecap="round"/>
<text x="216" y="176" font-family="Futura" font-weight="500" font-size="14" letter-spacing="5" fill="${ink}">LEAVE THE LIGHT ON.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero ----------------------------------------------------------------------
function hero() {
  const r = rng(22);
  // pale Formica scatter over the whole sheet, on a loose grid
  let pale = '';
  for (let gy = 0; gy < 5; gy++)
    for (let gx = 0; gx < 10; gx++) {
      const x = 64 + gx * 128 + (gy % 2 ? 64 : 0) + (r() - 0.5) * 40;
      const y = 60 + gy * 130 + (r() - 0.5) * 36;
      const k = r();
      const rot = Math.round(r() * 360);
      if (x > 40 && x < 660 && y > 176 && y < 520) continue; // keep the lettering clear
      if (k < 0.45) pale += boom(x, y, 0.62 + r() * 0.3, rot, C.tan);
      else if (k < 0.7) pale += boomLine(x, y, 0.55 + r() * 0.25, rot, C.tan, 2.4);
      else if (k < 0.9) pale += lineStar(x, y, 15 + r() * 8, C.tan, 2, rot);
      else pale += `<circle cx="${f(x)}" cy="${f(y)}" r="5" fill="${C.tan}"/><circle cx="${f(x + 16)}" cy="${f(y + 8)}" r="3" fill="${C.tan}"/>`;
    }
  const accents = `
${boom(138, 96, 1.0, -22, C.tomato)}${boomLine(150, 108, 1.0, -22, C.char, 2.2)}
${boom(452, 86, 0.8, 38, C.aqua)}
${lineStar(292, 112, 22, C.char, 2.2, 8)}
${lineStar(560, 122, 16, C.mustard, 2.4, 0)}
${boom(62, 592, 0.9, 158, C.aqua)}${boomLine(52, 582, 0.9, 158, C.char, 2.2)}
${lineStar(214, 582, 18, C.tomato, 2.2, 12)}
${boom(410, 574, 0.8, 12, C.mustard)}
${boom(626, 548, 0.7, -64, C.tomato)}
${lineStar(676, 318, 12, C.char, 2, 0)}
${boom(1232, 64, 0.8, 100, C.mustard)}${lineStar(1238, 590, 17, C.char, 2.2, 6)}
${boom(668, 68, 0.6, 200, C.aqua)}`;

  // ---- vignette ----
  const blob = 'M716,318C690,180 812,66 982,74C1132,81 1238,188 1226,336C1216,462 1112,572 960,572C856,572 792,538 782,468C777,430 796,404 776,384C750,360 724,362 716,318Z';
  const G = 486; // ground line
  const roofY = (x) => 268 - (x - 776) * (32 / 414); // underside of the roof slab
  let slats = '';
  for (let i = 0; i < 5; i++) {
    const x = 815 + i * 11;
    slats += `<rect x="${x}" y="${f(roofY(x) + 9)}" width="6.5" height="${f(G - roofY(x) - 9)}" fill="${C.mustard}"/>`;
  }
  const LX = 982;
  const LY = 388;
  const lampRays = ring(16, 22, 96, 60, 3.2, (a) => a > 236 && a < 304, -90);
  const house = `
<clipPath id="blob"><path d="${blob}"/></clipPath>
<clipPath id="wall"><path d="M806,${f(roofY(806))}L1150,${f(roofY(1150))}V${G}H806Z"/></clipPath>
<path d="${blob}" fill="${C.aqua}"/>
<path d="${blob}" fill="none" stroke="${C.char}" stroke-width="2.2" transform="translate(9 9)"/>
<g clip-path="url(#blob)">
  <path d="M600,${G}H1300V640H600Z" fill="${C.aquaMid}"/>
  <path d="M840,112h92a13,13 0 0 1 0,26h-92a13,13 0 0 1 0,-26z" fill="${C.white}"/>
  <path d="M808,134h60a10,10 0 0 1 0,20h-60a10,10 0 0 1 0,-20z" fill="${C.white}"/>
  <path d="M1050,150h84a11,11 0 0 1 0,22h-84a11,11 0 0 1 0,-22z" fill="${C.white}"/>
  <path d="M900,${G + 13}h40l4,11h-48zM890,${G + 31}h60l5,14h-70zM878,${G + 53}h84l6,17h-96z" fill="${C.cream}"/>
</g>
<path d="M806,${f(roofY(806))}L1150,${f(roofY(1150))}V${G}H806Z" fill="${C.white}"/>
<g clip-path="url(#wall)">
  <circle cx="${LX + 8}" cy="${LY}" r="112" fill="${C.glow1}"/>
  <circle cx="${LX + 8}" cy="${LY}" r="70" fill="${C.glow2}"/>
  ${rays(LX + 8, LY, lampRays, C.mustard)}
</g>
${slats}
<rect x="888" y="340" width="64" height="${G - 340}" fill="${C.char}"/>
<rect x="893" y="345" width="54" height="${G - 345}" fill="${C.tomato}"/>
<rect x="901" y="356" width="11" height="11" fill="${C.cream}"/><rect x="914.5" y="371" width="11" height="11" fill="${C.cream}"/><rect x="928" y="386" width="11" height="11" fill="${C.cream}"/>
<circle cx="938" cy="426" r="3.6" fill="${C.mustard}"/>
<rect x="878" y="${G}" width="84" height="8" fill="${C.cream}"/>
<rect x="1008" y="326" width="130" height="114" fill="${C.char}"/>
<rect x="1014" y="332" width="34" height="102" fill="${C.aquaDk}"/><rect x="1054" y="332" width="78" height="102" fill="${C.aquaDk}"/>
<path d="M1054,400L1110,332h14L1054,418zM1092,434l40,-48v16l-27,32z" fill="${C.aquaMid}"/>
<path d="M1014,332h34v10q-17,8 -34,0z" fill="${C.white}"/><path d="M1054,332h78v10q-13,8 -26,0q-13,8 -26,0q-13,8 -26,0z" fill="${C.white}"/>
<path d="M1076,434c-2,-12 2,-18 6,-22c-4,-8 0,-16 4,-13l3,5l5,-6c4,-2 6,6 2,13c6,5 8,14 6,23z" fill="${C.char}"/>
<rect x="1016" y="462" width="116" height="17" rx="2" fill="${C.tomato}"/>
<path d="M1026,479l-5,7M1122,479l5,7M1040,479v7M1108,479v7" stroke="${C.char}" stroke-width="2.4" stroke-linecap="round"/>
<path d="M1030,462l-4,-30l9,30zM1042,462l3,-40l5,40zM1056,462l-2,-28l8,28zM1094,462l2,-34l6,34zM1108,462l6,-26l1,26zM1120,462l5,-20l-1,20z" fill="${C.aquaDk}"/>
<path d="M1068,462l4,-22l4,22zM1082,462l-3,-18l7,18z" fill="${C.mustard}"/>
<path d="${ARM}" transform="translate(945 338) scale(0.26)" fill="${C.char}"/>
<path d="M${LX + 8},356V${LY - 14}" stroke="${C.char}" stroke-width="2.4"/>
<circle cx="${LX + 8}" cy="${LY}" r="15" fill="${C.mustard}"/><circle cx="${LX + 8}" cy="${LY}" r="15" fill="none" stroke="${C.char}" stroke-width="2.2"/>
<circle cx="${LX + 3}" cy="${LY - 5}" r="4.6" fill="${C.white}"/>
<path d="M776,250L1190,218V236L776,268Z" fill="${C.char}"/>
<path d="M776,268L1190,236V243L776,275Z" fill="${C.tomato}"/>
<path d="M1100,226V150M1078,160h44M1083,172h34M1088,184h24" stroke="${C.char}" stroke-width="2.6" stroke-linecap="round"/>
<path d="M1107,159l-9,-7l12,1c2,-8 13,-10 17,-3l6,2l-6,3c-2,6 -11,8 -20,4z" fill="${C.tomato}"/><circle cx="1123" cy="151.500" r="1.1" fill="${C.char}"/>
<path d="M770,${G}H1206" stroke="${C.char}" stroke-width="3" stroke-linecap="round"/>
<path d="M1184,${G}V404" stroke="${C.char}" stroke-width="5" stroke-linecap="round"/>
<circle cx="1176" cy="382" r="30" fill="${C.mustard}"/><circle cx="1196" cy="360" r="22" fill="${C.aquaDk}"/>
<path d="M1184,440l-12,-16M1184,426l12,-14" stroke="${C.char}" stroke-width="3" stroke-linecap="round"/>
<path d="M754,${G}V436" stroke="${C.char}" stroke-width="4.5" stroke-linecap="round"/>
<path d="M736,438v-12a11,11 0 0 1 11,-11h14a11,11 0 0 1 11,11v12z" fill="${C.tomato}"/>
<path d="M772,424V406h10v8h-6" fill="none" stroke="${C.mustard}" stroke-width="3" stroke-linejoin="round"/>`;

  // ---- type ----
  const type = `
<text x="82" y="312" font-family="SignPainter" font-size="162" fill="${C.aqua}" transform="translate(6.5 6.5)">Porchlight</text>
<text x="82" y="312" font-family="SignPainter" font-size="162" fill="${C.char}">Porchlight</text>
<path d="M92,350C196,339 310,335 408,341" fill="none" stroke="${C.tomato}" stroke-width="7.5" stroke-linecap="round"/>
<path d="M514,343C552,341 590,343 624,349" fill="none" stroke="${C.tomato}" stroke-width="7.5" stroke-linecap="round"/>
${lineStar(634, 200, 19, C.tomato, 2.6, 0)}
<path d="M114,412H480L506,441L480,470H114L88,441Z" fill="${C.char}" transform="translate(5 5)"/>
<path d="M114,412H480L506,441L480,470H114L88,441Z" fill="${C.tomato}"/>
<text x="297" y="450" text-anchor="middle" font-family="Futura" font-weight="700" font-size="25" letter-spacing="4.2" fill="${C.cream}">LEAVE THE LIGHT ON.</text>
<text x="94" y="514" font-family="Futura" font-weight="500" font-size="13.5" letter-spacing="4.8" fill="${C.char}">YOUR CODE · YOUR DOMAINS · YOUR MAC</text>`;

  return `
<rect width="1280" height="640" fill="${C.cream}"/>
${pale}
${accents}
${house}
${type}`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 22 Boomerang (daylight)

The atomic style on a light page: cream paper with a Formica scatter of boomerangs and starbursts, the name in sign-painter's script over a broken underline, the tagline on a tomato price-tag lozenge, and a small mid-century house front in an aqua kidney shape. Its globe hangs from a boomerang bracket by the door and its light is a drawn starburst on the wall. The mark is that bracket and globe.
Palette: cream #f5ead2, tan #e9dbb9, aqua #62c4bb / #23908b, tomato #e2472f, mustard #efb42b, charcoal #2a292e.
Type: SignPainter HouseScript for the name, Futura Bold and Medium capitals for the lozenge and the small line.
Tagline: Leave the light on.
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
