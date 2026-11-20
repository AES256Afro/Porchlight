// One-off: measure glyph positions and ink boxes in Chrome for concept 14.
import { openChrome } from '../lib/render.mjs';
const specs = JSON.parse(process.argv[2]);
const c = await openChrome();
try {
  const expr = `(${async function (specs) {
    const out = [];
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', '2000'); s.setAttribute('height', '400');
    document.body.appendChild(s);
    for (const sp of specs) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '0'); t.setAttribute('y', '200');
      t.setAttribute('font-family', sp.family); t.setAttribute('font-weight', sp.weight); t.setAttribute('font-size', sp.size);
      if (sp.ls) t.setAttribute('letter-spacing', sp.ls);
      t.textContent = sp.text; s.appendChild(t);
      await document.fonts.ready;
      const cv = document.createElement('canvas').getContext('2d');
      cv.font = `${sp.weight} ${sp.size}px "${sp.family}"`;
      const chars = [...sp.text].map((ch, i) => {
        const st = t.getStartPositionOfChar(i).x; const en = t.getEndPositionOfChar(i).x;
        const m = cv.measureText(ch);
        return { ch, x: +st.toFixed(2), adv: +(en - st).toFixed(2), inkL: +(st - m.actualBoundingBoxLeft).toFixed(2), inkR: +(st + m.actualBoundingBoxRight).toFixed(2), asc: +m.actualBoundingBoxAscent.toFixed(2), desc: +m.actualBoundingBoxDescent.toFixed(2) };
      });
      out.push({ text: sp.text, total: +t.getComputedTextLength().toFixed(2), chars });
    }
    return JSON.stringify(out);
  }})(${JSON.stringify(specs)})`;
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(r.result.value ?? JSON.stringify(r));
} finally { await c.close(); }
