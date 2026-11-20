// The mockup gallery: two side-by-side comparisons and mockups.html beside the concepts.
//
//   node gallery.mjs
//
// Needs app-shots.mjs and scenes.mjs to have run. The gallery is served with the concepts
// (the branding-gallery entry in .claude/launch.json) at /mockups.html.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openChrome } from '../lib/render.mjs';
import { OUT, SCRATCH } from '../lib/svg.mjs';
import { BRANDS, SMALL_LINE } from './brands.mjs';

const MOCK = path.join(OUT, 'mockups');
const TMP = path.join(SCRATCH, 'mockups');
fs.mkdirSync(TMP, { recursive: true });
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const href = (...p) => pathToFileURL(path.join(...p)).href;
const BASE = '*{box-sizing:border-box}html,body{margin:0}body{font:15px/1.4 system-ui, "Helvetica Neue", sans-serif;-webkit-font-smoothing:antialiased}';

// Every icon at the sizes people meet it, on the same light and dark grounds.
function iconsSheet() {
	const row = (b) => `<div class="r"><b>${b.n}</b>
		<div class="c light"><img src="${href(OUT, b.slug, 'icon-512.png')}" width="128" height="128"><img src="${href(OUT, b.slug, 'icon-128.png')}" width="64" height="64"><img src="${href(OUT, b.slug, 'icon-128.png')}" width="32" height="32"><img src="${href(OUT, b.slug, 'favicon-16.png')}" width="16" height="16"></div>
		<div class="c dark"><img src="${href(OUT, b.slug, 'icon-512.png')}" width="128" height="128"><img src="${href(OUT, b.slug, 'icon-128.png')}" width="64" height="64"><img src="${href(OUT, b.slug, 'icon-128.png')}" width="32" height="32"><img src="${href(OUT, b.slug, 'favicon-16.png')}" width="16" height="16"></div>
		<span>${esc(b.name)}</span></div>`;
	return `<!doctype html><meta charset="utf-8"><style>${BASE}
		body{width:1480px;background:#e9e6df;padding:36px 40px;color:#1b1b1b}
		h1{margin:0 0 4px;font-size:30px}p{margin:0 0 22px;color:#555}
		.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 26px}
		.r{display:grid;grid-template-columns:38px auto 1fr;grid-template-rows:auto auto;gap:6px 12px;align-items:center}
		.r b{grid-row:1 / 3;font-size:22px}.r span{grid-column:2 / 4;font-size:13px;color:#555}
		.c{display:flex;align-items:flex-end;gap:16px;padding:12px 16px;border-radius:10px}
		.light{background:#f8f6f1}.dark{background:#1b1b1d}</style>
		<h1>Every icon at real sizes</h1><p>128 and 64 as the Dock shows them, 32 as Finder lists them, 16 as a browser tab. Light ground, then dark.</p>
		<div class="grid">${BRANDS.map(row).join('')}</div>`;
}

// Every app window, the same findings, side by side.
function appsSheet() {
	return `<!doctype html><meta charset="utf-8"><style>${BASE}
		body{width:2400px;background:#e9e6df;padding:36px 40px;color:#1b1b1b}
		h1{margin:0 0 4px;font-size:34px}p{margin:0 0 24px;color:#555;font-size:18px}
		.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
		figure{margin:0}img{display:block;width:100%;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
		figcaption{margin-top:8px;font-size:18px}figcaption b{margin-right:6px}</style>
		<h1>The same findings in every brand</h1><p>The real Porchlight window on made-up repositories. Severity colours never change; only the brand does.</p>
		<div class="grid">${BRANDS.map((b) => `<figure><img src="${href(MOCK, b.slug, 'app-findings.png')}"><figcaption><b>${b.n}</b>${esc(b.name)}</figcaption></figure>`).join('')}</div>`;
}

function galleryHtml() {
	const scenes = [
		['app-scene-findings', 'App: findings'],
		['app-scene-roadmap', 'App: roadmap'],
		['landing', 'Landing page'],
		['dock', 'Dock and notification'],
		['tabs', 'Tabs and icon sizes'],
		['installer', 'Installer'],
		['sticker', 'Stickers'],
	];
	const v = `?v=${Date.now()}`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Porchlight mockups</title><style>${BASE}
	:root{--page:#e9e6df;--ink:#1b1b1b;--muted:#5d5a55;--card:#f6f4ef;--line:#d6d1c7}
	body{background:var(--page);color:var(--ink);padding:28px clamp(16px,3vw,44px) 60px}
	h1{margin:0;font-size:30px}.lede{margin:6px 0 18px;color:var(--muted);max-width:70ch}
	nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px;position:sticky;top:0;padding:10px 0;background:var(--page);z-index:2}
	nav a{padding:6px 11px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:14px}
	nav a:hover{border-color:var(--ink)}
	section{margin:0 0 54px;scroll-margin-top:64px}
	h2{margin:0 0 4px;font-size:24px}h2 small{font-weight:400;color:var(--muted);font-size:16px;margin-left:8px}
	.tag{margin:0 0 14px;color:var(--muted)}
	img{display:block;max-width:100%;height:auto;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
	.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:14px}
	.thumbs a{color:var(--muted);font-size:13px;text-decoration:none}.thumbs img{margin-bottom:5px;aspect-ratio:16/10;object-fit:cover;object-position:top;width:100%}
	</style></head><body>
	<h1>Porchlight mockups</h1>
	<p class="lede">Ten shortlisted brands, plus 54 for comparison, each shown in use: the real app on made-up repositories, a landing page, the Dock, browser tabs, the installer and stickers. The small line is the same for all: ${esc(SMALL_LINE)}.</p>
	<nav><a href="#compare">Compare</a>${BRANDS.map((b) => `<a href="#c${b.n}">${b.n} ${esc(b.name)}</a>`).join('')}</nav>
	<section id="compare"><h2>Side by side</h2><p class="tag">Every icon at real sizes, and the same findings in every brand.</p>
		<a href="mockups/compare-icons.png${v}"><img src="mockups/compare-icons.png${v}" alt="Every icon at real sizes" style="max-width:1100px"></a>
		<div style="height:18px"></div>
		<a href="mockups/compare-apps.png${v}"><img src="mockups/compare-apps.png${v}" alt="Every app window"></a></section>
	${BRANDS.map((b) => `<section id="c${b.n}"><h2>${b.n} ${esc(b.name)}${b.from ? `<small>from ${b.from}</small>` : ''}</h2><p class="tag">“${esc(b.tagline)}”</p>
		<a href="mockups/${b.slug}/board.png${v}"><img src="mockups/${b.slug}/board.png${v}" alt="${esc(b.name)}: all mockups" loading="lazy"></a>
		<div class="thumbs">${scenes.map(([f, label]) => `<a href="mockups/${b.slug}/${f}.png${v}"><img src="mockups/${b.slug}/${f}.png${v}" alt="" loading="lazy">${label}</a>`).join('')}</div></section>`).join('\n')}
	</body></html>`;
}

async function shot(c, html, out, w) {
	const file = path.join(TMP, `${path.basename(out, '.png')}.html`);
	fs.writeFileSync(file, html);
	await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 120, deviceScaleFactor: 1, mobile: false });
	await c.send('Page.navigate', { url: pathToFileURL(file).href + `?v=${Date.now()}` });
	await c.send('Runtime.evaluate', {
		awaitPromise: true,
		expression: `(async () => {
			for (let i = 0; i < 100 && document.readyState !== 'complete'; i++) await new Promise((r) => setTimeout(r, 50));
			await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
			await document.fonts.ready;
		})()`,
	});
	const { result } = await c.send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
	await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: result.value, deviceScaleFactor: 1, mobile: false });
	const { data } = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: result.value, scale: 1 }, captureBeyondViewport: true });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
}

const c = await openChrome();
try {
	await shot(c, iconsSheet(), path.join(MOCK, 'compare-icons.png'), 1480);
	await shot(c, appsSheet(), path.join(MOCK, 'compare-apps.png'), 2400);
} finally {
	await c.close();
}
fs.writeFileSync(path.join(OUT, 'mockups.html'), galleryHtml());
console.log(`gallery -> ${path.join(OUT, 'mockups.html')}`);
