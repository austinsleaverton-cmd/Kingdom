// Territory amenity placement and live bonuses. Damage never removes a building or its site.
import type { Difficulty, GameState } from './game';
import { decoInfo, decoList } from './deco';
import { cityLayout, hexLabel } from './grid';
import type { CityHex } from './grid';
import { AMENITY_SLOTS, BUILDINGS, BUILDING_ORDER, LEVEL_NAMES, MAX_AMENITIES, MAX_LEVEL, cityLevel } from './tile';
import type { Building, Improvement, PlotTerrain, Tile } from './tile';
import { damaged } from './raidState';
export interface SiteBonus {
  gold: number; food: number; happy: number; culture: number; stone: number; horses: number;
  notes: string[]; happyParts: [string, number][];
}
type Amounts = { gold?: number; food?: number; happy?: number; culture?: number; stone?: number; horses?: number };
export const TERRAIN_BONUS: (Amounts & { b: Building; t: PlotTerrain; note: string })[] = [
  { b: 'granary', t: 'grass', food: 1, note: 'on grass' },
];
export type Outside = Improvement | 'road';
export const WORK_BONUS: (Amounts & { b: Building; imp: Outside; note: string })[] = [
  { b: 'workshop', imp: 'mine', stone: 1, note: 'next to a mine' },
  { b: 'mill', imp: 'farm', food: 1, note: 'next to a farm' },
  { b: 'barracks', imp: 'pasture', horses: 1, note: 'next to a pasture' },
  { b: 'harbor', imp: 'fishery', food: 1, note: 'next to a fishery' },
  { b: 'park', imp: 'forest', culture: 1, note: 'next to a forest' },
  { b: 'market', imp: 'road', gold: 1, note: 'next to a road' },
];
export const ADJACENCY: (Amounts & { b: Building; next: Building | 'keep'; note: string })[] = [
  { b: 'market', next: 'harbor', gold: 1, note: 'next to the Harbor' },
  { b: 'mill', next: 'granary', food: 1, note: 'next to the Granary' },
  { b: 'park', next: 'temple', culture: 1, note: 'next to the Temple' },
  { b: 'arena', next: 'market', gold: 1, note: 'next to the Market' },
];
const empty = (): SiteBonus => ({ gold: 0, food: 0, happy: 0, culture: 0, stone: 0, horses: 0, notes: [], happyParts: [] });
function amountText(a: Amounts): string {
  const parts: string[] = [];
  if (a.gold) parts.push(`+${a.gold} gold`);
  if (a.food) parts.push(`+${a.food} food`);
  if (a.happy) parts.push(`+${a.happy} happy`);
  if (a.culture) parts.push(`+${a.culture} culture`);
  if (a.stone) parts.push(`+${a.stone} stone`);
  if (a.horses) parts.push(`+${a.horses} horse${a.horses === 1 ? '' : 's'}`);
  return parts.join(', ');
}
export const bonusAmount = (a: Amounts): string => amountText(a);
function addTo(out: SiteBonus, a: Amounts, label: string): void {
  out.gold += a.gold ?? 0; out.food += a.food ?? 0; out.happy += a.happy ?? 0;
  out.culture += a.culture ?? 0; out.stone += a.stone ?? 0; out.horses += a.horses ?? 0;
  out.notes.push(`${amountText(a)}: ${label}`);
  if (a.happy) out.happyParts.push([label, a.happy]);
}
export type Sites = Partial<Record<Building, number>>;
export function siteOf(c: Tile, b: Building): number | null { return c.sites[b] === undefined ? null : c.sites[b]!; }
export function amenityAt(c: Tile, i: number): Building | null {
  for (const b of BUILDING_ORDER) if (c.sites[b] === i) return b;
  return null;
}
export const siteUsed = (c: Tile, i: number): boolean => amenityAt(c, i) !== null || c.projectSite === i;
export function amenitySlots(c: Tile, simple = false): number {
  return simple ? MAX_AMENITIES : AMENITY_SLOTS[Math.min(AMENITY_SLOTS.length, cityLevel(c)) - 1];
}
export const amenitiesUsed = (c: Tile): number => c.buildings.length + (c.project ? 1 : 0);
export const freeSlots = (c: Tile, simple = false): number => Math.max(0, amenitySlots(c, simple) - amenitiesUsed(c));
export function terrainFits(t: PlotTerrain, b: Building): boolean { const need = BUILDINGS[b].plot; return need ? t === need : t !== 'water'; }
export function siteHex(g: GameState, c: Tile, i: number): CityHex | null {
  const h = cityLayout(g, c).byIndex.get(i); return h && !h.keep ? h : null;
}
function openFor(g: GameState, c: Tile, i: number, b: Building, anyTerrain = false): boolean {
  const h = siteHex(g, c, i); return !!h && !siteUsed(c, i) && (anyTerrain || terrainFits(h.terrain, b));
}
function slotsReason(c: Tile, simple: boolean): string {
  const n = amenitySlots(c, simple), level = cityLevel(c);
  return !simple && n < MAX_AMENITIES
    ? `Room for ${n} amenities: one more at ${level >= MAX_LEVEL ? LEVEL_NAMES[MAX_LEVEL - 1] : LEVEL_NAMES[level]}`
    : `Room for ${n} amenities, all used`;
}
export const siteFits = (g: GameState, c: Tile, i: number, b: Building, simple = false): boolean =>
  freeSlots(c, simple) > 0 && openFor(g, c, i, b);
export function siteReason(g: GameState, c: Tile, i: number, b: Building, simple = false): string {
  const h = cityLayout(g, c).byIndex.get(i);
  if (!h) return "That hex isn't part of this city";
  if (h.keep) return 'The Keep stands here';
  if (siteUsed(c, i)) return 'Something is already built here';
  if (!terrainFits(h.terrain, b)) return BUILDINGS[b].plot ? `Needs a ${BUILDINGS[b].plot} hex` : "Can't build on water";
  return freeSlots(c, simple) === 0 ? slotsReason(c, simple) : '';
}
export function noSiteReason(g: GameState, c: Tile, b: Building, simple = false): string {
  if (bestSite(g, c, b, simple) !== null) return '';
  if (freeSlots(c, simple) === 0) return slotsReason(c, simple);
  return BUILDINGS[b].plot ? `Needs a free ${BUILDINGS[b].plot} hex in the city's land` : "No free land hex in the city's land";
}
export const hasSiteFor = (g: GameState, c: Tile, b: Building): boolean =>
  cityLayout(g, c).hexes.some((h) => !h.keep && terrainFits(h.terrain, b));
export function nearbyWork(g: GameState, c: Tile, h: CityHex): { tile: Tile; work: Outside }[] {
  const out: { tile: Tile; work: Outside }[] = [];
  for (const t of [h.tile, ...g.map.neighbors(h.tile)]) {
    if (c.owner === null || t.owner !== c.owner) continue;
    if (t.improvement) out.push({ tile: t, work: t.improvement });
    if (t.road) out.push({ tile: t, work: 'road' });
  }
  return out;
}
const nextTo = (g: GameState, a: Tile, i: number): boolean => g.map.neighbors(a).some((n) => g.tileIndex(n) === i);
export function siteBonus(g: GameState, c: Tile, i: number, b: Building, sites: Sites = c.sites): SiteBonus {
  const out = empty(), h = cityLayout(g, c).byIndex.get(i);
  if (!h || h.keep || damaged(g, c, b)) return out;
  const name = BUILDINGS[b].name;
  for (const r of TERRAIN_BONUS) if (r.b === b && r.t === h.terrain) addTo(out, r, `${name} ${r.note}`);
  const work = nearbyWork(g, c, h);
  for (const r of WORK_BONUS) if (r.b === b && work.some((w) => w.work === r.imp)) addTo(out, r, `${name} ${r.note}`);
  for (const r of ADJACENCY) {
    if (r.b !== b || r.next !== 'keep' && damaged(g, c, r.next)) continue;
    const at = r.next === 'keep' ? g.tileIndex(c) : sites[r.next];
    if (at !== undefined && at >= 0 && at !== i && nextTo(g, h.tile, at)) addTo(out, r, `${name} ${r.note}`);
  }
  return out;
}
export function bonusSources(g: GameState, c: Tile, i: number, b: Building): number[] {
  const h = cityLayout(g, c).byIndex.get(i);
  if (!h || h.keep || damaged(g, c, b)) return [];
  const out = new Set<number>();
  for (const w of nearbyWork(g, c, h)) if (WORK_BONUS.some((r) => r.b === b && r.imp === w.work)) out.add(g.tileIndex(w.tile));
  for (const r of ADJACENCY) {
    if (r.b !== b || r.next !== 'keep' && damaged(g, c, r.next)) continue;
    const at = r.next === 'keep' ? g.tileIndex(c) : c.sites[r.next];
    if (at !== undefined && at >= 0 && at !== i && nextTo(g, h.tile, at)) out.add(at);
  }
  out.delete(i); return [...out];
}
export function cityBonus(g: GameState, c: Tile): SiteBonus {
  const out = empty();
  if (!c.city) return out;
  for (const b of BUILDING_ORDER) {
    if (!c.buildings.includes(b)) continue;
    if (damaged(g, c, b)) {
      // The existing economy and HUD add base building stats before calling cityBonus.
      // Cancel those base stats here, and do not add placement bonuses for the damaged amenity.
      const info = BUILDINGS[b];
      out.gold -= info.gold; out.food -= info.food; out.happy -= info.happy;
      out.culture -= info.culture; out.stone -= info.stone ?? 0;
      if (info.happy) out.happyParts.push([`${info.name} pillaged`, -info.happy]);
      out.notes.push(`${info.name} pillaged: effects disabled until repaired`);
      continue;
    }
    const at = c.sites[b];
    if (at === undefined || at < 0) continue;
    const p = siteBonus(g, c, at, b);
    out.gold += p.gold; out.food += p.food; out.happy += p.happy; out.culture += p.culture;
    out.stone += p.stone; out.horses += p.horses;
    out.notes.push(...p.notes); out.happyParts.push(...p.happyParts);
  }
  return out;
}
const worth = (p: SiteBonus) => p.gold + p.food + p.happy + p.stone + p.culture * .5 + p.horses * .5;
export function siteScore(g: GameState, c: Tile, i: number, b: Building): number {
  const h = siteHex(g, c, i);
  if (!h) return -Infinity;
  let s = worth(siteBonus(g, c, i, b));
  const after: Sites = { ...c.sites, [b]: i };
  for (const nb of BUILDING_ORDER) {
    const at = c.sites[nb];
    if (nb === b || at === undefined || at < 0 || !nextTo(g, h.tile, at)) continue;
    s += worth(siteBonus(g, c, at, nb, after)) - worth(siteBonus(g, c, at, nb));
  }
  if (!BUILDINGS[b].plot && h.terrain === 'hills') s -= .6;
  if (!BUILDINGS[b].plot && h.terrain === 'grass' && b !== 'granary') s -= .2;
  return s - h.dist * .05;
}
export function bestSite(g: GameState, c: Tile, b: Building, simple = false, anyCount = false): number | null {
  if (!anyCount && freeSlots(c, simple) === 0) return null;
  let best: number | null = null, score = -Infinity;
  for (const h of cityLayout(g, c).hexes) {
    if (h.keep || !openFor(g, c, h.index, b)) continue;
    const s = siteScore(g, c, h.index, b);
    if (s > score) { score = s; best = h.index; }
  }
  return best;
}
export function describePlacement(g: GameState, c: Tile, i: number, b: Building): string {
  const h = cityLayout(g, c).byIndex.get(i);
  if (!h) return 'a spot still to be found';
  const p = siteBonus(g, c, i, b);
  return `${hexLabel(h)}${p.notes.length ? ` (${p.notes.join('; ')})` : ''}`;
}
function fallbackSite(g: GameState, c: Tile, b: Building): number | null {
  const best = bestSite(g, c, b, true, true);
  if (best !== null) return best;
  for (const h of cityLayout(g, c).hexes) if (!h.keep && !siteUsed(c, h.index)) return h.index;
  return null;
}
export function settleSites(g: GameState, c: Tile): Building[] {
  if (!c.city) return [];
  const lay = cityLayout(g, c), taken = new Set<number>(), pending: { b: Building; was: number | undefined }[] = [];
  for (const b of BUILDING_ORDER) {
    const at = c.sites[b];
    if (!c.buildings.includes(b)) { delete c.sites[b]; continue; }
    const h = at !== undefined && at >= 0 ? lay.byIndex.get(at) : undefined;
    if (h && !h.keep && !taken.has(h.index)) taken.add(h.index);
    else pending.push({ b, was: at });
  }
  if (c.project) {
    const h = c.projectSite !== null ? lay.byIndex.get(c.projectSite) : undefined;
    if (!h || h.keep || taken.has(h.index)) c.projectSite = null;
  } else c.projectSite = null;
  for (const p of pending) delete c.sites[p.b];
  const moved: Building[] = [];
  for (const p of pending) {
    const to = fallbackSite(g, c, p.b);
    c.sites[p.b] = to ?? -1;
    if (p.was !== undefined && p.was >= 0 && to !== p.was) moved.push(p.b);
  }
  if (c.project && c.projectSite === null) c.projectSite = fallbackSite(g, c, c.project);
  for (const b of BUILDING_ORDER) {
    const at = c.sites[b];
    if (at === undefined || at < 0) continue;
    const h = lay.byIndex.get(at);
    if (!h || terrainFits(h.terrain, b)) continue;
    delete c.sites[b];
    const to = bestSite(g, c, b, true, true); c.sites[b] = to ?? at;
    if (to !== null && !moved.includes(b)) moved.push(b);
  }
  return moved;
}
export function migratePlots(g: GameState, c: Tile, placed: (Building | null)[], projectPlot: number | null): void {
  c.sites = {}; c.projectSite = null;
  const dirHex = (i: number, b: Building): number | null => {
    const t = g.map.neighborAt(c, i);
    if (!t) return null;
    const at = g.tileIndex(t), h = siteHex(g, c, at);
    return h && !siteUsed(c, at) && terrainFits(h.terrain, b) ? at : null;
  };
  placed.forEach((b, i) => { if (b && c.buildings.includes(b) && c.sites[b] === undefined) { const at = dirHex(i, b); if (at !== null) c.sites[b] = at; } });
  if (c.project && projectPlot !== null && projectPlot >= 0) c.projectSite = dirHex(projectPlot, c.project);
  settleSites(g, c);
}
export const BEAUTY_STEP = 8, BEAUTY_MAX = 2;
export function cityBeauty(c: Tile): number { return c.city ? decoList(c).reduce((sum, [, , k]) => sum + (decoInfo(k)?.beauty ?? 0), 0) : 0; }
export const beautyOn = (d: Difficulty, free: boolean): boolean => d !== 'easy' && !free;
export function beautyBonus(c: Tile, d: Difficulty, free: boolean): number {
  return beautyOn(d, free) ? Math.min(BEAUTY_MAX, Math.floor(cityBeauty(c) / BEAUTY_STEP)) : 0;
}
