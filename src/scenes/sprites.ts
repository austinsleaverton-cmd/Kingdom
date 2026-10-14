// Tiny 8-bit sprites painted from text grids at startup, so there are no image files to manage.
// Each letter is a palette color, '.' is see-through. Every sprite has two frames that loop.
import Phaser from 'phaser';
import type { Improvement } from '../world/tile';
import type { UnitType } from '../world/units';

const PALETTE: Record<string, number> = {
  k: 0x1a1a1a, // boots, outline
  s: 0xf1c27d, // skin
  y: 0xe8c547, // straw hat
  g: 0x3f8f3a, // green cloth
  w: 0x8b5a2b, // wood
  n: 0x9c6b3c, // horse
  m: 0x3b2414, // mane, dark hair
  i: 0x9ca3af, // steel helmet
  l: 0xe5e7eb, // blade, pick head
  c: 0x6b7280, // armor
  b: 0x2563eb, // blue shirt
  o: 0xf97316, // orange work shirt
  r: 0xb91c1c, // red shirt
  a: 0x5b3a1e, // dark hull
  f: 0x7dd3fc, // fish
};

type Frames = string[][];

// Units bob up and down: frame 2 is frame 1 shifted down a pixel
const bob = (rows: string[]): Frames => {
  const blank = '.'.repeat(rows[0].length);
  return [[...rows, blank], [blank, ...rows]];
};

const FARMER: Frames = [
  ['..yyyy..', '.yyyyyy.', '..ssss..', '..ssss.w', '...gg.w.', '..gggw..', '.s.gg...', '...gg...', '..g..g..', '..k..k..'],
  ['..yyyy..', '.yyyyyy.', '..ssss..', '..ssss..', '...gg...', '..ggggs.', '.s.gg.w.', '...gg..w', '..g..g.w', '..k..k..'],
];

const HORSE: Frames = [
  ['......mnn.', '.....mnnnn', 'mnnnnnnn..', 'nnnnnnnn..', '.nnnnnn...', '.n.n.n.n..', '.n.n.n.n..', '.k.k.k.k..'],
  ['..........', '..........', 'mnnnnnm...', 'nnnnnnnnn.', '.nnnnnn.nn', '.n.n.n.n.n', '.n.n.n.n..', '.k.k.k.k..'],
];

const MINER: Frames = [
  ['..iiiy..', '.iiiiii.', '..ssss.l', '..ssss.w', '..ccccw.', '.s.cc...', '...cc...', '...cc...', '..c..c..', '..k..k..'],
  ['..iiiy..', '.iiiiii.', '..ssss..', '..ssss..', '..cccc..', '.s.ccws.', '...cc.w.', '...cc.lw', '..c..cl.', '..k..k..'],
];

const WOODCUTTER: Frames = [
  ['..mmm...', '.mmmmm.l', '..sss.ll', '..sss.w.', '..rrrw..', '.s.rr...', '...rr...', '...rr...', '..r..r..', '..k..k..'],
  ['..mmm...', '.mmmmm..', '..sss...', '..sss...', '..rrrr..', '.s.rr.s.', '...rr.w.', '...rr..w', '..r..rll', '..k..k.l'],
];

const FISHER: Frames = [
  ['..yyyy..w.', '.yyyyyy.w.', '..ssss..w.', '..ssss..w.', '..bbbbsw..', '.s.bb..l..', '...bb...l.', '...bb...l.', '..b..b..f.', '..k..k....'],
  ['..yyyy...w', '.yyyyyy..w', '..ssss...w', '..ssss..w.', '..bbbbsw..', '.s.bb....l', '...bb....l', '...bb...ff', '..b..b....', '..k..k....'],
];

// Boats: hull, sails and oars
const TRIREME = bob(['....l.....', '....ll....', '....lll...', '....llll..', '....w.....', 'wwwwwwwwwa', '.wwwwwwwa.', '.k.k.k.k..']);
const GALLEASS = bob(['..l...l...', '..ll..ll..', '..lll.lll.', '..w...w...', 'wwwwwwwwww', 'wkwkwkwkwa', '.wwwwwwwa.', '..k.k.k...']);
const TRANSPORT = bob(['....w.....', '..lllll...', '..lllll...', '..lllll...', '....w.....', '.nn.w.nn..', 'wwwwwwwwwa', '.aaaaaaaa.']);

const SWORDSMAN = bob(['...iii...l', '..iiiii.l.', '...sss.l..', '...sss.l..', '..ccccsw..', '.s.cccc...', '...cccc...', '...c..c...', '...c..c...', '..kk..kk..']);
const ARCHER = bob(['...ggg..w.', '..ggggg..w', '...sss...w', '...sss...w', '..ggggsl.w', '.s.gggg..w', '...gggg.w.', '...g..g...', '...g..g...', '..kk..kk..']);
const KNIGHT = bob(['....ii....', '...iiii...', '....ss..l.', '...cccc.l.', '...cccc.l.', '......mnn.', '.nnnnnnnnn', 'nnnnnnnn..', '.n.n..n.n.', '.k.k..k.k.']);
const BUILDER = bob(['..yyyy....', '.yyyyyy...', '..ssss.ll.', '..ssss..w.', '..oooow...', '.s.oo.....', '...oo.....', '...oo.....', '..o..o....', '..k..k....']);
const SETTLER = bob(['...mmm....', '..mmmm.ww.', '...ss.wwww', '...ss.wwww', '..bbbbwww.', '.s.bb.....', '...bb.....', '...bb.....', '..b..b....', '..k..k....']);

// Who works each kind of improvement
export const WORKER_SPRITE: Record<Improvement, string> = {
  farm: 'px-farmer', pasture: 'px-horse', mine: 'px-miner', forest: 'px-woodcutter', fishery: 'px-fisher',
};
export const UNIT_SPRITE: Record<UnitType, string> = {
  builder: 'px-builder',
  settler: 'px-settler',
  swordsman: 'px-swordsman',
  archer: 'px-archer',
  knight: 'px-knight',
  trireme: 'px-trireme',
  galleass: 'px-galleass',
  transport: 'px-transport',
};

// Paint every sprite once and register a looping animation under the same key
export function makeSprites(scene: Phaser.Scene): void {
  const all: [string, Frames, number][] = [
    ['px-farmer', FARMER, 2.5],
    ['px-horse', HORSE, 1.2],
    ['px-miner', MINER, 3],
    ['px-woodcutter', WOODCUTTER, 2.5],
    ['px-swordsman', SWORDSMAN, 2],
    ['px-archer', ARCHER, 2],
    ['px-knight', KNIGHT, 2.5],
    ['px-builder', BUILDER, 2],
    ['px-settler', SETTLER, 2],
    ['px-fisher', FISHER, 1.5],
    ['px-trireme', TRIREME, 2],
    ['px-galleass', GALLEASS, 1.5],
    ['px-transport', TRANSPORT, 1.5],
  ];
  for (const [key, frames, rate] of all) {
    if (!scene.textures.exists(key)) paint(scene, key, frames);
    if (!scene.anims.exists(key)) {
      scene.anims.create({ key, frames: frames.map((_, i) => ({ key, frame: String(i) })), frameRate: rate, repeat: -1 });
    }
  }
}

function paint(scene: Phaser.Scene, key: string, frames: Frames): void {
  const w = Math.max(...frames.flat().map((r) => r.length));
  const h = Math.max(...frames.map((f) => f.length));
  const tex = scene.textures.createCanvas(key, w * frames.length, h);
  if (!tex) return;
  const ctx = tex.getContext();
  frames.forEach((rows, f) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = PALETTE[row[x]];
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
