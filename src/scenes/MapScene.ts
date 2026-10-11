// Rendering and input only. All rules live in src/world.
import Phaser from 'phaser';
import { GameState } from '../world/game';
import type { AttackPreview, Check, GameOptions, RoutePlan } from '../world/game';
import { hexDistance } from '../world/map';
import { loadGame, saveGame, saveSummary } from '../world/save';
import { LEVEL_NAMES, MAX_LEVEL, MAX_WALLS, YIELD, cityLevel, cityMaxHp, shieldMax } from '../world/tile';
import type { Terrain, Tile } from '../world/tile';
import { JOBS, TROOPS, UNIT_STATS } from '../world/units';
import type { Job, Unit, UnitType } from '../world/units';
import { Hud } from './Hud';
import type { BarMode, PanelBar, PanelButton, PanelModel, PanelSection } from './Hud';
import { Menu } from './Menu';

const SIZE = 28; // hex radius in px
const SQRT3 = Math.sqrt(3);
const DRAG_THRESHOLD = 6;

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

// select: click to select/move. claim: click to buy land. raise/lower: builder picks a target.
type Mode = BarMode | 'raise' | 'lower';

export class MapScene extends Phaser.Scene {
  private state: GameState | null = null;
  private hud!: Hud;
  private menu!: Menu;
  private mode: Mode = 'select';
  private hovered: Tile | null = null;
  private selected: Tile | null = null;
  private selectedUnitId: number | null = null;
  private reach = new Map<Tile, number>();
  private targets = new Map<Tile, AttackPreview>();
  private claimCity: Tile | null = null; // city buying land in claim mode
  private lastPointer = { x: 0, y: 0 };

  private terrainGfx!: Phaser.GameObjects.Graphics;
  private ownerGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private unitGfx!: Phaser.GameObjects.Graphics;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private selGfx!: Phaser.GameObjects.Graphics;
  private priceLabels: Phaser.GameObjects.Text[] = []; // claim prices shown on green hexes
  private cityLabels: Phaser.GameObjects.Text[] = []; // name tags under cities
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

  create(): void {
    this.terrainGfx = this.add.graphics().setDepth(0);
    this.ownerGfx = this.add.graphics().setDepth(1);
    this.overlayGfx = this.add.graphics().setDepth(2);
    this.unitGfx = this.add.graphics().setDepth(3);
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

    this.setupInput();
    this.openMenu();
  }

  // ---------- flow ----------

  private openMenu(): void {
    if (this.state) saveGame(this.state);
    this.hovered = null;
    this.hoverGfx.clear();
    this.hud.hideTip();
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
    this.clearSelection();
    this.mode = 'select';
    this.redraw();
    const p = state.players[state.current];
    const cities = state.cityCount(p.id);
    const note = `${cities} ${cities === 1 ? 'city' : 'cities'} \u00b7 ${p.gold} gold`;
    this.hud.showPass(p.name, p.color, state.turn, note, () => {
      this.centerOnHome();
      this.redraw();
      this.autoAdvance(null);
    });
  }

  private get playing(): boolean {
    return this.state !== null && !this.menu.visible && !this.hud.passVisible;
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
    state.endTurn();
    if (this.mode === 'raise' || this.mode === 'lower') this.mode = 'select';
    if (this.needsPass) return this.handOff();
    this.redraw();
    // New turn: start on the unit nearest to where you left off
    this.autoAdvance(this.selected);
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
        const unit = this.selectedUnit;
        if (unit && state.tileOf(unit) === tile) {
          // Clicking the selected unit again deselects it
          this.clearSelection();
        } else if (unit && this.targets.has(tile)) {
          this.routePreview = null;
          state.attack(unit, tile);
          this.cameras.main.shake(60, 0.003);
          acted = true;
        } else if (unit && this.reach.has(tile)) {
          this.routePreview = null;
          state.moveUnit(unit, tile);
          this.selected = tile;
          acted = true;
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
      switch (key) {
        case '1': this.setMode('select'); break;
        case 'N':
        case 'TAB': e.preventDefault(); this.nextUnit(); break;
        case 'K': this.toggleClaim(); break;
        case 'W': if (!unit && this.selected?.city && this.selected.owner === this.me) this.buildWalls(this.selected); break;
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
        const left = this.reach.get(tile);
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
    if (!state || !tile || state.winner !== null) {
      this.hud.hideTip();
      return;
    }
    const hc = this.hoverCheck(state, tile);
    const ok = hc ? hc.check.ok : true;
    const { x, y } = tileCenter(tile);
    this.hoverGfx.lineStyle(3, ok ? 0xffffff : 0xff5555, 0.95);
    this.hoverGfx.strokePoints(hexCorners(x, y, SIZE - 1.5), true);

    const owner = tile.owner === null ? 'Unclaimed' : state.players[tile.owner].name;
    const extras = [tile.capital ? 'Capital' : tile.city ? 'City' : '', tile.improvement ?? '', tile.road ? 'road' : '']
      .filter(Boolean)
      .join(' · ');
    const unit = state.unitAt(tile);
    const lines = [
      `${TERRAIN_NAME[tile.terrain]} (height ${tile.height})`,
      `${owner}${extras ? ` · ${extras}` : ''}`,
      `Yield ${YIELD[tile.terrain]}g/turn`,
    ];
    const home = state.homeCity(tile);
    if (tile.city) lines.unshift(`${state.cityName(tile)} (${LEVEL_NAMES[cityLevel(tile) - 1]})`);
    else if (home && tile.owner !== null) lines.push(`Land of ${state.cityName(home)}`);
    if (tile.city) lines.push(`HP ${tile.hp}/${cityMaxHp(tile)}${tile.walls ? ` · walls ${tile.walls} (${tile.shield}/${shieldMax(tile)})` : ''}`);
    if (unit) lines.push(`${state.players[unit.owner].name} ${UNIT_STATS[unit.type].name} (${unit.hp}/${UNIT_STATS[unit.type].hp} HP)`);
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
      status.lines!.push(unit.acted ? 'Already attacked this turn' : 'Red hexes = attack. Break a city to 0 HP, then walk in.');
    } else if (unit.type === 'builder') {
      status.lines!.push(unit.uses !== undefined ? `Jobs left: ${unit.uses}` : 'Unlimited jobs');
      if (unit.acted) status.lines!.push('Done working this turn');
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

    // Growth: spare food fills the bar, a full bar is the next level
    const lvl = cityLevel(city);
    const unlock = (n: number) =>
      n === 3 ? 'claims land 4 hexes out' : n === MAX_LEVEL ? 'troops train 1 turn faster' : '+1 gold, +1 food, +10 HP';
    const growLines = [`Level ${lvl} ${LEVEL_NAMES[lvl - 1]}${lvl > 1 ? `: +${lvl - 1} gold, +${lvl - 1} food, +${(lvl - 1) * 10} HP` : ''}`];
    if (lvl < MAX_LEVEL) {
      growLines.push(
        state.besieged(city)
          ? 'Not growing: enemy troops nearby'
          : `+${state.growthRate(city).toFixed(1)} per turn (spare food speeds it up)`,
      );
      growLines.push(`Next: ${LEVEL_NAMES[lvl]} \u00b7 ${unlock(lvl + 1)}`);
    } else growLines.push('Max size: troops train 1 turn faster');
    sections.push({
      heading: 'Growth',
      summary: `Lv ${lvl} ${LEVEL_NAMES[lvl - 1]}`,
      bars: lvl < MAX_LEVEL ? [{ label: 'Growth', value: Math.floor(city.growth), max: state.growthNeed(city), color: '#a3e635' }] : [],
      lines: growLines,
    });

    const wc = state.wallCheck(city, this.me);
    const nextStone = city.walls < MAX_WALLS ? state.wallStoneCost(city) : 0;
    sections.push({
      heading: 'Defense',
      summary: city.walls ? `walls ${city.walls}/${MAX_WALLS}` : 'no walls',
      lines: [
        city.walls
          ? `Walls level ${city.walls} of ${MAX_WALLS}: the blue bar soaks damage first`
          : 'No walls yet. Walls cost stone (mines make it).',
      ],
      buttons: [
        {
          label: city.walls >= MAX_WALLS ? 'Walls maxed' : city.walls ? `Upgrade walls to ${city.walls + 1}` : 'Build walls',
          key: 'W',
          enabled: wc.ok,
          hint: wc.ok ? (state.options.freeBuild ? 'free' : `${wc.cost}g + ${nextStone} stone`) : city.walls >= MAX_WALLS ? '' : wc.reason,
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
    ];
    for (const r of recruitables) {
      const c = state.recruitCheck(r.type, city, this.me);
      const s = UNIT_STATS[r.type];
      const time = s.train > 0 ? ` · ${s.train}t` : '';
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
      : [`One unit at a time \u00b7 food left: ${state.foodMade(this.me) - state.foodUsed(this.me)}`];
    // While training, only Builder (instant) is still possible, so the list shrinks to that
    const trainButtons = queued ? train.filter((b) => b.enabled) : train;
    sections.push({
      heading: 'Train',
      summary: queued ? `${UNIT_STATS[queued.type].name} \u00b7 ${queued.turnsLeft}t` : 'ready',
      lines: trainLines,
      buttons: trainButtons,
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
    const other = state.unitAt(tile);
    if (other && other.owner !== this.me) {
      const s = UNIT_STATS[other.type];
      lines.push(`${state.players[other.owner].name} ${s.name} here`);
      bars.push({ label: 'Unit HP', value: other.hp, max: s.hp, color: this.hpColor(other.hp / s.hp) });
    }
    return {
      title,
      subtitle:
        tile.city && tile.owner !== null
          ? `${state.players[tile.owner].name} ${tile.capital ? 'capital' : 'city'} \u00b7 ${LEVEL_NAMES[cityLevel(tile) - 1]}`
          : undefined,
      sections: [{ bars, lines }],
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
    this.targets = unit && this.mode === 'select' ? this.findTargets(state, unit) : new Map();

    this.drawTerrain(state);
    this.drawOwners(state);
    this.drawOverlay(state);
    this.drawUnits(state);
    this.hud.hideIdle();
    this.refreshHover();
    this.hud.update(state, this.mode);
    this.hud.showPanel(this.buildPanel(state));
    saveGame(state);
  }

  private drawTerrain(state: GameState): void {
    const g = this.terrainGfx;
    g.clear();
    const map = state.map;
    for (const t of map.tiles) {
      const { x, y } = tileCenter(t);
      const pts = hexCorners(x, y, SIZE);
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
      }
    }
    // Roads: connect road/city tiles to neighbors that also have roads
    const hasRoad = (t: Tile) => t.road || t.city;
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
    const map = state.map;
    let names = 0;
    for (const t of map.tiles) {
      if (t.owner === null) continue;
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

      if (t.city) {
        if (t.walls > 0) {
          // stone ring, thicker per level
          g.lineStyle(1.5 + t.walls * 1.5, 0x9ca3af, 1);
          g.strokePoints(hexCorners(x, y, SIZE - 4), true);
        }
        this.drawCity(g, x, y, color, t.capital);
        this.drawCityBars(g, t, x, y);
        this.cityLabel(names++, x, y + SIZE - 2, state.cityName(t), color, t.capital, cityLevel(t));
      }
    }
    for (let i = names; i < this.cityLabels.length; i++) this.cityLabels[i].setVisible(false);
  }

  // Name tag under each city, above units so it never gets covered.
  // Dots after the name show the city's level (1 dot = Village ... 5 = Metropolis).
  private cityLabel(i: number, x: number, y: number, name: string, color: number, capital: boolean, level: number): void {
    let label = this.cityLabels[i];
    if (!label) {
      label = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#ffffff', padding: { x: 4, y: 1 } })
        .setOrigin(0.5)
        .setDepth(4.2);
      this.cityLabels.push(label);
    }
    const bg = `#${color.toString(16).padStart(6, '0')}`;
    const text = `${capital ? '\u2605 ' : ''}${name} ${'\u2022'.repeat(level)}`;
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
        if (t === home || this.reach.has(t) || this.targets.has(t)) continue;
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
        if (!state.unitAt(t) && !capture) {
          g.fillStyle(0xffffff, 0.9);
          g.fillCircle(x, y, 4);
        }
      }
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
      g.strokeCircle(x, y - 2, tile.capital ? 21 : 18);
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
    g.clear();
    for (const u of state.units) {
      const t = state.tileOf(u);
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
      drawUnitIcon(g, u.type, x, y);
      // Status badge for your units: cyan arrow = on a route, green dot = ready, gray = holding
      if (u.owner === this.me && u.goal) {
        g.fillStyle(0x22d3ee, 1);
        g.lineStyle(1, 0x000000, 0.7);
        const tri = [new Phaser.Math.Vector2(x + 6, y - 15), new Phaser.Math.Vector2(x + 15, y - 10), new Phaser.Math.Vector2(x + 6, y - 5)];
        g.fillPoints(tri, true);
        g.strokePoints(tri, true);
      } else if (u.owner === this.me && !state.players[state.current].isAI && (u.moves > 0 || !u.acted)) {
        g.fillStyle(u.hold ? 0x9ca3af : 0x4ade80, 1);
        g.lineStyle(1, 0x000000, 0.6);
        g.fillCircle(x + 10, y - 10, 3.5);
        g.strokeCircle(x + 10, y - 10, 3.5);
      }
    }
  }

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

// Little white pictures on unit tokens, drawn with shapes so they look the same on every device.
function drawUnitIcon(g: Phaser.GameObjects.Graphics, type: UnitType, x: number, y: number): void {
  const white = 0xffffff;
  switch (type) {
    case 'swordsman': {
      // blade from hilt to tip, crossguard, pommel
      g.lineStyle(3, white, 1);
      g.lineBetween(x - 3, y + 3, x + 7, y - 7);
      g.lineStyle(2.5, white, 1);
      g.lineBetween(x - 7, y, x, y + 7); // guard
      g.lineBetween(x - 3, y + 3, x - 6, y + 6); // grip
      g.fillStyle(white, 1);
      g.fillCircle(x - 7, y + 7, 2); // pommel
      break;
    }
    case 'archer': {
      // bow (arc + string) with an arrow across it
      g.lineStyle(2.5, white, 1);
      g.beginPath();
      g.arc(x + 4, y, 9, Phaser.Math.DegToRad(125), Phaser.Math.DegToRad(235), false);
      g.strokePath();
      const ex = x + 4 + 9 * Math.cos(Phaser.Math.DegToRad(125));
      const ey = 9 * Math.sin(Phaser.Math.DegToRad(125));
      g.lineStyle(1, white, 0.9);
      g.lineBetween(ex, y - ey, ex, y + ey); // string
      g.lineStyle(1.5, white, 1);
      g.lineBetween(x - 7, y, x + 6, y); // arrow shaft
      g.fillStyle(white, 1);
      g.fillTriangle(x + 9, y, x + 5, y - 3, x + 5, y + 3); // arrowhead
      break;
    }
    case 'knight': {
      // horse head facing right
      const pts = [
        [-5, 8], [-6, 1], [-4, -4], [-3, -9], [-1, -6], [2, -6], [6, -2], [8, 1], [6, 4], [1, 2], [2, 8],
      ].map(([dx, dy]) => new Phaser.Math.Vector2(x + dx, y + dy));
      g.fillStyle(white, 1);
      g.fillPoints(pts, true);
      g.fillStyle(0x111111, 1);
      g.fillCircle(x + 1, y - 3, 1.2); // eye
      break;
    }
    case 'builder': {
      // hammer
      g.lineStyle(2.5, white, 1);
      g.lineBetween(x - 5, y + 6, x + 2, y - 1); // handle
      g.lineStyle(4.5, white, 1);
      g.lineBetween(x - 1, y - 6, x + 6, y + 1); // head
      break;
    }
    case 'settler': {
      // flag on a pole
      g.lineStyle(2, white, 1);
      g.lineBetween(x - 4, y + 7, x - 4, y - 7);
      g.fillStyle(white, 1);
      g.fillTriangle(x - 3, y - 7, x + 7, y - 4, x - 3, y - 1);
      break;
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
