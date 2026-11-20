// Build branding/concepts/index.html (static, relative paths, nothing from
// the network) and branding/concepts/contact-sheet.png.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { OUT, SCRATCH, esc } from './svg.mjs';
import { openChrome } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(SCRATCH, 'tmp');

const slugs = fs
  .readdirSync(OUT)
  .filter((d) => /^\d\d-/.test(d) && fs.statSync(path.join(OUT, d)).isDirectory())
  .sort();

function readNotes(slug) {
  const md = fs.readFileSync(path.join(OUT, slug, 'notes.md'), 'utf8').trim().split('\n');
  const title = md[0].replace(/^#\s*/, '').replace(/^\d\d\s+/, '');
  const body = md.slice(1).filter((l) => l.trim());
  return { title, body };
}

const concepts = slugs.map((slug) => {
  const n = readNotes(slug);
  const has = (f) => fs.existsSync(path.join(OUT, slug, f));
  return {
    slug,
    num: slug.slice(0, 2),
    pixel: slug.endsWith('-pixel'),
    title: n.title,
    body: n.body,
    markDark: has('mark-dark.svg') ? 'mark-dark.svg' : 'mark.svg',
    logoDark: has('logo-dark.svg') ? 'logo-dark.svg' : 'logo.svg',
  };
});

// Body lines: first is the idea, the others start with "Palette" / "Type".
function notesHtml(c) {
  return c.body
    .map((l) => {
      const m = l.match(/^(Palette[^:]*|Type[^:]*):\s*(.*)$/);
      return m ? `<p class="meta"><b>${esc(m[1])}</b> ${esc(m[2])}</p>` : `<p>${esc(l)}</p>`;
    })
    .join('\n');
}

const css = `
:root{
  --bg:#ece7dc; --card:#f8f5ee; --ink:#1d1b18; --muted:#6b645a; --rule:#d8d0c1;
  --light:#f4f1ea; --dark:#17181b; --accent:#c9761e;
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#141414; --card:#1d1d1e; --ink:#ece6da; --muted:#a39b8e; --rule:#2e2d2b; }
}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
header{max-width:1360px;margin:0 auto;padding:48px 24px 8px}
h1{font-weight:600;font-size:34px;letter-spacing:-.01em;margin:0 0 6px}
header p{margin:0;color:var(--muted);max-width:760px}
nav{max-width:1360px;margin:0 auto;padding:16px 24px 8px;display:flex;flex-wrap:wrap;gap:6px}
nav a{display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;border:1px solid var(--rule);border-radius:999px;color:var(--ink);text-decoration:none;font-size:13px;background:var(--card)}
nav a img{width:24px;height:24px;border-radius:6px}
nav a:hover{border-color:var(--accent)}
main{max-width:1360px;margin:0 auto;padding:8px 24px 64px}
section{background:var(--card);border:1px solid var(--rule);border-radius:14px;margin:24px 0;padding:24px;scroll-margin-top:16px}
.head{display:flex;align-items:baseline;gap:14px;margin-bottom:16px;flex-wrap:wrap}
.num{font:600 14px Menlo,monospace;color:var(--accent)}
h2{font-weight:600;font-size:24px;margin:0}
.slug{font:12px Menlo,monospace;color:var(--muted)}
.hero{display:block;width:100%;height:auto;aspect-ratio:2/1;border-radius:8px;background:#000}
.row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px;margin-top:16px}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.tile{border-radius:8px;display:flex;align-items:center;justify-content:center;gap:16px;padding:14px;min-height:96px;position:relative}
.tile.light{background:var(--light);color:#1d1b18}
.tile.dark{background:var(--dark);color:#e8e2d6}
.tile .cap{position:absolute;left:10px;top:6px;font:10px Menlo,monospace;opacity:.55;letter-spacing:.04em}
.logo img{width:100%;max-width:560px;height:auto;aspect-ratio:16/5}
.mark img{width:128px;height:128px}
.fav{flex-direction:row;align-items:flex-end;gap:14px}
.fav figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px;font:10px Menlo,monospace;opacity:.85}
.px{image-rendering:pixelated}
.icon img{width:128px;height:128px}
.notes p{margin:0 0 8px}
.notes .meta{font-size:13px;color:var(--muted)}
.notes .meta b{color:var(--ink);font-weight:600}
.files{font:12px Menlo,monospace;color:var(--muted);margin-top:10px}
.files a{color:inherit}
footer{max-width:1360px;margin:0 auto;padding:0 24px 48px;color:var(--muted);font-size:13px}
@media (max-width:900px){.row{grid-template-columns:1fr}.tiles{grid-template-columns:1fr 1fr}}
@media (max-width:560px){header,nav,main{padding-left:16px;padding-right:16px}section{padding:16px}.tiles{grid-template-columns:1fr}.mark img,.icon img{width:96px;height:96px}}
`;

function section(c) {
  const d = c.slug;
  return `<section id="c${c.num}">
  <div class="head"><span class="num">${c.num}</span><h2>${esc(c.title)}</h2><span class="slug">${esc(c.slug)}</span></div>
  <img class="hero" src="${d}/hero.png" width="1280" height="640" alt="${esc(c.title)}: landing image" loading="lazy">
  <div class="row">
    <div class="tiles">
      <div class="tile light logo" style="grid-column:1/-1"><span class="cap">logo</span><img src="${d}/logo.svg" alt="${esc(c.title)} logo" loading="lazy"></div>
      <div class="tile dark logo" style="grid-column:1/-1"><span class="cap">logo on dark</span><img src="${d}/${c.logoDark}" alt="" loading="lazy"></div>
      <div class="tile light mark"><span class="cap">mark</span><img src="${d}/mark.svg" alt="${esc(c.title)} mark" loading="lazy"></div>
      <div class="tile dark mark"><span class="cap">mark on dark</span><img src="${d}/${c.markDark}" alt="" loading="lazy"></div>
      <div class="tile light fav"><span class="cap">favicon</span>
        <figure><img class="px" src="${d}/favicon-16.png" width="16" height="16" alt="16px favicon">16</figure>
        <figure><img class="px" src="${d}/favicon-32.png" width="32" height="32" alt="32px favicon">32</figure>
        <figure><img class="px" src="${d}/favicon-16.png" width="64" height="64" alt="">16 at 4x</figure>
      </div>
      <div class="tile dark fav"><span class="cap">favicon on dark</span>
        <figure><img class="px" src="${d}/favicon-16.png" width="16" height="16" alt="">16</figure>
        <figure><img class="px" src="${d}/favicon-32.png" width="32" height="32" alt="">32</figure>
        <figure><img class="px" src="${d}/favicon-32.png" width="64" height="64" alt="">32 at 2x</figure>
      </div>
    </div>
    <div>
      <div class="tiles">
        <div class="tile light icon"><span class="cap">icon 128</span><img${c.pixel ? ' class="px"' : ''} src="${d}/icon-128.png" width="128" height="128" alt="${esc(c.title)} 128px icon" loading="lazy"></div>
        <div class="tile dark icon"><span class="cap">icon 128</span><img${c.pixel ? ' class="px"' : ''} src="${d}/icon-128.png" width="128" height="128" alt="" loading="lazy"></div>
      </div>
      <div class="notes" style="margin-top:14px">${notesHtml(c)}</div>
      <div class="files"><a href="${d}/hero.svg">hero.svg</a> · <a href="${d}/logo.svg">logo.svg</a> · <a href="${d}/mark.svg">mark.svg</a> · <a href="${d}/favicon.svg">favicon.svg</a> · <a href="${d}/icon-512.png">icon-512.png</a> · <a href="${d}/notes.md">notes.md</a></div>
    </div>
  </div>
</section>`;
}

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Porchlight concepts</title>
<link rel="icon" href="01-caged-bulb-pixel/favicon-32.png">
<style>${css}</style>
</head>
<body>
<header>
  <h1>Porchlight: 20 brand concepts</h1>
  <p>A light left on over your own front door. Each concept has a mark, a horizontal logo, a favicon redrawn for 16 and 32 pixels, a store icon and a landing image. Seven are pixel art drawn from hand-made pixel maps; the rest are hand-written SVG. The SVG type uses fonts installed on macOS, so text should be outlined before anything is used in production.</p>
</header>
<nav>${concepts.map((c) => `<a href="#c${c.num}"><img src="${c.slug}/icon-128.png" alt="">${c.num} ${esc(c.title)}</a>`).join('')}</nav>
<main>
${concepts.map(section).join('\n')}
</main>
<footer>Static page: every image is a local file beside it; nothing is loaded from the network.</footer>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), index);
console.log('wrote index.html');

// ---- contact sheet ---------------------------------------------------------
const u = (slug, f) => pathToFileURL(path.join(OUT, slug, f)).href + `?v=${Date.now()}`;
const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#e9e4d9;width:2400px;font-family:"Avenir Next",sans-serif;color:#1d1b18;-webkit-font-smoothing:antialiased}
h1{margin:0;padding:36px 40px 4px;font-weight:600;font-size:40px}
.sub{padding:0 40px 20px;color:#6b645a;font-size:18px}
.grid{display:grid;grid-template-columns:repeat(4,560px);gap:26px 26px;padding:0 40px 40px}
.cell{background:#f8f5ee;border-radius:12px;overflow:hidden;border:1px solid #d8d0c1}
.hero{display:block;width:560px;height:280px}
.strip{display:flex;align-items:center;gap:12px;padding:12px}
.mk{width:112px;height:112px;background:#f1ede4;border-radius:8px;display:flex;align-items:center;justify-content:center}
.mk.d{background:#17181b}
.mk img{width:100px;height:100px}
.ic{width:128px;height:128px}
.fv{display:flex;flex-direction:column;gap:8px;align-items:center}
.fv div{display:flex;gap:6px;align-items:center;padding:6px;border-radius:6px}
.l{background:#f1ede4}.dk{background:#17181b}
.px{image-rendering:pixelated}
.cap{padding:0 14px 12px;font-size:17px;display:flex;gap:10px;align-items:baseline}
.cap b{font:600 15px Menlo;color:#c9761e}
</style></head><body>
<h1>Porchlight — 20 concepts</h1>
<div class="sub">Landing image, mark on light and dark, 128 icon at 1:1, favicons at 16 and 32 on light and dark.</div>
<div class="grid">
${concepts
  .map(
    (c) => `<div class="cell">
  <img class="hero" src="${u(c.slug, 'hero.png')}">
  <div class="strip">
    <div class="mk"><img src="${u(c.slug, 'mark.svg')}"></div>
    <div class="mk d"><img src="${u(c.slug, c.markDark)}"></div>
    <img class="ic${c.pixel ? ' px' : ''}" src="${u(c.slug, 'icon-128.png')}">
    <div class="fv">
      <div class="l"><img src="${u(c.slug, 'favicon-16.png')}" width="16" height="16"><img src="${u(c.slug, 'favicon-32.png')}" width="32" height="32"></div>
      <div class="dk"><img src="${u(c.slug, 'favicon-16.png')}" width="16" height="16"><img src="${u(c.slug, 'favicon-32.png')}" width="32" height="32"></div>
    </div>
  </div>
  <div class="cap"><b>${c.num}</b>${esc(c.title)}</div>
</div>`,
  )
  .join('\n')}
</div></body></html>`;
fs.mkdirSync(TMP, { recursive: true });
const sheetHtml = path.join(TMP, 'contact-sheet.html');
fs.writeFileSync(sheetHtml, sheet);
const chrome = await openChrome();
try {
  const h = await chrome.renderPage(sheetHtml, path.join(OUT, 'contact-sheet.png'), 2400, 'auto');
  console.log(`wrote contact-sheet.png 2400x${h}`);
  if (process.argv.includes('--index-shot')) {
    const h2 = await chrome.renderPage(path.join(OUT, 'index.html'), path.join(TMP, 'index-shot.png'), 1400, 'auto');
    console.log(`index screenshot 1400x${h2} -> ${path.join(TMP, 'index-shot.png')}`);
  }
} finally {
  await chrome.close();
}
