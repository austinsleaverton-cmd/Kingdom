// Headless invalidation/culling regression tests. Uses the project's TypeScript dependency,
// no browser/Phaser boot required. Browser/iPad frame times still need a real playtest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const compile = (path) => {
  const source = fs.readFileSync(new URL(path, root), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, `Syntax: ${path}`);
  return result.outputText;
};
const context2d = () => new Proxy({}, { get: (o, key) => key in o ? o[key] : (..._args) => {}, set: (o, key, value) => (o[key] = value, true) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context2d() }) };
const geometry = { exports: {} };
vm.runInNewContext(compile('src/scenes/mapCache.ts'), { exports: geometry.exports, require: () => ({}) });
const { center, chunkKeys, terrainStamp, viewBounds, intersects, GROUND_FRAME } = geometry.exports;
assert.equal(GROUND_FRAME.grass, 'grass_01.png');
assert.equal(GROUND_FRAME.sand, 'sand_01.png');
assert.equal(center({ col: 0, row: 1 }).y, 42);
assert.deepEqual(JSON.parse(JSON.stringify(viewBounds(100, 200, 1000, 800, 2))), { x: 350, y: 400, width: 500, height: 400 });
assert(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 10, height: 10 }));
assert(!intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }));
assert(chunkKeys({ col: 0, row: 0 }).includes('-1,-1'), 'negative map edges cached');
const tile = (col, row) => ({ col, row, height: 2, terrain: 'grass', city: false, improvement: null, road: false });
const t = tile(10, 10), initial = terrainStamp(t, true, 0);
assert.equal(terrainStamp(t, false, 0), '?');
for (const [field, value] of Object.entries({ height: 4, terrain: 'hills', city: true, improvement: 'farm', road: true })) {
  assert.notEqual(terrainStamp({ ...t, [field]: value }, true, 0), initial, `${field} invalidates terrain`);
}
assert.notEqual(terrainStamp(t, true, 1), initial, 'neighbor road change invalidates');
assert.equal(terrainStamp({ ...t, road: true }, false, 63), '?', 'hidden road information excluded');

let uploads = 0, created = 0, removed = 0;
const textures = new Map();
const images = [];
const frame = { cutX: 0, cutY: 0, cutWidth: 120, cutHeight: 140, height: 140 };
const atlas = { has: () => true, get: () => frame, getSourceImage: () => ({}), setFilter: () => {} };
const scene = {
  events: { once: () => {} },
  cameras: { main: { scrollX: 0, scrollY: 0, width: 800, height: 600, zoom: 1 } },
  textures: {
    exists: () => true,
    get: () => atlas,
    createCanvas: (key, width, height) => {
      assert(!textures.has(key), 'unique live texture keys');
      const texture = { key, width, height, context: context2d(), refresh: () => { uploads++; }, setFilter: () => {} };
      textures.set(key, texture); created++; return texture;
    },
    remove: (key) => { assert(textures.delete(key)); removed++; },
  },
  add: { image: (x, y, key) => {
    const image = { x, y, key, visible: true, destroyed: false };
    for (const method of ['setOrigin', 'setDepth', 'setFrame']) image[method] = () => image;
    image.setScale = (v) => (image.scale = v, image);
    image.setPosition = (a, b) => (image.x = a, image.y = b, image);
    image.setVisible = (v) => (image.visible = v, image);
    image.destroy = () => { image.destroyed = true; };
    images.push(image); return image;
  } },
};
const renderer = { exports: {} };
vm.runInNewContext(compile('src/scenes/mapArt.ts'), {
  exports: renderer.exports,
  require: (name) => name === './mapCache' ? geometry.exports : { default: { Scenes: { Events: { SHUTDOWN: 'shutdown' } }, Textures: { FilterMode: { LINEAR: 1 } } } },
  document: globalThis.document, console,
});
compile('src/scenes/MapScene.ts');
const { HexArt } = renderer.exports;
const art = new HexArt(scene, 28, { tiles: 0.05, props: 0.08, keeps: 1.1 });
const tiles = Array.from({ length: 7000 }, (_, i) => tile(i % 100, Math.floor(i / 100)));
const get = (c, r) => c >= 0 && c < 100 && r >= 0 && r < 70 ? tiles[r * 100 + c] : undefined;
// Clockwise neighbor order is immaterial to stamp tests; reciprocal adjacency matters.
const neighbor = (t, d) => {
  const odd = t.row & 1;
  const dirs = [[1, 0], [odd, 1], [odd - 1, 1], [-1, 0], [odd - 1, -1], [odd, -1]];
  return get(t.col + dirs[d][0], t.row + dirs[d][1]);
};
const all = () => true;
art.drawMap(tiles, all, neighbor);
assert(uploads > 0 && uploads < 20, 'initial viewport bakes a few chunks, not the whole Huge map');
let before = uploads;
for (let i = 0; i < 20; i++) art.drawMap(tiles, all, neighbor);
assert.equal(uploads, before, 'selection-only redraws perform zero terrain uploads');
const changed = get(5, 5);
changed.improvement = 'farm';
art.drawMap(tiles, all, neighbor);
assert(uploads > before && uploads - before <= 4, 'farm rebuilds local chunks only');
before = uploads;
get(95, 65).improvement = 'forest';
art.drawMap(tiles, all, neighbor);
assert.equal(uploads, before, 'offscreen changes do not paint/upload');
scene.cameras.main.scrollX = center(get(95, 65)).x - 400;
scene.cameras.main.scrollY = center(get(95, 65)).y - 300;
art.updateView(true);
assert(uploads > before, 'camera pan builds newly visible chunks including dirty offscreen changes');
before = uploads;
art.updateView(true);
assert.equal(uploads, before, 'stationary camera does not repaint');
art.drawMap(tiles, () => false, neighbor);
assert(uploads > before, 'hot-seat exploration change refreshes visible chunks');
assert.equal(art.stamps.get(get(95, 65)), '?', 'hidden terrain cached without details');
before = uploads;
get(95, 65).road = true;
art.drawMap(tiles, () => false, neighbor);
assert.equal(uploads, before, 'hidden terrain edits do not reveal information');
scene.cameras.main.scrollX = 0; scene.cameras.main.scrollY = 0; scene.cameras.main.zoom = 0.3;
art.drawMap(tiles, all, neighbor);
assert([...textures.values()].some((v) => v.width === 256), 'distant zoom uses bounded half-resolution textures');
art.updateView(false);
assert(images.every((i) => i.destroyed || !i.visible), 'menu/city/handoff hides chunk scenery');
scene.cameras.main.zoom = 1;
art.drawMap(tiles, all, neighbor);
const roadA = get(10, 6), roadB = get(11, 6);
roadA.road = true; roadB.road = true;
art.drawMap(tiles, all, neighbor);
before = uploads;
roadB.road = false;
art.drawMap(tiles, all, neighbor);
assert(uploads > before, 'road neighbor removal invalidates both half-road endpoints');
const oldImages = [...images];
art.drawMap([tile(0, 0)], all, () => undefined);
assert(oldImages.every((i) => i.destroyed), 'new game releases the old map textures/images');
art.destroy();
assert.equal(textures.size, 0, 'shutdown releases every chunk texture');
assert.equal(created, removed, 'no leaked chunk allocations');
console.log('PASS: Huge-map dirty chunks, local edits, roads, fog/hot-seat, camera culling, zoom LOD, new game and cleanup.');
console.log('These are headless regression checks, not browser/iPad FPS measurements.');
