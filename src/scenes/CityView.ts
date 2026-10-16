// City View: a full-screen look inside one of your cities. Amenities sit on 6 plots around the Keep.
// A DOM overlay like the HUD: it reads the world and only changes it through GameState methods.
// Plot i is drawn in world direction i (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE), so it matches the map. See docs/CITY_VIEW.md.
import type { GameState } from '../world/game';
import { ADJACENCY, FACING_BONUS, TERRAIN_BONUS, bestPlot, bonusAmount, cityBonus, facingTile, facingWork, openPlots, plotBonus, plotFits, plotNeighbors, plotTerrain } from '../world/city';
import type { Outside } from '../world/city';
import { BUILDINGS, BUILDING_ORDER, LEVEL_NAMES, LEVEL_POP, MAX_WALLS, PLOTS_BY_LEVEL, PLOT_COUNT, cityLevel, cityMaxHp, shieldMax } from '../world/tile';
import type { Building, PlotTerrain, Terrain, Tile } from '../world/tile';
import { PX_CSS, builderActors, keepActors, plotActors } from './citySprites';

export interface CityViewHandlers {
  onChange(): void; // something was built: redraw and save
  onClose(): void;
}

const PLOT_COLOR: Record<PlotTerrain, string> = { water: '#1f5f9e', sand: '#d9c38a', grass: '#6bb352', hills: '#8c7a4c' };
const PLOT_NAME: Record<PlotTerrain, string> = { water: 'Water', sand: 'Sand', grass: 'Grass', hills: 'Hills' };
// The ring of map hexes outside the plots: what each plot faces
const OUT_COLOR: Record<Terrain, string> = { water: '#1f5f9e', sand: '#d9c38a', grass: '#6bb352', hills: '#8c7a4c', mountain: '#9a9a9a' };
const OUT_NAME: Record<Outside, string> = { farm: 'a farm', pasture: 'a pasture', mine: 'a mine', forest: 'a forest', fishery: 'a fishery', road: 'a road' };
const OUT_ICON: Record<Outside, string> = { farm: '\u{1F33E}', pasture: '\u{1F40E}', mine: '\u26CF\uFE0F', forest: '\u{1F332}', fishery: '\u{1F41F}', road: '\u{1F6E4}\uFE0F' };
const OUT_R = 20; // small hexes
const R = 52; // hex radius inside the drawing
const SQ3 = Math.sqrt(3);
const DIR_XY: [number, number][] = [[SQ3, 0], [SQ3 / 2, -1.5], [-SQ3 / 2, -1.5], [-SQ3, 0], [-SQ3 / 2, 1.5], [SQ3 / 2, 1.5]];
const OUT_DIST = SQ3 * R + ((R - 2) * SQ3) / 2 + 4 + (OUT_R * SQ3) / 2; // just past each plot's outer edge

const CSS = `
.k-city { position: fixed; inset: 0; z-index: 20; display: none; background: radial-gradient(circle at 50% 35%, #1d2433, #0b0e14 75%);
  color: #e5e7eb; font: 14px/1.4 system-ui, sans-serif; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.k-city-wrap { max-width: 920px; margin: 0 auto; padding: max(12px, env(safe-area-inset-top)) 14px 24px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
.k-city-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-right: 44px; }
.k-city-head h2 { margin: 0; font-size: 20px; }
.k-city-sub { color: #9ca3af; font-size: 13px; }
.k-city button { background: #262630; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 7px 12px; font: inherit; cursor: pointer; }
.k-city button:hover:not(:disabled) { background: #33333f; }
.k-city button:disabled { opacity: 0.45; cursor: default; }
.k-city kbd { opacity: 0.6; font-size: 11px; margin-right: 4px; }
.k-city-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.k-city svg { width: min(430px, 92vw); height: auto; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.k-city svg [data-plot] { cursor: pointer; }
.k-city-side { flex: 1; min-width: 260px; max-width: 430px; background: rgba(15,15,20,0.9); border: 1px solid #333; border-radius: 8px; padding: 10px 12px; box-sizing: border-box; }
.k-city-side h3 { margin: 0 0 4px; font-size: 15px; }
.k-city-side p { margin: 2px 0 8px; font-size: 12px; color: #9ca3af; }
.k-city-side .k-good { color: #4ade80; }
.k-city-list { display: flex; flex-direction: column; gap: 6px; }
.k-city-list button { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 2px; width: 100%; }
.k-city-list button b { font-weight: 600; }
.k-city-list button small { opacity: 0.8; font-size: 11px; }
.k-city-list button small.k-good { color: #4ade80; opacity: 1; }
.k-city-list button.k-best { border-color: #facc15; }
.k-city-foot { font-size: 12px; color: #8b8b99; text-align: center; max-width: 640px; margin: 0 auto; }
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
  s.textContent = CSS + PX_CSS;
  document.head.appendChild(s);
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

// The city level at which plot i opens
function plotLevel(i: number): number {
  const k = PLOTS_BY_LEVEL.findIndex((n) => n > i);
  return k < 0 ? PLOTS_BY_LEVEL.length - 1 : k;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
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

export class CityView {
  private root: HTMLDivElement;
  private state: GameState | null = null;
  private city: Tile | null = null;
  private me = 0;
  private sel: number | 'keep' = 'keep';
  private handlers: CityViewHandlers | null = null;

  constructor() {
    ensureStyle();
    this.root = document.createElement('div');
    this.root.className = 'k-city';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display === 'block';
  }

  open(state: GameState, city: Tile, me: number, handlers: CityViewHandlers): void {
    if (!city.city || city.owner !== me) return;
    this.state = state;
    this.city = city;
    this.me = me;
    this.handlers = handlers;
    // Start on the first open, empty plot (or the Keep when there isn't one)
    const open = openPlots(city, state.isSimple(me));
    const free = Array.from({ length: open }, (_, i) => i).find((i) => !city.placed[i] && city.projectPlot !== i);
    this.sel = free ?? 'keep';
    this.root.style.display = 'block';
    this.root.scrollTop = 0;
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.root.style.display = 'none';
    const h = this.handlers;
    this.handlers = null;
    h?.onClose();
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

    const head =
      `<div class="k-city-head"><div><h2>${esc(s.cityName(c))}</h2>` +
      `<div class="k-city-sub">${LEVEL_NAMES[lvl - 1]} \u00b7 ${c.pop} people \u00b7 ${used}/${open} plots used${more} \u00b7 ${gold}</div></div>` +
      `<button type="button" data-close><kbd>Esc</kbd>Back to map</button></div>`;

    // The drawing: Keep in the middle, 6 plots around it
    const w = OUT_DIST + OUT_R + 4;
    const hgt = Math.max(2.5 * R, (OUT_DIST * SQ3) / 2 + OUT_R) + 4;
    let svg = `<svg viewBox="${(-w).toFixed(1)} ${(-hgt).toFixed(1)} ${(2 * w).toFixed(1)} ${(2 * hgt).toFixed(1)}" xmlns="http://www.w3.org/2000/svg">`;
    // What's outside: the map hex each plot faces, with its improvement. Lit green when it's paying a bonus.
    for (let i = 0; i < PLOT_COUNT; i++) {
      const t = facingTile(c, i);
      if (!t) continue;
      const [dx, dy] = DIR_XY[i];
      const x = (dx / SQ3) * OUT_DIST;
      const y = (dy / SQ3) * OUT_DIST;
      const work = t.improvement ?? (t.road ? 'road' : null);
      const mine = t.owner === c.owner;
      const b = c.placed[i];
      const paying = !!b && plotBonus(c, i, b).notes.some((n) => n.includes('facing'));
      svg +=
        `<g data-plot="${i}" opacity="${mine ? 1 : 0.45}"><polygon points="${hexPoints(x, y, OUT_R)}" fill="${OUT_COLOR[t.terrain]}" fill-opacity="0.75" ` +
        `stroke="${paying ? '#4ade80' : '#000'}" stroke-opacity="${paying ? 1 : 0.35}" stroke-width="${paying ? 2.5 : 1}" stroke-dasharray="${mine ? '' : '3 2'}"/>` +
        (work ? `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" font-size="14" text-anchor="middle">${OUT_ICON[work]}</text>` : '') +
        `</g>`;
    }
    const keepSel = this.sel === 'keep';
    svg +=
      `<g data-plot="keep"><polygon points="${hexPoints(0, 0, R - 2)}" fill="#2a2f3a" stroke="${keepSel ? '#facc15' : '#9ca3af'}" stroke-width="${keepSel ? 4 : 2 + c.walls}"/>` +
      `<text x="0" y="2" font-size="30" text-anchor="middle">\u{1F3F0}</text>` +
      `<text x="0" y="26" font-size="11" fill="#e5e7eb" text-anchor="middle">Keep${c.walls ? ` \u00b7 walls ${c.walls}` : ''}</text>${keepActors(c.walls)}</g>`;
    for (let i = 0; i < PLOT_COUNT; i++) {
      const [dx, dy] = DIR_XY[i];
      const x = dx * R;
      const y = dy * R;
      const t = plotTerrain(c, i);
      const locked = i >= open;
      const b = c.placed[i];
      const proj = c.projectPlot === i ? c.project : null;
      const isSel = this.sel === i;
      let inner = '';
      if (b) {
        inner = `<text x="${x}" y="${y + 2}" font-size="28" text-anchor="middle">${BUILDINGS[b].icon}</text>` +
          `<text x="${x}" y="${y + 24}" font-size="11" font-weight="600" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke" text-anchor="middle">${esc(BUILDINGS[b].name)}</text>` +
          plotActors(b, x, y, i);
      } else if (proj) {
        inner = `<text x="${x}" y="${y + 2}" font-size="28" text-anchor="middle" opacity="0.45">${BUILDINGS[proj].icon}</text>` +
          `<text x="${x}" y="${y + 24}" font-size="11" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke" text-anchor="middle">${c.projectTurns}t left</text>` +
          builderActors(x, y, i);
      } else if (locked) {
        inner = `<text x="${x}" y="${y + 4}" font-size="20" text-anchor="middle">\u{1F512}</text>` +
          `<text x="${x}" y="${y + 24}" font-size="10" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke" text-anchor="middle">${LEVEL_NAMES[plotLevel(i)]}</text>`;
      } else {
        inner = `<text x="${x}" y="${y + 9}" font-size="28" fill="#fff" opacity="0.8" text-anchor="middle">+</text>` +
          `<text x="${x}" y="${y + 26}" font-size="10" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke" text-anchor="middle">${PLOT_NAME[t]}</text>`;
      }
      svg +=
        `<g data-plot="${i}" opacity="${locked && !b ? 0.45 : 1}"><polygon points="${hexPoints(x, y, R - 2)}" fill="${PLOT_COLOR[t]}" ` +
        `stroke="${isSel ? '#facc15' : '#000'}" stroke-opacity="${isSel ? 1 : 0.4}" stroke-width="${isSel ? 4 : 1.5}"/>${inner}</g>`;
    }
    svg += '</svg>';

    const side = `<div class="k-city-side">${this.sidePanel(s, c, simple, open)}</div>`;
    const foot = `<div class="k-city-foot">\u2605 = best spot for it \u00b7 Placement bonuses: ${esc(bonusRules())}</div>`;
    this.root.innerHTML = `<div class="k-city-wrap">${head}<div class="k-city-body">${svg}${side}</div>${foot}</div>`;

    this.root.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close();
    this.root.querySelectorAll<SVGGElement>('[data-plot]').forEach((g) => {
      g.addEventListener('click', () => {
        const v = g.getAttribute('data-plot')!;
        this.sel = v === 'keep' ? 'keep' : Number(v);
        this.render();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((btn) => {
      btn.onclick = () => this.build(btn.getAttribute('data-build') as Building);
    });
  }

  private sidePanel(s: GameState, c: Tile, simple: boolean, open: number): string {
    if (this.sel === 'keep') {
      const bonus = cityBonus(c).notes;
      return (
        `<h3>\u{1F3F0} Keep</h3>` +
        `<p>Health ${c.hp}/${cityMaxHp(c)} \u00b7 walls ${c.walls}/${MAX_WALLS}${c.walls ? ` (${c.shield}/${shieldMax(c)})` : ''}. Walls are built from the city panel (Defense).</p>` +
        `<p>Tap a plot to build on it. Neighbors matter, and so does the map hex each plot faces (the small hexes around the edge).</p>` +
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
}
