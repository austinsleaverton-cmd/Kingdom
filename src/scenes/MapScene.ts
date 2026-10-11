// Rendering and input only. All rules live in src/world.
import Phaser from 'phaser';
import { GameState } from '../world/game';
import type { Check, GameOptions } from '../world/game';
import { loadGame, saveGame, saveSummary } from '../world/save';
import { YIELD } from '../world/tile';
import type { Terrain, Tile } from '../world/tile';
import { JOBS, UNIT_STATS } from '../world/units';
import type { Job, Unit } from '../world/units';
import { Hud } from './Hud';
import type { BarMode, PanelButton, PanelModel } from './Hud';
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

// select: click to select/move. claim/city: click to buy. raise/lower: builder picks a target.
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
  private lastPointer = { x: 0, y: 0 };

  private terrainGfx!: Phaser.GameObjects.Graphics;
  private ownerGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private unitGfx!: Phaser.GameObjects.Graphics;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private unitLabels: Phaser.GameObjects.Text[] = [];

  private pressed = false;
  private dragging = false;
  private downX = 0;
  private downY = 0;

  constructor() {
    super('map');
  }

  create(): void {
    this.terrainGfx = this.add.graphics().setDepth(0);
    this.ownerGfx = this.add.graphics().setDepth(1);
    this.overlayGfx = this.add.graphics().setDepth(2);
    this.unitGfx = this.add.graphics().setDepth(3);
    this.hoverGfx = this.add.graphics().setDepth(5);

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
    const cap = state.map.tiles.find((t) => t.capital && t.owner === 0) ?? state.map.tiles.find((t) => t.owner === 0);
    if (cap) {
      const { x, y } = tileCenter(cap);
      this.cameras.main.setZoom(1.2).centerOn(x, y);
    }
  }

  private get playing(): boolean {
    return this.state !== null && !this.menu.visible;
  }

  private get selectedUnit(): Unit | null {
    if (!this.state || this.selectedUnitId === null) return null;
    return this.state.unitById(this.selectedUnitId) ?? null;
  }

  private setMode(m: Mode): void {
    this.mode = m;
    if (m === 'claim' || m === 'city') this.clearSelection();
    this.redraw();
  }

  private clearSelection(): void {
    this.selected = null;
    this.selectedUnitId = null;
    this.reach = new Map();
  }

  private endTurn(): void {
    if (!this.state || !this.playing || this.state.winner !== null) return;
    this.state.endTurn();
    if (this.mode === 'raise' || this.mode === 'lower') this.mode = 'select';
    this.redraw();
  }

  private fail(): void {
    this.cameras.main.shake(80, 0.002);
  }

  private clickTile(tile: Tile): void {
    const state = this.state;
    if (!state) return;
    switch (this.mode) {
      case 'claim':
      case 'city':
        if (!state.perform(this.mode, tile).ok) return this.fail();
        break;
      case 'raise':
      case 'lower': {
        const unit = this.selectedUnit;
        if (!unit) {
          this.mode = 'select';
          break;
        }
        if (!state.doJob(unit, this.mode, tile).ok) return this.fail();
        this.mode = 'select';
        break;
      }
      case 'select': {
        const unit = this.selectedUnit;
        if (unit && this.reach.has(tile)) {
          state.moveUnit(unit, tile);
          this.selected = tile;
        } else {
          this.selected = tile;
          const here = state.unitAt(tile);
          this.selectedUnitId = here && here.owner === 0 ? here.id : null;
        }
        break;
      }
    }
    this.redraw();
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
    if (!state.doJob(unit, job, state.tileOf(unit)).ok) return this.fail();
    this.redraw();
  }

  private recruitBuilder(): void {
    const state = this.state;
    if (!state || !this.selected) return;
    const unit = state.recruit('builder', this.selected);
    if (!unit) return this.fail();
    this.selectedUnitId = unit.id;
    this.selected = state.tileOf(unit);
    this.redraw();
  }

  // ---------- input ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.pressed = true;
      this.dragging = false;
      this.downX = p.x;
      this.downY = p.y;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.playing) return;
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
      if (e.key === 'Escape') {
        if (this.playing) this.openMenu();
        else this.continueGame();
        return;
      }
      if (!this.playing) return;
      const key = e.key.toUpperCase();
      const job = JOBS.find((j) => j.key === key);
      if (job && this.selectedUnit) {
        this.doJob(job.id);
        return;
      }
      switch (key) {
        case '1': this.setMode('select'); break;
        case '2': this.setMode('claim'); break;
        case '3': this.setMode('city'); break;
        case 'B': this.recruitBuilder(); break;
        case ' ':
        case 'ENTER': this.endTurn(); break;
      }
    });
  }

  private cancel(): void {
    if (this.mode !== 'select') this.mode = 'select';
    else this.clearSelection();
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
        return { label: 'Claim', check: state.check('claim', tile, 0) };
      case 'city':
        return { label: 'City', check: state.check('city', tile, 0) };
      case 'raise':
      case 'lower': {
        const unit = this.selectedUnit;
        if (!unit) return null;
        return { label: this.mode === 'raise' ? 'Raise' : 'Lower', check: state.jobCheck(unit, this.mode, tile) };
      }
      case 'select': {
        const left = this.reach.get(tile);
        if (left === undefined) return null;
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
    if (unit) lines.push(`${state.players[unit.owner].name} ${UNIT_STATS[unit.type].name}`);
    let status = '';
    if (hc) {
      if (this.mode === 'select') status = `${hc.label}: ${hc.check.reason}`;
      else status = hc.check.ok ? `${hc.label}: ${hc.check.cost}g` : `${hc.label}: ${hc.check.reason}`;
    }
    this.hud.showTip(lines, status, ok, this.lastPointer.x, this.lastPointer.y);
  }

  // ---------- selection panel ----------

  private buildPanel(state: GameState): PanelModel | null {
    const tile = this.selected;
    if (!tile) return null;
    const unit = this.selectedUnit;
    const buttons: PanelButton[] = [];
    const lines: string[] = [];
    let title = TERRAIN_NAME[tile.terrain];

    if (unit) {
      const stats = UNIT_STATS[unit.type];
      title = `${stats.name}`;
      lines.push(`Moves ${unit.moves}/${stats.moves}${unit.acted ? ' · done working this turn' : ''}`);
      lines.push('Click a lit hex to move. One job per turn.');
      const here = state.tileOf(unit);
      for (const j of JOBS) {
        const terraform = j.id === 'raise' || j.id === 'lower';
        const c = terraform ? this.terraformPreview(state, unit, j.id) : state.jobCheck(unit, j.id, here);
        buttons.push({
          label: j.label,
          key: j.key,
          enabled: c.ok,
          hint: c.ok ? (terraform ? 'pick a hex' : `${c.cost}g`) : c.reason,
          active: this.mode === j.id,
          onClick: () => this.doJob(j.id),
        });
      }
    }
    if (tile.city && tile.owner === 0) {
      if (!unit) title = tile.capital ? 'Capital' : 'City';
      const c = state.recruitCheck('builder', tile, 0);
      const s = UNIT_STATS.builder;
      buttons.push({
        label: `Recruit ${s.name}`,
        key: 'B',
        enabled: c.ok,
        hint: c.ok ? `${c.cost}g · ${s.food} food` : c.reason,
        onClick: () => this.recruitBuilder(),
      });
      lines.push(`Food ${state.foodUsed(0)}/${state.foodMade(0)} used`);
    }
    if (!unit && !tile.city) {
      const owner = tile.owner === null ? 'Unclaimed' : state.players[tile.owner].name;
      lines.push(owner, `Height ${tile.height}${tile.improvement ? ` · ${tile.improvement}` : ''}${tile.road ? ' · road' : ''}`);
    }
    return { title, lines, buttons };
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

  // ---------- drawing ----------

  private redraw(): void {
    const state = this.state;
    if (!state) return;
    const unit = this.selectedUnit;
    if (this.selectedUnitId !== null && !unit) this.clearSelection();
    if (unit) this.selected = state.tileOf(unit);
    this.reach = unit && this.mode === 'select' ? state.reachableFor(unit) : new Map();

    this.drawTerrain(state);
    this.drawOwners(state);
    this.drawOverlay(state);
    this.drawUnits(state);
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
    for (const t of map.tiles) {
      if (t.owner === null) continue;
      const color = state.players[t.owner].color;
      const { x, y } = tileCenter(t);
      const pts = hexCorners(x, y, SIZE);
      g.fillStyle(color, 0.22);
      g.fillPoints(pts, true);

      g.lineStyle(3, color, 1);
      for (let i = 0; i < 6; i++) {
        const n = map.neighborAt(t, EDGE_TO_DIR[i]);
        if (n && n.owner === t.owner) continue;
        const a = pts[i];
        const b = pts[(i + 1) % 6];
        g.lineBetween(a.x, a.y, b.x, b.y);
      }

      if (t.city) this.drawCity(g, x, y, color, t.capital);
    }
  }

  private drawOverlay(state: GameState): void {
    const g = this.overlayGfx;
    g.clear();
    g.fillStyle(0xffffff, 0.2);
    for (const t of this.reach.keys()) {
      const { x, y } = tileCenter(t);
      g.fillPoints(hexCorners(x, y, SIZE - 2), true);
    }
    const unit = this.selectedUnit;
    if ((this.mode === 'raise' || this.mode === 'lower') && unit) {
      const here = state.tileOf(unit);
      for (const t of [here, ...state.map.neighbors(here)]) {
        const ok = state.jobCheck(unit, this.mode, t).ok;
        g.fillStyle(ok ? 0x22c55e : 0xef4444, ok ? 0.3 : 0.15);
        const { x, y } = tileCenter(t);
        g.fillPoints(hexCorners(x, y, SIZE - 2), true);
      }
    }
    if (this.selected) {
      const { x, y } = tileCenter(this.selected);
      g.lineStyle(3, 0xfacc15, 1);
      g.strokePoints(hexCorners(x, y, SIZE - 2), true);
    }
  }

  private drawUnits(state: GameState): void {
    const g = this.unitGfx;
    g.clear();
    let i = 0;
    for (const u of state.units) {
      const t = state.tileOf(u);
      const c = tileCenter(t);
      const x = t.city ? c.x + 10 : c.x;
      const y = t.city ? c.y + 10 : c.y;
      const color = state.players[u.owner].color;
      const isSel = u.id === this.selectedUnitId;
      g.fillStyle(0x000000, 0.35);
      g.fillCircle(x + 1, y + 2, 11);
      g.fillStyle(color, 1);
      g.fillCircle(x, y, 11);
      g.lineStyle(isSel ? 3 : 2, isSel ? 0xfacc15 : 0xffffff, 1);
      g.strokeCircle(x, y, 11);
      // ready indicator for your units with moves or work left
      if (u.owner === 0 && state.current === 0 && (u.moves > 0 || !u.acted)) {
        g.fillStyle(0x4ade80, 1);
        g.fillCircle(x + 9, y - 9, 3.5);
      }
      let label = this.unitLabels[i];
      if (!label) {
        label = this.add
          .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffffff' })
          .setOrigin(0.5)
          .setDepth(4);
        this.unitLabels.push(label);
      }
      label.setText(UNIT_STATS[u.type].letter).setPosition(x, y).setVisible(true);
      i++;
    }
    for (; i < this.unitLabels.length; i++) this.unitLabels[i].setVisible(false);
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

function tileCenter(t: Tile): { x: number; y: number } {
  return {
    x: SIZE * SQRT3 * (t.col + 0.5 * (t.row & 1)),
    y: SIZE * 1.5 * t.row,
  };
}

function hexCorners(cx: number, cy: number, r: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Phaser.Math.DegToRad(60 * i - 30);
    pts.push(new Phaser.Math.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}
