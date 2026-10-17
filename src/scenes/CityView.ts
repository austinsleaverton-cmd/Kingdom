// City View: the inside of one of your cities. The ground grid, plots and people are drawn by the Phaser
// city screen (CityScene.ts, see docs/CITY_BUILDER.md). This file is the DOM around it: the header and the side
// panel with plot info, bonuses and the build list, and the decorate tray (task 5). It reads the world and only
// changes it through GameState methods and the decoration actions in world/deco.ts.
// Plot i sits in world direction i (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE), so it matches the map. See docs/CITY_VIEW.md.
import type Phaser from 'phaser';
import type { Check, GameState } from '../world/game';
import { ADJACENCY, FACING_BONUS, TERRAIN_BONUS, bestPlot, bonusAmount, cityBonus, facingTile, facingWork, openPlots, plotBonus, plotFits, plotNeighbors, plotTerrain } from '../world/city';
import type { Outside } from '../world/city';
import {
  DECOS, DECO_ORDER, clearDeco, decoAt, decoCount, decoCost, decoKind, decoList, decorateReason, isPathKind, moveDeco, paintPath,
  placeDeco, removeDeco, restoreDeco, snapDeco, trayCheck,
} from '../world/deco';
import type { DecoEntry, DecoGroup, DecoId } from '../world/deco';
import { gridSize, plotLevel } from '../world/grid';
import { BUILDINGS, BUILDING_ORDER, LEVEL_NAMES, LEVEL_POP, MAX_WALLS, PLOTS_BY_LEVEL, PLOT_COUNT, cityLevel, cityMaxHp, shieldMax } from '../world/tile';
import type { Building, PlotTerrain, Tile } from '../world/tile';
import { CITY_SCENE, CityScene } from './CityScene';
import type { CityPick } from './CityScene';
import { DECOR_ART, DECOR_THUMB, SHEET_INFO } from './cityArt';

export interface CityViewHandlers {
  onChange(): void; // something was built or decorated: redraw and save
  onClose(user: boolean): void; // user = you left on purpose (button, Esc, O, zooming out), not forced by the game
}

export interface CityOpenOptions {
  zoomIn?: boolean; // arriving from the map's zoom: the city screen starts close and eases out to fit
}

const PLOT_NAME: Record<PlotTerrain, string> = { water: 'Water', sand: 'Sand', grass: 'Grass', hills: 'Hills' };
const OUT_NAME: Record<Outside, string> = { farm: 'a farm', pasture: 'a pasture', mine: 'a mine', forest: 'a forest', fishery: 'a fishery', road: 'a road' };
const MAP_SCENE = 'map';
const Z = 20; // the city screen's layer: anything below it (the HUD) is hidden while a city is open
const UNDO_MAX = 30;
const GROUPS: [DecoGroup, string][] = [['path', 'Paths'], ['nature', 'Nature'], ['build', 'Buildings and props']];

const CSS = `
.k-city { position: fixed; inset: 0; z-index: ${Z}; display: none; pointer-events: none; color: #e5e7eb; font: 14px/1.4 system-ui, sans-serif; transition: opacity .2s ease; }
.k-city.k-dim { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .k-city { transition: none; } }
.k-city-head { position: absolute; top: 0; left: 0; right: 0; pointer-events: auto; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: max(10px, env(safe-area-inset-top)) calc(54px + env(safe-area-inset-right)) 10px max(14px, env(safe-area-inset-left)); box-sizing: border-box;
  background: linear-gradient(rgba(11,14,20,0.95), rgba(11,14,20,0.8)); border-bottom: 1px solid #2a2f3a; }
.k-city-head h2 { margin: 0; font-size: 19px; }
.k-city-sub { color: #9ca3af; font-size: 12px; }
.k-city button { background: #262630; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 7px 12px; font: inherit; cursor: pointer; }
.k-city button:hover:not(:disabled) { background: #33333f; }
.k-city button:disabled { opacity: 0.45; cursor: default; }
.k-city kbd { opacity: 0.6; font-size: 11px; margin-right: 4px; }
.k-city-head button { white-space: nowrap; flex: none; }
.k-city-btns { display: flex; gap: 8px; flex: none; flex-wrap: wrap; justify-content: flex-end; }
.k-city button.k-on { border-color: #4ade80; color: #bbf7d0; }
.k-city-side { position: absolute; pointer-events: auto; left: 0; right: 0; bottom: 0; height: 42vh; overflow-y: auto; -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain; background: rgba(15,15,20,0.95); border: 1px solid #333; border-bottom: none; border-radius: 12px 12px 0 0;
  padding: 10px max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); box-sizing: border-box; }
@media (min-width: 760px) {
  .k-city-side { left: auto; right: max(12px, env(safe-area-inset-right)); top: var(--k-city-top, 76px); bottom: 12px; height: auto; width: 370px;
    border: 1px solid #333; border-radius: 8px; padding: 10px 12px; }
}
.k-city-side h3 { margin: 0 0 4px; font-size: 15px; }
.k-city-side p { margin: 2px 0 8px; font-size: 12px; color: #9ca3af; }
.k-city-side .k-good { color: #4ade80; }
.k-city-list { display: flex; flex-direction: column; gap: 6px; }
.k-city-list button { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 2px; width: 100%; }
.k-city-list button b { font-weight: 600; }
.k-city-list button small { opacity: 0.8; font-size: 11px; }
.k-city-list button small.k-good { color: #4ade80; opacity: 1; }
.k-city-list button.k-best { border-color: #facc15; }
.k-city-rules { margin-top: 12px; font-size: 12px; color: #8b8b99; }
.k-city-rules summary { cursor: pointer; color: #9ca3af; }
.k-city-hint { font-size: 11px; color: #8b8b99; margin-top: 10px; }
.k-deco-tools { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 4px; }
.k-city .k-deco-tools button { padding: 5px 9px; font-size: 13px; }
.k-city button.k-sel { border-color: #facc15; background: #3a3420; }
.k-city button.k-warn { border-color: #f87171; color: #fecaca; }
.k-deco-group { font-size: 11px; color: #8b8b99; margin: 8px 0 3px; text-transform: uppercase; letter-spacing: 0.04em; }
.k-deco-tray { display: flex; gap: 6px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
@media (min-width: 760px) { .k-deco-tray { flex-wrap: wrap; overflow-x: visible; } }
.k-city .k-deco-item { flex: none; width: 76px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 3px; font-size: 11px; line-height: 1.2; }
.k-deco-item small { opacity: 0.75; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.k-thumb { position: relative; width: 34px; height: 34px; display: block; font-size: 24px; line-height: 34px; text-align: center; }
.k-thumb i { position: absolute; image-rendering: pixelated; background-repeat: no-repeat; }
.k-deco-picked { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #1d2230; border: 1px solid #facc15;
  border-radius: 6px; padding: 6px 8px; margin: 4px 0 6px; font-size: 13px; }
.k-toasts { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); z-index: 35; display: flex; flex-direction: column; gap: 6px;
  align-items: center; pointer-events: none; width: min(480px, calc(100vw - 24px)); }
.k-toast { background: rgba(15,15,20,0.95); border: 1px solid #4ade80; color: #e5e7eb; border-radius: 8px; padding: 8px 12px;
  font: 13px/1.35 system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,0.45); transition: opacity .4s, transform .4s; text-align: center; }
.k-toast.k-out { opacity: 0; transform: translateY(6px); }
`;

let styled = false;
function ensureStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// The Phaser game, so the City View can switch between the map and the city screen (set once in main.ts)
let phaser: Phaser.Game | null = null;
export function attachCityScreen(game: Phaser.Game): void {
  phaser = game;
}

let toastBox: HTMLDivElement | null = null;

// A short message near the bottom of the screen that fades by itself (keeps the last 3)
export function showToast(msg: string, ms = 4500): void {
  ensureStyle();
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'k-toasts';
    document.body.appendChild(toastBox);
  }
  const t = document.createElement('div');
  t.className = 'k-toast';
  t.textContent = msg;
  toastBox.appendChild(t);
  while (toastBox.children.length > 3) toastBox.firstElementChild?.remove();
  window.setTimeout(() => {
    t.classList.add('k-out');
    window.setTimeout(() => t.remove(), 450);
  }, ms);
}

// Every bonus building b on plot i would bring: its own, plus what it gives the neighbors
export function placementNotes(city: Tile, i: number, b: Building): string[] {
  const out = [...plotBonus(city, i, b).notes];
  const after = city.placed.slice();
  after[i] = b;
  for (const k of plotNeighbors(i)) {
    const nb = city.placed[k];
    if (!nb) continue;
    const before = new Set(plotBonus(city, k, nb).notes);
    for (const n of plotBonus(city, k, nb, after).notes) if (!before.has(n)) out.push(n);
  }
  return out;
}

// "+1 gold: Market next to the Harbor" -> "+1 gold"
export function shortNotes(notes: string[]): string {
  return notes.map((n) => n.split(':')[0]).join(', ');
}

// Does the city have any plot this amenity can stand on? (no water plot = no Harbor, no hills = no Workshop)
export function hasPlotFor(city: Tile, b: Building): boolean {
  const need = BUILDINGS[b].plot;
  return need ? city.plots.includes(need) : city.plots.some((t) => t !== 'water');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bonusRules(): string {
  const amount = (r: { gold?: number; food?: number; happy?: number; culture?: number }) =>
    [r.gold && `+${r.gold} gold`, r.food && `+${r.food} food`, r.happy && `+${r.happy} happy`, r.culture && `+${r.culture} culture`].filter(Boolean).join(', ');
  return [
    ...TERRAIN_BONUS.map((r) => `${BUILDINGS[r.b].name} ${r.note} ${amount(r)}`),
    ...ADJACENCY.map((r) => `${BUILDINGS[r.b].name} ${r.note} ${amount(r)}`),
    ...FACING_BONUS.map((r) => `${BUILDINGS[r.b].name} ${r.note} ${bonusAmount(r)}`),
  ].join(' \u00b7 ');
}

// "Looks out on a mine (your land): a Workshop here gets +1 stone"
function facingLine(c: Tile, i: number): string {
  const t = facingTile(c, i);
  if (!t) return '';
  const work = facingWork(c, i);
  const theirs = t.owner !== null && t.owner !== c.owner;
  const what = work ? OUT_NAME[work] : t.improvement ? OUT_NAME[t.improvement] : t.road ? 'a road' : `bare ${t.terrain}`;
  const where = t.owner === null ? 'unclaimed' : theirs ? "someone else's land" : 'your land';
  const fans = FACING_BONUS.filter((r) => r.imp === work || (r.imp === 'road' && work !== null && t.road));
  const tip = fans.length ? `: ${fans.map((r) => `${BUILDINGS[r.b].name} ${bonusAmount(r)}`).join(', ')}` : t.owner === c.owner ? '' : ' (no bonus until it\'s yours)';
  return `<p>Faces ${what} on ${where}${tip}.</p>`;
}

// A tray picture: the decoration's Kenney tiles as CSS crops of the tilesheets (emoji if it has none)
function thumbHtml(id: DecoId): string {
  const cells = DECOR_THUMB[id] ?? DECOR_ART[id];
  if (!cells.length) return DECOS[id].icon;
  const minX = Math.min(...cells.map((k) => k.x));
  const minY = Math.min(...cells.map((k) => k.y));
  const w = Math.max(...cells.map((k) => k.x + 1)) - minX;
  const h = Math.max(...cells.map((k) => k.y + 1)) - minY;
  const box = 34;
  const s = Math.max(0.5, Math.floor((box / (Math.max(w, h) * 16)) * 4) / 4); // px per art pixel, in quarter steps
  const ox = (box - w * 16 * s) / 2;
  const oy = (box - h * 16 * s) / 2;
  return cells
    .map((k) => {
      const g = SHEET_INFO[k.s];
      const col = k.f % g.cols;
      const row = Math.floor(k.f / g.cols);
      return (
        `<i style="left:${(ox + (k.x - minX) * 16 * s).toFixed(1)}px;top:${(oy + (k.y - minY) * 16 * s).toFixed(1)}px;` +
        `width:${16 * s}px;height:${16 * s}px;background-image:url('${g.url}');background-size:${g.w * s}px ${g.h * s}px;` +
        `background-position:-${col * g.step * s}px -${row * g.step * s}px"></i>`
      );
    })
    .join('');
}

type Tool = number | 'erase' | null;

export class CityView {
  private root: HTMLDivElement;
  private state: GameState | null = null;
  private city: Tile | null = null;
  private me = 0;
  private sel: CityPick = 'keep';
  private handlers: CityViewHandlers | null = null;
  private hidden: HTMLElement[] = []; // HUD pieces tucked away while the city is open
  private rulesOpen = false;
  private closing = false; // zooming back out to the map (task 6)
  // Decorate mode (task 5)
  private decorating = false;
  private tool: Tool = null;
  private picked: [number, number] | null = null;
  private undoStack: { deco: DecoEntry[]; refund: number }[] = []; // this visit only
  private stroke: { before: DecoEntry[]; gold: number; erase: boolean; kind: number } | null = null;
  private confirmClear = false;

  constructor() {
    ensureStyle();
    this.root = document.createElement('div');
    this.root.className = 'k-city';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display === 'block';
  }

  open(state: GameState, city: Tile, me: number, handlers: CityViewHandlers, opts: CityOpenOptions = {}): void {
    if (!city.city || city.owner !== me || this.closing) return;
    const again = this.visible;
    if (this.city !== city || this.me !== me) this.resetDeco();
    this.state = state;
    this.city = city;
    this.me = me;
    this.handlers = handlers;
    // Start on the first open, empty plot (or the Keep when there isn't one)
    const open = openPlots(city, state.isSimple(me));
    const free = Array.from({ length: open }, (_, i) => i).find((i) => !city.placed[i] && city.projectPlot !== i);
    this.sel = free ?? 'keep';
    this.root.style.display = 'block';
    if (!again) {
      this.hideOthers();
      if (opts.zoomIn) this.fadeIn();
    }
    this.render(); // lay out the panel first: the city screen fits itself into the space left over
    CityScene.link = {
      state,
      city,
      me,
      sel: () => this.sel,
      view: () => this.freeArea(),
      pick: (p) => this.pick(p),
      close: () => this.close(true),
      escape: () => this.escape(),
      deco: () => (this.decorating ? { tool: this.tool, picked: this.picked } : null),
      decoTap: (dx, dy) => this.decoTap(dx, dy),
      decoPaint: (dx, dy, first) => this.decoPaint(dx, dy, first),
      decoPaintEnd: () => this.decoPaintEnd(),
      decoMove: (fx, fy, tx, ty) => this.decoMove(fx, fy, tx, ty),
      undo: () => this.undo(),
    };
    const sm = phaser?.scene;
    if (!sm) return;
    if (again) CityScene.refit();
    else {
      CityScene.intro = !!opts.zoomIn;
      sm.sleep(MAP_SCENE); // the map stops drawing and listening underneath
      sm.run(CITY_SCENE); // starts it the first time, wakes it after that
    }
  }

  // user = you chose to leave (button, Esc, O, zooming out): the city screen zooms out and fades first.
  // Forced closes (menu, next player's turn, city lost) switch right away.
  close(user = false): void {
    if (!this.visible || this.closing) return;
    this.decoPaintEnd();
    if (user && CityScene.zoomOut(() => this.finishClose(true))) {
      this.closing = true;
      this.root.classList.add('k-dim');
      return;
    }
    this.finishClose(user);
  }

  private finishClose(user: boolean): void {
    this.closing = false;
    this.root.classList.remove('k-dim');
    this.resetDeco();
    this.root.style.display = 'none';
    this.showOthers();
    const sm = phaser?.scene;
    if (sm) {
      sm.sleep(CITY_SCENE);
      sm.wake(MAP_SCENE);
    }
    CityScene.link = null;
    const h = this.handlers;
    this.handlers = null;
    h?.onClose(user);
  }

  // The panel fades in with the city screen (two frames later, so the browser sees the change)
  private fadeIn(): void {
    const el = this.root;
    el.classList.add('k-dim');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('k-dim')));
  }

  // The world changed under it: redraw, or close if the city is no longer yours
  refresh(): void {
    if (!this.visible || !this.state || !this.city) return;
    if (!this.city.city || this.city.owner !== this.me || this.state.winner !== null) {
      this.close();
      return;
    }
    this.render();
  }

  // Tapped on the city screen
  private pick(p: CityPick): void {
    if (!this.visible) return;
    this.sel = p;
    this.render();
  }

  // The HUD sits under the old full-screen City View's layer; hide it so the city screen shows through cleanly.
  // Anything above that layer (the help button, toasts) stays, like before.
  private hideOthers(): void {
    this.hidden = [];
    for (const el of Array.from(document.body.children) as HTMLElement[]) {
      if (el === this.root || el === toastBox || el.id === 'game' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const z = parseInt(getComputedStyle(el).zIndex, 10);
      if (!Number.isNaN(z) && z > Z) continue;
      if (el.style.visibility === 'hidden') continue;
      el.style.visibility = 'hidden';
      this.hidden.push(el);
    }
  }

  private showOthers(): void {
    for (const el of this.hidden) el.style.visibility = '';
    this.hidden = [];
  }

  // Screen area the header and panel leave free (the city screen centers the town in it)
  private freeArea(): { x: number; y: number; w: number; h: number } {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const head = this.root.querySelector('.k-city-head')?.getBoundingClientRect();
    const side = this.root.querySelector('.k-city-side')?.getBoundingClientRect();
    const top = head ? head.bottom : 0;
    if (side && side.width > 0 && side.width < W * 0.8) return { x: 0, y: top, w: Math.max(0, side.left), h: H - top }; // panel on the right
    const bottom = side && side.height > 0 ? side.top : H; // panel along the bottom (phones)
    return { x: 0, y: top, w: W, h: Math.max(0, bottom - top) };
  }

  private render(): void {
    const s = this.state!;
    const c = this.city!;
    const simple = s.isSimple(this.me);
    const open = openPlots(c, simple);
    const used = c.placed.filter(Boolean).length + (c.projectPlot !== null ? 1 : 0);
    const lvl = cityLevel(c);
    const nextLvl = PLOTS_BY_LEVEL.findIndex((n) => n > open);
    const more = !simple && open < PLOT_COUNT && nextLvl >= 0 ? ` (${PLOTS_BY_LEVEL[nextLvl]} at ${LEVEL_NAMES[nextLvl]})` : '';
    const gold = s.isFree(this.me) ? 'free building' : `${s.players[this.me].gold} gold`;
    const size = gridSize(c);
    const canDeco = !decorateReason(s, c, this.me);
    if (!canDeco) this.decorating = false;

    // Keep the panel and tray scroll positions across the redraw (tapping tiles redraws a lot)
    const side = this.root.querySelector<HTMLElement>('.k-city-side');
    const sideTop = side?.scrollTop ?? 0;
    const trays = Array.from(this.root.querySelectorAll<HTMLElement>('.k-deco-tray')).map((t) => t.scrollLeft);

    const decoBtn = canDeco
      ? `<button type="button" data-deco${this.decorating ? ' class="k-on"' : ''}>${this.decorating ? '\u2714 Done' : '\u{1F333} Decorate'}</button>`
      : '';
    const head =
      `<div class="k-city-head"><div><h2>${esc(s.cityName(c))}</h2>` +
      `<div class="k-city-sub">${LEVEL_NAMES[lvl - 1]} \u00b7 ${c.pop} people \u00b7 ${used}/${open} plots used${more} \u00b7 ${size}x${size} \u00b7 ${gold}</div></div>` +
      `<div class="k-city-btns">${decoBtn}<button type="button" data-close><kbd>Esc</kbd>Back to map</button></div></div>`;
    const rules =
      `<details class="k-city-rules"${this.rulesOpen ? ' open' : ''}><summary>Placement bonuses</summary>` +
      `\u2605 = best spot for it \u00b7 ${esc(bonusRules())}</details>` +
      `<div class="k-city-hint">Tap a plot to pick it. Drag to look around, pinch or scroll to zoom. Keep zooming out to go back to the map.${canDeco ? ' Decorate to plant trees, paint paths and more.' : ''}</div>`;
    const body = this.decorating ? this.decoPanel(s, c) : `${this.sidePanel(s, c, simple, open)}${rules}`;
    this.root.innerHTML = `${head}<div class="k-city-side">${body}</div>`;

    // Desktop: the panel starts under the header, whatever height it ended up
    const headEl = this.root.querySelector<HTMLElement>('.k-city-head');
    if (headEl) this.root.style.setProperty('--k-city-top', `${Math.round(headEl.getBoundingClientRect().bottom) + 10}px`);
    const sideEl = this.root.querySelector<HTMLElement>('.k-city-side');
    if (sideEl) sideEl.scrollTop = sideTop;
    this.root.querySelectorAll<HTMLElement>('.k-deco-tray').forEach((t, i) => (t.scrollLeft = trays[i] ?? 0));

    this.root.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close(true);
    const decoEl = this.root.querySelector<HTMLButtonElement>('[data-deco]');
    if (decoEl) decoEl.onclick = () => this.setDecorating(!this.decorating);
    const det = this.root.querySelector<HTMLDetailsElement>('.k-city-rules');
    if (det) det.ontoggle = () => (this.rulesOpen = det.open);
    this.root.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((btn) => {
      btn.onclick = () => this.build(btn.getAttribute('data-build') as Building);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-tool')!;
        const t: Tool = v === 'select' ? null : v === 'erase' ? 'erase' : Number(v);
        this.tool = this.tool === t ? null : t; // tapping the picked one again stops
        if (this.tool !== null) this.picked = null;
        this.confirmClear = false;
        this.render();
      };
    });
    const act = (sel: string, fn: () => void) => {
      const el = this.root.querySelector<HTMLButtonElement>(sel);
      if (el) el.onclick = fn;
    };
    act('[data-deco-remove]', () => this.removePicked());
    act('[data-deco-undo]', () => this.undo());
    act('[data-deco-clear]', () => this.clearAll());
    CityScene.refresh();
  }

  private sidePanel(s: GameState, c: Tile, simple: boolean, open: number): string {
    if (this.sel === 'keep') {
      const bonus = cityBonus(c).notes;
      return (
        `<h3>\u{1F3F0} Keep</h3>` +
        `<p>Health ${c.hp}/${cityMaxHp(c)} \u00b7 walls ${c.walls}/${MAX_WALLS}${c.walls ? ` (${c.shield}/${shieldMax(c)})` : ''}. Walls are built from the city panel (Defense).</p>` +
        `<p>Tap a plot to build on it. Neighbors matter, and so does the map hex each plot faces (the small hexes past the edge of the town).</p>` +
        `<h3>Bonuses in this city</h3>` +
        (bonus.length ? `<p class="k-good">${bonus.map(esc).join('<br>')}</p>` : `<p>None yet. Put amenities next to the right neighbors to earn extra.</p>`)
      );
    }
    const i = this.sel;
    const t = plotTerrain(c, i);
    const b = c.placed[i];
    if (b) {
      const info = BUILDINGS[b];
      const notes = plotBonus(c, i, b).notes;
      return (
        `<h3>${info.icon} ${esc(info.name)}</h3><p>${esc(info.note)} \u00b7 ${PLOT_NAME[t]} plot ${i + 1}</p>` +
        facingLine(c, i) +
        (notes.length ? `<p class="k-good">${notes.map(esc).join('<br>')}</p>` : `<p>No placement bonus here.</p>`)
      );
    }
    if (c.projectPlot === i && c.project) {
      const info = BUILDINGS[c.project];
      const notes = placementNotes(c, i, c.project);
      return (
        `<h3>${info.icon} ${esc(info.name)} (building)</h3><p>${c.projectTurns} turn${c.projectTurns === 1 ? '' : 's'} left \u00b7 ${esc(info.note)}</p>` +
        (notes.length ? `<p class="k-good">When done: ${notes.map(esc).join('; ')}</p>` : '')
      );
    }
    if (i >= open) {
      const k = plotLevel(i);
      return `<h3>\u{1F512} ${PLOT_NAME[t]} plot</h3><p>Opens when ${esc(s.cityName(c))} grows into a ${LEVEL_NAMES[k]} (${LEVEL_POP[k]} people).</p>${facingLine(c, i)}`;
    }
    // Empty plot: everything not built yet that this city has a plot for, the ones that fit here first.
    // While the city is busy the list stays readable (dimmed, with its bonuses) and the reason shows once on top.
    const busy = s.busyWith(c);
    const rows = BUILDING_ORDER.filter((x) => !c.buildings.includes(x) && c.project !== x && hasPlotFor(c, x)).map((x) => {
      const check = s.buildCheck(c, x, this.me, i);
      const fits = plotFits(c, i, x, simple);
      return { b: x, check, fits, notes: fits ? placementNotes(c, i, x) : [], best: fits && bestPlot(c, x, simple) === i };
    });
    rows.sort((a, z) => Number(z.check.ok) - Number(a.check.ok) || Number(z.fits) - Number(a.fits));
    const list = rows
      .map(({ b: x, check, fits, notes, best }) => {
        const info = BUILDINGS[x];
        const cost = s.isFree(this.me) ? 'free' : `${info.cost}g`;
        const busyOnly = !!busy && fits && check.reason.startsWith('Busy');
        const detail = check.ok || busyOnly ? `${cost} \u00b7 ${info.turns}t \u00b7 ${info.note}` : check.reason;
        return (
          `<button type="button" data-build="${x}"${check.ok ? '' : ' disabled'}${best ? ' class="k-best"' : ''}>` +
          `<b>${info.icon} ${esc(info.name)}${best ? ' \u2605' : ''}</b><small>${esc(detail)}</small>` +
          (notes.length ? `<small class="k-good">${notes.map(esc).join('; ')}</small>` : '') +
          `</button>`
        );
      })
      .join('');
    return (
      `<h3>${PLOT_NAME[t]} plot ${i + 1}</h3>` +
      facingLine(c, i) +
      `<p>${busy ? `<b>Busy ${esc(busy)}</b>: one project at a time. Here's what each would earn on this plot.` : 'Pick what to build here.'}</p>` +
      `<div class="k-city-list">${list || '<p>Everything is built.</p>'}</div>`
    );
  }

  private build(b: Building): void {
    const s = this.state;
    const c = this.city;
    if (!s || !c || typeof this.sel !== 'number') return;
    if (!s.startBuilding(c, b, this.me, this.sel).ok) return;
    this.handlers?.onChange();
    this.render();
  }

  // ---------- decorate mode ----------

  private resetDeco(): void {
    this.decorating = false;
    this.tool = null;
    this.picked = null;
    this.undoStack = [];
    this.stroke = null;
    this.confirmClear = false;
  }

  private setDecorating(on: boolean): void {
    this.decorating = on;
    this.tool = null;
    this.picked = null;
    this.confirmClear = false;
    this.render();
  }

  // Esc: drop the tool or selection, then leave decorate mode, then back to the map
  private escape(): void {
    if (this.decorating && (this.tool !== null || this.picked)) {
      this.tool = null;
      this.picked = null;
      this.render();
    } else if (this.decorating) this.setDecorating(false);
    else this.close(true);
  }

  private decoPanel(s: GameState, c: Tile): string {
    const me = this.me;
    const small = decoCost(s, me, decoKind('tree'));
    const price = small === 0
      ? 'Decorations are free in this game.'
      : `${small}g each (Statue ${decoCost(s, me, decoKind('statue'))}g, Fountain ${decoCost(s, me, decoKind('fountain'))}g). Paths are free. Removing doesn't give gold back.`;
    const t = this.tool;
    const hint = t === null
      ? 'Pick something below, then tap open ground to place it. Tap a decoration to select it, drag it to move it.'
      : t === 'erase'
        ? 'Tap or drag over things to remove them (no gold back, Undo brings them back).'
        : isPathKind(t)
          ? 'Drag to paint a path, a tap paints one tile. Start on a painted tile to clear instead. Two fingers (or right-drag) move the view.'
          : `Tap open tiles to place ${esc(DECOS[DECO_ORDER[t]].name)}s. Tap it again (or Esc) to stop.`;
    const pk = this.picked;
    const pkKind = pk ? decoAt(c, pk[0], pk[1]) : null;
    const picked = pk && pkKind !== null
      ? `<div class="k-deco-picked"><span>${DECOS[DECO_ORDER[pkKind]].icon} <b>${esc(DECOS[DECO_ORDER[pkKind]].name)}</b> \u00b7 drag to move</span>` +
        `<button type="button" data-deco-remove>\u{1F5D1} Remove</button></div>`
      : '';
    const count = decoList(c).length;
    const tools =
      `<div class="k-deco-tools">` +
      `<button type="button" data-tool="select"${t === null ? ' class="k-sel"' : ''}>\u270B Select</button>` +
      `<button type="button" data-tool="erase"${t === 'erase' ? ' class="k-sel"' : ''}>\u{1F9FD} Eraser</button>` +
      `<button type="button" data-deco-undo${this.undoStack.length ? '' : ' disabled'}>\u21B6 Undo</button>` +
      `<button type="button" data-deco-clear${count ? '' : ' disabled'}${this.confirmClear ? ' class="k-warn"' : ''}>` +
      `${this.confirmClear ? `Tap again to clear all ${count}` : 'Clear all'}</button></div>`;
    const trays = GROUPS.map(([group, label]) => {
      const items = DECO_ORDER.map((id, k) => ({ id, k }))
        .filter(({ id }) => DECOS[id].group === group)
        .map(({ id, k }) => {
          const check = trayCheck(s, c, k, me);
          const cost = decoCost(s, me, k);
          const note = check.ok ? (cost ? `${cost}g` : 'free') : check.reason;
          return (
            `<button type="button" class="k-deco-item${t === k ? ' k-sel' : ''}" data-tool="${k}"${check.ok ? '' : ' disabled'} title="${esc(DECOS[id].name)}: ${esc(note)}">` +
            `<span class="k-thumb">${thumbHtml(id)}</span><span>${esc(DECOS[id].name)}</span><small>${esc(note)}</small></button>`
          );
        })
        .join('');
      return `<div class="k-deco-group">${label}</div><div class="k-deco-tray">${items}</div>`;
    }).join('');
    return (
      `<h3>\u{1F333} Decorate</h3>` +
      `<p>${price} ${decoCount(c)} decoration${decoCount(c) === 1 ? '' : 's'} here.</p>` +
      `<p>${hint}</p>` +
      picked +
      tools +
      trays
    );
  }

  // Run one decorating action: remember how to undo it, save, redraw. Shows why when it can't be done.
  private decoAct(fn: () => Check): boolean {
    const s = this.state;
    const c = this.city;
    if (!s || !c) return false;
    const before = snapDeco(c);
    const gold = s.players[this.me].gold;
    const r = fn();
    if (!r.ok) {
      if (r.reason) showToast(r.reason, 2500);
      CityScene.refresh();
      return false;
    }
    this.pushUndo(before, gold - s.players[this.me].gold);
    this.confirmClear = false;
    this.handlers?.onChange();
    this.render();
    return true;
  }

  private pushUndo(deco: DecoEntry[], refund: number): void {
    this.undoStack.push({ deco, refund: Math.max(0, refund) });
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
  }

  private decoTap(dx: number, dy: number): void {
    const s = this.state;
    const c = this.city;
    if (!s || !c || !this.decorating) return;
    this.confirmClear = false;
    const here = decoAt(c, dx, dy);
    const t = this.tool;
    const same = !!this.picked && this.picked[0] === dx && this.picked[1] === dy;
    if (t === 'erase') {
      if (here === null) return;
      if (same) this.picked = null;
      this.decoAct(() => removeDeco(s, c, dx, dy, this.me));
      return;
    }
    if (typeof t === 'number') {
      if (isPathKind(t)) {
        this.decoAct(() => paintPath(s, c, dx, dy, t, here !== t, this.me)); // the same path again clears it
        return;
      }
      if (here === null || isPathKind(here)) {
        this.decoAct(() => placeDeco(s, c, dx, dy, t, this.me));
        return;
      }
    }
    // Select (or unselect) the decoration on this tile
    this.picked = here !== null && !isPathKind(here) && !same ? [dx, dy] : null;
    this.render();
  }

  // A stroke of path painting (or erasing). The first tile decides: start on the same path and it clears.
  private decoPaint(dx: number, dy: number, first: boolean): void {
    const s = this.state;
    const c = this.city;
    if (!s || !c || !this.decorating) return;
    const t = this.tool;
    if (first) {
      const here = decoAt(c, dx, dy);
      this.confirmClear = false;
      this.stroke = {
        before: snapDeco(c),
        gold: s.players[this.me].gold,
        erase: t === 'erase' || (typeof t === 'number' && here === t),
        kind: typeof t === 'number' ? t : -1,
      };
    }
    const st = this.stroke;
    if (!st) return;
    const here = decoAt(c, dx, dy);
    let r: Check | null = null;
    if (st.erase) {
      if (here === null) return;
      if (t === 'erase') r = removeDeco(s, c, dx, dy, this.me);
      else if (isPathKind(here)) r = paintPath(s, c, dx, dy, here, false, this.me);
      if (r?.ok && this.picked && this.picked[0] === dx && this.picked[1] === dy) this.picked = null;
    } else if (st.kind >= 0) {
      r = paintPath(s, c, dx, dy, st.kind, true, this.me); // blocked tiles are just skipped
    }
    if (r?.ok) CityScene.refresh();
  }

  private decoPaintEnd(): void {
    const st = this.stroke;
    const s = this.state;
    const c = this.city;
    this.stroke = null;
    if (!st || !s || !c) return;
    if (JSON.stringify(st.before) !== JSON.stringify(decoList(c))) {
      this.pushUndo(st.before, st.gold - s.players[this.me].gold);
      this.handlers?.onChange();
    }
    if (this.visible) this.render();
  }

  private decoMove(fx: number, fy: number, tx: number, ty: number): void {
    const s = this.state;
    const c = this.city;
    if (!s || !c) return;
    if (this.decoAct(() => moveDeco(s, c, fx, fy, tx, ty, this.me))) {
      this.picked = [tx, ty];
      this.render();
    }
  }

  private removePicked(): void {
    const s = this.state;
    const c = this.city;
    const pk = this.picked;
    if (!s || !c || !pk) return;
    this.picked = null;
    this.decoAct(() => removeDeco(s, c, pk[0], pk[1], this.me));
  }

  private clearAll(): void {
    const s = this.state;
    const c = this.city;
    if (!s || !c) return;
    if (!this.confirmClear) {
      this.confirmClear = true;
      this.render();
      return;
    }
    this.picked = null;
    this.decoAct(() => clearDeco(s, c, this.me));
  }

  // Undo the last decorating action of this visit (gold spent on it comes back, nothing more)
  private undo(): void {
    const s = this.state;
    const c = this.city;
    if (!s || !c || !this.decorating) return;
    const last = this.undoStack.pop();
    if (!last) return;
    if (!restoreDeco(s, c, last.deco, last.refund, this.me).ok) return;
    this.picked = null;
    this.confirmClear = false;
    this.handlers?.onChange();
    this.render();
  }
}
