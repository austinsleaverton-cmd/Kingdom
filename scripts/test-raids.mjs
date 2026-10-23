// node scripts/test-raids.mjs (after npm install). No browser or real saves are used.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
const source = fileURLToPath(new URL('../src/world/', import.meta.url));
const out = await mkdtemp(join(tmpdir(), 'kingdom-raids-'));
try {
  await writeFile(join(out, 'package.json'), '{"type":"module"}');
  for (const name of await readdir(source)) {
    if (!name.endsWith('.ts')) continue;
    const text = (await readFile(join(source, name), 'utf8')).replaceAll('import.meta.env.VITE_CHANNEL', "'dev'");
    const built = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
      .replace(/from '(\.\/[A-Za-z0-9_-]+)'/g, "from '$1.js'");
    await writeFile(join(out, name.replace(/\.ts$/, '.js')), built);
  }
  const load = (name) => import(pathToFileURL(join(out, name)));
  const { GameState } = await load('game.js');
  const { installRaidRules } = await load('raidRules.js');
  installRaidRules(); installRaidRules();
  const { raidState, damaged, campFor, isBarbarian } = await load('raidState.js');
  const { initializeRaids, runBarbarians, campUnits, CAMP_HP, CAMP_REWARD, CAMP_DISTANCE, MAX_CAMPS, MAX_RAIDERS } = await load('barbarians.js');
  const { startRepair, repairCheck, advanceRepairs } = await load('amenityRaids.js');
  const { cityBonus, siteBonus, amenitiesUsed } = await load('city.js');
  const { hexDistance } = await load('map.js');
  const { saveGame, loadGame } = await load('save.js');
  const storage = new Map(), KEY = 'kingdom-save-v3-dev';
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  const options = (extra = {}) => ({ seed: 4242, size: 'small', opponents: 1, freeBuild: false, difficulty: 'normal',
    seats: [{ name: 'Blue', human: true }, { name: 'Red', human: true }], barbarians: false, ...extra });
  const cityOf = (g, p = 0) => g.cities().find((c) => c.owner === p);
  const troop = (g, tile, owner = 0, type = 'swordsman') => {
    const u = { id: g.nextUnitId++, type, owner, col: tile.col, row: tile.row, moves: 2, acted: false, hp: 30 };
    g.units.push(u); return u;
  };
  const g = new GameState(options()), c = cityOf(g);
  const site = g.cityLand(c).find((t) => !t.city && t.terrain !== 'water');
  c.buildings = ['market']; c.sites.market = g.tileIndex(site); c.deco = [[2, 2, 0]];
  site.improvement = 'farm'; site.road = true;
  const decoration = JSON.stringify(c.deco), slots = amenitiesUsed(c), attacker = troop(g, site, 1);
  g.current = 1;
  assert.equal(g.pillageCheck(attacker).ok, false, 'peace protects ordinary kingdoms');
  assert.ok(g.declareWar(1, 0).ok);
  g.players[0].gold = 3;
  const lootBefore = g.players[1].gold;
  assert.ok(g.pillage(attacker).ok);
  assert.equal(g.players[0].gold, 0, 'Market cannot steal below zero');
  assert.equal(g.players[1].gold, lootBefore + 3);
  assert.ok(damaged(g, c, 'market'));
  assert.equal(site.improvement, 'farm'); assert.equal(site.road, true);
  assert.equal(JSON.stringify(c.deco), decoration); assert.equal(amenitiesUsed(c), slots);
  assert.equal(c.sites.market, g.tileIndex(site)); assert.ok(c.buildings.includes('market'));
  assert.equal(cityBonus(g, c).gold, -2, 'base Market income is cancelled');
  assert.equal(siteBonus(g, c, g.tileIndex(site), 'market').gold, 0, 'placement bonus disabled');
  attacker.acted = false; attacker.moves = 2;
  assert.equal(g.pillageTarget(site).name, 'farm', 'already pillaged amenity never pays again');
  g.current = 0; g.players[0].gold = 100;
  assert.equal(repairCheck(g, c, 'market').ok, false, 'enemy occupation blocks repair');
  g.units = g.units.filter((u) => u !== attacker);
  assert.ok(startRepair(g, c, 'market').ok);
  assert.equal(g.players[0].gold, 90, 'quarter cost paid once');
  assert.match(g.busyWith(c), /repairing/);
  advanceRepairs(g, 1); assert.ok(damaged(g, c, 'market'), 'only owner turns advance repair');
  advanceRepairs(g, 0); assert.ok(damaged(g, c, 'market'));
  advanceRepairs(g, 0); assert.equal(damaged(g, c, 'market'), false);
  assert.equal(cityBonus(g, c).gold, 1, 'road placement bonus restored');
  console.log('pillage, repeat-loot protection, preserved town, occupation and repair PASS');
  const neighbor = g.map.neighbors(site).find((t) => !t.city && t.owner === 0 && t.home === g.tileIndex(c) && t.terrain !== 'water');
  if (neighbor) {
    c.buildings.push('arena'); c.sites.arena = g.tileIndex(neighbor);
    assert.equal(siteBonus(g, c, g.tileIndex(neighbor), 'arena').gold, 1);
    raidState(g).damaged[g.tileIndex(c)] = ['market'];
    assert.equal(siteBonus(g, c, g.tileIndex(neighbor), 'arena').gold, 0);
  } else raidState(g).damaged[g.tileIndex(c)] = ['market'];
  assert.ok(startRepair(g, c, 'market').ok);
  c.owner = 1; advanceRepairs(g, 1);
  assert.equal(raidState(g).repairs[g.tileIndex(c)], undefined, 'capture cancels previous owner repair');
  assert.ok(damaged(g, c, 'market'), 'capture does not magically repair damage');
  for (const seed of [42, 777, 4242]) {
    const s = new GameState(options({ seed, size: 'large', opponents: 0, seats: [{ name: 'Blue', human: true }], barbarians: true }));
    initializeRaids(s);
    const data = raidState(s), camps = campUnits(s);
    assert.ok(camps.length > 0 && camps.length <= MAX_CAMPS);
    assert.equal(s.players.filter((p) => p.alive).length, 1, 'barbarians are not another kingdom');
    assert.equal(s.sandbox, true); assert.equal(s.fog, true);
    for (const unit of camps) {
      const t = s.tileOf(unit);
      assert.equal(t.owner, null); assert.equal(s.isExplored(0, t), false);
      assert.ok(s.cities().every((c) => hexDistance(c, t) >= CAMP_DISTANCE));
      assert.equal(unit.moves, 0); assert.equal(unit.hp, CAMP_HP);
    }
    const camp = camps[0], tile = s.tileOf(camp);
    const at = s.map.neighbors(tile).find((t) => t.terrain !== 'water' && !s.unitAt(t));
    assert.ok(at);
    const soldier = troop(s, at);
    assert.ok(s.isEnemy(camp.owner, 0));
    assert.deepEqual(s.wars, {});
    assert.equal(s.attackPreview(soldier, tile).counter, 0);
    const gold = s.players[0].gold;
    for (let i = 0; s.unitById(camp.id) && i < 4; i++) { soldier.acted = false; soldier.moves = 2; assert.ok(s.attack(soldier, tile).ok); }
    assert.equal(s.unitById(camp.id), undefined); assert.equal(campFor(s, camp.id), undefined);
    assert.equal(s.players[0].gold, gold + CAMP_REWARD); assert.equal(tile.owner, null);
    if (data.camps.length) {
      s.turn++; data.camps[0].nextRaid = s.turn;
      runBarbarians(s);
      const count = s.unitsOf(data.faction).filter((u) => !campFor(s, u.id)).length;
      assert.ok(count > 0 && count <= MAX_RAIDERS);
      runBarbarians(s);
      assert.equal(s.unitsOf(data.faction).filter((u) => !campFor(s, u.id)).length, count, 'once per round');
      const raider = s.unitsOf(data.faction).find((u) => !campFor(s, u.id));
      assert.equal(raider.moves, 0); assert.equal(s.current, 0);
      s.current = data.faction;
      assert.equal(s.attackPreview(raider, cityOf(s)).ok, false, 'raiders cannot attack cities');
      assert.equal(s.moveUnit(raider, cityOf(s)), false, 'raiders cannot capture cities');
      s.current = 0;
    }
    saveGame(s);
    const back = loadGame();
    assert.ok(back);
    assert.deepEqual(back.raids, s.raids);
    assert.deepEqual(back.units, s.units);
    assert.equal(back.players[back.raids.faction].alive, false);
    const before = back.units.length; runBarbarians(back); assert.equal(back.units.length, before, 'reload never duplicates the round');
  }
  console.log('hidden camps, combat/reward, neutral diplomacy, turn cadence, recruitment and save round-trip PASS');
  const legacy = new GameState(options());
  saveGame(legacy);
  const raw = JSON.parse(storage.get(KEY)); delete raw.raids; delete raw.options.barbarians;
  storage.set(KEY, JSON.stringify(raw));
  const old = loadGame();
  assert.ok(old); assert.equal(old.raids.enabled, false);
  initializeRaids(old); assert.equal(campUnits(old).length, 0);
  assert.equal(old.grossIncome(0), legacy.grossIncome(0));
  assert.equal(old.foodMade(0), legacy.foodMade(0));
  assert.ok(old.players.every((p) => !isBarbarian(old, p.id) || !p.alive));
  console.log('legacy saves retain their peaceful setting PASS');
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const s = new GameState(options({ seed: 77, difficulty, barbarians: true, seats: [{ name: 'Blue', human: true }, { name: 'Red', human: false }] }));
    initializeRaids(s);
    for (let i = 0; i < 30 && s.winner === null; i++) s.endTurn();
    assert.equal(s.current === s.raids.faction, false);
    assert.ok(s.unitsOf(s.raids.faction).filter((u) => !campFor(s, u.id)).length <= MAX_RAIDERS);
    saveGame(s); assert.ok(loadGame());
  }
  console.log('three difficulty soak games PASS; still verify npm run build and phone/desktop playtests');
} finally { await rm(out, { recursive: true, force: true }); }
