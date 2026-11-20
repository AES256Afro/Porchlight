// Mockups of each shortlisted brand in use: the app window, a landing page, the Dock with a
// notification, icon sizes and browser tabs, the installer window and stickers on a laptop lid.
// Then one board per brand and a gallery page, mockups.html, beside the concepts.
//
//   node scenes.mjs [slug ...]
//
// Needs app-shots.mjs to have run first (the app window is a real screenshot). Everything else
// is drawn here from the concept's own files. Every scene uses the same neutral desktop, so the
// brands are compared on equal ground. Nothing here shows the owner's data or machines.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openChrome } from '../lib/render.mjs';
import { OUT, SCRATCH } from '../lib/svg.mjs';
import { BRANDS, SMALL_LINE } from './brands.mjs';

const only = process.argv.slice(2);
const TMP = path.join(SCRATCH, 'mockups');
fs.mkdirSync(TMP, { recursive: true });
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NEUTRAL_DESK = 'radial-gradient(120% 90% at 20% 10%, #8fa3b8 0%, #5d7189 45%, #34435a 100%)';
const LIGHTS = `<span class="tl"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>`;
const BASE_CSS = `
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{font:14px/1.45 system-ui, "Helvetica Neue", sans-serif;-webkit-font-smoothing:antialiased}
.tl{display:inline-flex;gap:8px}.tl i{display:block;width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.25)}
`;

function files(b) {
	const dir = path.join(OUT, b.slug);
	const u = (n) => pathToFileURL(path.join(dir, n)).href;
	const has = (n) => fs.existsSync(path.join(dir, n));
	return {
		hero: u('hero.svg'),
		logo: u('logo.svg'),
		logoDark: u(has('logo-dark.svg') ? 'logo-dark.svg' : 'logo.svg'),
		mark: u('mark.svg'),
		markDark: u(has('mark-dark.svg') ? 'mark-dark.svg' : 'mark.svg'),
		icon: u('icon.svg'),
		icon512: u('icon-512.png'),
		icon128: u('icon-128.png'),
		fav16: u('favicon-16.png'),
		fav32: u('favicon-32.png'),
		favSvg: u(has('favicon-32.svg') ? 'favicon-32.svg' : 'favicon.svg'),
		app: (p) => pathToFileURL(path.join(OUT, 'mockups', b.slug, `app-${p}.png`)).href,
	};
}

const page = (css, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;

// 1. The app window: the real interface in the brand, in a window on the neutral desk.
function appScene(b, f, which) {
	const a = b.app;
	return page(
		`body{width:1600px;height:1000px;background:${NEUTRAL_DESK};display:grid;place-items:center}
		.win{width:1440px;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.35)}
		.bar{height:34px;background:${a.surface};display:flex;align-items:center;padding:0 14px;position:relative;border-bottom:1px solid ${a.hairline}}
		.bar b{position:absolute;left:0;right:0;text-align:center;font:600 13px system-ui;color:${a.ink2}}
		.win img{display:block;width:1440px;height:900px}`,
		`<div class="win"><div class="bar">${LIGHTS}<b>Porchlight</b></div><img src="${f.app(which)}"></div>`,
	);
}

// 2. A landing page in a browser.
function landingScene(b, f) {
	const a = b.app;
	const dark = b.scheme === 'dark';
	const features = [
		['Your repos', 'Finds passwords, keys and private information in your code and its whole history, and packages with known security holes, before anyone else does.'],
		['Your servers', 'Watches the domains you have proven are yours and tells you what changed: certificates, DNS, and what each one shows the world.'],
		['Your computer', 'Checks updates, built-in protection, what accepts connections and credentials left in files. It only reads, and asks before anything leaves.'],
	];
	return page(
		`body{width:1440px;height:1560px;background:${NEUTRAL_DESK};padding:36px}
		.browser{border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4),0 0 0 1px rgba(0,0,0,.3);background:${a.page};color:${a.ink}}
		.chrome{height:46px;background:${dark ? '#202124' : '#e8e6e1'};display:flex;align-items:center;gap:18px;padding:0 14px}
		.tab{display:flex;align-items:center;gap:8px;height:34px;margin-top:12px;padding:0 14px;border-radius:9px 9px 0 0;background:${dark ? '#35363a' : '#fff'};color:${dark ? '#e8eaed' : '#202124'};font-size:12.5px;width:300px;white-space:nowrap;overflow:hidden}
		.tab img{width:16px;height:16px}
		.addr{height:38px;background:${dark ? '#35363a' : '#fff'};display:flex;align-items:center;padding:0 16px}
		.pill{flex:1;height:28px;border-radius:14px;background:${dark ? '#202124' : '#f1efea'};display:flex;align-items:center;gap:8px;padding:0 14px;color:${dark ? '#bdc1c6' : '#5f6368'};font-size:13px}
		.site{background:${a.page}}
		header{display:flex;align-items:center;justify-content:space-between;padding:18px 48px;background:${a.surface};border-bottom:1px solid ${a.hairline}}
		header img{height:58px;display:block}
		nav{display:flex;align-items:center;gap:30px;font-size:15px;color:${a.ink2}}
		.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;text-decoration:none}
		.primary{background:${a.accent};color:${b.onAccent}}
		.ghost{border:1px solid color-mix(in srgb, ${a.ink} 25%, transparent);color:${a.ink}}
		.hero{display:block;width:100%;aspect-ratio:2/1}
		.intro{padding:56px 48px 20px;display:grid;grid-template-columns:1.15fr 1fr;gap:56px;align-items:end}
		h1{margin:0;font-family:${b.headFont};font-weight:${b.headWeight ?? 700};font-size:54px;line-height:1.04;letter-spacing:-0.005em}
		.intro p{margin:0 0 18px;font-size:18px;line-height:1.55;color:${a.ink2}}
		.ctas{display:flex;gap:12px}
		.small{font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;color:${a.muted};margin-top:14px}
		.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:32px 48px 56px}
		.col{background:${a.surface};border:1px solid ${a.hairline};border-radius:12px;padding:24px}
		.col h3{margin:0 0 8px;font-family:${b.headFont};font-weight:${b.headWeight ?? 700};font-size:22px}
		.col p{margin:0;color:${a.ink2};font-size:15px;line-height:1.55}
		.num{font:600 12px ui-monospace, Menlo;color:${a.link};letter-spacing:.1em;margin-bottom:10px}`,
		`<div class="browser">
			<div class="chrome">${LIGHTS}<div class="tab"><img src="${f.favSvg}">Porchlight · ${esc(b.tagline)}</div></div>
			<div class="addr"><div class="pill">&#x1F512;&#xFE0E; porchlight</div></div>
			<div class="site">
				<header><img src="${dark ? f.logoDark : f.logo}"><nav><span>Features</span><span>How it works</span><span>Source</span><span class="btn primary">Download</span></nav></header>
				<img class="hero" src="${f.hero}">
				<div class="intro">
					<h1>${esc(b.tagline)}</h1>
					<div><p>Porchlight keeps private information out of your repos, your projects and anything publicly searchable. It runs on your own computer, and nothing leaves it unless you say so.</p>
					<div class="ctas"><span class="btn primary">Download for macOS</span><span class="btn ghost">Read the source</span></div>
					<div class="small">${esc(SMALL_LINE)}</div></div>
				</div>
				<div class="cols">${features.map(([h, p], i) => `<div class="col"><div class="num">0${i + 1}</div><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>
			</div>
		</div>`,
	);
}

// Plain stand-ins for other apps in the Dock: flat tiles, no real product.
const DOCK_TILES = [
	['#e9e7e2', '#9aa1ab', 'circle'], ['#3b82c4', '#d7e9f8', 'bars'], ['#f1f0ec', '#d55b3e', 'grid'], ['#2f3237', '#9ad27a', 'prompt'],
	['#fbcf4f', '#7a5a0e', 'lines'], ['#6e5bb8', '#e6e0fb', 'circle'], ['#ffffff', '#3b82c4', 'grid'], ['#4aa774', '#e2f5e8', 'bars'],
];
function tile([bg, fg, shape]) {
	const g = {
		circle: `<circle cx="32" cy="32" r="14" fill="none" stroke="${fg}" stroke-width="5"/>`,
		bars: `<rect x="17" y="34" width="7" height="13" rx="2" fill="${fg}"/><rect x="28.5" y="24" width="7" height="23" rx="2" fill="${fg}"/><rect x="40" y="17" width="7" height="30" rx="2" fill="${fg}"/>`,
		grid: `<g fill="${fg}"><rect x="17" y="17" width="12" height="12" rx="3"/><rect x="35" y="17" width="12" height="12" rx="3"/><rect x="17" y="35" width="12" height="12" rx="3"/><rect x="35" y="35" width="12" height="12" rx="3" opacity=".5"/></g>`,
		prompt: `<path d="M18 22l10 10-10 10" fill="none" stroke="${fg}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="31" y="40" width="15" height="4.5" rx="2" fill="${fg}"/>`,
		lines: `<g fill="${fg}"><rect x="17" y="19" width="30" height="4" rx="2"/><rect x="17" y="28" width="24" height="4" rx="2"/><rect x="17" y="37" width="30" height="4" rx="2"/><rect x="17" y="46" width="18" height="4" rx="2"/></g>`,
	}[shape];
	return `<svg viewBox="0 0 64 64" width="64" height="64"><rect x="2" y="2" width="60" height="60" rx="14" fill="${bg}"/>${g}</svg>`;
}

// 3. The Dock, with a notification from the app.
function dockScene(b, f) {
	const left = DOCK_TILES.slice(1, 5).map((t) => `<div class="it">${tile(t)}</div>`).join('');
	const right = DOCK_TILES.slice(5, 7).map((t) => `<div class="it">${tile(t)}</div>`).join('');
	return page(
		`body{width:1200px;height:720px;background:${NEUTRAL_DESK};position:relative;overflow:hidden}
		.menu{position:absolute;inset:0 0 auto 0;height:30px;background:rgba(255,255,255,.28);backdrop-filter:blur(20px);display:flex;align-items:center;gap:22px;padding:0 18px;color:#111;font-size:13.5px}
		.menu b{font-weight:700}.menu .r{margin-left:auto}
		.note{position:absolute;top:46px;right:16px;width:372px;border-radius:16px;background:rgba(246,246,246,.86);backdrop-filter:blur(30px);box-shadow:0 10px 30px rgba(0,0,0,.22);display:flex;gap:12px;padding:13px 14px;color:#111}
		.note img{width:40px;height:40px;flex:none}
		.note .t{display:flex;justify-content:space-between;font-weight:600;font-size:13.5px}.note .t span{font-weight:400;color:#666;font-size:12px}
		.note p{margin:2px 0 0;font-size:13px;line-height:1.35}
		.dock{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);display:flex;align-items:flex-end;gap:6px;padding:8px 10px 10px;border-radius:24px;background:rgba(255,255,255,.26);backdrop-filter:blur(30px);box-shadow:0 0 0 1px rgba(255,255,255,.25) inset,0 10px 30px rgba(0,0,0,.25)}
		.it{width:76px;height:76px;position:relative}.it img,.it svg{width:76px;height:76px;display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))}
		.pl img{width:76px;height:76px}.pl::after{content:"";position:absolute;left:50%;bottom:-7px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:rgba(0,0,0,.65)}
		.sep{width:1px;height:66px;background:rgba(0,0,0,.18);margin:0 6px 4px}
		.tip{position:absolute;bottom:94px;left:50%;transform:translateX(-50%);background:rgba(240,240,240,.92);color:#111;font-size:13px;padding:4px 11px;border-radius:7px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.2)}
`,
		`<div class="menu"><b>Porchlight</b><span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span><span class="r">Fri 10:08</span></div>
		<div class="note"><img src="${f.icon128}"><div style="flex:1"><div class="t">Porchlight <span>now</span></div><p>storefront: a key was committed in config/deploy.js. 2 new findings since the last scan.</p></div></div>
		<div class="dock">${left}<div class="it pl"><span class="tip">Porchlight</span><img src="${f.icon128}"></div>${right}<div class="sep"></div><div class="it">${tile(['#d8d8d8', '#8a8a8a', 'lines'])}</div></div>`,
	);
}

// 4. Favicons where they live: browser tabs, light and dark, and the sidebar mark.
function tabsScene(b, f) {
	const strip = (dark) => {
		const bg = dark ? '#1f1f22' : '#dedcd7';
		const on = dark ? '#3a3a3e' : '#ffffff';
		const ink = dark ? '#e8eaed' : '#202124';
		const off = dark ? '#a8abb0' : '#55585d';
		const ph = (c) => `<span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:${c}"></span>`;
		return `<div class="strip" style="background:${bg}">${LIGHTS}
			<div class="t" style="color:${off}">${ph(dark ? '#5b6b7d' : '#9fb2c6')}Inbox</div>
			<div class="t on" style="background:${on};color:${ink}"><img src="${f.fav16}" width="16" height="16">Findings · Porchlight</div>
			<div class="t" style="color:${off}">${ph(dark ? '#6d6253' : '#c9b48f')}Release notes</div>
			<div class="t" style="color:${off}">${ph(dark ? '#4f6b58' : '#9cc3a6')}Docs</div></div>`;
	};
	const sizes = (bg, fg) => `<div class="panel" style="background:${bg};color:${fg}">
		<figure><img src="${f.icon512}" width="128" height="128">128</figure><figure><img src="${f.icon128}" width="64" height="64">64</figure><figure><img src="${f.icon128}" width="32" height="32">32</figure>
		<span class="gap"></span>
		<figure><img src="${f.fav32}" width="32" height="32">favicon 32</figure><figure><img src="${f.fav16}" width="16" height="16">16</figure>
		<figure><img class="px" src="${f.fav16}" width="96" height="96">16 at 6×</figure></div>`;
	return page(
		`body{width:1600px;background:#cfccc6;padding:36px;display:grid;gap:22px;align-content:start}
		.strip{height:46px;border-radius:10px;display:flex;align-items:flex-end;gap:4px;padding:0 12px;overflow:hidden}
		.strip .tl{align-self:center;margin-right:14px}
		.t{display:flex;align-items:center;gap:9px;height:36px;padding:0 16px;width:250px;font-size:13px;border-radius:9px 9px 0 0;white-space:nowrap}
		.row{display:grid;grid-template-columns:1fr 1fr;gap:22px}
		.panel{border-radius:12px;padding:24px 26px;display:flex;align-items:flex-end;gap:26px}
		.panel .gap{flex:1}
		.panel figure{margin:0;text-align:center;font:12px ui-monospace, Menlo;opacity:.8}
		.panel img{display:block;margin:0 auto 8px}.px{image-rendering:pixelated}`,
		`${strip(false)}${strip(true)}
		<div class="row">${sizes('#f6f4ef', '#222')}${sizes('#18181a', '#ddd')}</div>`,
	);
}

// 5. The installer window from the DMG.
function installerScene(b, f) {
	const a = b.app;
	const folder = `<svg viewBox="0 0 160 128" width="150" height="120"><path d="M8 22c0-6 4-10 10-10h40l12 12h72c6 0 10 4 10 10v8H8z" fill="#3d97e0"/><rect x="8" y="34" width="144" height="86" rx="10" fill="#6cb7f2"/><rect x="8" y="34" width="144" height="10" fill="#8cc9f6"/><g fill="#3d97e0" opacity=".55"><path d="M80 58l18 36h-8l-4-9H74l-4 9h-8zm-3.5 21h7L80 70z"/></g></svg>`;
	const arrow = `<svg viewBox="0 0 220 60" width="220" height="60"><path d="M10 32 C70 6,140 6,192 28" fill="none" stroke="${a.ink}" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 13"/><path d="M178 12l22 18-27 9" fill="none" stroke="${a.ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
	return page(
		`body{width:1280px;height:800px;background:${NEUTRAL_DESK};display:grid;place-items:center}
		.win{width:1000px;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.35)}
		.bar{height:38px;background:#ececec;display:flex;align-items:center;padding:0 14px;position:relative;border-bottom:1px solid #d0d0d0}
		.bar b{position:absolute;left:0;right:0;text-align:center;font:600 13px system-ui;color:#444}
		.body{height:580px;position:relative;background:${a.page};color:${a.ink};overflow:hidden}
		.bg{position:absolute;inset:0;background:radial-gradient(60% 70% at 30% 45%, color-mix(in srgb, ${a.link} 22%, transparent), transparent 70%)}
		.items{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:70px;padding-bottom:60px}
		.items figure{margin:0;text-align:center;font:13px system-ui}
		.items img{display:block;filter:drop-shadow(0 8px 14px rgba(0,0,0,.3))}
		.cap{position:absolute;left:0;right:0;bottom:60px;text-align:center}
		.cap h2{margin:0;font-family:${b.headFont};font-weight:${b.headWeight ?? 700};font-size:30px}
		.cap p{margin:6px 0 0;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${a.muted}}`,
		`<div class="win"><div class="bar">${LIGHTS}<b>Porchlight 0.9.0</b></div><div class="body"><div class="bg"></div>
		<div class="items"><figure><img src="${f.icon512}" width="160" height="160">Porchlight</figure>${arrow}<figure>${folder}<div style="height:20px"></div>Applications</figure></div>
		<div class="cap"><h2>Drag Porchlight into Applications.</h2><p>${esc(SMALL_LINE)}</p></div></div></div>`,
	);
}

// 6. Stickers on a laptop lid.
function stickerScene(b, f) {
	const a = b.app;
	const cut = (px) => `drop-shadow(${px}px 0 0 #fff) drop-shadow(-${px}px 0 0 #fff) drop-shadow(0 ${px}px 0 #fff) drop-shadow(0 -${px}px 0 #fff) drop-shadow(0 6px 8px rgba(0,0,0,.35))`;
	return page(
		`body{width:1600px;height:1000px;background:linear-gradient(170deg,#c9c3b8,#a39b8e);position:relative;overflow:hidden}
		.lid{position:absolute;left:150px;top:90px;width:1400px;height:980px;border-radius:34px;background:linear-gradient(150deg,#4a4c51 0%,#36383c 55%,#2b2c30 100%);box-shadow:0 40px 80px rgba(0,0,0,.45),inset 0 0 0 2px rgba(255,255,255,.08)}
		.s{position:absolute}
		.mark{left:300px;top:150px;width:360px;height:360px;transform:rotate(-7deg);filter:${cut(5)}}
		.logo{left:760px;top:220px;width:560px;transform:rotate(4deg);border-radius:14px;overflow:hidden;box-shadow:0 0 0 7px #fff,0 8px 14px rgba(0,0,0,.35);background:${a.surface}}
		.logo img{display:block;width:100%}
		.icon{left:1110px;top:560px;width:220px;height:220px;transform:rotate(9deg);filter:${cut(5)}}
		.tag{left:300px;top:640px;transform:rotate(-3deg);background:${a.page};color:${a.ink};padding:18px 26px;border-radius:999px;box-shadow:0 0 0 6px #fff,0 8px 14px rgba(0,0,0,.35);font-family:${b.headFont};font-weight:${b.headWeight ?? 700};font-size:30px;white-space:nowrap}`,
		`<div class="lid"></div>
		<img class="s mark" src="${b.scheme === 'dark' ? f.markDark : f.mark}">
		<div class="s logo"><img src="${b.scheme === 'dark' ? f.logoDark : f.logo}"></div>
		<img class="s icon" src="${f.icon512}">
		<div class="s tag">${esc(b.tagline)}</div>`,
	);
}

function boardHtml(b) {
	const m = (n) => `${n}.png`;
	const a = b.app;
	return page(
		`body{width:2400px;background:#e9e6df;color:#1b1b1b;padding:44px 48px 52px;font-family:system-ui}
		h1{margin:0;font:700 40px/1.1 system-ui}h1 small{font-weight:400;color:#666;font-size:24px;margin-left:12px}
		.sub{margin:8px 0 26px;color:#444;font-size:19px}.sub i{color:${a.accent}}
		.g{display:grid;gap:22px}
		.r1{grid-template-columns:1500px 1fr}.r2{grid-template-columns:1fr 1fr 1fr}
		img{display:block;width:100%;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
		.col{display:grid;gap:22px;align-content:start}
		.land{height:100%;object-fit:cover;object-position:top}`,
		`<h1>${b.n} ${esc(b.name)}${b.from ? `<small>from ${b.from}</small>` : ''}</h1>
		<p class="sub">“${esc(b.tagline)}” · ${esc(SMALL_LINE)}</p>
		<div class="g r1"><img src="${m('app-scene-findings')}"><div class="col"><img src="${m('dock')}"><img src="${m('installer')}"></div></div>
		<div class="g r2" style="margin-top:22px"><img class="land" src="${m('landing')}" style="height:735px"><div class="col"><img src="${m('tabs')}"><img src="${m('app-scene-roadmap')}"></div><img src="${m('sticker')}"></div>`,
	);
}

async function shot(c, html, out, w, h, scale = 1) {
	const file = path.join(TMP, `${path.basename(path.dirname(out))}-${path.basename(out, '.png')}.html`);
	fs.writeFileSync(file, html);
	await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h ?? 120, deviceScaleFactor: scale, mobile: false });
	await c.send('Page.navigate', { url: pathToFileURL(file).href + `?v=${Date.now()}` });
	await c.send('Runtime.evaluate', {
		awaitPromise: true,
		expression: `(async () => {
			for (let i = 0; i < 100 && document.readyState !== 'complete'; i++) await new Promise((r) => setTimeout(r, 50));
			await Promise.race([Promise.all([...document.images].map((i) => i.decode().catch(() => null))), new Promise((r) => setTimeout(r, 8000))]);
			await document.fonts.ready;
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		})()`,
	});
	if (h == null) {
		const { result } = await c.send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
		h = result.value;
		await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false });
	}
	const { data } = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
}

const c = await openChrome();
try {
	for (const b of BRANDS) {
		if (only.length && !only.some((o) => b.slug.startsWith(o))) continue;
		const f = files(b);
		const dir = path.join(OUT, 'mockups', b.slug);
		fs.mkdirSync(dir, { recursive: true });
		const o = (n) => path.join(dir, `${n}.png`);
		await shot(c, appScene(b, f, 'findings'), o('app-scene-findings'), 1600, 1000);
		await shot(c, appScene(b, f, 'roadmap'), o('app-scene-roadmap'), 1600, 1000);
		await shot(c, landingScene(b, f), o('landing'), 1440, 1560);
		await shot(c, dockScene(b, f), o('dock'), 1200, 720, 2);
		await shot(c, tabsScene(b, f), o('tabs'), 1600, null);
		await shot(c, installerScene(b, f), o('installer'), 1280, 800);
		await shot(c, stickerScene(b, f), o('sticker'), 1600, 1000);
		const board = path.join(dir, 'board.html');
		fs.writeFileSync(board, boardHtml(b));
		await shot(c, fs.readFileSync(board, 'utf8').replace(/src="([\w-]+\.png)"/g, (_, n) => `src="${pathToFileURL(path.join(dir, n)).href}"`), o('board'), 2400, null);
		fs.rmSync(board);
		console.log(`scenes: ${b.slug}`);
	}
} finally {
	await c.close();
}
