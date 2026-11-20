// Build branding/concepts/round-2.html (static, relative paths, nothing from the network) and
// branding/concepts/contact-sheet-2.png from concepts 21 and up. Round one keeps its own
// index.html and contact-sheet.png.
//
//   node lib/gallery2.mjs            page and contact sheet
//   node lib/gallery2.mjs --shot     also a screenshot of the page into the scratch folder
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT, SCRATCH, esc } from './svg.mjs';
import { openChrome } from './render.mjs';

const TMP = path.join(SCRATCH, 'tmp');
const FIRST = 21;
const LAST = 52;

const GROUPS = [
  { from: 21, to: 24, title: 'Atomic and Googie roadside', from1: 'from 09 Atomic sign' },
  { from: 25, to: 28, title: 'Atomic print and seventies', from1: 'from 09 Atomic sign and 16 Seventies badge' },
  { from: 29, to: 32, title: 'Art Deco: architecture and emblem', from1: 'leaning into Deco' },
  { from: 33, to: 36, title: 'Art Deco: posters', from1: 'leaning into Deco' },
  { from: 37, to: 40, title: 'Art Deco: metal and engraving', from1: 'from 20 Deco filament and 08 Woodcut lantern' },
  { from: 41, to: 44, title: 'Papercut', from1: 'from 12 Papercut night' },
  { from: 45, to: 48, title: 'Flat illustration', from1: 'from 15 Flat porch' },
  { from: 49, to: 52, title: 'Print craft and others', from1: 'from 08 Woodcut lantern, 12 Papercut night and 05 Amber terminal' },
];

const REQUIRED = ['hero.png', 'icon-128.png', 'favicon-16.png', 'favicon-32.png', 'mark.svg', 'logo.svg', 'notes.md'];

const slugs = fs
  .readdirSync(OUT)
  .filter((d) => /^\d\d-/.test(d) && Number(d.slice(0, 2)) >= FIRST && Number(d.slice(0, 2)) <= LAST && fs.statSync(path.join(OUT, d)).isDirectory())
  .sort();

function readNotes(slug) {
  const md = fs.readFileSync(path.join(OUT, slug, 'notes.md'), 'utf8').trim().split('\n');
  const title = md[0].replace(/^#\s*/, '').replace(/^\d\d\s+/, '');
  const lines = md.slice(1).filter((l) => l.trim());
  let tagline = '';
  const body = [];
  for (const l of lines) {
    const m = l.match(/^Tagline:\s*(.*)$/);
    if (m) tagline = m[1].trim();
    else body.push(l);
  }
  return { title, body, tagline };
}

const concepts = [];
for (const slug of slugs) {
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(OUT, slug, f)));
  if (missing.length) {
    console.log(`skipping ${slug}: missing ${missing.join(', ')}`);
    continue;
  }
  const n = readNotes(slug);
  const has = (f) => fs.existsSync(path.join(OUT, slug, f));
  concepts.push({
    slug,
    num: slug.slice(0, 2),
    title: n.title,
    body: n.body,
    tagline: n.tagline,
    markDark: has('mark-dark.svg') ? 'mark-dark.svg' : 'mark.svg',
    logoDark: has('logo-dark.svg') ? 'logo-dark.svg' : 'logo.svg',
  });
}
const groups = GROUPS.map((g) => ({ ...g, items: concepts.filter((c) => Number(c.num) >= g.from && Number(c.num) <= g.to) })).filter(
  (g) => g.items.length,
);

// Which concepts audition which tagline, in the order the taglines first appear.
const taglines = new Map();
for (const c of concepts) {
  if (!c.tagline) continue;
  if (!taglines.has(c.tagline)) taglines.set(c.tagline, []);
  taglines.get(c.tagline).push(c);
}

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
a{color:inherit}
header{max-width:1360px;margin:0 auto;padding:48px 24px 8px}
h1{font-weight:600;font-size:34px;letter-spacing:-.01em;margin:0 0 6px}
header p{margin:0 0 8px;color:var(--muted);max-width:820px}
.lines{max-width:1360px;margin:0 auto;padding:24px 24px 0}
.lines h2,.jump h2{font-weight:600;font-size:18px;margin:0 0 10px}
.lines ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px}
.lines li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:8px 0;border-top:1px solid var(--rule)}
.lines q{quotes:none;font-weight:600;font-size:17px}
.lines .on{font-size:13px;color:var(--muted)}
.lines .on a{text-decoration:none;border-bottom:1px solid var(--rule)}
.lines .on a:hover{border-color:var(--accent)}
.jump{max-width:1360px;margin:0 auto;padding:28px 24px 0}
.gh{font-weight:600;font-size:15px;margin:18px 0 8px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.gh a{text-decoration:none}
.gh a:hover{color:var(--accent)}
.gh span{font-weight:400;font-size:13px;color:var(--muted)}
.over{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.over a{display:block;background:var(--card);border:1px solid var(--rule);border-radius:10px;overflow:hidden;text-decoration:none;color:var(--ink)}
.over a:hover{border-color:var(--accent)}
.over a>img{display:block;width:100%;height:auto;aspect-ratio:2/1;background:#000}
.oc{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:13px;min-width:0}
.oc img{width:24px;height:24px;border-radius:6px;flex:none}
.oc b{font:600 12px Menlo,monospace;color:var(--accent)}
main{max-width:1360px;margin:0 auto;padding:8px 24px 64px}
.group{margin:44px 0 0;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;scroll-margin-top:16px}
.group h2{font-weight:600;font-size:26px;margin:0}
.group span{color:var(--muted);font-size:14px}
section{background:var(--card);border:1px solid var(--rule);border-radius:14px;margin:18px 0 24px;padding:24px;scroll-margin-top:16px}
.head{display:flex;align-items:baseline;gap:14px;margin-bottom:16px;flex-wrap:wrap}
.num{font:600 14px Menlo,monospace;color:var(--accent)}
h3{font-weight:600;font-size:24px;margin:0}
.slug{font:12px Menlo,monospace;color:var(--muted)}
.tag{margin-left:auto;font-size:14px;color:var(--muted)}
.tag q{quotes:none;color:var(--ink);font-weight:600}
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
footer{max-width:1360px;margin:0 auto;padding:0 24px 48px;color:var(--muted);font-size:13px}
@media (max-width:900px){.row{grid-template-columns:1fr}.tiles{grid-template-columns:1fr 1fr}.lines ol{grid-template-columns:1fr}.over{grid-template-columns:repeat(2,minmax(0,1fr))}.tag{margin-left:0;flex-basis:100%}}
@media (max-width:560px){header,.lines,.jump,main{padding-left:16px;padding-right:16px}section{padding:16px}.tiles{grid-template-columns:1fr}.mark img,.icon img{width:96px;height:96px}.over{grid-template-columns:1fr}}
`;

function section(c) {
  const d = c.slug;
  return `<section id="c${c.num}">
  <div class="head"><span class="num">${c.num}</span><h3>${esc(c.title)}</h3><span class="slug">${esc(c.slug)}</span>${
    c.tagline ? `<span class="tag">Tagline: <q>${esc(c.tagline)}</q></span>` : ''
  }</div>
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
        <div class="tile light icon"><span class="cap">icon 128</span><img src="${d}/icon-128.png" width="128" height="128" alt="${esc(c.title)} 128px icon" loading="lazy"></div>
        <div class="tile dark icon"><span class="cap">icon 128</span><img src="${d}/icon-128.png" width="128" height="128" alt="" loading="lazy"></div>
      </div>
      <div class="notes" style="margin-top:14px">${notesHtml(c)}</div>
      <div class="files"><a href="${d}/hero.svg">hero.svg</a> · <a href="${d}/logo.svg">logo.svg</a> · <a href="${d}/mark.svg">mark.svg</a> · <a href="${d}/favicon.svg">favicon.svg</a> · <a href="${d}/icon-512.png">icon-512.png</a> · <a href="${d}/notes.md">notes.md</a></div>
    </div>
  </div>
</section>`;
}

const count = concepts.length;
const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Porchlight concepts, round two</title>
<link rel="icon" href="${concepts[0] ? concepts[0].slug : ''}/favicon-32.png">
<style>${css}</style>
</head>
<body>
<header>
  <h1>Porchlight: round two, ${count} more concepts</h1>
  <p>Built on the ones you liked in <a href="index.html">round one</a>: the atomic roadside sign, Art Deco, the papercut night and the flat porch, with a few from the woodcut, the seventies badge and the amber terminal. Each has a mark, a logo for light and dark pages, favicons redrawn for 16 and 32 pixels, an app icon and a landing image.</p>
  <p>The old slogan is gone. Each concept carries one of ${taglines.size} new taglines, listed below, so you can choose a line as well as a look. All ${count} are also on <a href="contact-sheet-2.png">one sheet</a>.</p>
</header>
<div class="lines">
  <h2>Taglines being tried</h2>
  <ol>
${[...taglines.entries()]
  .map(
    ([t, cs]) =>
      `    <li><q>${esc(t)}</q><span class="on">on ${cs.map((c) => `<a href="#c${c.num}">${c.num}</a>`).join(', ')}</span></li>`,
  )
  .join('\n')}
  </ol>
</div>
<div class="jump">
  <h2>All ${count} at a glance</h2>
${groups
  .map(
    (g) =>
      `  <h3 class="gh"><a href="#g${g.from}">${esc(g.title)}</a><span>${esc(g.from1)}</span></h3>\n  <div class="over">\n` +
      g.items
        .map(
          (c) =>
            `    <a href="#c${c.num}"><img src="${c.slug}/hero.png" width="1280" height="640" alt="" loading="lazy"><span class="oc"><img src="${c.slug}/icon-128.png" width="128" height="128" alt="" loading="lazy"><b>${c.num}</b>${esc(c.title)}</span></a>`,
        )
        .join('\n') +
      `\n  </div>`,
  )
  .join('\n')}
</div>
<main>
${groups
  .map(
    (g) =>
      `<div class="group" id="g${g.from}"><h2>${esc(g.title)}</h2><span>${g.items[0].num} to ${g.items[g.items.length - 1].num}, ${esc(g.from1)}</span></div>\n` +
      g.items.map(section).join('\n'),
  )
  .join('\n')}
</main>
<footer>Static page: every image is a local file beside it; nothing is loaded from the network. The type uses fonts installed on macOS, so text should be outlined before anything is used in production.</footer>
</body>
</html>
`;

// ---- contact sheet ---------------------------------------------------------
const u = (slug, f) => pathToFileURL(path.join(OUT, slug, f)).href + `?v=${Date.now()}`;
const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#e9e4d9;width:2400px;font-family:"Avenir Next",sans-serif;color:#1d1b18;-webkit-font-smoothing:antialiased}
h1{margin:0;padding:36px 40px 4px;font-weight:600;font-size:40px}
.sub{padding:0 40px 8px;color:#6b645a;font-size:18px}
h2{margin:0;padding:26px 40px 14px;font-weight:600;font-size:26px}
h2 span{font-weight:400;font-size:18px;color:#6b645a;margin-left:12px}
.grid{display:grid;grid-template-columns:repeat(4,560px);gap:26px 26px;padding:0 40px}
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
.cap{padding:0 14px 12px;font-size:17px;display:flex;gap:10px;align-items:baseline}
.cap b{font:600 15px Menlo;color:#c9761e}
.end{height:40px}
</style></head><body>
<h1>Porchlight: round two, ${count} concepts</h1>
<div class="sub">Landing image, mark on light and dark, 128 icon at 1:1, favicons at 16 and 32 on light and dark.</div>
${groups
  .map(
    (g) => `<h2>${esc(g.title)}<span>${esc(g.from1)}</span></h2>
<div class="grid">
${g.items
  .map(
    (c) => `<div class="cell">
  <img class="hero" src="${u(c.slug, 'hero.png')}">
  <div class="strip">
    <div class="mk"><img src="${u(c.slug, 'mark.svg')}"></div>
    <div class="mk d"><img src="${u(c.slug, c.markDark)}"></div>
    <img class="ic" src="${u(c.slug, 'icon-128.png')}">
    <div class="fv">
      <div class="l"><img src="${u(c.slug, 'favicon-16.png')}" width="16" height="16"><img src="${u(c.slug, 'favicon-32.png')}" width="32" height="32"></div>
      <div class="dk"><img src="${u(c.slug, 'favicon-16.png')}" width="16" height="16"><img src="${u(c.slug, 'favicon-32.png')}" width="32" height="32"></div>
    </div>
  </div>
  <div class="cap"><b>${c.num}</b>${esc(c.title)}</div>
</div>`,
  )
  .join('\n')}
</div>`,
  )
  .join('\n')}
<div class="end"></div>
</body></html>`;

fs.mkdirSync(TMP, { recursive: true });
const sheetHtml = path.join(TMP, 'contact-sheet-2.html');
fs.writeFileSync(sheetHtml, sheet);
const chrome = await openChrome();
try {
  const h = await chrome.renderPage(sheetHtml, path.join(OUT, 'contact-sheet-2.png'), 2400, 'auto');
  console.log(`wrote contact-sheet-2.png 2400x${h} (${count} concepts)`);
  fs.writeFileSync(path.join(OUT, 'round-2.html'), index);
  console.log('wrote round-2.html');
  if (process.argv.includes('--shot')) {
    const h2 = await chrome.renderPage(path.join(OUT, 'round-2.html'), path.join(TMP, 'round-2-shot.png'), 1400, 'auto');
    console.log(`page screenshot 1400x${h2} -> ${path.join(TMP, 'round-2-shot.png')}`);
  }
} finally {
  await chrome.close();
}
