import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

// Concepts are written beside this folder, in branding/concepts.
export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../concepts');
// Scratch files (Chrome profiles, review sheets) stay out of the repository.
export const SCRATCH = process.env.BRAND_SCRATCH || path.join(process.env.TMPDIR || '/tmp', 'porchlight-brand');

// A standalone SVG document.
export function svg({ w, h, vb = `0 0 ${w} ${h}`, body, crisp = false, title = 'Porchlight', defs = '', fonts = null }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}"` +
    (crisp ? ' shape-rendering="crispEdges"' : '') +
    `>\n<title>${title}</title>\n` +
    (fonts ? `<style>${fontFaces(fonts)}</style>\n` : '') +
    (defs ? `<defs>\n${defs}\n</defs>\n` : '') +
    body.trim() +
    '\n</svg>\n'
  );
}

// Nest a drawing (with its own viewBox) inside another SVG at x, y, w, h.
export function nest({ x = 0, y = 0, w, h, vb, body, crisp = false }) {
  return (
    `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vb}"` +
    (crisp ? ' shape-rendering="crispEdges"' : '') +
    `>\n${body.trim()}\n</svg>`
  );
}

// Write a concept's files. files: { 'mark.svg': '...', ... }
export function writeConcept(slug, files) {
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  console.log(`wrote ${Object.keys(files).length} files to ${dir}`);
  return dir;
}

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Deterministic pseudo-random numbers (mulberry32) for hand-tuned scatter.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Faces that CSS cannot reach by family name (Phosphate Inline, Futura Condensed, Gill Sans
// UltraBold...) are named by their PostScript name: fonts = { Deco: 'Phosphate-Inline' } lets the
// drawing use font-family="Deco". Nothing is loaded from the network.
export function fontFaces(fonts) {
  return Object.entries(fonts)
    .map(([alias, ps]) => `@font-face{font-family:'${alias}';src:local('${ps}')}`)
    .join('');
}
