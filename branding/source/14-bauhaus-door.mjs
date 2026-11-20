// 14 Bauhaus door: a strict grid; the door a black rectangle, the bulb a
// cream circle under a black shade, its light an amber quarter circle. The
// wordmark's o is lit: its counter is filled amber.
import { svg, nest, writeConcept } from '../lib/svg.mjs';

const SLUG = '14-bauhaus-door';
const C = {
  paper: '#efe8da',
  black: '#161514',
  red: '#d63c25',
  amber: '#f2a51a',
  litDoor: '#7a4410',
  litRed: '#e8641f',
  blue: '#1f3f8f',
  cream: '#fff6e0',
  grey: '#b9b09f',
};

// Futura Bold, measured in Chrome at 100px: the o's ink box and the word's advance.
const FUTURA_BOLD = { total: 539.5, oCx: 105.09, oCy: -25.65, oRx: 24.5, oRy: 22 };

// The wordmark: lowercase Futura Bold with the counter of the o lit.
function word(x, y, size, ink = C.black, fill = C.amber) {
  const k = size / 100;
  return (
    `<ellipse cx="${(x + FUTURA_BOLD.oCx * k).toFixed(2)}" cy="${(y + FUTURA_BOLD.oCy * k).toFixed(2)}" rx="${(FUTURA_BOLD.oRx * k).toFixed(2)}" ry="${(FUTURA_BOLD.oRy * k).toFixed(2)}" fill="${fill}"/>` +
    `<text x="${x}" y="${y}" font-family="Futura" font-weight="700" font-size="${size}" fill="${ink}">porchlight</text>`
  );
}

// The composition on a square field of side s (units of s/32), drawn at x, y.
// Night (blue), ground (black), door, step, pendant lamp, quarter circle of light.
function field(x0, y0, s, { cord = true, knob = true } = {}) {
  const u = s / 32;
  const X = (v) => +(x0 + v * u).toFixed(2);
  const Y = (v) => +(y0 + v * u).toFixed(2);
  const L = (v) => +(v * u).toFixed(2);
  const id = `q${Math.round(x0)}_${Math.round(s)}`;
  // geometry, in grid units
  const door = [6, 13, 8, 14]; // x, y, w, h
  const step = [4, 27, 12, 1];
  const bulb = { cx: 20, cy: 11.5, r: 2 };
  const R = 16; // light radius
  const quarter = `M${X(bulb.cx)} ${Y(bulb.cy)}V${Y(bulb.cy + R)}A${L(R)} ${L(R)} 0 0 1 ${X(bulb.cx - R)} ${Y(bulb.cy)}Z`;
  const rect = ([x, y, w, h]) => `M${X(x)} ${Y(y)}h${L(w)}v${L(h)}h${-L(w)}Z`;
  let b = `<clipPath id="${id}"><path d="${quarter}"/></clipPath>`;
  b += `<rect x="${X(0)}" y="${Y(0)}" width="${L(32)}" height="${L(28)}" fill="${C.blue}"/>`;
  b += `<rect x="${X(0)}" y="${Y(28)}" width="${L(32)}" height="${L(4)}" fill="${C.black}"/>`;
  b += `<path d="${quarter}" fill="${C.amber}"/>`;
  b += `<path d="${rect(door)}" fill="${C.black}"/>`;
  b += `<path d="${rect(step)}" fill="${C.red}"/>`;
  // where the light falls on the door and the step: overprint colours
  b += `<g clip-path="url(#${id})"><path d="${rect(door)}" fill="${C.litDoor}"/><path d="${rect(step)}" fill="${C.litRed}"/></g>`;
  if (knob) b += `<rect x="${X(12)}" y="${Y(20)}" width="${L(1)}" height="${L(1)}" fill="${C.amber}"/>`;
  // pendant: cord, shade (a half disc), bulb
  if (cord) b += `<rect x="${X(bulb.cx - 0.25)}" y="${Y(0)}" width="${L(0.5)}" height="${L(bulb.cy - 2.5)}" fill="${C.black}"/>`;
  b += `<path d="M${X(bulb.cx - 3)} ${Y(bulb.cy - 0.5)}A${L(3)} ${L(3)} 0 0 1 ${X(bulb.cx + 3)} ${Y(bulb.cy - 0.5)}Z" fill="${C.black}"/>`;
  b += `<circle cx="${X(bulb.cx)}" cy="${Y(bulb.cy + 1)}" r="${L(bulb.r)}" fill="${C.cream}"/>`;
  return b;
}

function hero() {
  const W = 1280;
  const H = 640;
  let b = `<rect width="${W}" height="${H}" fill="${C.paper}"/>`;
  // the field: 512 square on the 64px margin
  b += field(64, 64, 512);
  // right column on the 12-column grid (96px columns, from 640)
  const RX = 640;
  const RE = 1216;
  b += `<rect x="${RX}" y="64" width="${RE - RX}" height="4" fill="${C.black}"/>`;
  b += `<g font-family="Futura" font-weight="500" fill="${C.black}">`;
  b += `<text x="${RX}" y="100" font-size="15" letter-spacing="2.4">no. 01</text>`;
  b += `<text x="${RE}" y="100" font-size="15" letter-spacing="2.4" text-anchor="end">dusk to dawn</text>`;
  b += `</g>`;
  b += word(RX - 6, 328, 106);
  b += `<text x="${RX}" y="386" font-family="Futura" font-weight="500" font-size="27.5" fill="${C.black}">A light left on over your own front door.</text>`;
  // the three things it looks at, keyed to the field's colours
  b += `<rect x="${RX}" y="496" width="${RE - RX}" height="2" fill="${C.black}"/>`;
  const items = [
    [C.red, 'repositories', 'keys and old packages'],
    [C.amber, 'domains', 'names you have proven'],
    [C.blue, 'this mac', 'updates, firewall, files'],
  ];
  items.forEach(([col, t, sub], i) => {
    const x = RX + i * 192;
    b += `<rect x="${x}" y="524" width="16" height="16" fill="${col}"/>`;
    b += `<text x="${x + 28}" y="539" font-family="Futura" font-weight="700" font-size="18" fill="${C.black}">${t}</text>`;
    b += `<text x="${x + 28}" y="563" font-family="Futura" font-weight="500" font-size="14" fill="${C.black}" fill-opacity="0.72">${sub}</text>`;
  });
  b += `<rect x="${RX}" y="572" width="${RE - RX}" height="4" fill="${C.black}"/>`;
  // a rotated line on the right margin
  b += `<text transform="translate(1250 576) rotate(-90)" font-family="Futura" font-weight="500" font-size="12" letter-spacing="3.2" fill="${C.black}" fill-opacity="0.75">runs on your own computer</text>`;
  return svg({ w: W, h: H, body: b });
}

function markSvg() {
  return svg({ w: 512, h: 512, vb: '0 0 256 256', body: field(0, 0, 256) });
}
function iconSvg() {
  const b = `<clipPath id="tile"><rect width="256" height="256" rx="52"/></clipPath><g clip-path="url(#tile)">${field(0, 0, 256)}</g>`;
  return svg({ w: 512, h: 512, vb: '0 0 256 256', body: b });
}

// 16px: every edge on a whole pixel except the arc.
function faviconSvg() {
  const b = `
<rect width="16" height="14" fill="${C.blue}"/>
<rect y="14" width="16" height="2" fill="${C.black}"/>
<path d="M10 6V14A8 8 0 0 1 2 6Z" fill="${C.amber}"/>
<rect x="3" y="7" width="4" height="7" fill="${C.black}"/>
<clipPath id="q"><path d="M10 6V14A8 8 0 0 1 2 6Z"/></clipPath>
<rect x="3" y="7" width="4" height="7" fill="${C.litDoor}" clip-path="url(#q)"/>
<rect x="2" y="13" width="6" height="1" fill="${C.red}"/>
<rect x="2" y="13" width="6" height="1" fill="${C.litRed}" clip-path="url(#q)"/>
<rect x="10" y="0" width="1" height="3" fill="${C.black}"/>
<rect x="8" y="3" width="5" height="2" fill="${C.black}"/>
<rect x="9" y="5" width="3" height="2" fill="${C.cream}"/>`;
  return svg({ w: 16, h: 16, vb: '0 0 16 16', body: b });
}
function favicon32Svg() {
  const b = `<clipPath id="t"><rect width="32" height="32" rx="3"/></clipPath><g clip-path="url(#t)">${field(0, 0, 32, { knob: false })}</g>`;
  return svg({ w: 32, h: 32, vb: '0 0 32 32', body: b });
}

function logoSvg() {
  let b = field(16, 16, 168);
  b += word(212, 124, 74);
  return svg({ w: 640, h: 200, body: b });
}

const notes = `# 14 Bauhaus door

Swiss and Bauhaus geometry on a 32-unit grid: the night a blue square, the door a black rectangle on a red step, a pendant bulb under a half-disc shade, and its light one amber quarter circle; where the light crosses the door and the step the colours overprint. In the wordmark the counter of the o is lit.
Palette: paper #efe8da, black #161514, blue #1f3f8f, amber #f2a51a, red #d63c25, lit door #7a4410, cream #fff6e0.
Type: Futura Bold lowercase for the name, Futura Medium for the tagline and labels.
`;

writeConcept(SLUG, {
  'mark.svg': markSvg(),
  'logo.svg': logoSvg(),
  'favicon.svg': faviconSvg(),
  'favicon-32.svg': favicon32Svg(),
  'icon.svg': iconSvg(),
  'hero.svg': hero(),
  'notes.md': notes,
});
