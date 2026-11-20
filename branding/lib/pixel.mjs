// Pixel-art helpers: a raster grid that is composited on whole pixels and
// written out as one <path> per colour (runs merged horizontally, then
// vertically). Everything stays on the integer grid, so an SVG with
// shape-rendering="crispEdges" scaled by an integer renders crisp.

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => (v + 0.5) / 16));

export function bayer(x, y) {
  return BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4];
}

export class Grid {
  constructor(w, h, fill = null) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(fill);
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    return this.inside(x, y) ? this.px[y * this.w + x] : undefined;
  }
  set(x, y, c) {
    if (c !== undefined && this.inside(x, y)) this.px[y * this.w + x] = c;
    return this;
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }
  hline(x, y, w, c) {
    return this.rect(x, y, w, 1, c);
  }
  vline(x, y, h, c) {
    return this.rect(x, y, 1, h, c);
  }
  // Paint a hand-drawn map. rows: array of strings, one char per pixel.
  // '.' and ' ' are transparent. Every other char must be in the palette.
  stamp(rows, pal, x0 = 0, y0 = 0, { flipX = false } = {}) {
    rows.forEach((row, j) => {
      const chars = [...row];
      chars.forEach((ch, i) => {
        if (ch === '.' || ch === ' ') return;
        if (!(ch in pal)) throw new Error(`no palette entry for "${ch}" (row ${j}: ${row})`);
        const xi = flipX ? chars.length - 1 - i : i;
        this.set(x0 + xi, y0 + j, pal[ch]);
      });
    });
    return this;
  }
  // Replace colours inside a region by a mapping (used for lighting ramps).
  // level(x, y) returns an integer >= 0; ramps[colour][level-1] is used when level > 0.
  relight(level, ramps, { x = 0, y = 0, w = this.w, h = this.h } = {}) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const c = this.get(i, j);
        const l = level(i, j);
        if (l > 0 && ramps[c]) {
          const r = ramps[c];
          this.set(i, j, r[Math.min(l, r.length) - 1]);
        }
      }
    return this;
  }
  // Light pool with ordered-dithered band edges. thresholds: radii as a
  // fraction of (rx, ry), from the outside in, e.g. [1, 0.7, 0.45].
  // Returns a level function usable by relight().
  static pool({ cx, cy, rx, ry = rx, thresholds, spread = 0.12, clipY = null }) {
    return (x, y) => {
      if (clipY && !clipY(y)) return 0;
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy) + (bayer(x, y) - 0.5) * spread;
      let l = 0;
      for (const t of thresholds) if (d < t) l++;
      return l;
    };
  }
  // Fill an area with a dithered vertical gradient between colour bands.
  // bands: [{y, c}] sorted by y; between consecutive bands the colours are
  // mixed with a 4x4 Bayer pattern.
  vgradient(x, y, w, h, bands) {
    for (let j = y; j < y + h; j++) {
      let k = 0;
      while (k < bands.length - 2 && j >= bands[k + 1].y) k++;
      const a = bands[k];
      const b = bands[k + 1] ?? a;
      const t = b.y === a.y ? 0 : Math.max(0, Math.min(1, (j - a.y) / (b.y - a.y)));
      for (let i = x; i < x + w; i++) this.set(i, j, bayer(i, j) < t ? b.c : a.c);
    }
    return this;
  }
  // Draw a 1px outline around every pixel of colour set `of` where the
  // neighbour is in `onto` (or transparent when onto is null).
  outline(of, color, { onto = null, diagonal = false } = {}) {
    const ofSet = new Set(of);
    const marks = [];
    const dirs = diagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (ofSet.has(c)) continue;
        if (onto ? !onto.includes(c) : c !== null) continue;
        if (dirs.some(([dx, dy]) => ofSet.has(this.get(x + dx, y + dy)))) marks.push([x, y]);
      }
    for (const [x, y] of marks) this.set(x, y, color);
    return this;
  }
  clone() {
    const g = new Grid(this.w, this.h);
    g.px = this.px.slice();
    return g;
  }
  // Copy another grid on top (null pixels are transparent).
  blit(g, x0 = 0, y0 = 0) {
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        const c = g.get(x, y);
        if (c != null) this.set(x0 + x, y0 + y, c);
      }
    return this;
  }
  colours() {
    return [...new Set(this.px.filter((c) => c != null))];
  }
  // One <path> per colour, coordinates in grid units.
  toPaths() {
    const byColour = new Map();
    // horizontal runs per row
    const runs = [];
    for (let y = 0; y < this.h; y++) {
      let x = 0;
      while (x < this.w) {
        const c = this.px[y * this.w + x];
        let e = x + 1;
        while (e < this.w && this.px[y * this.w + e] === c) e++;
        if (c != null) runs.push({ x, y, w: e - x, h: 1, c });
        x = e;
      }
    }
    // merge vertically: same x, w, c on consecutive rows
    const open = new Map();
    const done = [];
    for (const r of runs) {
      const key = `${r.x},${r.w},${r.c}`;
      const prev = open.get(key);
      if (prev && prev.y + prev.h === r.y) {
        prev.h++;
      } else {
        if (prev) done.push(prev);
        open.set(key, { ...r });
      }
    }
    for (const r of open.values()) done.push(r);
    for (const r of done) {
      if (!byColour.has(r.c)) byColour.set(r.c, []);
      byColour.get(r.c).push(`M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`);
    }
    let out = '';
    for (const [c, ds] of byColour) out += `<path fill="${c}" d="${ds.join('')}"/>\n`;
    return out;
  }
}

// A plain proportional pixel font for taglines and small labels.
// 9 rows: 0-1 ascender, 2-6 x-height (caps use rows 0-6), 7-8 descender.
const G = {
  a: ['', '', '.##.', '...#', '.###', '#..#', '.###', '', ''],
  b: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '###.', '', ''],
  c: ['', '', '.###', '#...', '#...', '#...', '.###', '', ''],
  d: ['...#', '...#', '.###', '#..#', '#..#', '#..#', '.###', '', ''],
  e: ['', '', '.##.', '#..#', '####', '#...', '.###', '', ''],
  f: ['.##', '#..', '###', '#..', '#..', '#..', '#..', '', ''],
  g: ['', '', '.###', '#..#', '#..#', '#..#', '.###', '...#', '.##.'],
  h: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '#..#', '', ''],
  i: ['#', '.', '#', '#', '#', '#', '#', '', ''],
  j: ['.#', '..', '.#', '.#', '.#', '.#', '.#', '.#', '#.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#', '', ''],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#', '', ''],
  m: ['', '', '####.', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '', ''],
  n: ['', '', '###.', '#..#', '#..#', '#..#', '#..#', '', ''],
  o: ['', '', '.##.', '#..#', '#..#', '#..#', '.##.', '', ''],
  p: ['', '', '###.', '#..#', '#..#', '#..#', '###.', '#...', '#...'],
  q: ['', '', '.###', '#..#', '#..#', '#..#', '.###', '...#', '...#'],
  r: ['', '', '#.##', '##..', '#...', '#...', '#...', '', ''],
  s: ['', '', '.###', '#...', '.##.', '...#', '###.', '', ''],
  t: ['#..', '#..', '###', '#..', '#..', '#..', '.##', '', ''],
  u: ['', '', '#..#', '#..#', '#..#', '#..#', '.###', '', ''],
  v: ['', '', '#...#', '#...#', '.#.#.', '.#.#.', '..#..', '', ''],
  w: ['', '', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.', '', ''],
  x: ['', '', '#..#', '#..#', '.##.', '#..#', '#..#', '', ''],
  y: ['', '', '#..#', '#..#', '#..#', '#..#', '.###', '...#', '.##.'],
  z: ['', '', '####', '...#', '.##.', '#...', '####', '', ''],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#', '', ''],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.', '', ''],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####', '', ''],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.', '', ''],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####', '', ''],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....', '', ''],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####', '', ''],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#', '', ''],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###', '', ''],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#', '', ''],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####', '', ''],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#', '', ''],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#', '', ''],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.', '', ''],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....', '', ''],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#', '', ''],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.', '', ''],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '', ''],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.', '', ''],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#', '', ''],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..', '', ''],
  '.': ['', '', '', '', '', '', '#', '', ''],
  ',': ['', '', '', '', '', '', '#', '#', ''],
  "'": ['#', '#', '', '', '', '', '', '', ''],
  '’': ['#', '#', '', '', '', '', '', '', ''],
  '-': ['', '', '', '', '###', '', '', '', ''],
  ':': ['', '', '', '#', '', '', '#', '', ''],
  '!': ['#', '#', '#', '#', '#', '', '#', '', ''],
  '?': ['###.', '...#', '...#', '.##.', '.#..', '....', '.#..', '', ''],
  '0': ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.', '', ''],
  '1': ['.#', '##', '.#', '.#', '.#', '.#', '.#', '', ''],
  '2': ['.##.', '#..#', '...#', '..#.', '.#..', '#...', '####', '', ''],
  '3': ['###.', '...#', '...#', '.##.', '...#', '...#', '###.', '', ''],
  '4': ['#..#', '#..#', '#..#', '####', '...#', '...#', '...#', '', ''],
  '7': ['####', '...#', '..#.', '..#.', '.#..', '.#..', '.#..', '', ''],
  '/': ['...#', '...#', '..#.', '.##.', '.#..', '#...', '#...', '', ''],
  '→': ['', '', '..#.', '...#', '####', '...#', '..#.', '', ''],
};
const SPACE = 3;

function glyphWidth(g) {
  return Math.max(...g.map((r) => r.length));
}

export function measureText(text, { gap = 1 } = {}) {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += SPACE;
    else {
      const g = G[ch];
      if (!g) throw new Error(`pixel font has no glyph for "${ch}"`);
      w += glyphWidth(g) + gap;
    }
  }
  return Math.max(0, w - gap);
}

// Draw text with its x-height top at y+2 (rows 0-1 are ascenders).
// Returns the width drawn.
export function drawText(grid, text, x, y, color, { gap = 1, shadow = null, shadowDx = 1, shadowDy = 1 } = {}) {
  const paint = (ox, oy, c) => {
    let cx = ox;
    for (const ch of text) {
      if (ch === ' ') {
        cx += SPACE;
        continue;
      }
      const g = G[ch];
      g.forEach((row, j) => {
        [...row].forEach((p, i) => {
          if (p === '#') grid.set(cx + i, oy + j, c);
        });
      });
      cx += glyphWidth(g) + gap;
    }
    return cx - gap - ox;
  };
  if (shadow) paint(x + shadowDx, y + shadowDy, shadow);
  return paint(x, y, color);
}

export const pixelFont = G;
