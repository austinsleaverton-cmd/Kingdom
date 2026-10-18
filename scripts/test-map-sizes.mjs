// Run after npm install: node scripts/test-map-sizes.mjs
// Transpile the headless world into a temporary directory; browser storage is simulated, no real saves touched.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = fileURLToPath(new URL('../src/world/', import.meta.url));
const out = await mkdtemp(join(tmpdir(), 'kingdom-maps-'));
try {
  await writeFile(join(out, 'package.json'), '{"type":"module"}');
  for (const name of await readdir(source)) {
    if (!name.endsWith('.ts')) continue;
    const text = (await readFile(join(source, name), 'utf8')).replaceAll('import.meta.env.VITE_CHANNEL', "'dev'");
    const built = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
      .replace(/from '(\.\/[A-Za-z0-9_-]+)'/g, "from '$1.js'");
    await writeFile(join(out, name.replace(/\.ts$/, '.js')), built);
  }
  const { GameState, MAP_SIZES } = await import(pathToFileURL(join(out, 'game.js')));
  const { LEGACY_MAP_SIZES, savedMapDimensions } = await import(pathToFileURL(join(out, 'mapSizes.js')));
  const { hexDistance } = await import(pathToFileURL(join(out, 'map.js')));
  const { saveGame, loadGame, saveSummary } = await import(pathToFileURL(join(out, 'save.js')));
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const key = 'kingdom-save-v3-dev';
  const expected = { small: [30, 20], medium: [50, 35], large: [75, 50], huge: [100, 70] };
  const opts = (size, seed = 12345) => ({ size, seed, opponents: 3, freeBuild: false, difficulty: 'normal' });
  function sameWorld(a, b) {
    assert.ok(b, 'save must load');
    assert.equal(b.map.width, a.map.width);
    assert.equal(b.map.height, a.map.height);
    assert.deepEqual(b.map.tiles.map((t) => [t.height, t.owner, t.home, t.city, t.capital, t.pop, t.hp]), a.map.tiles.map((t) => [t.height, t.owner, t.home, t.city, t.capital, t.pop, t.hp]));
    assert.deepEqual(b.units, a.units);
    assert.deepEqual(b.training, a.training);
    assert.deepEqual(b.players.map((p) => [p.gold, p.stone, p.alive]), a.players.map((p) => [p.gold, p.stone, p.alive]));
    assert.deepEqual(b.explored.map((a) => Array.from(a)), a.explored.map((a) => Array.from(a)));
    assert.deepEqual(b.cityNames, a.cityNames);
  }
  for (const size of Object.keys(expected)) {
    const preset = MAP_SIZES[size];
    assert.deepEqual([preset.width, preset.height], expected[size]);
    const state = new GameState(opts(size));
    assert.equal(state.map.tiles.length, preset.width * preset.height);
    saveGame(state);
    sameWorld(state, loadGame());
    assert.ok(saveSummary().sizeLabel.includes(`${preset.width}x${preset.height}`));
    const legacy = new GameState(opts(size), LEGACY_MAP_SIZES[size]);
    saveGame(legacy);
    const raw = JSON.parse(storage.get(key));
    delete raw.mapDimensions;
    storage.set(key, JSON.stringify(raw));
    const restored = loadGame();
    sameWorld(legacy, restored);
    saveGame(restored);
    assert.deepEqual(JSON.parse(storage.get(key)).mapDimensions, LEGACY_MAP_SIZES[size]);
    sameWorld(legacy, loadGame());
    console.log(`${size}: new save, legacy save, migrated save PASS`);
  }
  for (const bad of [null, {}, { width: 0, height: 70 }, { width: 100.5, height: 70 }, { width: 100000, height: 70 }, { width: '100', height: 70 }]) {
    assert.equal(savedMapDimensions('huge', 7000, bad), null);
  }
  assert.equal(savedMapDimensions('huge', 7000), null, 'no guessing a new size for a legacy save');
  assert.equal(savedMapDimensions('huge', 2401), null);
  // Survey spacing across several seeds at every new size. Log measurements rather than claiming browser performance.
  for (const size of Object.keys(expected)) {
    let minSeparation = Infinity;
    let landShare = 0;
    for (const seed of [1, 42, 12345, 987654]) {
      const s = new GameState(opts(size, seed));
      const caps = s.map.tiles.filter((t) => t.capital);
      assert.equal(caps.length, 4);
      for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) {
        minSeparation = Math.min(minSeparation, hexDistance(caps[i], caps[j]));
        assert.ok(hexDistance(caps[i], caps[j]) >= 3, 'capitals must not overlap');
      }
      landShare += s.landCount() / s.map.tiles.length;
    }
    console.log(`${size}: minimum capital spacing ${minSeparation} hexes; mean land ${Math.round(landShare / 4 * 100)}%`);
  }
  const huge = new GameState(opts('huge'));
  const cap = huge.cities().find((c) => c.owner === 0);
  const scout = { id: 1, type: 'scout', owner: 0, col: cap.col, row: cap.row, moves: 3, acted: false, hp: 15 };
  huge.units.push(scout);
  huge.nextUnitId = 2;
  assert.ok(huge.exploreCheck(scout).ok);
  assert.ok(huge.setExplore(scout, true).ok);
  saveGame(huge);
  sameWorld(huge, loadGame());
  const start = performance.now();
  for (let i = 0; i < 10 && huge.winner === null; i++) huge.endTurn();
  console.log(`Huge: 10 early-game rounds with AI/scout in ${Math.round(performance.now() - start)}ms (headless, not a phone/rendering benchmark)`);
  console.log('Map size regressions PASS. Still run npm run build and browser/phone playtests.');
} finally {
  await rm(out, { recursive: true, force: true });
}
