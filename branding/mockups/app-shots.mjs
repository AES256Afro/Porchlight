// Screenshots of the real Porchlight interface dressed in each shortlisted brand.
//
//   node app-shots.mjs <url with #k=key> [slug ...]
//
// The interface must be running on demo data only (made-up repositories, its own report folder),
// never the owner's. Each brand's colours, sidebar mark and typefaces are laid over the page with
// a stylesheet; the page's own code and data are untouched. Writes
// branding/concepts/mockups/<slug>/app-<page>.png at 2x.
import fs from 'node:fs';
import path from 'node:path';
import { openChrome } from '../lib/render.mjs';
import { OUT } from '../lib/svg.mjs';
import { BRANDS } from './brands.mjs';

const [url, ...only] = process.argv.slice(2);
if (!url || !/^http:\/\/127\.0\.0\.1:\d+\/#k=[\w-]+$/.test(url)) throw new Error('usage: node app-shots.mjs http://127.0.0.1:<port>/#k=<key> [slug ...]');
const W = 1440;
const H = 900;
const PAGES = ['findings', 'roadmap'];

function svgUri(file) {
	return `data:image/svg+xml;base64,${fs.readFileSync(file).toString('base64')}`;
}

function css(b) {
	const a = b.app;
	return `
html:root, html:root[data-look] {
	color-scheme: ${b.scheme} !important;
	--page: ${a.page} !important; --surface: ${a.surface} !important; --ink: ${a.ink} !important;
	--ink-2: ${a.ink2} !important; --muted: ${a.muted} !important; --hairline: ${a.hairline} !important;
	--border: color-mix(in srgb, ${a.ink} 18%, transparent) !important;
	--accent: ${a.accent} !important; --accent-hover: ${a.accentHover} !important; --link: ${a.link} !important;
}
.brand { font-family: ${b.brandFont}; font-size: ${b.brandSize ?? 16}px; font-weight: normal;
	letter-spacing: ${b.brandTracking ?? 'normal'}; ${b.brandCase === 'upper' ? 'text-transform: uppercase;' : ''} gap: 10px; padding: 2px 8px 6px; }
.brand img { width: 30px; height: 30px; border-radius: 4px; }
.brand .lit { color: ${b.lit ?? 'inherit'}; }
.page h1, .page-head h1 { font-family: ${b.headFont}; font-weight: ${b.headWeight ?? 600}; letter-spacing: 0.005em; }
.button.primary { color: ${b.onAccent} !important; }
`;
}

const c = await openChrome();
const s = c.send;
try {
	await s('Page.setBypassCSP', { enabled: true });
	let first = true;
	for (const b of BRANDS) {
		if (only.length && !only.some((o) => b.slug.startsWith(o))) continue;
		const dir = path.join(OUT, b.slug);
		const fav = path.join(dir, fs.existsSync(path.join(dir, 'favicon-32.svg')) ? 'favicon-32.svg' : 'favicon.svg');
		const out = path.join(OUT, 'mockups', b.slug);
		fs.mkdirSync(out, { recursive: true });
		await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: b.scheme }] });
		await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
		if (first) {
			await s('Page.navigate', { url });
			await new Promise((r) => setTimeout(r, 2500));
			first = false;
		}
		for (const page of PAGES) {
			await s('Runtime.evaluate', { expression: `location.hash = '#/${page}'` });
			await new Promise((r) => setTimeout(r, 1500));
			const brand = JSON.stringify({ css: css(b), fav: svgUri(fav), lit: Boolean(b.lit) });
			const { exceptionDetails } = await s('Runtime.evaluate', {
				awaitPromise: true,
				expression: `(async () => {
					const b = ${brand};
					let st = document.getElementById('mock-brand');
					if (!st) { st = document.createElement('style'); st.id = 'mock-brand'; document.head.append(st); }
					st.textContent = b.css;
					const a = document.querySelector('.brand');
					const img = a.querySelector('img');
					img.src = b.fav; img.width = 30; img.height = 30;
					for (const n of [...a.childNodes]) if (n.nodeType === 3) n.remove();
					a.querySelectorAll('span').forEach((x) => x.remove());
					const name = document.createElement('span');
					if (b.lit) { const d = document.createElement('span'); d.textContent = 'Porch'; const l = document.createElement('span'); l.className = 'lit'; l.textContent = 'light'; name.append(d, l); }
					else name.textContent = 'Porchlight';
					a.append(name);
					// The owner's copy rule: the page never says "this Mac".
					const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
					for (let n; (n = walk.nextNode()); ) n.nodeValue = n.nodeValue.replace(/\\bThis Mac\\b/g, 'This computer').replace(/\\bthis Mac\\b/g, 'this computer');
					window.scrollTo(0, 0);
					await document.fonts.ready;
					await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				})()`,
			});
			if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
			const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
			fs.writeFileSync(path.join(out, `app-${page}.png`), Buffer.from(data, 'base64'));
		}
		console.log(`app shots: ${b.slug}`);
	}
} finally {
	await c.close();
}
