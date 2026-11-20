// 23 Sputnik lamp: the porch light as an atomic starburst fixture, glowing over
// a flush mid-century door with three diamond lights. The name is split by the
// door, PORCH on one side and LIGHT on the other, in wide Futura capitals with
// the tagline in sign-painter's script.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '23-sputnik-lamp';
const C = {
  night: '#150f1c',
  floor: '#1b1424',
  wall: '#291d36',
  r1: '#30223e',
  r2: '#3b2846',
  r3: '#4b2f4e',
  r4: '#633853',
  r5: '#874551',
  r6: '#b85c41',
  mustard: '#f2b632',
  hot: '#fff0bd',
  brass: '#d19c3a',
  aqua: '#5cc3b6',
  aquaDk: '#2c8d86',
  cream: '#f5e9cf',
  creamDk: '#d9c9a8',
  persimmon: '#e4572e',
  persimmonLt: '#f47a45',
  persimmonDk: '#a93c20',
};
const f = (n) => Math.round(n * 10) / 10;
const pol = (cx, cy, a, r) => [cx + Math.cos((a * Math.PI) / 180) * r, cy + Math.sin((a * Math.PI) / 180) * r];

// ---- the fixture: brass arms, lit bulbs on the long ones, aqua balls on the short
function sputnik(cx, cy, sc, { rod = true } = {}) {
  let arms = '';
  let tips = '';
  for (let i = 0; i < 16; i++) {
    const a = i * 22.5 - 90;
    if (rod && i === 0) continue;
    const long = i % 2 === 0;
    const [x, y] = pol(cx, cy, a, (long ? 88 : 56) * sc);
    arms += `M${cx},${cy}L${f(x)},${f(y)}`;
    tips += long
      ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(8.4 * sc)}" fill="${C.mustard}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(5 * sc)}" fill="${C.hot}"/>`
      : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(5.6 * sc)}" fill="${C.aqua}"/>`;
  }
  return `<path d="${arms}" stroke="${C.brass}" stroke-width="${f(3.4 * sc)}" stroke-linecap="round"/>
${tips}
<circle cx="${cx}" cy="${cy}" r="${f(14 * sc)}" fill="${C.brass}"/>
<circle cx="${cx}" cy="${cy}" r="${f(9 * sc)}" fill="${C.mustard}"/>
<circle cx="${f(cx - 3 * sc)}" cy="${f(cy - 3 * sc)}" r="${f(3.4 * sc)}" fill="${C.hot}"/>`;
}

// ---- mark: a ball-clock starburst, a door in its lit centre ----------------------
function markBody({ door = C.wall } = {}) {
  let spokes = '';
  let balls = '';
  for (let i = 0; i < 12; i++) {
    const a = i * 30 - 90;
    const long = i % 2 === 0;
    const [x0, y0] = pol(100, 100, a, 40);
    const [x1, y1] = pol(100, 100, a, long ? 84 : 67);
    spokes += `M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}`;
    balls += `<circle cx="${f(x1)}" cy="${f(y1)}" r="${long ? 10.5 : 7.5}" fill="${long ? C.aqua : C.persimmon}"/>`;
  }
  return `
<path d="${spokes}" stroke="${C.persimmon}" stroke-width="5" stroke-linecap="round"/>
${balls}
<circle cx="100" cy="100" r="46" fill="${C.persimmon}"/>
<circle cx="100" cy="100" r="40" fill="${C.mustard}"/>
<path d="M85,131V76H115V131A40,40 0 0 1 85,131Z" fill="${door}"/>
<path d="M100,84L108,93L100,102L92,93Z" fill="${C.hot}"/>
<circle cx="109" cy="111" r="2.6" fill="${C.mustard}"/>`;
}
const markSvg = svg({ w: 512, h: 512, vb: '0 0 200 200', body: markBody() });

// ---- favicons, on the pixel grid ------------------------------------------------
const PIX = { P: C.persimmon, A: C.aqua, a: C.aquaDk, M: C.mustard, H: C.hot, D: C.wall };
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
  '.......AA.......',
  '..P....AA....P..',
  '.PP....PP....PP.',
  '...P.PPPPPP.P...',
  '....PMMMMMMP....',
  '...PMMDDDDMMP...',
  '...PMMDHHDMMP...',
  'AAPPMMDHHDMMPPAA',
  'AAPPMMDDDDMMPPAA',
  '...PMMDDDMMMP...',
  '...PMMDDDDMMP...',
  '....PMDDDDMP....',
  '...P.PPPPPP.P...',
  '.PP....PP....PP.',
  '..P....AA....P..',
  '.......AA.......',
];
const FAV32 = [
  '..............AAAA..............',
  '.............AAAAAA.............',
  '.............AAAAAA.............',
  '......PP......AAAA......PP......',
  '.....PPPP......PP......PPPP.....',
  '.....PPPP......PP......PPPP.....',
  '......PPP......PP......PPP......',
  '........PP...PPPPPP...PP........',
  '.........PPPPPPPPPPPPPP.........',
  '.........PPMMMMMMMMMMPP.........',
  '........PPMMMMMMMMMMMMPP........',
  '.......PPMMMDDDDDDDDMMMPP.......',
  '.......PMMMMDDDDDDDDMMMMP.......',
  '.AAA..PPMMMMDDDHHDDDMMMMPP..AAA.',
  'AAAAA.PPMMMMDDHHHHDDMMMMPP.AAAAA',
  'AAAAAPPPMMMMDDHHHHDDMMMMPPPAAAAA',
  'AAAAAPPPMMMMDDDHHDDDMMMMPPPAAAAA',
  'AAAAA.PPMMMMDDDDDDDDMMMMPP.AAAAA',
  '.AAA..PPMMMMDDDDDDMDMMMMPP..AAA.',
  '.......PMMMMDDDDDDDDMMMMP.......',
  '.......PPMMMDDDDDDDDMMMPP.......',
  '........PPMMDDDDDDDDMMPP........',
  '.........PPMDDDDDDDDMPP.........',
  '.........PPPPPPPPPPPPPP.........',
  '........PP...PPPPPP...PP........',
  '......PPP......PP......PPP......',
  '.....PPPP......PP......PPPP.....',
  '.....PPPP......PP......PPPP.....',
  '......PP......AAAA......PP......',
  '.............AAAAAA.............',
  '.............AAAAAA.............',
  '..............AAAA..............',
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
<rect width="512" height="512" fill="${C.wall}"/>
<circle cx="256" cy="256" r="330" fill="${C.r1}"/>
<circle cx="256" cy="256" r="262" fill="${C.r2}"/>
<circle cx="256" cy="256" r="196" fill="${C.r3}"/>
<circle cx="256" cy="256" r="136" fill="${C.r4}"/>
${nest({ x: 36, y: 36, w: 440, h: 440, vb: '0 0 200 200', body: markBody() })}
</g>`,
});

// ---- logo ----------------------------------------------------------------------
function logo(dark) {
  return `
${nest({ x: 12, y: 12, w: 176, h: 176, vb: '0 0 200 200', body: markBody() })}
<text x="208" y="104" font-family="Futura" font-weight="500" font-size="50" letter-spacing="9.4" fill="${dark ? C.cream : C.wall}">PORCHLIGHT</text>
<path d="M210,122H606" stroke="${dark ? C.aqua : C.aquaDk}" stroke-width="2.5"/>
<text x="408" y="164" text-anchor="middle" font-family="SignPainter" font-size="40" fill="${dark ? C.mustard : C.persimmon}">Lights on. Eyes open.</text>`;
}
const logoSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(false) });
const logoDarkSvg = svg({ w: 640, h: 200, vb: '0 0 640 200', body: logo(true) });

// ---- hero ----------------------------------------------------------------------
function bullet(x, base) {
  return `
<path d="M${x - 15},${base - 34}L${x - 23},${base}M${x + 15},${base - 34}L${x + 23},${base}M${x},${base - 22}V${base - 3}" stroke="${C.brass}" stroke-width="2.8" stroke-linecap="round"/>
<path d="M${x - 24},${base - 74}H${x + 24}C${x + 24},${base - 40} ${x + 15},${base - 20} ${x},${base - 20}C${x - 15},${base - 20} ${x - 24},${base - 40} ${x - 24},${base - 74}Z" fill="${C.cream}"/>
<path d="M${x + 10},${base - 74}H${x + 24}C${x + 24},${base - 40} ${x + 15},${base - 20} ${x},${base - 20}C${x + 9},${base - 26} ${x + 12},${base - 46} ${x + 10},${base - 74}Z" fill="${C.creamDk}"/>
<rect x="${x - 26}" y="${base - 79}" width="52" height="7" rx="2" fill="${C.cream}"/>`;
}

function twinkle(cx, cy, s, fill) {
  const k = s * 0.14;
  return `<path d="M${cx},${f(cy - s)}Q${f(cx + k)},${f(cy - k)} ${f(cx + s)},${cy}Q${f(cx + k)},${f(cy + k)} ${cx},${f(cy + s)}Q${f(cx - k)},${f(cy + k)} ${f(cx - s)},${cy}Q${f(cx - k)},${f(cy - k)} ${cx},${f(cy - s)}Z" fill="${fill}"/>`;
}

function hero() {
  const LX = 640;
  const LY = 164;
  const top = 40;
  const G = 548;
  const DT = 302; // top of the door leaf
  const rings = [
    [620, C.r1],
    [486, C.r2],
    [366, C.r3],
    [262, C.r4],
    [176, C.r5],
  ]
    .map(([r, c]) => `<circle cx="${LX}" cy="${LY}" r="${r}" fill="${c}"/>`)
    .join('');
  // the nearest light is a many-pointed star, not a disc
  let star = '';
  for (let i = 0; i < 64; i++) {
    const [x, y] = pol(LX, LY, i * 5.625 - 90, i % 2 ? 92 : i % 4 === 0 ? 138 : 118);
    star += `${i ? 'L' : 'M'}${f(x)},${f(y)}`;
  }
  let star2 = '';
  for (let i = 0; i < 32; i++) {
    const [x, y] = pol(LX, LY, i * 11.25 - 90, i % 2 ? 56 : 84);
    star2 += `${i ? 'L' : 'M'}${f(x)},${f(y)}`;
  }
  let wedges = '';
  for (let i = 0; i < 32; i++) {
    const a = i * 11.25 + 5.6;
    const w = i % 2 ? 0.6 : 1.1;
    const [x0, y0] = pol(LX, LY, a, 150);
    const [x1, y1] = pol(LX, LY, a - w, 900);
    const [x2, y2] = pol(LX, LY, a + w, 900);
    wedges += `M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}L${f(x2)},${f(y2)}Z`;
  }
  let battens = '';
  for (let x = 48; x < 1280; x += 74) if (x < 560 || x > 720) battens += `M${x},${top}V${G}`;

  const door = `
<clipPath id="door"><rect x="578" y="${DT}" width="124" height="${G - DT}"/></clipPath>
<rect x="568" y="${DT - 10}" width="144" height="${G - DT + 10}" fill="${C.cream}"/>
<rect x="578" y="${DT}" width="124" height="${G - DT}" fill="${C.persimmon}"/>
<g clip-path="url(#door)"><circle cx="${LX}" cy="${LY}" r="262" fill="${C.persimmonLt}"/><circle cx="${LX}" cy="${LY}" r="176" fill="#fb9a5b"/></g>
${[352, 412, 472]
  .map(
    (y) =>
      `<path d="M640,${y - 24}L664,${y}L640,${y + 24}L616,${y}Z" fill="${C.persimmonDk}"/><path d="M640,${y - 17}L657,${y}L640,${y + 17}L623,${y}Z" fill="${C.hot}"/><path d="M640,${y - 17}L657,${y}L640,${y + 17}Z" fill="#ffd77c"/>`,
  )
  .join('')}
<path d="${Array.from({ length: 16 }, (_, i) => pol(688, 432, i * 22.5 - 90, i % 2 ? 5.6 : 14)).map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join('')}Z" fill="${C.brass}"/>
<circle cx="688" cy="432" r="5.6" fill="${C.mustard}"/><circle cx="686.500" cy="430.500" r="2" fill="${C.hot}"/>
<rect x="614" y="512" width="52" height="10" rx="2" fill="${C.brass}"/><rect x="619" y="515.500" width="42" height="3" fill="${C.persimmonDk}"/>
<rect x="558" y="${G}" width="164" height="9" fill="${C.creamDk}"/>
<path d="M594,566H686L698,590H582Z" fill="${C.aquaDk}"/><path d="M591,572H689L692,578H588Z" fill="${C.cream}"/>`;

  const snake = (x, y) => `
<path d="M${x - 14},${y}c-8,-36 -4,-68 2,-90c10,26 10,60 6,90z" fill="${C.aquaDk}"/>
<path d="M${x - 2},${y}c-4,-50 2,-90 8,-116c8,34 8,78 4,116z" fill="${C.aqua}"/>
<path d="M${x + 8},${y}c2,-30 8,-56 16,-74c2,26 -2,54 -8,74z" fill="${C.aquaDk}"/>
<path d="M${x + 3},${y}c-2,-42 1,-78 4,-100" fill="none" stroke="${C.aquaDk}" stroke-width="1.8"/>`;
  const rubber = (x, y) => `
<path d="M${x},${y}c-2,-40 2,-74 -4,-112M${x - 2},${y - 50}c-10,-10 -16,-16 -22,-18M${x - 1},${y - 76}c10,-8 16,-14 22,-22" fill="none" stroke="${C.aquaDk}" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="${x - 28}" cy="${y - 74}" rx="17" ry="10" transform="rotate(28 ${x - 28} ${y - 74})" fill="${C.aqua}"/>
<ellipse cx="${x + 26}" cy="${y - 104}" rx="17" ry="10" transform="rotate(-34 ${x + 26} ${y - 104})" fill="${C.aqua}"/>
<ellipse cx="${x - 8}" cy="${y - 128}" rx="11" ry="19" transform="rotate(-10 ${x - 8} ${y - 128})" fill="${C.aqua}"/>
<ellipse cx="${x + 20}" cy="${y - 54}" rx="15" ry="9" transform="rotate(-20 ${x + 20} ${y - 54})" fill="${C.aquaDk}"/>`;
  // two milk bottles left on the step
  const bottle = (x) =>
    `<path d="M${x - 5},${G}v-17c0,-4 2.500,-5 2.500,-9v-4h5v4c0,4 2.500,5 2.500,9v17z" fill="${C.cream}"/><rect x="${x - 3}" y="${G - 33}" width="6" height="3.500" rx="1" fill="${C.aqua}"/>`;

  return `
<rect width="1280" height="640" fill="${C.wall}"/>
<clipPath id="wall"><rect y="${top}" width="1280" height="${G - top}"/></clipPath>
<g clip-path="url(#wall)">
${rings}
<path d="${wedges}" fill="${C.cream}" opacity="0.04"/>
<path d="${battens}" stroke="${C.night}" stroke-width="2" opacity="0.4"/>
<path d="${star}Z" fill="${C.r6}"/>
<path d="${star2}Z" fill="#dd7f3c"/>
</g>
<rect width="1280" height="${top}" fill="${C.night}"/>
<rect y="${top - 5}" width="1280" height="5" fill="${C.r2}"/>
<rect y="${G}" width="1280" height="${640 - G}" fill="${C.floor}"/>
<ellipse cx="640" cy="${G + 22}" rx="420" ry="54" fill="${C.wall}"/>
<ellipse cx="640" cy="${G + 20}" rx="290" ry="38" fill="${C.r2}"/>
<ellipse cx="640" cy="${G + 18}" rx="170" ry="24" fill="${C.r4}"/>
<rect y="${G}" width="1280" height="4" fill="${C.night}" opacity="0.5"/>
${door}
${snake(520, G - 74)}${bullet(520, G)}
${rubber(762, G - 74)}${bullet(762, G)}
${bottle(733)}${bottle(722)}
<text x="521" y="332" text-anchor="middle" font-family="Futura" font-weight="500" font-size="36" letter-spacing="2" fill="${C.cream}">57</text>
<path d="M501,343H541" stroke="${C.brass}" stroke-width="3"/>
${twinkle(452, 96, 11, C.cream)}${twinkle(842, 118, 9, C.aqua)}${twinkle(408, 214, 7, C.aqua)}${twinkle(886, 232, 12, C.cream)}${twinkle(792, 262, 6, C.mustard)}${twinkle(486, 268, 6, C.mustard)}
<path d="M${LX},${top}V${LY}" stroke="${C.brass}" stroke-width="4.5"/>
<path d="M${LX - 18},${top}h36l-7,11h-22z" fill="${C.brass}"/>
${sputnik(LX, LY, 1.2)}
<text x="279" y="436" text-anchor="middle" font-family="Futura" font-weight="500" font-size="88" letter-spacing="22" fill="${C.cream}">PORCH</text>
<text x="1023" y="436" text-anchor="middle" font-family="Futura" font-weight="500" font-size="88" letter-spacing="22" fill="${C.cream}">LIGHT</text>
<text x="268" y="502" text-anchor="middle" font-family="SignPainter" font-size="60" fill="${C.mustard}" transform="rotate(-3 268 502)">Lights on.</text>
<text x="1012" y="502" text-anchor="middle" font-family="SignPainter" font-size="60" fill="${C.mustard}" transform="rotate(-3 1012 502)">Eyes open.</text>`;
}
const heroSvg = svg({ w: 1280, h: 640, vb: '0 0 1280 640', body: hero() });

const notes = `# 23 Sputnik lamp

The porch light as an atomic starburst fixture: brass arms, lit bulbs on the long ones and aqua balls on the short, hanging over a flush persimmon door with three diamond lights. Its light is drawn as stepped rings and thin rays across a plum board-and-batten wall. The door splits the name in two, and the tagline splits with it. The mark is a ball-clock starburst with the door in its lit centre.
Palette: plum night #150f1c / #291d36 / #4b2f4e / #874551, mustard #f2b632, brass #d19c3a, aqua #5cc3b6, cream #f5e9cf, persimmon #e4572e.
Type: Futura Medium capitals, tracked wide, for the name; SignPainter HouseScript for the tagline.
Tagline: Lights on. Eyes open.
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
