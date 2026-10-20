// Run after npm install: node scripts/test-city-territory.mjs
// City View territory rework (docs/CITY_BUILDER.md): layout math, amenity placement, decorations, capture,
// save/load, old-save migration, and AI soak games. Transpiles the headless world into a temporary directory;
// browser storage is simulated, no real saves are touched.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = fileURLToPath(new URL('../src/world/', import.meta.url));
const out = await mkdtemp(join(tmpdir(), 'kingdom-city-'));
try {
  await writeFile(join(out, 'package.json'), '{"type":"module"}');
  for (const name of await readdir(source)) {
    if (!name.endsWith('.ts')) continue;
    const text = (await readFile(join(source, name), 'utf8')).replaceAll('import.meta.env.VITE_CHANNEL', "'dev'");
    const built = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
      .replace(/from '(\.\/[A-Za-z0-9_-]+)'/g, "from '$1.js'");
    await writeFile(join(out, name.replace(/\.ts$/, '.js')), built);
  }
  const load = (f) => import(pathToFileURL(join(out, f)));
  const { GameState } = await load('game.js');
  const grid = await load('grid.js');
  const city = await load('city.js');
  const deco = await load('deco.js');
  const { saveGame, loadGame } = await load('save.js');
  const { BUILDING_ORDER } = await load('tile.js');
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const KEY = 'kingdom-save-v3-dev';
  const opts = (seed, extra = {}) => ({ size: 'small', seed, opponents: 1, freeBuild: true, difficulty: 'normal', ...extra });
  const myCity = (s) => s.cities().find((c) => c.owner === 0);
  const kindOf = (id) => deco.decoKind(id);

  // ---------- layout math ----------
  {
    const counts = new Map();
    for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) {
      const k = grid.cellHex(x, y).join(',');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    assert.equal(grid.hexCells(0, 0).length, grid.HEX_CELLS, 'every hex has the same number of cells');
    for (const [q, r] of [[0, 0], [3, -2], [-4, 5], [1, 1]]) {
      const cells = grid.hexCells(q, r);
      assert.equal(cells.length, grid.HEX_CELLS);
      for (const [x, y] of cells) assert.deepEqual(grid.cellHex(x, y), [q, r]);
      assert.deepEqual(grid.cellHex(...grid.hexCenter(q, r)), [q, r]);
    }
    console.log(`layout: ${grid.HEX_CELLS} cells per hex, patches tile without gaps PASS`);
  }

  // ---------- a new city ----------
  const s = new GameState(opts(4242));
  const cap = myCity(s);
  const lay = grid.cityLayout(s, cap);
  assert.equal(lay.hexes[0].tile, cap, "the Keep's hex comes first");
  assert.equal(lay.hexes.length, s.cityLand(cap).length, 'one patch per owned hex');
  assert.equal(lay.cells.size, lay.hexes.length * grid.HEX_CELLS);
  for (const h of lay.hexes) assert.equal(h.tile.home, s.tileIndex(cap));
  for (const o of lay.outside) assert.ok(!o.tile || o.tile.home !== s.tileIndex(cap) || o.tile.owner !== cap.owner, 'outside ring is outside');
  // world neighbours line up: the hex east of the city is drawn east of the Keep
  const east = s.map.neighborAt(cap, 0);
  if (east && lay.byIndex.has(s.tileIndex(east))) assert.ok(lay.byIndex.get(s.tileIndex(east)).center[0] > 0);
  console.log(`new city: ${lay.hexes.length} hexes, ${lay.cells.size} cells, ${lay.outside.length} outside hexes PASS`);

  // ---------- placement ----------
  const land = lay.hexes.filter((h) => !h.keep && h.terrain !== 'water');
  assert.ok(land.length >= 2, 'test map needs land around the capital');
  const farmHex = land[0];
  farmHex.tile.improvement = 'farm';
  s.invalidate();
  const before = s.foodMade(0);
  assert.equal(s.buildCheck(cap, 'workshop', 0, farmHex.terrain === 'hills' ? -5 : farmHex.index).ok, false);
  if (farmHex.terrain !== 'hills') assert.match(s.buildCheck(cap, 'workshop', 0, farmHex.index).reason, /hills hex|people/);
  assert.equal(s.buildCheck(cap, 'temple', 0, lay.hexes[0].index).reason, 'The Keep stands here');
  assert.ok(s.startBuilding(cap, 'temple', 0, farmHex.index).ok, 'temple on the farm hex');
  assert.equal(cap.projectSite, farmHex.index);
  for (let i = 0; i < 5 && cap.project; i++) s.endTurn();
  assert.equal(cap.project, null);
  assert.equal(cap.sites.temple, farmHex.index, 'finished where it was reserved');
  assert.equal(farmHex.tile.improvement, 'farm', 'the farm stays under the amenity');
  assert.ok(s.foodMade(0) >= before, 'the farm still produces');
  // capacity: the old plot limit (2 for a Village, one more per size) still caps how many amenities a city has
  assert.equal(city.amenitySlots(cap, false), [2, 3, 4, 5, 6][cap.level - 1]);
  cap.pop = 5;
  for (const b of ['market', 'granary', 'barracks', 'park']) {
    if (city.freeSlots(cap) === 0) break;
    assert.ok(s.startBuilding(cap, b, 0).ok, `auto-place ${b}`);
    assert.notEqual(cap.projectSite, farmHex.index, 'auto-place picks a free hex');
    for (let i = 0; i < 6 && cap.project; i++) s.endTurn();
  }
  if (city.freeSlots(cap) === 0) assert.match(s.buildCheck(cap, 'arena', 0).reason, /Room for \d amenities/);
  console.log('placement: Keep hex refused, terrain rules, farm kept, auto-place, amenity limit PASS');

  // ---------- bonuses come from real neighbours ----------
  {
    const t = cap.sites.market;
    const h = grid.cityLayout(s, cap).byIndex.get(t);
    const roadAt = [h.tile, ...s.map.neighbors(h.tile)].find((n) => n.owner === 0 && !n.city && n.terrain !== 'water');
    const without = city.siteBonus(s, cap, t, 'market').gold;
    if (roadAt) {
      roadAt.road = true;
      assert.equal(city.siteBonus(s, cap, t, 'market').gold, without + (without ? 0 : 1), 'Market next to a road');
      roadAt.road = false;
    }
    console.log('bonuses: next-to-a-road counts the hex and its neighbours PASS');
  }

  // ---------- decorations and border growth ----------
  {
    const tree = kindOf('tree');
    const path = kindOf('path');
    const lay2 = grid.cityLayout(s, cap);
    const spot = [...lay2.cells.keys()].map((k) => k.split(',').map(Number)).find(([x, y]) => !deco.tileReason(s, cap, x, y, tree));
    assert.ok(deco.placeDeco(s, cap, spot[0], spot[1], tree, 0).ok);
    assert.ok(deco.placeDeco(s, cap, spot[0], spot[1], path, 0).ok, 'a path goes under the tree');
    assert.equal(deco.objAt(cap, spot[0], spot[1]), tree);
    assert.equal(deco.groundAt(cap, spot[0], spot[1]), path);
    assert.match(deco.tileReason(s, cap, 0, 0, tree), /Keep/);
    const lot = lay2.hexes.find((h) => !h.keep && h.terrain !== 'water' && !city.siteUsed(cap, h.index));
    if (lot) {
      assert.match(deco.tileReason(s, cap, lot.center[0], lot.center[1], tree), /amenity/);
      assert.equal(deco.tileReason(s, cap, lot.center[0], lot.center[1], path), '', 'paths may cross an empty amenity spot');
    }
    // claim a new hex: the town grows by a whole patch of ground
    const cells = lay2.cells.size;
    const target = s.map.tiles.find((t) => t.owner === null && t.terrain !== 'water' && s.check('claim', t, 0, cap).ok);
    assert.ok(target, 'something to claim');
    const outside = grid.cityLayout(s, cap).outside.find((o) => o.tile === target);
    const [ox, oy] = outside.center;
    assert.match(deco.tileReason(s, cap, ox + 1, oy + 1, tree), /Outside/);
    assert.ok(s.perform('claim', target, 0, cap).ok);
    assert.equal(grid.cityLayout(s, cap).cells.size, cells + grid.HEX_CELLS, 'claimed hex adds ground');
    assert.equal(deco.tileReason(s, cap, ox + 1, oy + 1, tree), '', 'new ground can be decorated');
    console.log('decorations: two layers, Keep and amenity spots clear, border growth adds room PASS');
  }

  // ---------- founding a city on your own land ----------
  {
    const s2 = new GameState(opts(777, { opponents: 0 }));
    const c = myCity(s2);
    // give the capital a ring of land 3 hexes out so a settler can found inside its territory
    for (const t of s2.map.tiles) {
      if (t.owner === null && t.terrain !== 'water' && Math.abs(t.col - c.col) <= 4 && Math.abs(t.row - c.row) <= 4) {
        t.owner = 0;
        t.home = s2.tileIndex(c);
      }
    }
    s2.invalidate();
    const lay3 = grid.cityLayout(s2, c);
    const spotHex = lay3.hexes.find((h) => h.dist >= 3 && h.tile.terrain === 'grass');
    if (spotHex) {
      const tree = kindOf('tree');
      const cells = grid.hexCells(spotHex.q, spotHex.r).filter(([x, y]) => !deco.tileReason(s2, c, x, y, tree)).slice(0, 5);
      for (const [x, y] of cells) assert.ok(deco.placeDeco(s2, c, x, y, tree, 0).ok);
      const n = deco.decoList(c).length;
      s2.units.push({ id: 99, type: 'settler', owner: 0, col: spotHex.tile.col, row: spotHex.tile.row, moves: 2, acted: false, hp: 10 });
      // an amenity on the hex blocks founding
      c.buildings.push('park');
      c.sites.park = spotHex.index;
      assert.match(s2.foundCheck(s2.units.at(-1)).reason, /Park stands here/);
      delete c.sites.park;
      c.buildings.pop();
      assert.ok(s2.foundCity(s2.units.at(-1)).ok);
      assert.ok(!grid.cityLayout(s2, c).byIndex.has(spotHex.index), 'the hex left the old city');
      assert.equal(deco.decoList(c).length + (c.decoStash?.length ?? 0), n, 'nothing lost');
      for (const [x, y, k] of deco.decoList(c)) assert.equal(deco.tileReason(s2, c, x, y, k), '');
      console.log('founding on your own land: decorations moved, amenity hexes protected PASS');
    } else console.log('founding on your own land: no spot on this seed (skipped)');
  }

  // ---------- capture keeps the town ----------
  {
    const s3 = new GameState(opts(31337, { freeBuild: true }));
    const mine = myCity(s3);
    const theirs = s3.cities().find((c) => c.owner === 1);
    const tree = kindOf('tree');
    const lay4 = grid.cityLayout(s3, mine);
    const spots = [...lay4.cells.keys()].map((k) => k.split(',').map(Number)).filter(([x, y]) => !deco.tileReason(s3, mine, x, y, tree)).slice(0, 9);
    for (const [x, y] of spots) assert.ok(deco.placeDeco(s3, mine, x, y, tree, 0).ok);
    assert.ok(s3.startBuilding(mine, 'temple', 0).ok);
    for (let i = 0; i < 5 && mine.project; i++) s3.endTurn();
    const site = mine.sites.temple;
    const decoBefore = JSON.stringify(deco.decoList(mine));
    assert.equal(city.beautyBonus(mine, 'normal', false), 1, '9 beauty = +1 happy');
    assert.equal(city.beautyBonus(theirs, 'normal', false), 0, 'beauty stays in its own city');
    s3.players[1].isAI = true;
    s3.captureCity(mine, 1); // private in TS, reachable in tests
    assert.equal(mine.owner, 1);
    assert.equal(mine.sites.temple, site, 'amenity keeps its hex');
    assert.equal(JSON.stringify(deco.decoList(mine)), decoBefore, 'decorations stay with the city');
    assert.equal(grid.cityLayout(s3, mine).hexes.every((h) => h.tile.owner === 1), true);
    console.log('capture: amenities, decorations and land change hands together PASS');
  }

  // ---------- save / load ----------
  {
    s.players[0].isAI = false;
    const c = cap;
    c.decoStash = [kindOf('bench'), kindOf('stones')];
    saveGame(s);
    const back = loadGame();
    const c2 = back.map.tiles[s.tileIndex(c)];
    assert.deepEqual(c2.sites, c.sites);
    assert.deepEqual(c2.deco.slice(0, c.deco.length), c.deco, 'placed decorations keep their cells');
    assert.equal(c2.decoStash.filter((k) => deco.isPathKind(k)).length, 1, 'stored path stays stored');
    assert.equal(c2.decoStash.length + c2.deco.length, c.deco.length + c.decoStash.length, 'stored bench comes back once there is room');
    assert.equal(back.foodMade(0), s.foodMade(0));
    assert.equal(back.grossIncome(0), s.grossIncome(0));
    console.log('save/load: sites, decorations, stored items and economy round-trip PASS');
  }

  // ---------- old saves (six plots, square town) ----------
  {
    const s4 = new GameState(opts(2024));
    const c = myCity(s4);
    c.pop = 5;
    c.level = 3;
    c.buildings = ['market', 'temple', 'granary'];
    c.project = 'park';
    c.projectTurns = 1;
    saveGame(s4);
    const raw = JSON.parse(storage.get(KEY));
    const i = s4.tileIndex(c);
    delete raw.layout;
    delete raw.sites;
    delete raw.projectSites;
    delete raw.decoStash;
    // market on plot 0 (east), temple on plot 3 (west), granary on plot 5 (southeast), park going up on plot 1
    raw.plots = { [i]: ['gggggg', [1, -1, -1, 0, -1, 2], 1] };
    // decorations from the 11x11 square town, including one on an old plot spot and one far corner
    const oldDeco = [[-3, -3, 0], [2, 0, 4], [5, 5, 5], [-5, 5, 6], [3, 3, 9], [4, -1, 14], [0, 3, 15]];
    raw.deco = { [i]: oldDeco.flat() };
    raw.grid = { [i]: 3 };
    storage.set(KEY, JSON.stringify(raw));
    const back = loadGame();
    const c2 = back.map.tiles[i];
    const expect = (dir) => {
      const t = back.map.neighborAt(c2, dir);
      return t && grid.cityLayout(back, c2).byIndex.has(back.tileIndex(t)) ? back.tileIndex(t) : null;
    };
    for (const [b, dir] of [['market', 0], ['temple', 3], ['granary', 5]]) {
      const want = expect(dir);
      if (want !== null) assert.equal(c2.sites[b], want, `${b} moved onto the hex its plot faced`);
      else assert.ok(c2.sites[b] !== undefined, `${b} still has a spot (or waits for one)`);
    }
    assert.equal(c2.project, 'park');
    assert.ok(c2.projectSite !== null, 'construction kept its reservation');
    const placed = Object.values(c2.sites).filter((v) => v >= 0);
    assert.equal(new Set(placed).size, placed.length, 'one amenity per hex');
    assert.equal(c2.deco.length + c2.decoStash.length, oldDeco.length, 'no decoration lost');
    for (const [x, y, k] of c2.deco) assert.equal(deco.tileReason(back, c2, x, y, k), '');
    back.endTurn();
    assert.ok(c2.buildings.includes('park') && c2.sites.park !== undefined, 'construction finishes after migrating');
    saveGame(back);
    assert.equal(JSON.parse(storage.get(KEY)).layout, 2, 'saved in the new layout');
    console.log(`old saves: plots moved onto their hexes, ${c2.deco.length} decorations kept, ${c2.decoStash.length} stored PASS`);
  }

  // ---------- AI soak games ----------
  const invariants = (g, label) => {
    for (const c of g.cities()) {
      const lay5 = grid.cityLayout(g, c);
      const used = new Set();
      for (const b of BUILDING_ORDER) {
        const at = c.sites[b];
        if (!c.buildings.includes(b)) {
          assert.equal(at, undefined, `${label}: site for an unbuilt ${b}`);
          continue;
        }
        assert.ok(at !== undefined, `${label}: ${b} has no site`);
        if (at < 0) continue;
        const h = lay5.byIndex.get(at);
        assert.ok(h && !h.keep, `${label}: ${b} off its city's land`);
        assert.ok(!used.has(at), `${label}: two amenities on one hex`);
        used.add(at);
      }
      if (c.project) {
        assert.ok(c.projectSite !== null, `${label}: construction without a hex`);
        assert.ok(!used.has(c.projectSite), `${label}: construction on a used hex`);
      }
      assert.ok(c.buildings.length <= 6, `${label}: more than 6 amenities`);
      for (const [x, y, k] of deco.decoList(c)) assert.equal(deco.tileReason(g, c, x, y, k), '', `${label}: decoration off open ground`);
    }
  };
  let built = 0;
  let captured = 0;
  const start = performance.now();
  for (const [seed, difficulty] of [[1, 'normal'], [42, 'hard'], [9001, 'easy'], [5, 'hard'], [77, 'normal'], [314, 'easy'], [2718, 'hard'], [8080, 'normal']]) {
    const g = new GameState({ size: 'small', seed, opponents: 3, freeBuild: false, difficulty });
    const owners0 = new Map(g.cities().map((c) => [g.tileIndex(c), c.owner]));
    for (let turn = 0; turn < 80 && g.winner === null; turn++) {
      g.endTurn();
      if (turn % 10 === 0) invariants(g, `seed ${seed} turn ${g.turn}`);
    }
    invariants(g, `seed ${seed} end`);
    built += g.cities().reduce((n, c) => n + c.buildings.length, 0);
    captured += g.cities().filter((c) => owners0.has(g.tileIndex(c)) && owners0.get(g.tileIndex(c)) !== c.owner).length;
    saveGame(g);
    const back = loadGame();
    invariants(back, `seed ${seed} reloaded`);
    for (const c of g.cities()) assert.deepEqual(back.map.tiles[g.tileIndex(c)].sites, c.sites, `seed ${seed}: sites survive a reload`);
  }
  console.log(`AI soak: 8 games x 80 rounds, ${built} amenities built, ${captured} capitals changed hands, invariants hold (${Math.round(performance.now() - start)}ms) PASS`);
  console.log('City territory regressions PASS. Still run npm run build and phone/desktop playtests.');
} finally {
  await rm(out, { recursive: true, force: true });
}
