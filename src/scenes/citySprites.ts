// Little pixel people inside a city: who's at work on each plot (soldiers drilling at the Barracks,
// a smith at the Workshop, builders on a plot under construction). Same 8-bit style as the map sprites.
// The city screen (CityScene.ts) uses them as Phaser sprites: makeCitySprites paints the extra people once
// and the PLOT_PEOPLE tables say who stands where. The old SVG helpers below are kept for now.
import Phaser from 'phaser';
import type { Building } from '../world/tile';
import { GRIDS, PALETTE, makeSprites } from './sprites';
import type { Frames } from './sprites';

const PAL: Record<string, number> = { ...PALETTE, p: 0x7c3aed, u: 0xf5f5f4, d: 0xfacc15 }; // purple, white robe, gold

// A smith hammering on an anvil
const SMITH: Frames = [
  ['..mmm.....', '..sss..ll.', '..sss..w..', '.oooo.w...', 's.oo.s....', '..oo......', '..oo..cc..', '..oo.cccc.', '.o..o.cc..', '.k..k.cc..'],
  ['..mmm.....', '..sss.....', '..sss.....', '.oooo.....', 's.oo.sw...', '..oo...wll', '..oo..cc..', '..oo.cccc.', '.o..o.cc..', '.k..k.cc..'],
];

// A merchant holding up a gold coin
const MERCHANT: Frames = [
  ['...pp.....', '..pppp....', '..ssss..d.', '..ssss.s..', '.ppppps...', 's.pppp....', '..pppp....', '..pppp....', '..p..p....', '..k..k....'],
  ['...pp.....', '..pppp....', '..ssss....', '..ssss....', '.pppppsd..', 's.pppp....', '..pppp....', '..pppp....', '..p..p....', '..k..k....'],
];

// A priest raising both arms
const PRIEST: Frames = [
  ['s..mmmm..s', '.s.ssss.s.', '..uussuu..', '...uuuu...', '...uddu...', '...uuuu...', '..uuuuuu..', '..uuuuuu..', '.uuuuuuuu.', '..k....k..'],
  ['...mmmm...', '...ssss...', '..uussuu..', '.suuuuuus.', '...uddu...', '...uuuu...', '..uuuuuu..', '..uuuuuu..', '.uuuuuuuu.', '..k....k..'],
];

// A townsperson out for a walk
const VILLAGER: Frames = [
  ['...mmm..', '...sss..', '...sss..', '..bbbb..', '.s.bb.s.', '...bb...', '...bb...', '..b..b..', '.b....b.', '.k....k.'],
  ['...mmm..', '...sss..', '...sss..', '..bbbb..', '..sbbs..', '...bb...', '...bb...', '...bb...', '...bb...', '...kk...'],
];

// ---------- Phaser sprites (city screen) ----------

// One person on the city screen: a sprite key (map sprites from sprites.ts or the extras below) and how fast it loops
export interface PxActor {
  key: string;
  fps: number;
  flip?: boolean; // mirrored, so the pair faces each other
}

const EXTRA: [string, Frames][] = [
  ['px-smith', SMITH],
  ['px-merchant', MERCHANT],
  ['px-priest', PRIEST],
  ['px-villager', VILLAGER],
];

// Who's on each plot: one left of the building, one right
export const PLOT_PEOPLE: Record<Building, PxActor[]> = {
  barracks: [{ key: 'px-swordsman', fps: 4 }, { key: 'px-swordsman', fps: 4, flip: true }],
  workshop: [{ key: 'px-smith', fps: 3 }, { key: 'px-catapult', fps: 1.5, flip: true }],
  mill: [{ key: 'px-farmer', fps: 2.5 }, { key: 'px-settler', fps: 2, flip: true }],
  granary: [{ key: 'px-farmer', fps: 2.5 }, { key: 'px-settler', fps: 2, flip: true }],
  market: [{ key: 'px-merchant', fps: 2 }, { key: 'px-villager', fps: 3, flip: true }],
  harbor: [{ key: 'px-fisher', fps: 1.5 }, { key: 'px-trireme', fps: 2, flip: true }],
  temple: [{ key: 'px-priest', fps: 1.5 }, { key: 'px-villager', fps: 1, flip: true }],
  park: [{ key: 'px-villager', fps: 3 }, { key: 'px-villager', fps: 2.5, flip: true }],
  arena: [{ key: 'px-knight', fps: 2.5 }, { key: 'px-knight', fps: 2.5, flip: true }],
};

// Two builders hammering away on a plot under construction
export const BUILDER_PEOPLE: PxActor[] = [{ key: 'px-builder', fps: 3 }, { key: 'px-builder', fps: 3, flip: true }];

// A guard by the Keep, plus an archer on the walls once it has some
export function keepPeople(walls: number): PxActor[] {
  return walls > 0 ? [{ key: 'px-archer', fps: 1.5 }, { key: 'px-swordsman', fps: 1.5, flip: true }] : [{ key: 'px-swordsman', fps: 1.5, flip: true }];
}

// Paint the city-only people once (the map people come from makeSprites) and register their animations
export function makeCitySprites(scene: Phaser.Scene): void {
  makeSprites(scene);
  for (const [key, frames] of EXTRA) {
    if (!scene.textures.exists(key)) paintPx(scene, key, frames);
    if (!scene.anims.exists(key)) {
      scene.anims.create({ key, frames: frames.map((_, i) => ({ key, frame: String(i) })), frameRate: 2, repeat: -1 });
    }
  }
}

function paintPx(scene: Phaser.Scene, key: string, frames: Frames): void {
  const w = Math.max(...frames.flat().map((r) => r.length));
  const h = Math.max(...frames.map((f) => f.length));
  const tex = scene.textures.createCanvas(key, w * frames.length, h);
  if (!tex) return;
  const ctx = tex.getContext();
  frames.forEach((rows, f) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = PAL[row[x]];
        if (c === undefined) continue;
        ctx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
        ctx.fillRect(f * w + x, y, 1, 1);
      }
    });
    tex.add(String(f), 0, f * w, 0, w, h);
  });
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp pixels when scaled up
}

// ---------- SVG versions (the old City View drawing, no longer used by the city screen) ----------

interface Actor {
  f: Frames;
  fps: number;
  flip?: boolean;
}

const PLOT_ACTORS: Record<Building, Actor[]> = {
  barracks: [{ f: GRIDS.SWORDSMAN, fps: 4 }, { f: GRIDS.SWORDSMAN, fps: 4, flip: true }],
  workshop: [{ f: SMITH, fps: 3 }, { f: GRIDS.CATAPULT, fps: 1.5, flip: true }],
  mill: [{ f: GRIDS.FARMER, fps: 2.5 }, { f: GRIDS.SETTLER, fps: 2, flip: true }],
  granary: [{ f: GRIDS.FARMER, fps: 2.5 }, { f: GRIDS.SETTLER, fps: 2, flip: true }],
  market: [{ f: MERCHANT, fps: 2 }, { f: VILLAGER, fps: 3, flip: true }],
  harbor: [{ f: GRIDS.FISHER, fps: 1.5 }, { f: GRIDS.TRIREME, fps: 2, flip: true }],
  temple: [{ f: PRIEST, fps: 1.5 }, { f: VILLAGER, fps: 1, flip: true }],
  park: [{ f: VILLAGER, fps: 3 }, { f: VILLAGER, fps: 2.5, flip: true }],
  arena: [{ f: GRIDS.KNIGHT, fps: 2.5 }, { f: GRIDS.KNIGHT, fps: 2.5, flip: true }],
};

const BUILDERS: Actor[] = [{ f: GRIDS.BUILDER, fps: 3 }, { f: GRIDS.BUILDER, fps: 3, flip: true }];

export const PX_CSS = `
.k-px .k-f0 { animation: k-px-a var(--d) steps(1, end) infinite; animation-delay: var(--o); }
.k-px .k-f1 { opacity: 0; animation: k-px-b var(--d) steps(1, end) infinite; animation-delay: var(--o); }
@keyframes k-px-a { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 0; } }
@keyframes k-px-b { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .k-px .k-f0, .k-px .k-f1 { animation: none; } }
`;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

// One frame as SVG rects, one rect per run of same-colored pixels
function frameRects(rows: string[]): string {
  let out = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const c = PAL[ch];
      if (c === undefined) {
        x++;
        continue;
      }
      let n = 1;
      while (x + n < row.length && row[x + n] === ch) n++;
      out += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${hex(c)}"/>`;
      x += n;
    }
  });
  return out;
}

const painted = new Map<Frames, string>();
function framesSvg(f: Frames): string {
  let s = painted.get(f);
  if (!s) {
    s = f.map((rows, i) => `<g class="k-f${i}">${frameRects(rows)}</g>`).join('');
    painted.set(f, s);
  }
  return s;
}

// A sprite standing with its feet at (x, y), centered on x
function actor(a: Actor, x: number, y: number, scale: number, delay: number): string {
  const w = Math.max(...a.f.flat().map((r) => r.length));
  const h = Math.max(...a.f.map((rows) => rows.length));
  const left = x - (w * scale) / 2;
  const tx = a.flip ? left + w * scale : left;
  const period = (a.f.length / a.fps).toFixed(2);
  return (
    `<g class="k-px" style="--d:${period}s;--o:-${delay.toFixed(2)}s" pointer-events="none" shape-rendering="crispEdges" ` +
    `transform="translate(${tx.toFixed(1)} ${(y - h * scale).toFixed(1)}) scale(${a.flip ? -scale : scale} ${scale})">${framesSvg(a.f)}</g>`
  );
}

function pair(list: Actor[], x: number, y: number, seed: number): string {
  return list.map((a, k) => actor(a, x + (k === 0 ? -28 : 28), y + 10, 2, (seed * 0.37 + k * 0.21) % 1.5)).join('');
}

// The people working at a finished amenity on the plot centered at (x, y)
export function plotActors(b: Building, x: number, y: number, seed: number): string {
  return pair(PLOT_ACTORS[b], x, y, seed);
}

// Two builders hammering away on a plot under construction
export function builderActors(x: number, y: number, seed: number): string {
  return pair(BUILDERS, x, y, seed);
}

// A guard by the Keep, plus an archer on the walls once it has some
export function keepActors(walls: number): string {
  const guards: Actor[] = walls > 0 ? [{ f: GRIDS.ARCHER, fps: 1.5 }, { f: GRIDS.SWORDSMAN, fps: 1.5, flip: true }] : [{ f: GRIDS.SWORDSMAN, fps: 1.5, flip: true }];
  if (guards.length === 1) return actor(guards[0], 28, 10, 2, 0.3);
  return pair(guards, 0, 0, 3);
}
