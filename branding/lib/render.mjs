// Render SVGs to PNG at exact device pixels with headless Chrome over the
// DevTools pipe (no network port).
//
//   node render.mjs 01-caged-bulb-pixel [02-... ...]   render a concept's PNGs + review sheet
//   node render.mjs --page file.html out.png W H       screenshot an HTML page
//
// Per concept: favicon.svg -> favicon-16.png, favicon-32.png (favicon-32.svg overrides the 32),
// icon.svg -> icon-128.png, icon-512.png (icon-128.svg overrides the 128), hero.svg -> hero.png.
// The review sheet goes to $BRAND_SCRATCH/review/<slug>.png (scratch, not the repo).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { OUT, SCRATCH } from './svg.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(SCRATCH, 'tmp');
fs.mkdirSync(TMP, { recursive: true });

export async function openChrome() {
  const udd = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-pipe',
      `--user-data-dir=${udd}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--force-color-profile=srgb',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--metrics-recording-only',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  proc.stdio[2].on('data', (d) => (stderr += d));
  const toChrome = proc.stdio[3];
  const fromChrome = proc.stdio[4];
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;
  let buf = '';
  const dec = new StringDecoder('utf8');
  fromChrome.on('data', (chunk) => {
    buf += dec.write(chunk);
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else for (const l of listeners) l(msg);
    }
  });
  proc.on('exit', (code) => {
    for (const { rej } of pending.values()) rej(new Error(`chrome exited ${code}: ${stderr.slice(-2000)}`));
  });
  const send = (method, params = {}, sessionId) => {
    const id = ++nextId;
    toChrome.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((res, rej) => pending.set(id, { res, rej }));
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

  const waitLoad = () =>
    new Promise((res) => {
      const l = (msg) => {
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
          listeners.delete(l);
          res();
        }
      };
      listeners.add(l);
    });

  async function gotoPage(url, w, h) {
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const loaded = waitLoad();
    await s('Page.navigate', { url });
    await loaded;
    await s('Runtime.evaluate', {
      expression:
        'Promise.race([Promise.all([...document.images].map(i => i.decode().catch(() => null))), new Promise(r => setTimeout(r, 6000))]).then(() => document.fonts.ready).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))',
      awaitPromise: true,
    });
  }

  async function shot(out, w, h) {
    const { data } = await s('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
      captureBeyondViewport: true,
    });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
  }

  // Render one SVG file at exactly w x h pixels.
  async function renderSvg(svgPath, out, w, h) {
    const html = path.join(TMP, `wrap-${process.pid}.html`);
    const src = pathToFileURL(svgPath).href + `?v=${Date.now()}`;
    fs.writeFileSync(
      html,
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}img{display:block;width:${w}px;height:${h}px}</style></head><body><img src="${src}"></body></html>`,
    );
    await gotoPage(pathToFileURL(html).href, w, h);
    await shot(out, w, h);
  }

  async function renderPage(htmlPath, out, w, h) {
    await gotoPage(pathToFileURL(htmlPath).href + `?v=${Date.now()}`, w, typeof h === 'number' ? h : 800);
    if (h === 'auto' || !h) {
      const { result } = await s('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
      h = result.value;
      await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    }
    await shot(out, w, h);
    return h;
  }

  async function close() {
    try {
      await send('Browser.close');
    } catch {}
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }

  return { renderSvg, renderPage, close, send: s };
}

function reviewHtml(slug) {
  const d = pathToFileURL(path.join(OUT, slug)).href;
  const v = `?v=${Date.now()}`;
  const markDark = fs.existsSync(path.join(OUT, slug, 'mark-dark.svg')) ? 'mark-dark.svg' : 'mark.svg';
  const logoDark = fs.existsSync(path.join(OUT, slug, 'logo-dark.svg')) ? 'logo-dark.svg' : 'logo.svg';
  const notes = fs.existsSync(path.join(OUT, slug, 'notes.md'))
    ? fs.readFileSync(path.join(OUT, slug, 'notes.md'), 'utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    : '(no notes)';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#8a8a8a;font:13px Menlo;color:#111;width:1400px}
  .row{display:flex;gap:16px;padding:16px 16px 0}
  .px{image-rendering:pixelated}
  .tile{display:flex;align-items:center;justify-content:center;gap:14px;padding:12px}
  .light{background:#f4f1ea}.dark{background:#16181c;color:#ddd}
  .col{display:flex;flex-direction:column;gap:12px}
  pre{white-space:pre-wrap;margin:0;padding:10px 16px 16px;font:12px Menlo}
  </style></head><body>
  <div class="row">
    <img src="${d}/hero.png${v}" width="960" height="480">
    <div class="col" style="width:392px">
      <div class="tile light"><img src="${d}/icon-128.png${v}" width="128" height="128"><img src="${d}/favicon-32.png${v}" width="32" height="32"><img src="${d}/favicon-16.png${v}" width="16" height="16"></div>
      <div class="tile dark"><img src="${d}/icon-128.png${v}" width="128" height="128"><img src="${d}/favicon-32.png${v}" width="32" height="32"><img src="${d}/favicon-16.png${v}" width="16" height="16"></div>
      <div class="tile light"><img class="px" src="${d}/favicon-16.png${v}" width="128" height="128"><img class="px" src="${d}/favicon-32.png${v}" width="128" height="128"></div>
    </div>
  </div>
  <div class="row">
    <div class="tile light" style="width:640px;height:200px;padding:0"><img src="${d}/logo.svg${v}" width="640" height="200"></div>
    <div class="tile dark" style="width:200px;height:200px;padding:0"><img src="${d}/${markDark}${v}" width="200" height="200"></div>
    <div class="tile light" style="width:200px;height:200px;padding:0"><img src="${d}/mark.svg${v}" width="200" height="200"></div>
    <div class="tile" style="width:200px;height:200px;padding:0"><img src="${d}/icon-512.png${v}" width="200" height="200"></div>
  </div>
  <div class="row">
    <div class="tile dark" style="width:640px;height:200px;padding:0"><img src="${d}/${logoDark}${v}" width="640" height="200"></div>
    <img src="${d}/hero.png${v}" width="560" height="280">
  </div>
  <pre>${slug}\n${notes}</pre>
  </body></html>`;
}

export async function renderConcept(c, slug) {
  const dir = path.join(OUT, slug);
  const f = (n) => path.join(dir, n);
  const has = (n) => fs.existsSync(f(n));
  await c.renderSvg(f('favicon.svg'), f('favicon-16.png'), 16, 16);
  await c.renderSvg(f(has('favicon-32.svg') ? 'favicon-32.svg' : 'favicon.svg'), f('favicon-32.png'), 32, 32);
  await c.renderSvg(f(has('icon-128.svg') ? 'icon-128.svg' : 'icon.svg'), f('icon-128.png'), 128, 128);
  await c.renderSvg(f('icon.svg'), f('icon-512.png'), 512, 512);
  await c.renderSvg(f('hero.svg'), f('hero.png'), 1280, 640);
  const rh = path.join(TMP, `review-${slug}.html`);
  fs.writeFileSync(rh, reviewHtml(slug));
  const out = path.join(SCRATCH, 'review', `${slug}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await c.renderPage(rh, out, 1400, 'auto');
  console.log(`rendered ${slug} -> review ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const c = await openChrome();
  try {
    if (args[0] === '--page') {
      const h = await c.renderPage(path.resolve(args[1]), path.resolve(args[2]), Number(args[3]), args[4] === 'auto' ? 'auto' : Number(args[4]));
      console.log(`page -> ${args[2]} (${args[3]}x${h})`);
    } else if (args[0] === '--svg') {
      await c.renderSvg(path.resolve(args[1]), path.resolve(args[2]), Number(args[3]), Number(args[4]));
      console.log(`svg -> ${args[2]}`);
    } else {
      for (const slug of args) await renderConcept(c, slug);
    }
  } finally {
    await c.close();
  }
}
