// City View rules: amenities stand on plots around the Keep. Plots have terrain, and neighbors give bonuses.
// Pure functions on tiles: no Phaser, no GameState. See docs/CITY_VIEW.md.
import type { WorldMap } from './map';
import { BUILDINGS, BUILDING_ORDER, LEVEL_NAMES, MAX_LEVEL, PLOTS_BY_LEVEL, PLOT_COUNT, cityLevel } from './tile';
import type { Building, PlotTerrain, Tile } from './tile';

// What a placement adds on top of the amenity's normal stats
export interface PlotBonus {
  gold: number;
  food: number;
  happy: number;
  culture: number;
  notes: string[]; // "+1 gold: Market next to the Harbor"
  happyParts: [string, number][]; // for the happiness breakdown
}

type Amounts = { gold?: number; food?: number; happy?: number; culture?: number };

// Terrain bonuses: the amenity on this kind of plot
export const TERRAIN_BONUS: (Amounts & { b: Building; t: PlotTerrain; note: string })[] = [
  { b: 'granary', t: 'grass', food: 1, note: 'on grass' },
];

// Neighbor bonuses: the amenity next to another one (or the Keep). The bonus goes to the first one.
export const ADJACENCY: (Amounts & { b: Building; next: Building | 'keep'; note: string })[] = [
  { b: 'temple', next: 'keep', happy: 1, note: 'by the Keep' },
  { b: 'market', next: 'harbor', gold: 1, note: 'next to the Harbor' },
  { b: 'park', next: 'temple', culture: 1, note: 'next to the Temple' },
  { b: 'arena', next: 'market', gold: 1, note: 'next to the Market' },
];

const empty = (): PlotBonus => ({ gold: 0, food: 0, happy: 0, culture: 0, notes: [], happyParts: [] });

function amountText(a: Amounts): string {
  const parts: string[] = [];
  if (a.gold) parts.push(`+${a.gold} gold`);
  if (a.food) parts.push(`+${a.food} food`);
  if (a.happy) parts.push(`+${a.happy} happy`);
  if (a.culture) parts.push(`+${a.culture} culture`);
  return parts.join(', ');
}

function addTo(out: PlotBonus, a: Amounts, label: string): void {
  out.gold += a.gold ?? 0;
  out.food += a.food ?? 0;
  out.happy += a.happy ?? 0;
  out.culture += a.culture ?? 0;
  out.notes.push(`${amountText(a)}: ${label}`);
  if (a.happy) out.happyParts.push([label, a.happy]);
}

// Plot i faces world direction i. Mountains count as hills; off the map counts as grass.
export function snapshotPlots(map: WorldMap, city: Tile): PlotTerrain[] {
  const out: PlotTerrain[] = [];
  for (let i = 0; i < PLOT_COUNT; i++) {
    const n = map.neighborAt(city, i);
    const t = n ? n.terrain : 'grass';
    out.push(t === 'mountain' ? 'hills' : t);
  }
  return out;
}

// A new city: plots from the land around it, nothing built
export function setupPlots(map: WorldMap, city: Tile): void {
  city.plots = snapshotPlots(map, city);
  city.placed = new Array<Building | null>(PLOT_COUNT).fill(null);
  city.projectPlot = null;
}

// Plots the city can use at its size (easy rules: all of them)
export function openPlots(city: Tile, simple = false): number {
  if (simple) return PLOT_COUNT;
  return PLOTS_BY_LEVEL[Math.min(PLOTS_BY_LEVEL.length, cityLevel(city)) - 1];
}

export function plotUsed(city: Tile, i: number): boolean {
  return !!city.placed[i] || city.projectPlot === i;
}

export function freePlots(city: Tile, simple = false): number {
  let n = 0;
  for (let i = 0; i < openPlots(city, simple); i++) if (!plotUsed(city, i)) n++;
  return n;
}

// The two plots beside plot i on the ring (every ring-1 plot also touches the Keep)
export function plotNeighbors(i: number): number[] {
  return [(i + 1) % PLOT_COUNT, (i + PLOT_COUNT - 1) % PLOT_COUNT];
}

export function terrainFits(t: PlotTerrain, b: Building): boolean {
  const need = BUILDINGS[b].plot;
  return need ? t === need : t !== 'water';
}

export function plotTerrain(city: Tile, i: number): PlotTerrain {
  return city.plots[i] ?? 'grass';
}

export function plotFits(city: Tile, i: number, b: Building, simple = false): boolean {
  return i >= 0 && i < openPlots(city, simple) && !plotUsed(city, i) && terrainFits(plotTerrain(city, i), b);
}

// Why an amenity can't go on this plot (empty when it can)
export function plotReason(city: Tile, i: number, b: Building, simple = false): string {
  if (i < 0 || i >= PLOT_COUNT) return 'No such plot';
  if (i >= openPlots(city, simple)) return `Plot opens when the city grows (${nextPlotLevel(city)})`;
  if (plotUsed(city, i)) return 'Plot already used';
  if (!terrainFits(plotTerrain(city, i), b)) {
    const need = BUILDINGS[b].plot;
    return need ? `Needs a ${need} plot` : "Can't build on a water plot";
  }
  return '';
}

// Why an amenity has nowhere to go (empty when there is a spot)
export function noPlotReason(city: Tile, b: Building, simple = false): string {
  if (bestPlot(city, b, simple) !== null) return '';
  const need = BUILDINGS[b].plot;
  if (need && !city.plots.some((t, i) => t === need && !city.placed[i] && city.projectPlot !== i)) return `Needs a free ${need} plot`;
  if (freePlots(city, simple) === 0) {
    return openPlots(city, simple) < PLOT_COUNT ? `No free plot: more at ${nextPlotLevel(city)}` : 'All plots are used';
  }
  return need ? `No open ${need} plot yet: more at ${nextPlotLevel(city)}` : 'No open land plot';
}

function nextPlotLevel(city: Tile): string {
  const lvl = cityLevel(city);
  return lvl >= MAX_LEVEL ? LEVEL_NAMES[MAX_LEVEL - 1] : LEVEL_NAMES[lvl];
}

// Bonus for amenity b standing on plot i, given what stands where (layout)
export function plotBonus(city: Tile, i: number, b: Building, layout: (Building | null)[] = city.placed): PlotBonus {
  const out = empty();
  const name = BUILDINGS[b].name;
  const t = plotTerrain(city, i);
  for (const r of TERRAIN_BONUS) if (r.b === b && r.t === t) addTo(out, r, `${name} ${r.note}`);
  const near = plotNeighbors(i).map((k) => layout[k] ?? null);
  for (const r of ADJACENCY) {
    if (r.b !== b) continue;
    if (r.next === 'keep' || near.includes(r.next)) addTo(out, r, `${name} ${r.note}`);
  }
  return out;
}

// Every placement bonus in the city added up
export function cityBonus(city: Tile): PlotBonus {
  const out = empty();
  city.placed.forEach((b, i) => {
    if (!b) return;
    const pb = plotBonus(city, i, b);
    out.gold += pb.gold;
    out.food += pb.food;
    out.happy += pb.happy;
    out.culture += pb.culture;
    out.notes.push(...pb.notes);
    out.happyParts.push(...pb.happyParts);
  });
  return out;
}

const worth = (p: PlotBonus) => p.gold + p.food + p.happy + p.culture * 0.5;

// How good plot i is for amenity b: its own bonus, plus what it adds to its neighbors,
// minus a little for using up a special plot another amenity needs (hills for a Workshop, grass for a Mill)
export function plotScore(city: Tile, i: number, b: Building): number {
  let s = worth(plotBonus(city, i, b));
  const after = city.placed.slice();
  after[i] = b;
  for (const k of plotNeighbors(i)) {
    const nb = city.placed[k];
    if (!nb) continue;
    s += worth(plotBonus(city, k, nb, after)) - worth(plotBonus(city, k, nb));
  }
  const t = plotTerrain(city, i);
  if (!BUILDINGS[b].plot && t === 'hills') s -= 0.6;
  if (!BUILDINGS[b].plot && t === 'grass' && b !== 'granary') s -= 0.2;
  return s;
}

// The best open plot for amenity b (null = nowhere to put it). Ties go to the lowest plot.
export function bestPlot(city: Tile, b: Building, simple = false): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < PLOT_COUNT; i++) {
    if (!plotFits(city, i, b, simple)) continue;
    const s = plotScore(city, i, b);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

// "plot 3 (+1 gold: Market next to the Harbor)"
export function describePlacement(city: Tile, i: number, b: Building): string {
  const pb = plotBonus(city, i, b);
  return `plot ${i + 1}${pb.notes.length ? ` (${pb.notes.join('; ')})` : ''}`;
}

// Old saves (and anything else missing a layout): put already-built amenities on plots.
// Size locks are ignored here, and an amenity with no matching plot still gets a spot (grandfathered).
export function placeExisting(city: Tile): void {
  if (city.plots.length !== PLOT_COUNT) return;
  if (city.placed.length !== PLOT_COUNT) city.placed = new Array<Building | null>(PLOT_COUNT).fill(null);
  for (const b of BUILDING_ORDER) {
    if (!city.buildings.includes(b) || city.placed.includes(b)) continue;
    let at = bestPlot(city, b, true);
    if (at === null) {
      const free = city.placed.findIndex((x, i) => !x && city.projectPlot !== i);
      at = free >= 0 ? free : null;
    }
    if (at !== null) city.placed[at] = b;
  }
}
