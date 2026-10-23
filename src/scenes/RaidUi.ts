import type Phaser from 'phaser';
import type { GameState } from '../world/game';
import type { Tile } from '../world/tile';
import { BUILDINGS } from '../world/tile';
import { NAVY, TROOPS, UNIT_STATS } from '../world/units';
import type { Unit, UnitType } from '../world/units';
import { initializeRaids, campUnits, CAMP_HP, CAMP_REWARD } from '../world/barbarians';
import { repairCheck, startRepair, REPAIR_TURNS } from '../world/amenityRaids';
import { campFor, damaged, isBarbarian, raidState } from '../world/raidState';
import { repairStatus } from '../world/raidRules';
import { MapScene } from './MapScene';
import { CityView } from './CityView';
import { Hud } from './Hud';
import type { PanelModel, PanelSection } from './Hud';
import { installRaidMenu } from './RaidMenu';
interface MapBridge extends Phaser.Scene {
  state: GameState | null; hud: Hud; selected: Tile | null; hovered: Tile | null;
  lastPointer: { x: number; y: number }; playing: boolean;
  startGame(g: GameState): void; drawUnits(g: GameState): void; redraw(): void;
  cityPanel(g: GameState, c: Tile): PanelModel;
  tilePanel(g: GameState, t: Tile): PanelModel;
  unitPanel(g: GameState, u: Unit): PanelModel;
  refreshHover(): void; sees(t: Tile): boolean; seen(t: Tile): boolean;
  recruit(type: UnitType): void;
}
interface CityBridge {
  state: GameState | null; city: Tile | null; root: HTMLDivElement; sel: 'keep' | number;
  handlers: { onChange(): void } | null;
  render(): void; sidePanel(g: GameState, c: Tile, simple: boolean): string;
}
interface HudBridge { root: HTMLDivElement; update(g: GameState, mode: string): void }
const graphics = new WeakMap<MapBridge, Phaser.GameObjects.Graphics>();
const center = (t: Tile) => ({ x: 28 * Math.sqrt(3) * (t.col + .5 * (t.row & 1)), y: 42 * t.row });
function repairSection(g: GameState, c: Tile, change: () => void): PanelSection {
  const data = raidState(g), list = data.damaged[g.tileIndex(c)] ?? [];
  return { heading: 'Repairs', summary: `${list.length} pillaged`, lines: repairStatus(g, c), buttons: list.map((b) => {
    const check = repairCheck(g, c, b);
    return { label: `Repair ${BUILDINGS[b].name}`, enabled: check.ok, hint: check.ok ? `${check.cost}g, ${REPAIR_TURNS} turns` : check.reason,
      onClick: () => { if (startRepair(g, c, b).ok) change(); } };
  }) };
}
let installed = false;
export function installRaidUi(): void {
  if (installed) return;
  installed = true;
  installRaidMenu();
  const p = MapScene.prototype as unknown as MapBridge, start = p.startGame;
  p.startGame = function(g) { initializeRaids(g); start.call(this, g); };
  const draw = p.drawUnits;
  p.drawUnits = function(g) {
    const original = g.units;
    try { g.units = original.filter((u) => !campFor(g, u.id)); draw.call(this, g); }
    finally { g.units = original; }
    let canvas = graphics.get(this);
    if (!canvas || !canvas.active) { canvas = this.add.graphics().setDepth(3.35); graphics.set(this, canvas); }
    canvas.clear();
    for (const u of campUnits(g)) {
      const t = g.tileOf(u);
      if (!this.sees(t)) continue;
      const { x, y } = center(t);
      canvas.fillStyle(0x1c1009, 1); canvas.fillCircle(x, y, 17);
      canvas.fillStyle(0xc4844b, 1); canvas.fillTriangle(x - 13, y + 9, x, y - 13, x + 13, y + 9);
      canvas.lineStyle(2, 0xf4d2ad, 1); canvas.strokeTriangle(x - 13, y + 9, x, y - 13, x + 13, y + 9);
      canvas.fillStyle(0x28190f, 1); canvas.fillTriangle(x - 4, y + 9, x, y - 2, x + 4, y + 9);
      canvas.fillStyle(0x111111, 1); canvas.fillRect(x - 13, y + 14, 26, 4);
      canvas.fillStyle(0xf59e0b, 1); canvas.fillRect(x - 12, y + 15, 24 * Math.max(0, u.hp / CAMP_HP), 2);
    }
    for (const city of g.cities()) for (const b of g.raids?.damaged[g.tileIndex(city)] ?? []) {
      const site = city.sites[b], tile = site !== undefined && site >= 0 ? g.map.tiles[site] : null;
      if (!tile || !this.sees(tile)) continue;
      const { x, y } = center(tile);
      canvas.lineStyle(4, 0xff5544, 1); canvas.lineBetween(x - 7, y - 7, x + 7, y + 7); canvas.lineBetween(x + 7, y - 7, x - 7, y + 7);
    }
  };
  const city = p.cityPanel;
  p.cityPanel = function(g, c) {
    const model = city.call(this, g, c);
    if ((g.raids?.damaged[g.tileIndex(c)] ?? []).length) model.sections.unshift(repairSection(g, c, () => this.redraw()));
    if (g.sandbox && g.raids?.enabled) {
      const train = model.sections.find((s) => s.heading === 'Train');
      const types = [...TROOPS, ...(g.isCoastal(c) ? NAVY : [])];
      for (const type of types) {
        const check = g.recruitCheck(type, c), info = UNIT_STATS[type];
        train?.buttons?.push({ label: info.name, enabled: check.ok, hint: check.ok ? `${check.cost}g, ${g.trainTurns(type, c)} turns` : check.reason,
          onClick: () => this.recruit(type) });
      }
    }
    return model;
  };
  const tile = p.tilePanel;
  p.tilePanel = function(g, t) {
    const unit = g.unitAt(t);
    if (unit && campFor(g, unit.id) && this.sees(t)) return {
      title: 'Barbarian camp', subtitle: 'Hostile to every kingdom, no war declaration needed',
      sections: [{ bars: [{ label: 'Camp HP', value: unit.hp, max: CAMP_HP, color: '#f59e0b' }],
        lines: [`Attack with troops to clear it for ${CAMP_REWARD} gold. Clearing it stops new raiders, not those already roaming.`] }],
    };
    const model = tile.call(this, g, t), home = g.homeCity(t);
    if (home && home.owner === g.current) {
      const b = home.buildings.find((b) => home.sites[b] === g.tileIndex(t) && damaged(g, home, b));
      if (b) model.sections.push(repairSection(g, home, () => this.redraw()));
    }
    return model;
  };
  const unitPanel = p.unitPanel;
  p.unitPanel = function(g, u) {
    const model = unitPanel.call(this, g, u);
    if (UNIT_STATS[u.type].military) model.sections[0]?.lines?.push('Barbarian raiders and camps are always valid enemies. Kingdom troops still require a declared war.');
    return model;
  };
  const hover = p.refreshHover;
  p.refreshHover = function() {
    const g = this.state, t = this.hovered, u = g && t ? g.unitAt(t) : null;
    if (g && t && u && campFor(g, u.id) && this.sees(t) && this.playing) {
      this.hud.showTip(['Barbarian camp', `${u.hp}/${CAMP_HP} HP`, `Clear for ${CAMP_REWARD} gold. No war declaration needed.`], '', true, this.lastPointer.x, this.lastPointer.y);
      return;
    }
    hover.call(this);
  };
  const cv = CityView.prototype as unknown as CityBridge, panel = cv.sidePanel;
  cv.sidePanel = function(g, c, simple) {
    const list = g.raids?.damaged[g.tileIndex(c)] ?? [];
    const selected = list.find((b) => c.sites[b] === this.sel);
    const base = selected ? `<h3>${BUILDINGS[selected].icon} ${BUILDINGS[selected].name}: pillaged</h3><p>All effects are disabled. The building, its slot, farm, road and decorations are preserved.</p>` : panel.call(this, g, c, simple);
    const rows = (this.sel === 'keep' ? list : selected ? [selected] : []).map((b) => {
      const check = repairCheck(g, c, b);
      return `<button type="button" data-raid-repair="${b}"${check.ok ? '' : ' disabled'}>Repair ${BUILDINGS[b].name}: ${check.ok ? `${check.cost}g, ${REPAIR_TURNS} turns` : check.reason}</button>`;
    }).join('');
    return base + (rows ? `<div class="k-city-list">${rows}</div>` : '');
  };
  const render = cv.render;
  cv.render = function() {
    render.call(this);
    const g = this.state, c = this.city;
    if (!g || !c) return;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-raid-repair]')) button.onclick = () => {
      const b = c.buildings.find((b) => b === button.dataset.raidRepair);
      if (b && startRepair(g, c, b).ok) { this.handlers?.onChange(); this.render(); }
    };
  };
  const hud = Hud.prototype as unknown as HudBridge, update = hud.update;
  hud.update = function(g, mode) {
    update.call(this, g, mode);
    if (!g.raids) return;
    const kingdoms = g.players.filter((p) => !isBarbarian(g, p.id));
    const label = this.root.querySelector<HTMLElement>('.k-mode');
    if (label) label.textContent = g.sandbox
      ? g.raids.enabled ? 'One kingdom + barbarian camps' : 'Sandbox'
      : `${kingdoms.length} kingdoms${g.raids.enabled ? ' + barbarian camps' : ''}`;
    for (const row of this.root.querySelectorAll<HTMLTableRowElement>('.k-tab tr')) {
      if (row.cells[0]?.textContent?.trim() === g.players[g.raids.faction].name) row.remove();
    }
  };
}
