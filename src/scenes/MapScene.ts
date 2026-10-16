// Rendering and input only. All rules live in src/world.
import Phaser from 'phaser';
import { GameState, MIN_WAR_TURNS, MOOD_FACE, PEACE_RETRY, TRUCE_TURNS } from '../world/game';
import type { AttackPreview, Check, GameOptions, RoutePlan } from '../world/game';
import { describePlacement, openPlots } from '../world/city';
import { hexDistance } from '../world/map';
import { loadGame, saveGame, saveSummary } from '../world/save';
import { BUILDINGS, BUILDING_ORDER, LEVEL_NAMES, LEVEL_POP, MAX_LEVEL, MAX_WALLS, YIELD, cityLevel, cityMaxHp, shieldMax } from '../world/tile';
import type { Building, Improvement, Terrain, Tile } from '../world/tile';
import { JOBS, NAVY, PALISADE_HP, TROOPS, UNIT_STATS } from '../world/units';
import type { Job, Unit, UnitType } from '../world/units';
import { CityView, hasPlotFor, placementNotes, shortNotes, showToast } from './CityView';
import { ART, KEEP_ART, TINY, canDraw, crispCityArt, loadCityArt } from './cityArt';
import { Hud } from './Hud';
import type { BarMode, DialogButton, PanelBar, PanelButton, PanelModel, PanelSection } from './Hud';
import { Menu } from './Menu';
import { UNIT_SPRITE, WORKER_SPRITE, makeSprites } from './sprites';

const SIZE = 28; // hex radius in px
const SQRT3 = Math.sqrt(3);
const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 320; // two taps on your own city this close together open the City View

const HEIGHT_COLOR = [0x1f5f9e, 0xd9c38a, 0x6bb352, 0x4f9443, 0x8c7a4c, 0x9a9a9a];
const TERRAIN_NAME: Record<Terrain, string> = {
  water: 'Water',
  sand: 'Sand',
  grass: 'Grass',
  hills: 'Hills',
  mountain: 'Mountain',
};
// Hex edge i (between corner i and i+1) faces this neighbor direction.
const EDGE_TO_DIR = [0, 5, 4, 3, 2, 1];

// Fog of war colors: unexplored land is near-black, explored-but-out-of-sight is dimmed
const FOG_COLOR = 0x0d1320;
const FOG_DIM = 0.22; // light veil: explored land stays easy to read, only enemy troops are hidden

// Pixel sprites: little workers on worked tiles (hidden when zoomed far out) and people on unit tokens
const WORKER_SCALE = 1.6;
const UNIT_SCALE = 1.7;
const WORKER_ZOOM = 0.55; // below this zoom the workers are too small to matter
const WORKER_OFFSET: Record<Improvement, [number, number]> = { farm: [10, -4], pasture: [1, -7], mine: [12, -3], forest: [13, 7], fishery: [10, -6] };

// select: click to select/move. claim: click to buy land. raise/lower: builder picks a target.
type Mode = BarMode | 'raise' | 'lower';

export class MapScene extends Phaser.Scene {
  private state: GameState | null = null;
  private hud!: Hud;
  private menu!: Menu;
  private cityView!: CityView; // full-screen look inside a city (plots around the Keep)
  private pendingToasts: string[] = []; // hot-seat: news held back until the next person starts their turn
  private mode: Mode = 'select';
  private hovered: Tile | null = null;
  private selected: Tile | null = null;
  private selectedUnitId: number | null = null;
  private reach = new Map<Tile, number>();
  private unloadAt = new Set<Tile>(); // land hexes the selected transport can drop a unit on
  private targets = new Map<Tile, AttackPreview>();
  private claimCity: Tile | null = null; // city buying land in claim mode
  private lastPointer = { x: 0, y: 0 };
  private visible: Set<Tile> | null = null; // fog of war: what you can see right now (null = no fog)
  private smallZoom = false;

  private terrainGfx!: Phaser.GameObjects.Graphics;
  private ownerGfx!: Phaser.GameObjects.Graphics;
  private castleGfx!: Phaser.GameObjects.Graphics; // flags and crowns on the castles (or the drawn fallback city)
  private castles: Phaser.GameObjects.Blitter | null = null; // Kenney castle tiles, one per city (null = art missing)
  private fogGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private unitGfx!: Phaser.GameObjects.Graphics;
  private badgeGfx!: Phaser.GameObjects.Graphics;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private selGfx!: Phaser.GameObjects.Graphics;
  private workerSprites: Phaser.GameObjects.Sprite[] = [];
  private unitSprites: Phaser.GameObjects.Sprite[] = [];
  private priceLabels: Phaser.GameObjects.Text[] = []; // claim prices shown on green hexes
  private cityLabels: Phaser.GameObjects.Text[] = []; // name tags under cities
  private lastTap: { tile: Tile; at: number } | null = null; // for double-tap on a city
  private routeLabels: Phaser.GameObjects.Text[] = []; // turn numbers along a route
  private routePreview: { unitId: number; dest: Tile; plan: RoutePlan } | null = null; // tapped once, tap again to go
  private hoverPlan: { unitId: number; tile: Tile; plan: RoutePlan } | null = null; // cached for the tooltip

  private pressed = false;
  private dragging = false;
  private downX = 0;
  private downY = 0;
  private pinchDist = 0; // distance between two fingers last frame (0 = not pinching)
  private pinching = false; // a pinch happened during this touch: don't treat release as a click

  constructor() {
    super('map');
  }

  // Kenney tilesheets (castle for cities here, the whole town in the city screen). A failed download just
  // leaves the sheet out and cities fall back to the drawn house.
  preload(): void {
    loadCityArt(this);
  }

  create(): void {
    makeSprites(this);
    crispCityArt(this);
    this.terrainGfx = this.add.graphics().setDepth(0);
    this.ownerGfx = this.add.graphics().setDepth(1);
    if (this.textures.exists(TINY)) this.castles = this.add.blitter(0, 0, TINY).setDepth(1.1);
    this.castleGfx = this.add.graphics().setDepth(1.15);
    this.fogGfx = this.add.graphics().setDepth(1.5);
    this.overlayGfx = this.add.graphics().setDepth(2);
    this.unitGfx = this.add.graphics().setDepth(3);
    this.badgeGfx = this.add.graphics().setDepth(3.4);
    this.selGfx = this.add.graphics().setDepth(4.5);
    this.hoverGfx = this.add.graphics().setDepth(5);
    // Gentle pulse so the current selection is easy to spot
    this.tweens.add({ targets: this.selGfx, alpha: 0.45, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.hud = new Hud({
      onMode: (m) => this.setMode(m),
      onEndTurn: () => this.endTurn(),
      onMenu: () => this.openMenu(),
    });
    this.menu = new Menu(
      (opts) => this.newGame(opts),
      () => this.continueGame(),
    );
    this.cityView = new CityView();

    this.setupInput();
    this.openMenu();
  }

  // Workers hide when zoomed far out (keeps huge maps readable and smooth)
  update(): void {
    const small = this.cameras.main.zoom < WORKER_ZOOM;
    if (small === this.smallZoom) return;
    this.smallZoom = small;
    if (this.state) this.drawWorkers(this.state);
  }

  // ---------- flow ----------

  private openMenu(): void {
    if (this.cityView.visible) this.cityView.close();
    if (this.state) saveGame(this.state);
    this.hovered = null;
    this.hoverGfx.clear();
    this.hud.hideTip();
    this.hud.hideDialog();
    this.hud.setVisible(false);
    this.menu.show(saveSummary());
  }

  private continueGame(): void {
    const saved = this.state ?? loadGame();
    if (saved) this.startGame(saved);
  }

  private newGame(opts: GameOptions): void {
    const save = saveSummary();
    if (save && !save.finished && !window.confirm('Start a new kingdom? Your saved game will be replaced.')) return;
    this.startGame(new GameState(opts));
  }

  private startGame(state: GameState): void {
    if (state !== this.state) this.clearSelection();
    this.state = state;
    this.hovered = null;
    this.menu.hide();
    this.hud.setVisible(true);
    this.redraw();
    this.cameras.main.setZoom(1.2);
    this.centerOnHome();
    if (this.needsPass) this.handOff();
  }

  private centerOnHome(): void {
    const state = this.state;
    if (!state) return;
    const cap = state.map.tiles.find((t) => t.capital && t.owner === this.me) ?? state.map.tiles.find((t) => t.owner === this.me);
    if (cap) {
      const { x, y } = tileCenter(cap);
      this.cameras.main.centerOn(x, y);
    }
  }

  // Hot-seat: show the "pass the device" screen whenever it's a different person's turn
  private get needsPass(): boolean {
    const state = this.state;
    return !!state && state.hotseat && state.winner === null && state.humansAlive().length > 1;
  }

  private handOff(): void {
    const state = this.state;
    if (!state) return;
    if (this.cityView.visible) this.cityView.close();
    this.clearSelection();
    this.mode = 'select';
    this.hud.hideDialog();
    this.redraw();
    const p = state.players[state.current];
    const cities = state.cityCount(p.id);
    const note = `${cities} ${cities === 1 ? 'city' : 'cities'} \u00b7 ${p.gold} gold`;
    this.hud.showPass(p.name, p.color, state.turn, note, () => {
      this.centerOnHome();
      this.redraw();
      this.autoAdvance(null);
      this.showAlerts();
      for (const msg of this.pendingToasts) showToast(msg);
      this.pendingToasts = [];
    });
  }

  private get playing(): boolean {
    return this.state !== null && !this.menu.visible && !this.hud.passVisible && !this.hud.dialogVisible && !this.cityView.visible;
  }

  // Whose turn it is: with hot-seat play this is whichever person is holding the device
  private get me(): number {
    return this.state?.current ?? 0;
  }

  private get selectedUnit(): Unit | null {
    if (!this.state || this.selectedUnitId === null) return null;
    return this.state.unitById(this.selectedUnitId) ?? null;
  }

  private setMode(m: Mode): void {
    // Pressing Select (1) while already selecting clears the selection
    if (m === 'select' && this.mode === 'select') this.clearSelection();
    this.mode = m;
    if (m !== 'claim') this.claimCity = null;
    this.redraw();
  }

  // Claim land is a city action: toggle claim mode for the selected city.
  private toggleClaim(): void {
    const city = this.selected;
    if (!this.state || !city || !city.city || city.owner !== this.me) return;
    if (this.mode === 'claim' && this.claimCity === city) {
      this.setMode('select');
      return;
    }
    this.selectedUnitId = null;
    this.claimCity = city;
    this.mode = 'claim';
    this.redraw();
  }

  private clearSelection(): void {
    this.selected = null;
    this.selectedUnitId = null;
    this.reach = new Map();
    this.unloadAt = new Set();
    this.targets = new Map();
    this.claimCity = null;
    this.routePreview = null;
    if (this.mode === 'claim') this.mode = 'select';
  }

  // Before ending the turn, catch units that were forgotten (unless they're set to hold).
  private endTurn(force = false): void {
    const state = this.state;
    if (!state || !this.playing || state.winner !== null) return;
    if (this.hud.idleVisible) force = true; // second press of End turn / Space
    const idle = state.idleUnits(this.me);
    if (!force && idle.length > 0) {
      // Jump to the nearest waiting unit, then ask (Space again ends the turn anyway)
      const cur = this.selectedUnit;
      if (!cur || !idle.includes(cur)) {
        const from = this.selected ?? state.tileOf(idle[0]);
        const next = idle.reduce((a, b) => (hexDistance(state.tileOf(b), from) < hexDistance(state.tileOf(a), from) ? b : a));
        this.focusUnit(next);
      }
      const counts = new Map<string, number>();
      for (const u of idle) counts.set(UNIT_STATS[u.type].name, (counts.get(UNIT_STATS[u.type].name) ?? 0) + 1);
      const names = [...counts].map(([n, c]) => (c > 1 ? `${c} ${n}s` : n)).join(', ');
      this.hud.showIdle(idle.length, names, {
        onShow: () => this.focusUnit(idle[0]),
        onHoldAll: () => {
          for (const u of idle) state.setHold(u, true);
          this.redraw();
        },
        onEndAnyway: () => this.endTurn(true),
      });
      return;
    }
    this.hud.hideIdle();
    // Remember what stands on every plot, so finished amenities can be announced after the turn
    const before = state.cities().map((c) => [c, c.placed.slice()] as const);
    state.endTurn();
    const news = this.finishedNews(state, before);
    if (this.mode === 'raise' || this.mode === 'lower') this.mode = 'select';
    if (this.needsPass) {
      this.pendingToasts = news;
      return this.handOff();
    }
    this.redraw();
    for (const msg of news) showToast(msg);
    // New turn: start on the unit nearest to where you left off
    this.autoAdvance(this.selected);
    this.showAlerts();
  }

  // Amenities that finished for whoever's turn it is now, with where they went and why
  private finishedNews(state: GameState, before: (readonly [Tile, (Building | null)[]])[]): string[] {
    const out: string[] = [];
    for (const [c, old] of before) {
      if (c.owner !== state.current || state.players[state.current].isAI) continue;
      c.placed.forEach((b, i) => {
        if (b && old[i] !== b) out.push(`${BUILDINGS[b].icon} ${state.cityName(c)} finished its ${BUILDINGS[b].name} on ${describePlacement(c, i, b)}`);
      });
    }
    return out;
  }

  // Big news since your last turn (someone declared war on you)
  private showAlerts(): void {
    const state = this.state;
    if (!state) return;
    const news = state.takeAlerts(this.me);
    if (!news.length) return;
    this.hud.showDialog({
      title: 'War!',
      color: 0xef4444,
      lines: news,
      buttons: [{ label: 'OK', kind: 'main', onClick: () => this.hud.hideDialog() }],
    });
  }

  private focusUnit(unit: Unit): void {
    const state = this.state;
    if (!state) return;
    this.mode = 'select';
    this.selectedUnitId = unit.id;
    this.selected = state.tileOf(unit);
    const { x, y } = tileCenter(this.selected);
    this.cameras.main.pan(x, y, 300, 'Sine.easeInOut');
    this.redraw();
  }

  private toggleHold(): void {
    const state = this.state;
    const unit = this.selectedUnit;
    if (!state || !unit || unit.owner !== this.me) return;
    state.setHold(unit, !unit.hold);
    this.redraw();
  }

  // Does this unit of yours still have a real move (or an attack) left this turn?
  // Road moves cost half, so a unit can be left with 0.5: that counts as done here.
  // Out of moves = done, even if a builder could still work its tile (click it again to do that).
  private hasWork(state: GameState, u: Unit): boolean {
    if (u.owner !== this.me || u.hold || u.goal || state.players[state.current].isAI) return false;
    if (u.moves >= 1 && state.reachableFor(u).size > 0) return true;
    if (state.unloadTiles(u).size > 0) return true;
    return UNIT_STATS[u.type].military && this.findTargets(state, u).size > 0;
  }

  // After a unit finishes (no moves, nothing left to do), jump to the nearest unit that can still act.
  private autoAdvance(from: Tile | null): void {
    const state = this.state;
    if (!state || state.winner !== null || this.mode !== 'select') return;
    from = from ?? state.map.tiles.find((t) => t.capital && t.owner === this.me) ?? null;
    if (!from) return;
    const cur = this.selectedUnit;
    if (cur && this.hasWork(state, cur)) return;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of state.unitsOf(this.me)) {
      if (u === cur || !this.hasWork(state, u)) continue;
      const d = hexDistance(state.tileOf(u), from);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best) this.focusUnit(best);
  }

  // N: cycle to the next unit that can still act (by id, wrapping around).
  private nextUnit(): void {
    const state = this.state;
    if (!state) return;
    const ready = state.unitsOf(this.me).filter((u) => this.hasWork(state, u)).sort((a, b) => a.id - b.id);
    if (!ready.length) return this.fail();
    const cur = this.selectedUnitId ?? -1;
    this.focusUnit(ready.find((u) => u.id > cur) ?? ready[0]);
  }

  private fail(): void {
    this.cameras.main.shake(80, 0.002);
  }

  private clickTile(tile: Tile): void {
    const state = this.state;
    if (!state) return;
    let acted = false; // a unit used moves or its action: maybe jump to the next one
    switch (this.mode) {
      case 'claim':
        if (state.perform('claim', tile, this.me, this.claimCity).ok) break;
        // Clicked another of your cities: claim for that one instead
        if (tile.city && tile.owner === this.me && tile !== this.claimCity) {
          this.claimCity = tile;
          this.selected = tile;
          break;
        }
        // Your own unit: just select it.
        if (this.selectOwn(state, tile)) break;
        return this.fail();
      case 'raise':
      case 'lower': {
        const unit = this.selectedUnit;
        if (!unit) {
          this.mode = 'select';
          break;
        }
        if (!state.doJob(unit, this.mode, tile).ok) return this.fail();
        this.mode = 'select';
        acted = true;
        break;
      }
      case 'select': {
        // Quick double-tap on your own city: open it (a slower second tap still picks the unit standing there)
        const now = Date.now();
        const tap = this.lastTap;
        this.lastTap = { tile, at: now };
        if (tile.city && tile.owner === this.me && tap && tap.tile === tile && now - tap.at < DOUBLE_TAP_MS) {
          this.lastTap = null;
          this.routePreview = null;
          this.selectedUnitId = null;
          this.selected = tile;
          this.redraw();
          this.openCity(tile);
          return;
        }
        const unit = this.selectedUnit;
        const rival = this.rivalCapital(state, tile);
        if (unit && state.tileOf(unit) === tile) {
          // Clicking the selected unit again deselects it
          this.clearSelection();
        } else if (unit && this.targets.has(tile)) {
          this.routePreview = null;
          state.attack(unit, tile);
          this.cameras.main.shake(60, 0.003);
          acted = true;
        } else if (unit && this.unloadAt.has(tile)) {
          // Transport: drop the next unit on board onto this hex
          this.routePreview = null;
          state.unload(unit, tile);
          acted = true;
        } else if (unit && this.reach.has(tile)) {
          this.routePreview = null;
          state.moveUnit(unit, tile);
          this.selected = tile;
          acted = true;
        } else if (rival !== null) {
          // Another kingdom's capital: diplomacy (declare war / make peace)
          this.routePreview = null;
          this.selectTile(state, tile);
          this.openDiplomacy(rival);
        } else if (unit && this.canRoute(state, unit, tile)) {
          // Far hex: first tap previews the route, second tap on the same hex sends the unit
          const pv = this.routePreview;
          if (pv && pv.unitId === unit.id && pv.dest === tile) {
            this.routePreview = null;
            state.setRoute(unit, tile);
            acted = true;
          } else {
            const plan = state.planRoute(unit, tile);
            if (plan.ok) this.routePreview = { unitId: unit.id, dest: tile, plan };
            else {
              this.routePreview = null;
              this.selectTile(state, tile);
            }
          }
        } else {
          this.routePreview = null;
          this.selectTile(state, tile);
        }
        break;
      }
    }
    this.redraw();
    if (acted) this.autoAdvance(tile);
  }

  // The kingdom whose (explored) capital this is, if it isn't yours
  private rivalCapital(state: GameState, tile: Tile): number | null {
    if (state.sandbox || !tile.capital || tile.owner === null || tile.owner === this.me || !this.seen(tile)) return null;
    return state.players[tile.owner].alive ? tile.owner : null;
  }

  // ---------- war and peace ----------

  private openDiplomacy(q: number): void {
    const state = this.state;
    if (!state || state.sandbox || q === this.me) return;
    const me = this.me;
    const them = state.players[q];
    if (!them || !them.alive) return;
    const cities = state.cityCount(q);
    const troops = state.unitsOf(q).filter((u) => UNIT_STATS[u.type].military).length;
    const share = Math.round((state.ownedLand(q) / state.landCount()) * 100);
    const lines = [`${cities} ${cities === 1 ? 'city' : 'cities'} \u00b7 ${troops} troop${troops === 1 ? '' : 's'} \u00b7 ${share}% of the land`];
    const buttons: DialogButton[] = [];
    if (state.atWar(me, q)) {
      const t = state.warTurns(me, q);
      lines.push(t === 0 ? 'At war (declared this turn).' : `At war for ${t} turn${t === 1 ? '' : 's'}.`);
      const pc = state.peaceCheck(me, q);
      lines.push(
        pc.ok
          ? them.isAI
            ? `${them.name} may say yes or no, depending on how the war is going for them.`
            : 'Between people, peace is agreed right away.'
          : pc.reason,
      );
      buttons.push({
        label: 'Offer peace',
        kind: 'main',
        enabled: pc.ok,
        hint: pc.ok ? `then no war for ${TRUCE_TURNS} turns` : '',
        onClick: () => this.offerPeace(q),
      });
    } else {
      const wc = state.warCheck(me, q);
      lines.push("At peace: neither side's troops can attack the other.");
      lines.push(
        wc.ok
          ? `Declaring war lets both sides attack units and cities. A war lasts at least ${MIN_WAR_TURNS} turns before you can make peace.`
          : wc.reason,
      );
      buttons.push({ label: `Declare war on ${them.name}`, kind: 'danger', enabled: wc.ok, onClick: () => this.declareWar(q) });
    }
    buttons.push({ label: 'Close', onClick: () => this.hud.hideDialog() });
    this.hud.showDialog({ title: them.name, color: them.color, lines, buttons });
  }

  private declareWar(q: number): void {
    const state = this.state;
    if (!state) return;
    const c = state.declareWar(this.me, q);
    this.hud.hideDialog();
    if (!c.ok) return this.fail();
    this.cameras.main.shake(150, 0.004);
    this.redraw();
  }

  private offerPeace(q: number): void {
    const state = this.state;
    if (!state) return;
    const r = state.offerPeace(this.me, q);
    const them = state.players[q];
    this.redraw();
    this.hud.showDialog({
      title: r.ok ? `Peace with ${them.name}` : 'Peace refused',
      color: them.color,
      lines: r.ok
        ? [r.reason || `You made peace with ${them.name}.`, `Neither side can declare war again for ${TRUCE_TURNS} turns.`]
        : [r.reason, `You can ask again in ${PEACE_RETRY} turns.`],
      buttons: [{ label: 'OK', kind: 'main', onClick: () => this.hud.hideDialog() }],
    });
  }

  // Tapping a far hex with your unit selected plans a route, unless it's your own unit or city (that selects it).
  private canRoute(state: GameState, unit: Unit, tile: Tile): boolean {
    if (unit.owner !== this.me || state.players[state.current].isAI || state.winner !== null) return false;
    const here = state.unitAt(tile);
    if (here && here.owner === this.me) return false;
    if (tile.city && tile.owner === this.me) return false;
    return true;
  }

  private planFor(state: GameState, unit: Unit, tile: Tile): RoutePlan {
    const pv = this.routePreview;
    if (pv && pv.unitId === unit.id && pv.dest === tile) return pv.plan;
    const hp = this.hoverPlan;
    if (hp && hp.unitId === unit.id && hp.tile === tile) return hp.plan;
    const plan = state.planRoute(unit, tile);
    this.hoverPlan = { unitId: unit.id, tile, plan };
    return plan;
  }

  private cancelRoute(): void {
    const state = this.state;
    const unit = this.selectedUnit;
    this.routePreview = null;
    if (state && unit && unit.owner === this.me) state.clearRoute(unit);
    this.redraw();
  }

  // City first (it's the main thing on a tile); click the same city again to get the unit on it.
  private selectTile(state: GameState, tile: Tile): void {
    const here = state.unitAt(tile);
    const mine = here && here.owner === this.me ? here : null;
    const ownCity = tile.city && tile.owner === this.me;
    if (ownCity && mine) {
      const cityAlreadySelected = this.selected === tile && this.selectedUnitId === null;
      this.selectedUnitId = cityAlreadySelected ? mine.id : null;
    } else {
      this.selectedUnitId = mine ? mine.id : null;
    }
    this.selected = tile;
  }

  private selectOwn(state: GameState, tile: Tile): boolean {
    const here = state.unitAt(tile);
    const ownCity = tile.city && tile.owner === this.me;
    if (!ownCity && !(here && here.owner === this.me)) return false;
    this.mode = 'select';
    this.claimCity = null;
    this.selected = null;
    this.selectedUnitId = null;
    this.selectTile(state, tile);
    return true;
  }

  private doJob(job: Job): void {
    const state = this.state;
    const unit = this.selectedUnit;
    if (!state || !unit) return;
    if (job === 'raise' || job === 'lower') {
      this.mode = this.mode === job ? 'select' : job;
      this.redraw();
      return;
    }
    const here = state.tileOf(unit);
    if (!state.doJob(unit, job, here).ok) return this.fail();
    this.redraw();
    this.autoAdvance(here);
  }

  private recruit(type: UnitType): void {
    const state = this.state;
    if (!state || !this.selected) return;
    const res = state.recruit(type, this.selected);
    if (!res) return this.fail();
    if (res !== 'queued') {
      this.mode = 'select';
      this.claimCity = null;
      this.selectedUnitId = res.id;
      this.selected = state.tileOf(res);
    }
    this.redraw();
  }

  private buildWalls(city: Tile): void {
    const state = this.state;
    if (!state) return;
    if (!state.buildWalls(city, this.me).ok) return this.fail();
    this.redraw();
  }

  // Auto-place: the amenity goes to the best open plot. Say where, so the player learns the bonuses.
  private build(city: Tile, b: Building): void {
    const state = this.state;
    if (!state) return;
    if (!state.startBuilding(city, b, this.me).ok) return this.fail();
    const info = BUILDINGS[b];
    const at = city.projectPlot;
    if (at !== null) {
      const notes = placementNotes(city, at, b);
      showToast(`${info.icon} ${info.name} going up on plot ${at + 1}${notes.length ? ` (${notes.join('; ')})` : ''}, ready in ${info.turns} turns`);
    }
    this.redraw();
  }

  // The City View: the city's plots around the Keep, pick a spot and build
  private openCity(city: Tile): void {
    const state = this.state;
    if (!state || !city.city || city.owner !== this.me || state.players[this.me].isAI) return;
    this.hud.hideTip();
    this.hud.hideIdle();
    this.cityView.open(state, city, this.me, {
      onChange: () => this.redraw(),
      onClose: () => this.redraw(),
    });
  }

  private pillage(): void {
    const state = this.state;
    const unit = this.selectedUnit;
    if (!state || !unit) return;
    if (!state.pillage(unit).ok) return this.fail();
    this.redraw();
  }

  private foundCity(): void {
    const state = this.state;
    const unit = this.selectedUnit;
    if (!state || !unit || unit.type !== 'settler') return;
    const tile = state.tileOf(unit);
    if (!state.foundCity(unit).ok) return this.fail();
    this.selectedUnitId = null;
    this.selected = tile;
    this.redraw();
  }

  // ---------- input ----------

  // Two-finger pinch on phones/tablets: zoom around the point between the fingers.
  private handlePinch(): boolean {
    const a = this.input.pointer1;
    const b = this.input.pointer2;
    if (!a?.isDown || !b?.isDown) {
      this.pinchDist = 0;
      return false;
    }
    this.pinching = true;
    this.dragging = true;
    this.hud.hideTip();
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const cam = this.cameras.main;
    if (this.pinchDist > 0 && dist > 0) {
      const before = cam.getWorldPoint(mx, my);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dist / this.pinchDist), 0.3, 3));
      cam.preRender(); // refresh the camera matrix so the next lookup uses the new zoom
      const after = cam.getWorldPoint(mx, my);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    }
    this.pinchDist = dist;
    return true;
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.addPointer(1); // allow a second finger for pinch zoom

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.input.pointer1?.isDown && this.input.pointer2?.isDown) this.pinching = true;
      this.pressed = true;
      this.dragging = false;
      this.downX = p.x;
      this.downY = p.y;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.playing) return;
      if (this.handlePinch()) return;
      if (this.pinching) return; // one finger lifted mid-pinch: wait until both are up
      if (this.pressed && p.isDown) {
        if (!this.dragging && Math.hypot(p.x - this.downX, p.y - this.downY) > DRAG_THRESHOLD) {
          this.dragging = true;
        }
        if (this.dragging) {
          const cam = this.cameras.main;
          cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
          cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
          this.hud.hideTip();
          return;
        }
      }
      this.setHover(this.tileAtScreen(p.x, p.y), p.x, p.y);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pinching) {
        // Finish the pinch once every finger is up; never count it as a tap
        if (!this.input.pointer1?.isDown && !this.input.pointer2?.isDown) {
          this.pinching = false;
          this.pinchDist = 0;
          this.pressed = false;
          this.dragging = false;
        }
        return;
      }
      const wasClick = this.pressed && !this.dragging;
      this.pressed = false;
      this.dragging = false;
      if (!this.playing || !wasClick) return;
      if (p.rightButtonReleased()) {
        this.cancel();
        return;
      }
      if (!p.leftButtonReleased()) return;
      const tile = this.tileAtScreen(p.x, p.y);
      if (tile) this.clickTile(tile);
      this.setHover(this.tileAtScreen(p.x, p.y), p.x, p.y);
    });

    this.input.on('gameout', () => {
      if (this.playing) this.setHover(null, 0, 0);
    });

    // Smooth zoom: scale by how far the wheel/trackpad actually moved, so
    // trackpads (many tiny events) and mouse wheels (few big ones) feel the same.
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.playing) return;
      const ev = p.event as WheelEvent;
      const pinch = ev.ctrlKey; // macOS trackpad pinch arrives as ctrl+wheel
      const delta = Phaser.Math.Clamp(dy, -60, 60);
      const factor = Math.exp(-delta * (pinch ? 0.01 : 0.0015));
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.3, 3));
    });

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      // A popup is open: Esc or Enter closes it, everything else waits
      if (this.hud.dialogVisible) {
        if (e.key === 'Escape' || e.key === 'Enter') this.hud.hideDialog();
        return;
      }
      // Inside a city: Esc (or O again) goes back to the map, other keys wait
      if (this.cityView.visible) {
        if (e.key === 'Escape' || e.key.toUpperCase() === 'O') this.cityView.close();
        return;
      }
      if (this.hud.passVisible && !this.menu.visible) {
        if (e.key === ' ' || e.key === 'Enter') this.hud.startPass();
        else if (e.key === 'Escape') this.openMenu();
        return;
      }
      if (e.key === 'Escape') {
        if (!this.playing) this.continueGame();
        else if (this.selected || this.mode !== 'select') {
          // First Esc clears the selection, second opens the menu
          this.clearSelection();
          this.mode = 'select';
          this.redraw();
        } else this.openMenu();
        return;
      }
      if (!this.playing) return;
      const key = e.key.toUpperCase();
      const unit = this.selectedUnit;
      const job = JOBS.find((j) => j.key === key);
      if (job && unit && unit.type === 'builder') {
        this.doJob(job.id);
        return;
      }
      if (key === 'H' && unit) {
        this.toggleHold();
        return;
      }
      if (key === 'X' && unit && (unit.goal || this.routePreview)) {
        this.cancelRoute();
        return;
      }
      if (key === 'C' && unit && unit.type === 'settler') {
        this.foundCity();
        return;
      }
      if (key === 'L' && unit && UNIT_STATS[unit.type].military) {
        this.pillage();
        return;
      }
      switch (key) {
        case '1': this.setMode('select'); break;
        case 'N':
        case 'TAB': e.preventDefault(); this.nextUnit(); break;
        case 'K': this.toggleClaim(); break;
        case 'W': if (!unit && this.selected?.city && this.selected.owner === this.me) this.buildWalls(this.selected); break;
        case 'O': if (!unit && this.selected?.city && this.selected.owner === this.me) this.openCity(this.selected); break;
        case 'B': if (!unit) this.recruit('builder'); break;
        case 'S': if (!unit) this.recruit('settler'); break;
        case ' ':
        case 'ENTER': this.endTurn(); break;
      }
    });
  }

  private cancel(): void {
    if (this.mode !== 'select') {
      this.mode = 'select';
      this.claimCity = null;
    } else this.clearSelection();
    this.redraw();
  }

  private tileAtScreen(sx: number, sy: number): Tile | null {
    if (!this.state) return null;
    const w = this.cameras.main.getWorldPoint(sx, sy);
    const q = ((SQRT3 / 3) * w.x - (1 / 3) * w.y) / SIZE;
    const r = ((2 / 3) * w.y) / SIZE;
    // cube rounding
    const x = q;
    const z = r;
    const y = -x - z;
    let rx = Math.round(x);
    const ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (!(dy > dz)) rz = -rx - ry;
    const row = rz;
    const col = rx + (row - (row & 1)) / 2;
    return this.state.map.get(col, row);
  }

  private setHover(tile: Tile | null, sx: number, sy: number): void {
    this.hovered = tile;
    this.lastPointer = { x: sx, y: sy };
    this.refreshHover();
  }

  // ---------- fog of war ----------

  // Explored: seen at some point (terrain and borders show). Visible: in sight right now (units show).
  private seen(t: Tile): boolean {
    return !this.visible || !!this.state?.isExplored(this.me, t);
  }

  private sees(t: Tile): boolean {
    return !this.visible || this.visible.has(t);
  }

  private hoverCheck(state: GameState, tile: Tile): { label: string; check: Check } | null {
    switch (this.mode) {
      case 'claim':
        return { label: 'Claim', check: state.check('claim', tile, this.me, this.claimCity) };
      case 'raise':
      case 'lower': {
        const unit = this.selectedUnit;
        if (!unit) return null;
        return { label: this.mode === 'raise' ? 'Raise' : 'Lower', check: state.jobCheck(unit, this.mode, tile) };
      }
      case 'select': {
        const pv = this.targets.get(tile);
        if (pv) {
          const kill = pv.kind === 'unit' && pv.dmg >= (state.unitAt(tile)?.hp ?? 0) ? ' (kills it)' : '';
          return { label: 'Attack', check: { ok: true, cost: 0, reason: `deal ${pv.dmg}${kill}, take ${pv.counter}` } };
        }
        const sel = this.selectedUnit;
        // In range of another kingdom's troops or city, but not at war with them
        if (sel && sel.owner === this.me && UNIT_STATS[sel.type].military && this.sees(tile)) {
          const a = state.attackPreview(sel, tile);
          if (!a.ok && a.reason.startsWith('At peace')) return { label: 'Attack', check: { ok: false, cost: 0, reason: a.reason } };
        }
        if (this.rivalCapital(state, tile) !== null && !this.reach.has(tile)) {
          return { label: 'Diplomacy', check: { ok: true, cost: 0, reason: 'click to declare war or make peace' } };
        }
        const sel2 = this.selectedUnit;
        if (sel2 && this.unloadAt.has(tile) && sel2.cargo?.length) {
          return { label: 'Unload', check: { ok: true, cost: 0, reason: `drop off the ${UNIT_STATS[sel2.cargo[0].type].name}` } };
        }
        const left = this.reach.get(tile);
        if (left !== undefined && sel2 && !UNIT_STATS[sel2.type].naval && state.hasRoom(tile, this.me)) {
          return { label: 'Board', check: { ok: true, cost: 0, reason: 'ride the Transport (uses all moves)' } };
        }
        if (left === undefined) {
          const unit = this.selectedUnit;
          if (!unit || !this.canRoute(state, unit, tile) || state.tileOf(unit) === tile) return null;
          const plan = this.planFor(state, unit, tile);
          if (!plan.ok) return { label: 'Route', check: { ok: false, cost: 0, reason: plan.reason } };
          const pv = this.routePreview;
          const again = pv && pv.unitId === unit.id && pv.dest === tile;
          const t = `${plan.turns} turn${plan.turns === 1 ? '' : 's'}${plan.nextTo ? ', stops next to it' : ''}`;
          return { label: 'Route', check: { ok: true, cost: 0, reason: again ? `${t} \u00b7 click again to go` : `${t} \u00b7 click to see the path` } };
        }
        if (tile.city && tile.owner !== null && tile.owner !== this.me) return { label: 'Move in', check: { ok: true, cost: 0, reason: 'capture this city!' } };
        return { label: 'Move', check: { ok: true, cost: 0, reason: `${left} moves left after` } };
      }
    }
  }

  private refreshHover(): void {
    this.hoverGfx.clear();
    const state = this.state;
    const tile = this.hovered;
    if (!state || !tile || state.winner !== null || this.hud.dialogVisible || this.cityView.visible) {
      this.hud.hideTip();
      return;
    }
    const hc = this.hoverCheck(state, tile);
    const ok = hc ? hc.check.ok : true;
    const { x, y } = tileCenter(tile);
    this.hoverGfx.lineStyle(3, ok ? 0xffffff : 0xff5555, 0.95);
    this.hoverGfx.strokePoints(hexCorners(x, y, SIZE - 1.5), true);

    let lines: string[];
    if (!this.seen(tile)) {
      lines = ['Unexplored', 'Send a unit to scout it'];
    } else {
      const owner = tile.owner === null ? 'Unclaimed' : state.players[tile.owner].name;
      const extras = [tile.capital ? 'Capital' : tile.city ? 'City' : '', tile.improvement ?? '', tile.road ? 'road' : '', tile.palisade ? `palisade ${tile.palisade} HP` : '']
        .filter(Boolean)
        .join(' · ');
      const unit = state.unitAt(tile);
      lines = [
        `${TERRAIN_NAME[tile.terrain]} (height ${tile.height})`,
        `${owner}${extras ? ` · ${extras}` : ''}`,
        `Yield ${YIELD[tile.terrain]}g/turn`,
      ];
      const home = state.homeCity(tile);
      if (tile.city) lines.unshift(`${state.cityName(tile)} (${LEVEL_NAMES[cityLevel(tile) - 1]}, ${tile.pop} people ${MOOD_FACE[state.mood(tile)]})`);
      else if (home && tile.owner !== null) lines.push(`Land of ${state.cityName(home)}`);
      if (tile.city) lines.push(`HP ${tile.hp}/${cityMaxHp(tile)}${tile.walls ? ` · walls ${tile.walls} (${tile.shield}/${shieldMax(tile)})` : ''}${tile.wallTurns ? ` · walls going up (${tile.wallTurns})` : ''}`);
      if (tile.city && tile.owner !== null && tile.owner !== this.me && !state.sandbox) {
        lines.push(state.atWar(this.me, tile.owner) ? `At war with ${state.players[tile.owner].name}` : `At peace with ${state.players[tile.owner].name}`);
      }
      if (unit && (unit.owner === this.me || this.sees(tile))) lines.push(`${state.players[unit.owner].name} ${UNIT_STATS[unit.type].name} (${unit.hp}/${UNIT_STATS[unit.type].hp} HP)`);
      if (!this.sees(tile)) lines.push('Out of sight: troops here are hidden');
    }
    let status = '';
    if (hc) {
      if (this.mode === 'select') status = `${hc.label}: ${hc.check.reason}`;
      else status = hc.check.ok ? `${hc.label}: ${hc.check.cost}g` : `${hc.label}: ${hc.check.reason}`;
    }
    this.hud.showTip(lines, status, ok, this.lastPointer.x, this.lastPointer.y);
  }

  // ---------- selection panel ----------

  private renameCity(city: Tile): void {
    const state = this.state;
    if (!state || city.owner !== this.me) return;
    const name = window.prompt('Name this city', state.cityName(city));
    if (name) state.renameCity(city, name);
    this.redraw();
  }

  private hpColor(frac: number): string {
    return frac > 0.5 ? '#22c55e' : frac > 0.25 ? '#eab308' : '#ef4444';
  }

  private buildPanel(state: GameState): PanelModel | null {
    const tile = this.selected;
    if (!tile) return null;
    const unit = this.selectedUnit;
    if (unit) return this.unitPanel(state, unit);
    if (tile.city && tile.owner === this.me) return this.cityPanel(state, tile);
    return this.tilePanel(state, tile);
  }

  private unitPanel(state: GameState, unit: Unit): PanelModel {
    const stats = UNIT_STATS[unit.type];
    const here = state.tileOf(unit);
    const sections: PanelSection[] = [];
    const status: PanelSection = {
      bars: [
        { label: 'Health', value: unit.hp, max: stats.hp, color: this.hpColor(unit.hp / stats.hp) },
        { label: 'Moves', value: unit.moves, max: stats.moves, color: '#60a5fa' },
      ],
      lines: [],
    };
    if (stats.military) {
      status.lines!.push(`Attack ${stats.atk} · Range ${stats.range}${stats.strongVs ? ` · strong vs ${UNIT_STATS[stats.strongVs].name}s` : ''}`);
      if (stats.boatsOnly) status.lines!.push('Only fights other boats.');
      else if (stats.naval) status.lines!.push('Hits boats, units on the shore and cities. Next to an enemy city it blockades its fisheries.');
      if (stats.setup) status.lines!.push(`Fire first, then move: it can't shoot after moving. x${stats.vsPalisade} vs palisades, x${stats.vsCity} vs cities.`);
      status.lines!.push(unit.acted ? 'Already attacked this turn' : 'Red hexes = attack (only kingdoms you are at war with).');
    } else if (unit.type === 'builder') {
      status.lines!.push(unit.uses !== undefined ? `Jobs left: ${unit.uses}` : 'Unlimited jobs');
      status.lines!.push('Can wade into your own water to build fisheries.');
      if (unit.acted) status.lines!.push('Done working this turn');
    } else if (stats.carry) {
      const aboard = unit.cargo ?? [];
      status.lines!.push(`On board ${aboard.length}/${stats.carry}${aboard.length ? `: ${aboard.map((c) => UNIT_STATS[c.type].name).join(', ')}` : ''}`);
      status.lines!.push(aboard.length ? 'Green hexes = unload the next unit there.' : 'Land units board by moving onto it.');
    } else if (stats.scout) {
      status.lines!.push("Crosses closed borders at peace to look around. Hills, mountains and forests cost 1 less. Can't fight.");
    } else {
      status.lines!.push('Move 3+ hexes from any city, then found it. Uses up the settler.');
    }
    if (unit.hold) status.lines!.push('Holding: skipped by the end-of-turn check');
    sections.push(status);

    // Route: what's planned, or how to plan one
    if (unit.owner === this.me) {
      const pv = this.routePreview && this.routePreview.unitId === unit.id ? this.routePreview.plan : null;
      const active = unit.goal ? state.routeLeft(unit) : null;
      const lines: string[] = [];
      const buttons: PanelButton[] = [];
      const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;
      if (pv) {
        lines.push(`Preview: ${turns(pv.turns)} to get there${pv.nextTo ? ' (stops next to it)' : ''}. Tap the same hex again to go.`);
        lines.push('Dots show where it stops each turn.');
      } else if (unit.goal) {
        lines.push(active ? `On a route: about ${turns(active.turns)} left` : 'On a route');
        lines.push('Moves by itself at the start of each turn. Stops if enemies show up.');
        if (unit.waited) lines.push(`Waiting for one of your units to get out of the way (${unit.waited})`);
      } else {
        lines.push('Tap a far hex to plan a multi-turn route.');
      }
      if (unit.goal || pv) {
        buttons.push({ label: pv ? 'Cancel preview' : 'Cancel route', key: 'X', enabled: true, hint: pv ? 'clear the path' : 'stop here', onClick: () => this.cancelRoute() });
      }
      sections.push({ heading: 'Route', summary: pv ? `preview ${turns(pv.turns)}` : active ? turns(active.turns) : 'none', lines, buttons });
    }

    const actions: PanelButton[] = [];
    if (unit.type === 'settler') {
      const c = state.foundCheck(unit);
      actions.push({ label: 'Found city here', key: 'C', enabled: c.ok, hint: c.ok ? 'uses the settler' : c.reason, onClick: () => this.foundCity() });
    }
    if (stats.military && unit.owner === this.me) {
      const c = state.pillageCheck(unit);
      const loot = state.pillageTarget(here);
      // Only worth showing on enemy land
      if (here.owner !== null && here.owner !== unit.owner && !here.city) {
        actions.push({
          label: loot ? `Pillage ${loot.name}` : 'Pillage',
          key: 'L',
          enabled: c.ok,
          hint: c.ok && loot ? `+${loot.gold}g, uses its attack` : c.reason,
          onClick: () => this.pillage(),
        });
      }
    }
    if (unit.type === 'builder') {
      for (const j of JOBS) {
        const terraform = j.id === 'raise' || j.id === 'lower';
        const c = terraform ? this.terraformPreview(state, unit, j.id) : state.jobCheck(unit, j.id, here);
        actions.push({
          label: j.label,
          key: j.key,
          enabled: c.ok,
          hint: c.ok ? (terraform ? 'pick a hex' : `${c.cost}g`) : c.reason,
          active: this.mode === j.id,
          onClick: () => this.doJob(j.id),
        });
      }
    }
    if (unit.owner === this.me) {
      actions.push({
        label: unit.hold ? 'Stop holding' : 'Hold position',
        key: 'H',
        enabled: true,
        hint: unit.hold ? 'holding' : 'skip end-turn check',
        active: unit.hold === true,
        onClick: () => this.toggleHold(),
      });
    }
    sections.push({ heading: 'Actions', buttons: actions });
    const where = here.city ? ` · in ${state.cityName(here)}` : '';
    return {
      title: stats.name,
      subtitle: `${state.players[unit.owner].name}${where}`,
      sections,
      footer: 'Click it again or Esc to deselect \u00b7 N or Tab = next unit',
    };
  }

  private cityPanel(state: GameState, city: Tile): PanelModel {
    const claiming = this.mode === 'claim' && this.claimCity === city;
    const open = state.openClaims(city);
    const sections: PanelSection[] = [];
    const bars: PanelBar[] = [{ label: 'Health', value: city.hp, max: cityMaxHp(city), color: this.hpColor(city.hp / cityMaxHp(city)) }];
    if (city.walls) bars.push({ label: `Walls ${city.walls}`, value: city.shield, max: shieldMax(city), color: '#60a5fa' });
    sections.push({ bars });

    // People: spare food fills the growth bar, a full bar is one more person
    const lvl = cityLevel(city);
    const unlock = (n: number) =>
      n === 3 ? 'claims land 4 hexes out' : n === MAX_LEVEL ? 'troops train 1 turn faster' : '+1 gold, +1 food, +10 HP';
    const need = state.growthNeed(city);
    const note = state.growthNote(city);
    const rate = state.growthRate(city);
    const growLines = [
      `${city.pop} people \u00b7 eat ${Math.floor(city.pop / 2)} food \u00b7 ${need > 0 ? note || `+${rate.toFixed(1)} growth/turn` : 'full size'}`,
    ];
    if (lvl < MAX_LEVEL) growLines.push(`Next: ${LEVEL_NAMES[lvl]} at ${LEVEL_POP[lvl]} people (${unlock(lvl + 1)}, +1 plot)`);
    sections.push({
      heading: 'People',
      summary: `${city.pop} \u00b7 ${LEVEL_NAMES[lvl - 1]}`,
      bars: need > 0 ? [{ label: 'Growth', value: Math.floor(city.growth), max: need, color: '#a3e635' }] : [],
      lines: growLines,
    });

    // Happiness: what's helping and hurting
    const mood = state.mood(city);
    const happy = state.happiness(city);
    const moodText: Record<string, string> = {
      happy: 'Happy: grows 50% faster, +1 gold',
      content: 'Content',
      unhappy: 'Unhappy: not growing. Build a Temple or Park',
      angry: 'Angry: people are leaving! Build amenities or bring troops home',
    };
    sections.push({
      heading: 'Happiness',
      folded: true,
      summary: `${MOOD_FACE[mood]} ${happy >= 0 ? '+' : ''}${happy}`,
      lines: [
        `${MOOD_FACE[mood]} ${happy >= 0 ? '+' : ''}${happy} \u00b7 ${moodText[mood]}`,
        state.happinessParts(city).map(([k, n]) => `${k} ${n >= 0 ? '+' : ''}${n}`).join(', '),
      ],
    });

    // Culture: the city grabs a free tile next to its land when the bar fills
    const cNeed = state.cultureNeed(city);
    const cRate = state.cultureRate(city);
    const pick = state.borderPick(city);
    const cTurns = Math.max(1, Math.ceil((cNeed - city.culture) / cRate));
    sections.push({
      heading: 'Borders',
      folded: true,
      summary: pick ? `+1 tile in ${cTurns}t` : 'no room',
      bars: [{ label: 'Culture', value: city.culture, max: cNeed, color: '#c084fc' }],
      lines: [
        pick
          ? `+${cRate} culture per turn \u00b7 grabs a free tile in about ${cTurns} turn${cTurns === 1 ? '' : 's'}`
          : 'No open land in reach: grows again when land opens up',
      ],
    });

    // Amenities: one project at a time, shared with training troops. Each one stands on a plot around the Keep:
    // these buttons auto-place it on the best open plot, Open city picks the spot by hand.
    const plotsOpen = openPlots(city, state.isSimple(this.me));
    const plotsUsed = city.placed.filter(Boolean).length + (city.projectPlot !== null ? 1 : 0);
    const buildButtons: PanelButton[] = [
      {
        label: '\u{1F3F0} Open city',
        key: 'O',
        enabled: true,
        hint: `${plotsUsed}/${plotsOpen} plots used \u00b7 pick spots`,
        onClick: () => this.openCity(city),
      },
    ];
    const built = BUILDING_ORDER.filter((b) => city.buildings.includes(b));
    for (const b of BUILDING_ORDER) {
      if (city.buildings.includes(b)) continue;
      if (BUILDINGS[b].coastal && !state.isCoastal(city)) continue; // inland: no Harbor
      if (!hasPlotFor(city, b)) continue; // no plot it can stand on (no hills: no Workshop)
      const info = BUILDINGS[b];
      const c = state.buildCheck(city, b, this.me);
      const doing = city.project === b;
      let where = '';
      if (doing && city.projectPlot !== null) where = ` \u00b7 plot ${city.projectPlot + 1}`;
      else if (c.ok) {
        const at = state.autoPlot(city, b, this.me);
        const bonus = at !== null ? shortNotes(placementNotes(city, at, b)) : '';
        where = at !== null ? ` \u00b7 plot ${at + 1}${bonus ? ` ${bonus}` : ''}` : '';
      }
      buildButtons.push({
        label: `${info.icon} ${info.name}${doing ? ` (${city.projectTurns}t left)` : ''}`,
        enabled: c.ok,
        active: doing,
        hint: doing ? `building${where}` : c.ok ? `${state.options.freeBuild ? 'free' : `${c.cost}g`} \u00b7 ${info.turns}t \u00b7 ${info.note}${where}` : c.reason,
        onClick: () => this.build(city, b),
      });
    }
    sections.push({
      heading: 'Amenities',
      summary: city.project ? `${BUILDINGS[city.project].name} ${city.projectTurns}t` : `${built.length} built \u00b7 ${plotsUsed}/${plotsOpen} plots`,
      lines: [
        built.length ? `Built: ${built.map((b) => `${BUILDINGS[b].icon} ${BUILDINGS[b].name}`).join(', ')}` : 'Nothing built yet. One project at a time.',
        'Buttons pick the best plot for you. Open city (O or double-tap the city) to choose the spot yourself.',
      ],
      buttons: buildButtons,
      grid: true,
    });

    const wc = state.wallCheck(city, this.me);
    const nextStone = city.walls < MAX_WALLS ? state.wallStoneCost(city) : 0;
    const wt = state.wallTurnsFor(city);
    const turnsTxt = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;
    const wallLines = [
      city.walls
        ? `Walls level ${city.walls} of ${MAX_WALLS}: the blue bar soaks damage first`
        : 'No walls yet. Walls cost stone (mines make it).',
    ];
    if (city.wallTurns > 0) wallLines.push(`Building walls level ${city.walls + 1}: ${turnsTxt(city.wallTurns)} left`);
    sections.push({
      heading: 'Defense',
      folded: true,
      summary: city.wallTurns > 0 ? `walls ${city.walls + 1} in ${city.wallTurns}` : city.walls ? `walls ${city.walls}/${MAX_WALLS}` : 'no walls',
      lines: wallLines,
      buttons: [
        {
          label:
            city.walls >= MAX_WALLS ? 'Walls maxed' : city.wallTurns > 0 ? `Building walls ${city.walls + 1}` : city.walls ? `Upgrade walls to ${city.walls + 1}` : 'Build walls',
          key: 'W',
          enabled: wc.ok,
          hint: wc.ok
            ? `${state.options.freeBuild ? 'free' : `${wc.cost}g + ${nextStone} stone`} · ${turnsTxt(wt)}`
            : city.walls >= MAX_WALLS ? '' : wc.reason,
          onClick: () => this.buildWalls(city),
        },
      ],
    });

    sections.push({
      heading: 'Land',
      summary: `${state.cityLand(city).length} tiles${open > 0 ? ` \u00b7 ${open} open` : ''}`,
      lines: claiming
        ? [`${state.cityLand(city).length} tiles. Click a green hex to buy it (price shown). K or right-click when done.`]
        : [`${state.cityLand(city).length} tiles · ${open > 0 ? `${open} more can be claimed` : 'area full: send a settler to expand'}`],
      buttons: [
        {
          label: claiming ? 'Done claiming' : 'Claim land',
          key: 'K',
          enabled: claiming || open > 0,
          hint: claiming ? '' : open > 0 ? `${open} open` : 'full',
          active: claiming,
          onClick: () => this.toggleClaim(),
        },
      ],
    });

    const train: PanelButton[] = [];
    const recruitables: { type: UnitType; key?: string }[] = [
      { type: 'builder', key: 'B' },
      { type: 'settler', key: 'S' },
      ...(state.sandbox ? [] : TROOPS.map((type) => ({ type }))),
      ...(state.sandbox || !state.isCoastal(city) ? [] : NAVY.map((type) => ({ type }))),
    ];
    for (const r of recruitables) {
      const c = state.recruitCheck(r.type, city, this.me);
      const s = UNIT_STATS[r.type];
      const turns = state.trainTurns(r.type, city);
      const time = turns > 0 ? ` · ${turns}t` : '';
      train.push({
        label: s.name,
        key: r.key,
        enabled: c.ok,
        hint: c.ok ? `${c.cost}g · ${s.food} food${time}` : c.reason,
        onClick: () => this.recruit(r.type),
      });
    }
    const queued = state.trainingAt(city);
    const trainLines = queued
      ? [`Training ${UNIT_STATS[queued.type].name}: ${queued.turnsLeft > 0 ? `${queued.turnsLeft} turn${queued.turnsLeft > 1 ? 's' : ''} left` : 'waiting for room'}`]
      : [city.project ? `Busy building ${BUILDINGS[city.project].name} (builders still OK)` : `One unit at a time \u00b7 food left: ${state.foodMade(this.me) - state.foodUsed(this.me)}`];
    // While training, only Builder (instant) is still possible, so the list shrinks to that
    const trainButtons = queued ? train.filter((b) => b.enabled) : train;
    sections.push({
      heading: 'Train',
      summary: queued ? `${UNIT_STATS[queued.type].name} \u00b7 ${queued.turnsLeft}t` : 'ready',
      lines: trainLines,
      buttons: trainButtons,
      grid: true,
    });

    const here = state.unitAt(city);
    if (here && here.owner === this.me) {
      sections.push({
        heading: 'In this city',
        buttons: [
          {
            label: `Select ${UNIT_STATS[here.type].name}`,
            enabled: true,
            hint: 'or click the city again',
            onClick: () => {
              this.mode = 'select';
              this.claimCity = null;
              this.selectedUnitId = here.id;
              this.redraw();
            },
          },
        ],
      });
    }
    return {
      title: state.cityName(city),
      subtitle: `${LEVEL_NAMES[cityLevel(city) - 1]} \u00b7 ${city.capital ? 'your capital' : 'your city'}`,
      titleAction: { label: 'Rename', onClick: () => this.renameCity(city) },
      sections,
    };
  }

  private tilePanel(state: GameState, tile: Tile): PanelModel {
    if (!this.seen(tile)) {
      return { title: 'Unexplored', sections: [{ lines: ['Nobody has scouted this land yet. Send a unit to see it.'] }] };
    }
    const lines: string[] = [];
    const home = state.homeCity(tile);
    if (tile.owner === null) lines.push('Unclaimed');
    else lines.push(`${state.players[tile.owner].name}${home ? ` · land of ${state.cityName(home)}` : ''}`);
    lines.push(`Height ${tile.height} · ${YIELD[tile.terrain]} gold/turn${tile.improvement ? ` · ${tile.improvement}` : ''}${tile.road ? ' · road' : ''}`);
    const bars: PanelBar[] = [];
    let title = TERRAIN_NAME[tile.terrain];
    if (tile.city && tile.owner !== null) {
      title = state.cityName(tile);
      bars.push({ label: 'Health', value: tile.hp, max: cityMaxHp(tile), color: this.hpColor(tile.hp / cityMaxHp(tile)) });
      if (tile.walls) bars.push({ label: `Walls ${tile.walls}`, value: tile.shield, max: shieldMax(tile), color: '#60a5fa' });
    }
    if (tile.palisade) {
      lines.push(`Palisade ${tile.palisade}/${PALISADE_HP} HP${tile.owner === this.me ? ': enemies have to break it to get through' : ': break it to get through'}`);
    }
    const other = state.unitAt(tile);
    if (other && other.owner !== this.me && this.sees(tile)) {
      const s = UNIT_STATS[other.type];
      lines.push(`${state.players[other.owner].name} ${s.name} here`);
      bars.push({ label: 'Unit HP', value: other.hp, max: s.hp, color: this.hpColor(other.hp / s.hp) });
    }
    if (!this.sees(tile)) lines.push('Out of sight right now');
    const sections: PanelSection[] = [{ bars, lines }];
    // Another kingdom's city: war and peace with them
    const q = tile.owner;
    if (tile.city && q !== null && q !== this.me && !state.sandbox && state.players[q].alive) {
      const war = state.atWar(this.me, q);
      const t = state.warTurns(this.me, q);
      sections.push({
        heading: 'Diplomacy',
        summary: war ? 'at war' : 'at peace',
        lines: [war ? `At war with ${state.players[q].name} for ${t} turn${t === 1 ? '' : 's'}` : `At peace with ${state.players[q].name}`],
        buttons: [{ label: war ? 'Make peace...' : 'Declare war...', enabled: true, hint: '', onClick: () => this.openDiplomacy(q) }],
      });
    }
    return {
      title,
      subtitle:
        tile.city && tile.owner !== null
          ? `${state.players[tile.owner].name} ${tile.capital ? 'capital' : 'city'} \u00b7 ${LEVEL_NAMES[cityLevel(tile) - 1]} \u00b7 ${tile.pop} people ${MOOD_FACE[state.mood(tile)]}`
          : undefined,
      sections,
    };
  }

  // Raise/lower is valid if any target (builder tile or neighbor) works.
  private terraformPreview(state: GameState, unit: Unit, job: 'raise' | 'lower'): Check {
    const here = state.tileOf(unit);
    let last: Check = { ok: false, cost: 0, reason: 'Nothing to change' };
    for (const t of [here, ...state.map.neighbors(here)]) {
      const c = state.jobCheck(unit, job, t);
      if (c.ok) return c;
      last = c;
    }
    return last;
  }

  private findTargets(state: GameState, unit: Unit): Map<Tile, AttackPreview> {
    const out = new Map<Tile, AttackPreview>();
    const stats = UNIT_STATS[unit.type];
    if (!stats.military || unit.acted || unit.owner !== state.current) return out;
    const here = state.tileOf(unit);
    const near = new Set<Tile>(state.map.neighbors(here));
    if (stats.range >= 2) for (const n of [...near]) for (const m of state.map.neighbors(n)) if (m !== here) near.add(m);
    for (const t of near) {
      const pv = state.attackPreview(unit, t);
      if (pv.ok) out.set(t, pv);
    }
    return out;
  }

  // ---------- drawing ----------

  private redraw(): void {
    const state = this.state;
    if (!state) return;
    const unit = this.selectedUnit;
    if (this.selectedUnitId !== null && !unit) this.clearSelection();
    if (unit) this.selected = state.tileOf(unit);
    if (this.mode === 'claim') {
      // Stop if the city was lost
      if (!this.claimCity || this.claimCity.owner !== this.me) {
        this.mode = 'select';
        this.claimCity = null;
      } else this.selected = this.claimCity;
    }
    if (this.routePreview && (this.routePreview.unitId !== this.selectedUnitId || this.mode !== 'select')) this.routePreview = null;
    this.hoverPlan = null; // the board changed: re-plan hover routes
    this.reach = unit && this.mode === 'select' ? state.reachableFor(unit) : new Map();
    this.unloadAt = unit && this.mode === 'select' && unit.owner === this.me ? state.unloadTiles(unit) : new Set();
    this.targets = unit && this.mode === 'select' ? this.findTargets(state, unit) : new Map();
    // Fog of war: reveal what's in sight now (and remember it)
    this.visible = state.fog ? state.explore(this.me) : null;

    this.drawTerrain(state);
    this.drawOwners(state);
    this.drawFog(state);
    this.drawWorkers(state);
    this.drawOverlay(state);
    this.drawUnits(state);
    this.hud.hideIdle();
    this.refreshHover();
    this.hud.update(state, this.mode);
    this.hud.showPanel(this.buildPanel(state));
    this.cityView.refresh(); // keep an open City View in step (or close it if the city was lost)
    saveGame(state);
  }

  private drawTerrain(state: GameState): void {
    const g = this.terrainGfx;
    g.clear();
    const map = state.map;
    for (const t of map.tiles) {
      const { x, y } = tileCenter(t);
      const pts = hexCorners(x, y, SIZE);
      if (!this.seen(t)) {
        // Never explored: just darkness
        g.fillStyle(FOG_COLOR, 1);
        g.fillPoints(pts, true);
        g.lineStyle(1, 0x000000, 0.4);
        g.strokePoints(pts, true);
        continue;
      }
      g.fillStyle(HEIGHT_COLOR[t.height], 1);
      g.fillPoints(pts, true);
      g.lineStyle(1, 0x000000, 0.25);
      g.strokePoints(pts, true);
      if (t.terrain === 'mountain') {
        g.fillStyle(0x6b6b6b, 1);
        g.fillTriangle(x - 12, y + 8, x, y - 11, x + 12, y + 8);
        g.fillStyle(0xf2f2f2, 1);
        g.fillTriangle(x - 4, y - 5, x, y - 11, x + 4, y - 5);
      } else if (t.terrain === 'hills') {
        g.fillStyle(0x6f6038, 1);
        g.fillEllipse(x - 6, y + 4, 14, 8);
        g.fillEllipse(x + 6, y + 6, 12, 7);
      }
      if (t.improvement === 'farm') {
        g.lineStyle(2, 0xf0d264, 1);
        for (let i = -1; i <= 1; i++) g.lineBetween(x - 11, y + i * 6, x + 11, y + i * 6);
      } else if (t.improvement === 'mine') {
        g.fillStyle(0x2b2b2b, 1);
        g.fillRect(x - 7, y + 1, 14, 9);
        g.fillStyle(0xd4a017, 1);
        g.fillCircle(x, y + 5, 2.5);
      } else if (t.improvement === 'pasture') {
        // wooden fence with a horseshoe
        g.lineStyle(2, 0x8b5a2b, 1);
        g.lineBetween(x - 12, y + 2, x + 12, y + 2);
        g.lineBetween(x - 12, y + 8, x + 12, y + 8);
        for (const px of [-11, -4, 4, 11]) g.lineBetween(x + px, y - 1, x + px, y + 11);
        g.lineStyle(2.5, 0xe5e7eb, 1);
        g.beginPath();
        g.arc(x, y - 8, 4, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), true);
        g.strokePath();
      } else if (t.improvement === 'fishery') {
        // net floats and a little jumping fish
        g.lineStyle(1.5, 0xe5e7eb, 0.8);
        g.strokeCircle(x - 4, y + 4, 7);
        g.lineBetween(x - 11, y + 4, x + 3, y + 4);
        g.lineBetween(x - 4, y - 3, x - 4, y + 11);
        g.fillStyle(0xf97316, 1);
        for (const [dx, dy] of [[-11, 4], [3, 4], [-4, -3], [-4, 11]] as const) g.fillCircle(x + dx, y + dy, 2);
        g.fillStyle(0x7dd3fc, 1);
        g.fillEllipse(x + 8, y - 6, 8, 4);
        g.fillTriangle(x + 12, y - 6, x + 15, y - 9, x + 15, y - 3);
      } else if (t.improvement === 'forest') {
        // three pine trees
        for (const [dx, dy, s] of [[-8, 4, 1], [8, 4, 1], [0, -3, 1.2]] as const) {
          g.fillStyle(0x5b3a1e, 1);
          g.fillRect(x + dx - 1, y + dy + 4 * s, 2, 4);
          g.fillStyle(0x1f5e2e, 1);
          g.fillTriangle(x + dx - 6 * s, y + dy + 5 * s, x + dx, y + dy - 8 * s, x + dx + 6 * s, y + dy + 5 * s);
        }
      }
    }
    // Roads: connect road/city tiles to neighbors that also have roads
    const hasRoad = (t: Tile) => (t.road || t.city) && this.seen(t);
    g.lineStyle(4, 0x7a5a32, 0.95);
    for (const t of map.tiles) {
      if (!hasRoad(t)) continue;
      const a = tileCenter(t);
      let linked = false;
      for (let dir = 0; dir < 6; dir++) {
        const n = map.neighborAt(t, dir);
        if (!n || !hasRoad(n)) continue;
        linked = true;
        if (dir === 0 || dir === 4 || dir === 5) {
          const b = tileCenter(n);
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
      if (t.road && !linked) {
        g.fillStyle(0x7a5a32, 1);
        g.fillCircle(a.x, a.y, 4);
      }
    }
  }

  private drawOwners(state: GameState): void {
    const g = this.ownerGfx;
    g.clear();
    this.castles?.clear();
    this.castleGfx.clear();
    const map = state.map;
    let names = 0;
    for (const t of map.tiles) {
      if (t.owner === null || !this.seen(t)) continue;
      const color = state.players[t.owner].color;
      const { x, y } = tileCenter(t);
      const pts = hexCorners(x, y, SIZE);
      g.fillStyle(color, 0.22);
      g.fillPoints(pts, true);

      for (let i = 0; i < 6; i++) {
        const n = map.neighborAt(t, EDGE_TO_DIR[i]);
        const a = pts[i];
        const b = pts[(i + 1) % 6];
        if (n && n.owner === t.owner) {
          // Same kingdom, different city: faint dashed-looking divider
          if (n.home !== t.home) {
            g.lineStyle(1.5, 0xffffff, 0.35);
            g.lineBetween(a.x, a.y, b.x, b.y);
          }
          continue;
        }
        g.lineStyle(3, color, 1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }

      if (t.palisade) {
        // wooden stakes around the hex
        const ring = hexCorners(x, y, SIZE - 5);
        g.lineStyle(3, 0x8b5a2b, 1);
        g.strokePoints(ring, true);
        g.fillStyle(0x5b3a1e, 1);
        for (const c of ring) g.fillCircle(c.x, c.y, 2.5);
      }
      if (t.city) {
        if (t.walls > 0) {
          // stone ring, thicker per level
          g.lineStyle(1.5 + t.walls * 1.5, 0x9ca3af, 1);
          g.strokePoints(hexCorners(x, y, SIZE - 4), true);
        }
        this.drawCastle(x, y, color, t.capital);
        this.drawCityBars(g, t, x, y);
        this.cityLabel(names++, x, y + SIZE - 2, state.cityName(t), color, t.capital, t.pop, MOOD_FACE[state.mood(t)]);
      }
    }
    for (let i = names; i < this.cityLabels.length; i++) this.cityLabels[i].setVisible(false);
  }

  // A city on the map: the Kenney castle (the same one as the Keep inside the city) with a flag in the owner's
  // color on top. Capitals get a gold crown on the flagpole. Falls back to the drawn house if the art is missing.
  private drawCastle(x: number, y: number, color: number, capital: boolean): void {
    const b = this.castles;
    const g = this.castleGfx;
    if (!b || !canDraw(this, KEEP_ART.cells)) {
      this.drawCity(g, x, y, color, capital);
      return;
    }
    const left = Math.round(x - (KEEP_ART.w * ART) / 2);
    const top = Math.round(y - (KEEP_ART.h * ART) / 2 - 2);
    for (const c of KEEP_ART.cells) b.create(left + c.x * ART, top + c.y * ART, c.f);
    // Flag on the battlements
    const px = Math.round(x);
    const py = top + 1;
    const h = 8;
    g.lineStyle(1.5, 0x2a1d14, 1);
    g.lineBetween(px, py, px, py - h);
    g.fillStyle(color, 1);
    g.fillTriangle(px, py - h, px, py - h + 5, px + 8, py - h + 2.5);
    g.lineStyle(1, 0x111111, 0.85);
    g.strokeTriangle(px, py - h, px, py - h + 5, px + 8, py - h + 2.5);
    if (capital) {
      const base = py - h - 1;
      g.fillStyle(0xfacc15, 1);
      g.fillRect(px - 4, base - 2, 8, 2);
      g.fillTriangle(px - 4, base - 2, px - 4, base - 6, px - 2, base - 2);
      g.fillTriangle(px - 1.5, base - 2, px, base - 7, px + 1.5, base - 2);
      g.fillTriangle(px + 2, base - 2, px + 4, base - 6, px + 4, base - 2);
    }
  }

  // Explored land that's out of sight right now gets a dark veil
  private drawFog(state: GameState): void {
    const g = this.fogGfx;
    g.clear();
    if (!this.visible) return;
    g.fillStyle(0x000000, FOG_DIM);
    for (const t of state.map.tiles) {
      if (!this.seen(t) || this.sees(t)) continue;
      const { x, y } = tileCenter(t);
      g.fillPoints(hexCorners(x, y, SIZE), true);
    }
  }

  // A little pixel worker on every worked farm, pasture, mine and forest you can see
  private drawWorkers(state: GameState): void {
    let n = 0;
    if (!this.smallZoom) {
      for (const pl of state.players) {
        if (!pl.alive) continue;
        for (const t of state.workedTiles(pl.id)) {
          if (!t.improvement || !this.sees(t)) continue;
          const { x, y } = tileCenter(t);
          const [ox, oy] = WORKER_OFFSET[t.improvement];
          const key = WORKER_SPRITE[t.improvement];
          let s = this.workerSprites[n];
          if (!s) {
            s = this.add.sprite(0, 0, key, '0').setDepth(1.3).setScale(WORKER_SCALE);
            this.workerSprites.push(s);
          }
          s.setPosition(Math.round(x + ox), Math.round(y + oy)).setVisible(true);
          if (s.anims.currentAnim?.key !== key) s.play({ key, startFrame: n % 2 });
          n++;
        }
      }
    }
    for (let i = n; i < this.workerSprites.length; i++) this.workerSprites[i].setVisible(false);
  }

  // Name tag under each city, above units so it never gets covered.
  // After the name: how many people live there and how happy they are.
  private cityLabel(i: number, x: number, y: number, name: string, color: number, capital: boolean, pop: number, face: string): void {
    let label = this.cityLabels[i];
    if (!label) {
      label = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#ffffff', padding: { x: 4, y: 1 } })
        .setOrigin(0.5)
        .setDepth(4.2);
      this.cityLabels.push(label);
    }
    const bg = `#${color.toString(16).padStart(6, '0')}`;
    const text = `${capital ? '\u2605 ' : ''}${name} ${pop} ${face}`;
    label.setText(text).setBackgroundColor(bg).setPosition(x, y).setVisible(true);
  }

  // Health bar (only when damaged) with the wall shield bar above it.
  private drawCityBars(g: Phaser.GameObjects.Graphics, t: Tile, x: number, y: number): void {
    const w = 30;
    const left = x - w / 2;
    let barY = y + 18;
    const bar = (value: number, max: number, color: number) => {
      g.fillStyle(0x111111, 0.85);
      g.fillRect(left - 1, barY - 1, w + 2, 5);
      g.fillStyle(color, 1);
      g.fillRect(left, barY, Math.max(0, (value / max) * w), 3);
      barY -= 5;
    };
    const max = cityMaxHp(t);
    if (t.hp < max) bar(t.hp, max, t.hp / max > 0.5 ? 0x22c55e : t.hp / max > 0.25 ? 0xeab308 : 0xef4444);
    if (t.walls > 0) bar(t.shield, shieldMax(t), 0x60a5fa);
  }

  private priceLabel(i: number, x: number, y: number, text: string, affordable: boolean): void {
    let label = this.priceLabels[i];
    if (!label) {
      label = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(2.5);
      this.priceLabels.push(label);
    }
    label.setText(text).setColor(affordable ? '#ffffff' : '#fca5a5').setPosition(x, y).setVisible(true);
  }

  private drawOverlay(state: GameState): void {
    const g = this.overlayGfx;
    g.clear();
    let labels = 0;
    const unit = this.selectedUnit;

    if (this.reach.size > 0 && unit) {
      // Dim everything the unit can't reach so the lit hexes pop.
      const home = state.tileOf(unit);
      g.fillStyle(0x000000, 0.4);
      for (const t of state.map.tiles) {
        if (t === home || this.reach.has(t) || this.targets.has(t) || this.unloadAt.has(t)) continue;
        const { x, y } = tileCenter(t);
        g.fillPoints(hexCorners(x, y, SIZE), true);
      }
      for (const t of this.reach.keys()) {
        const { x, y } = tileCenter(t);
        const pts = hexCorners(x, y, SIZE - 3);
        const capture = t.city && t.owner !== null && t.owner !== unit.owner;
        g.fillStyle(capture ? 0xfacc15 : 0xffffff, capture ? 0.3 : 0.12);
        g.fillPoints(pts, true);
        g.lineStyle(capture ? 3 : 2, capture ? 0xfacc15 : 0xffffff, 0.9);
        g.strokePoints(pts, true);
        const other = state.unitAt(t);
        if ((!other || !this.sees(t)) && !capture) {
          g.fillStyle(0xffffff, 0.9);
          g.fillCircle(x, y, 4);
        }
      }
    }
    // Where a transport can drop off its passengers: green
    for (const t of this.unloadAt) {
      const { x, y } = tileCenter(t);
      const pts = hexCorners(x, y, SIZE - 3);
      g.fillStyle(0x22c55e, 0.25);
      g.fillPoints(pts, true);
      g.lineStyle(2, 0x4ade80, 0.95);
      g.strokePoints(pts, true);
      g.fillStyle(0x4ade80, 1);
      g.fillTriangle(x - 5, y - 3, x + 5, y - 3, x, y + 4);
    }
    if (this.targets.size > 0 && unit) {
      if (this.reach.size === 0) {
        // No moves left but can still attack: dim the rest so targets stand out
        const home = state.tileOf(unit);
        g.fillStyle(0x000000, 0.4);
        for (const t of state.map.tiles) {
          if (t === home || this.targets.has(t)) continue;
          const { x, y } = tileCenter(t);
          g.fillPoints(hexCorners(x, y, SIZE), true);
        }
      }
      for (const t of this.targets.keys()) {
        const { x, y } = tileCenter(t);
        const pts = hexCorners(x, y, SIZE - 3);
        g.fillStyle(0xef4444, 0.35);
        g.fillPoints(pts, true);
        g.lineStyle(3, 0xf87171, 1);
        g.strokePoints(pts, true);
        // crosshair
        g.lineStyle(2, 0xffffff, 0.9);
        g.strokeCircle(x, y - 14, 5);
        g.lineBetween(x - 8, y - 14, x + 8, y - 14);
        g.lineBetween(x, y - 22, x, y - 6);
      }
    }
    if (this.mode === 'claim') {
      // Claim zone: this city's area (hexes within CLAIM_RADIUS of it). Dim everything else hard.
      const city = this.claimCity;
      const zone = new Set(state.map.tiles.filter((t) => (city ? state.inCityRange(t, city) : state.inClaimRange(t, this.me))));
      g.fillStyle(0x000000, 0.55);
      for (const t of state.map.tiles) {
        if (zone.has(t)) continue;
        const { x, y } = tileCenter(t);
        g.fillPoints(hexCorners(x, y, SIZE), true);
      }
      // Inside the zone: green + price = buy now; darkened = not reachable yet (or water / someone else's)
      for (const t of zone) {
        if (t.owner === this.me && (!city || state.belongsTo(t, city))) continue; // already this city's
        const { x, y } = tileCenter(t);
        const pts = hexCorners(x, y, SIZE - 3);
        const c = state.check('claim', t, this.me, city);
        if (c.ok) {
          g.fillStyle(0x22c55e, 0.5);
          g.fillPoints(pts, true);
          g.lineStyle(3, 0x86efac, 1);
          g.strokePoints(pts, true);
          this.priceLabel(labels++, x, y, c.cost > 0 ? `${c.cost}g` : 'free', c.cost <= state.players[this.me].gold || state.options.freeBuild);
        } else {
          g.fillStyle(0x000000, 0.3);
          g.fillPoints(pts, true);
        }
      }
      // Yellow line around the edge of the zone
      g.lineStyle(3, 0xfacc15, 0.95);
      for (const t of zone) {
        const { x, y } = tileCenter(t);
        const pts = hexCorners(x, y, SIZE);
        for (let i = 0; i < 6; i++) {
          const n = state.map.neighborAt(t, EDGE_TO_DIR[i]);
          if (n && zone.has(n)) continue;
          const a = pts[i];
          const b = pts[(i + 1) % 6];
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
    }
    if ((this.mode === 'raise' || this.mode === 'lower') && unit) {
      const here = state.tileOf(unit);
      for (const t of [here, ...state.map.neighbors(here)]) {
        const ok = state.jobCheck(unit, this.mode, t).ok;
        const { x, y } = tileCenter(t);
        const pts = hexCorners(x, y, SIZE - 3);
        g.fillStyle(ok ? 0x22c55e : 0xef4444, ok ? 0.35 : 0.15);
        g.fillPoints(pts, true);
        if (ok) {
          g.lineStyle(2, 0x4ade80, 0.95);
          g.strokePoints(pts, true);
        }
      }
    }
    for (let i = labels; i < this.priceLabels.length; i++) this.priceLabels[i].setVisible(false);
    this.drawSelection();
  }

  // Yellow hex outline on the selected tile, plus a halo on whichever thing is
  // actually selected: the city itself, or the unit standing on it.
  private drawSelection(): void {
    const g = this.selGfx;
    g.clear();
    for (const l of this.routeLabels) l.setVisible(false);
    const tile = this.selected;
    if (!tile) return;
    const { x, y } = tileCenter(tile);
    const pts = hexCorners(x, y, SIZE - 2);
    g.lineStyle(7, 0x000000, 0.45);
    g.strokePoints(pts, true);
    g.lineStyle(3.5, 0xfacc15, 1);
    g.strokePoints(pts, true);
    const unit = this.selectedUnit;
    if (unit) {
      const p = unitPos(tile);
      g.lineStyle(3, 0xfacc15, 1);
      g.strokeCircle(p.x, p.y, 15);
    } else if (tile.city) {
      g.lineStyle(3, 0xfacc15, 1);
      g.strokeCircle(x, y - 2, 23);
    }
    this.drawRoute(g);
  }

  // The selected unit's route: the tapped preview (yellow) or its active route (cyan).
  // A numbered dot marks where it stops at the end of each turn.
  private drawRoute(g: Phaser.GameObjects.Graphics): void {
    const state = this.state;
    const unit = this.selectedUnit;
    if (!state || !unit || unit.owner !== this.me) return;
    const pv = this.routePreview && this.routePreview.unitId === unit.id ? this.routePreview : null;
    let plan: RoutePlan | null = pv ? pv.plan : null;
    let dest: Tile | null = pv ? pv.dest : null;
    if (!plan && unit.goal) {
      plan = state.routeLeft(unit);
      dest = state.map.get(unit.goal.col, unit.goal.row) ?? null;
    }
    if (!plan || !plan.path.length || !dest) return;
    const color = pv ? 0xfacc15 : 0x22d3ee;
    const pts = [unitPos(state.tileOf(unit)), ...plan.path.map((t) => tileCenter(t))];
    g.lineStyle(6, 0x000000, 0.45);
    g.strokePoints(pts, false);
    g.lineStyle(3, color, 1);
    g.strokePoints(pts, false);
    // the hex it's heading for
    const d = tileCenter(dest);
    g.lineStyle(3, color, 1);
    g.strokePoints(hexCorners(d.x, d.y, SIZE - 5), true);
    const first = plan.turnAt[0];
    let n = 0;
    for (let i = 0; i < plan.path.length; i++) {
      const endOfTurn = i === plan.path.length - 1 || plan.turnAt[i + 1] !== plan.turnAt[i];
      if (!endOfTurn) continue;
      const { x, y } = tileCenter(plan.path[i]);
      g.fillStyle(0x000000, 0.6);
      g.fillCircle(x, y, 9);
      g.fillStyle(color, 1);
      g.fillCircle(x, y, 7.5);
      this.routeLabel(n++, x, y, String(plan.turnAt[i] - first + 1));
    }
    if (pv) {
      const t = `${plan.turns} turn${plan.turns === 1 ? '' : 's'} \u00b7 tap again to go`;
      this.routeLabel(n++, d.x, d.y - SIZE + 2, t, true);
    }
  }

  private routeLabel(i: number, x: number, y: number, text: string, big = false): void {
    let label = this.routeLabels[i];
    if (!label) {
      label = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#111111' })
        .setOrigin(0.5)
        .setDepth(5);
      this.routeLabels.push(label);
    }
    label
      .setText(text)
      .setFontSize(big ? 13 : 11)
      .setColor(big ? '#ffffff' : '#111111')
      .setStroke('#000000', big ? 4 : 0)
      .setPosition(x, y)
      .setVisible(true);
  }

  private drawUnits(state: GameState): void {
    const g = this.unitGfx;
    const badge = this.badgeGfx;
    g.clear();
    badge.clear();
    let n = 0;
    for (const u of state.units) {
      const t = state.tileOf(u);
      if (u.owner !== this.me && !this.sees(t)) continue; // hidden in the fog
      const { x, y } = unitPos(t);
      const color = state.players[u.owner].color;
      const isSel = u.id === this.selectedUnitId;
      const stats = UNIT_STATS[u.type];
      if (stats.military) {
        // Troops are squares, civilians are circles
        g.fillStyle(0x000000, 0.35);
        g.fillRoundedRect(x - 10, y - 9, 22, 22, 5);
        g.fillStyle(color, 1);
        g.fillRoundedRect(x - 11, y - 11, 22, 22, 5);
        g.lineStyle(isSel ? 3 : 2, isSel ? 0xfacc15 : 0xffffff, 1);
        g.strokeRoundedRect(x - 11, y - 11, 22, 22, 5);
      } else {
        g.fillStyle(0x000000, 0.35);
        g.fillCircle(x + 1, y + 2, 11);
        g.fillStyle(color, 1);
        g.fillCircle(x, y, 11);
        g.lineStyle(isSel ? 3 : 2, isSel ? 0xfacc15 : 0xffffff, 1);
        g.strokeCircle(x, y, 11);
      }
      if (u.hp < stats.hp) {
        const frac = Math.max(0, u.hp / stats.hp);
        g.fillStyle(0x111111, 0.9);
        g.fillRect(x - 12, y + 13, 24, 4);
        g.fillStyle(frac > 0.5 ? 0x22c55e : frac > 0.25 ? 0xeab308 : 0xef4444, 1);
        g.fillRect(x - 11, y + 14, 22 * frac, 2);
      }
      this.unitSprite(n++, UNIT_SPRITE[u.type], x, y);
      // Passengers on a transport: one white pip each
      for (let k = 0; k < (u.cargo?.length ?? 0); k++) {
        badge.fillStyle(0xffffff, 1);
        badge.lineStyle(1, 0x000000, 0.7);
        badge.fillCircle(x - 9 + k * 6, y - 13, 2.5);
        badge.strokeCircle(x - 9 + k * 6, y - 13, 2.5);
      }
      // Status badge for your units: cyan arrow = on a route, green dot = ready, gray = holding
      if (u.owner === this.me && u.goal) {
        badge.fillStyle(0x22d3ee, 1);
        badge.lineStyle(1, 0x000000, 0.7);
        const tri = [new Phaser.Math.Vector2(x + 6, y - 15), new Phaser.Math.Vector2(x + 15, y - 10), new Phaser.Math.Vector2(x + 6, y - 5)];
        badge.fillPoints(tri, true);
        badge.strokePoints(tri, true);
      } else if (u.owner === this.me && !state.players[state.current].isAI && (u.moves > 0 || !u.acted)) {
        badge.fillStyle(u.hold ? 0x9ca3af : 0x4ade80, 1);
        badge.lineStyle(1, 0x000000, 0.6);
        badge.fillCircle(x + 10, y - 10, 3.5);
        badge.strokeCircle(x + 10, y - 10, 3.5);
      }
    }
    for (let i = n; i < this.unitSprites.length; i++) this.unitSprites[i].setVisible(false);
  }

  // The little pixel person standing on a unit's token
  private unitSprite(i: number, key: string, x: number, y: number): void {
    let s = this.unitSprites[i];
    if (!s) {
      s = this.add.sprite(0, 0, key, '0').setDepth(3.2).setScale(UNIT_SCALE);
      this.unitSprites.push(s);
    }
    s.setPosition(Math.round(x), Math.round(y)).setVisible(true);
    if (s.anims.currentAnim?.key !== key) s.play({ key, startFrame: i % 2 });
  }

  // Fallback city (no Kenney art): a little house in the owner's color, with a crown on capitals
  private drawCity(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, capital: boolean): void {
    const s = capital ? 1.25 : 1;
    g.fillStyle(0x1b1b1b, 1);
    g.fillRect(x - 9 * s, y - 4 * s, 18 * s, 12 * s);
    g.fillStyle(color, 1);
    g.fillRect(x - 7 * s, y - 2 * s, 14 * s, 8 * s);
    g.fillTriangle(x - 10 * s, y - 3 * s, x, y - 12 * s, x + 10 * s, y - 3 * s);
    g.lineStyle(1.5, 0xffffff, 0.9);
    g.strokeRect(x - 7 * s, y - 2 * s, 14 * s, 8 * s);
    if (capital) {
      g.fillStyle(0xfacc15, 1);
      g.fillTriangle(x - 6, y - 17, x - 3, y - 22, x, y - 17);
      g.fillTriangle(x - 2, y - 17, x + 1, y - 24, x + 4, y - 17);
      g.fillTriangle(x + 2, y - 17, x + 5, y - 22, x + 8, y - 17);
    }
  }
}

function tileCenter(t: Tile): { x: number; y: number } {
  return {
    x: SIZE * SQRT3 * (t.col + 0.5 * (t.row & 1)),
    y: SIZE * 1.5 * t.row,
  };
}

// Units on a city sit in its lower-right corner so both stay visible.
function unitPos(t: Tile): { x: number; y: number } {
  const c = tileCenter(t);
  return t.city ? { x: c.x + 12, y: c.y + 11 } : c;
}

function hexCorners(cx: number, cy: number, r: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Phaser.Math.DegToRad(60 * i - 30);
    pts.push(new Phaser.Math.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}
