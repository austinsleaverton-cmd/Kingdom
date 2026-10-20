// City View rules: amenities stand on the hexes of the city's own territory (the land and water it owns on the
// map), one amenity per hex and never on the Keep's hex. Building one never touches the hex's farm, mine, road or
// fishery: both stand there and both keep working. The hex's terrain, the improvements on and around it, and the
// amenities next to it give bonuses. Pure functions: no Phaser. See docs/CITY_BUILDER.md.
// Also the beauty bonus from decorations (task 7).
import type { Difficulty, GameState } from './game';
import { decoInfo, decoList } from './deco';
import { cityLayout, hexLabel } from './grid';
import type { CityHex } from './grid';
import { AMENITY_SLOTS, BUILDINGS, BUILDING_ORDER, LEVEL_NAMES, MAX_AMENITIES, MAX_LEVEL, cityLevel } from './tile';
import type { Building, Improvement, PlotTerrain, Tile } from './tile';

// What a placement adds on top of the amenity's normal stats
export interface SiteBonus {
  gold: number;
  food: number;
  happy: number;
  culture: number;
  stone: number;
  horses: number; // room for more Knights
  notes: string[]; // "+1 gold: Market next to the Harbor"
  happyParts: [string, number][]; // for the happiness breakdown
}

type Amounts = { gold?: number; food?: number; happy?: number; culture?: number; stone?: number; horses?: number };

// Terrain bonuses: the amenity on this kind of hex
export const TERRAIN_BONUS: (Amounts & { b: Building; t: PlotTerrain; note: string })[] = [
  { b: 'granary', t: 'grass', food: 1, note: 'on grass' },
];

// Work bonuses: an improvement or road on the amenity's hex or a hex next to it, on the city owner's land.
// Live: pillage the mine and the Workshop loses its bonus until it's rebuilt. Counts once, however many there are.
export type Outside = Improvement | 'road';
export const WORK_BONUS: (Amounts & { b: Building; imp: Outside; note: string })[] = [
  { b: 'workshop', imp: 'mine', stone: 1, note: 'next to a mine' },
  { b: 'mill', imp: 'farm', food: 1, note: 'next to a farm' },
  { b: 'barracks', imp: 'pasture', horses: 1, note: 'next to a pasture' },
  { b: 'harbor', imp: 'fishery', food: 1, note: 'next to a fishery' },
  { b: 'park', imp: 'forest', culture: 1, note: 'next to a forest' },
  { b: 'market', imp: 'road', gold: 1, note: 'next to a road' },
];

// Neighbor bonuses: the amenity on a hex next to another one (or next to the Keep). The bonus goes to the first one.
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

export function bonusAmount(a: Amounts): string {
  return amountText(a);
}

function addTo(out: SiteBonus, a: Amounts, label: string): void {
  out.gold += a.gold ?? 0;
  out.food += a.food ?? 0;
  out.happy += a.happy ?? 0;
  out.culture += a.culture ?? 0;
  out.stone += a.stone ?? 0;
  out.horses += a.horses ?? 0;
  out.notes.push(`${amountText(a)}: ${label}`);
  if (a.happy) out.happyParts.push([label, a.happy]);
}

// ---------- where amenities stand ----------

export type Sites = Partial<Record<Building, number>>;

// The hex (map tile index) a finished amenity stands on, -1 while it waits for a spot, null if it isn't built
export function siteOf(city: Tile, b: Building): number | null {
  const s = city.sites[b];
  return s === undefined ? null : s;
}

// The finished amenity on a hex
export function amenityAt(city: Tile, index: number): Building | null {
  for (const b of BUILDING_ORDER) if (city.sites[b] === index) return b;
  return null;
}

// Something stands on the hex, or is going up there
export function siteUsed(city: Tile, index: number): boolean {
  return amenityAt(city, index) !== null || city.projectSite === index;
}

// Amenities the city has room for at its size (easy rules: all of them)
export function amenitySlots(city: Tile, simple = false): number {
  if (simple) return MAX_AMENITIES;
  return AMENITY_SLOTS[Math.min(AMENITY_SLOTS.length, cityLevel(city)) - 1];
}

export function amenitiesUsed(city: Tile): number {
  return city.buildings.length + (city.project ? 1 : 0);
}

export function freeSlots(city: Tile, simple = false): number {
  return Math.max(0, amenitySlots(city, simple) - amenitiesUsed(city));
}

export function terrainFits(t: PlotTerrain, b: Building): boolean {
  const need = BUILDINGS[b].plot;
  return need ? t === need : t !== 'water';
}

// One of the city's hexes an amenity could stand on (not the Keep's), or null
export function siteHex(state: GameState, city: Tile, index: number): CityHex | null {
  const h = cityLayout(state, city).byIndex.get(index);
  return h && !h.keep ? h : null;
}

function openFor(state: GameState, city: Tile, index: number, b: Building, anyTerrain = false): boolean {
  const h = siteHex(state, city, index);
  return !!h && !siteUsed(city, index) && (anyTerrain || terrainFits(h.terrain, b));
}

function nextLevelName(city: Tile): string {
  const lvl = cityLevel(city);
  return lvl >= MAX_LEVEL ? LEVEL_NAMES[MAX_LEVEL - 1] : LEVEL_NAMES[lvl];
}

function slotsReason(city: Tile, simple: boolean): string {
  const n = amenitySlots(city, simple);
  if (!simple && n < MAX_AMENITIES) return `Room for ${n} amenities: one more at ${nextLevelName(city)}`;
  return `Room for ${n} amenities, all used`;
}

// Can amenity b go on hex `index` right now (open hex, right terrain, room for one more)?
export function siteFits(state: GameState, city: Tile, index: number, b: Building, simple = false): boolean {
  return freeSlots(city, simple) > 0 && openFor(state, city, index, b);
}

// Why amenity b can't go on hex `index` (empty when it can)
export function siteReason(state: GameState, city: Tile, index: number, b: Building, simple = false): string {
  const h = cityLayout(state, city).byIndex.get(index);
  if (!h) return "That hex isn't part of this city";
  if (h.keep) return 'The Keep stands here';
  if (siteUsed(city, index)) return 'Something is already built here';
  if (!terrainFits(h.terrain, b)) {
    const need = BUILDINGS[b].plot;
    return need ? `Needs a ${need} hex` : "Can't build on water";
  }
  if (freeSlots(city, simple) === 0) return slotsReason(city, simple);
  return '';
}

// Why amenity b has nowhere to go (empty when there is a spot)
export function noSiteReason(state: GameState, city: Tile, b: Building, simple = false): string {
  if (bestSite(state, city, b, simple) !== null) return '';
  if (freeSlots(city, simple) === 0) return slotsReason(city, simple);
  const need = BUILDINGS[b].plot;
  return need ? `Needs a free ${need} hex in the city's land` : "No free land hex in the city's land";
}

// Does the city's land have any hex this amenity could ever stand on? (no water: no Harbor, no hills: no Workshop)
export function hasSiteFor(state: GameState, city: Tile, b: Building): boolean {
  return cityLayout(state, city).hexes.some((h) => !h.keep && terrainFits(h.terrain, b));
}

// ---------- bonuses ----------

// The improvements and roads on hex h or next to it that count for the city: on the city owner's land
export function nearbyWork(state: GameState, city: Tile, h: CityHex): { tile: Tile; work: Outside }[] {
  const out: { tile: Tile; work: Outside }[] = [];
  for (const t of [h.tile, ...state.map.neighbors(h.tile)]) {
    if (city.owner === null || t.owner !== city.owner) continue;
    if (t.improvement) out.push({ tile: t, work: t.improvement });
    if (t.road) out.push({ tile: t, work: 'road' });
  }
  return out;
}

function nextTo(state: GameState, a: Tile, index: number): boolean {
  return state.map.neighbors(a).some((n) => state.tileIndex(n) === index);
}

// Bonus for amenity b standing on hex `index`, given where everything else stands (sites)
export function siteBonus(state: GameState, city: Tile, index: number, b: Building, sites: Sites = city.sites): SiteBonus {
  const out = empty();
  const h = cityLayout(state, city).byIndex.get(index);
  if (!h || h.keep) return out;
  const name = BUILDINGS[b].name;
  for (const r of TERRAIN_BONUS) if (r.b === b && r.t === h.terrain) addTo(out, r, `${name} ${r.note}`);
  const work = nearbyWork(state, city, h);
  for (const r of WORK_BONUS) if (r.b === b && work.some((w) => w.work === r.imp)) addTo(out, r, `${name} ${r.note}`);
  for (const r of ADJACENCY) {
    if (r.b !== b) continue;
    const at = r.next === 'keep' ? state.tileIndex(city) : sites[r.next];
    if (at !== undefined && at >= 0 && at !== index && nextTo(state, h.tile, at)) addTo(out, r, `${name} ${r.note}`);
  }
  return out;
}

// The hexes paying amenity b its bonuses on hex `index` (for drawing who helps whom)
export function bonusSources(state: GameState, city: Tile, index: number, b: Building): number[] {
  const h = cityLayout(state, city).byIndex.get(index);
  if (!h || h.keep) return [];
  const out = new Set<number>();
  for (const w of nearbyWork(state, city, h)) {
    if (WORK_BONUS.some((r) => r.b === b && r.imp === w.work)) out.add(state.tileIndex(w.tile));
  }
  for (const r of ADJACENCY) {
    if (r.b !== b) continue;
    const at = r.next === 'keep' ? state.tileIndex(city) : city.sites[r.next];
    if (at !== undefined && at >= 0 && at !== index && nextTo(state, h.tile, at)) out.add(at);
  }
  out.delete(index);
  return [...out];
}

// Every placement bonus in the city added up (amenities waiting for a spot get none)
export function cityBonus(state: GameState, city: Tile): SiteBonus {
  const out = empty();
  if (!city.city) return out;
  for (const b of BUILDING_ORDER) {
    const at = city.sites[b];
    if (at === undefined || at < 0 || !city.buildings.includes(b)) continue;
    const pb = siteBonus(state, city, at, b);
    out.gold += pb.gold;
    out.food += pb.food;
    out.happy += pb.happy;
    out.culture += pb.culture;
    out.stone += pb.stone;
    out.horses += pb.horses;
    out.notes.push(...pb.notes);
    out.happyParts.push(...pb.happyParts);
  }
  return out;
}

const worth = (p: SiteBonus) => p.gold + p.food + p.happy + p.stone + p.culture * 0.5 + p.horses * 0.5;

// How good hex `index` is for amenity b: its own bonus, plus what it adds to the amenities next to it, minus a little
// for using up a special hex another amenity needs (hills for a Workshop, grass for a Mill) and for building far out
export function siteScore(state: GameState, city: Tile, index: number, b: Building): number {
  const h = siteHex(state, city, index);
  if (!h) return -Infinity;
  let s = worth(siteBonus(state, city, index, b));
  const after: Sites = { ...city.sites, [b]: index };
  for (const nb of BUILDING_ORDER) {
    const at = city.sites[nb];
    if (nb === b || at === undefined || at < 0 || !nextTo(state, h.tile, at)) continue;
    s += worth(siteBonus(state, city, at, nb, after)) - worth(siteBonus(state, city, at, nb));
  }
  if (!BUILDINGS[b].plot && h.terrain === 'hills') s -= 0.6;
  if (!BUILDINGS[b].plot && h.terrain === 'grass' && b !== 'granary') s -= 0.2;
  return s - h.dist * 0.05;
}

// The best open hex for amenity b (null = nowhere to put it). anyCount ignores the city's amenity limit.
// Ties go to the hex nearest the Keep.
export function bestSite(state: GameState, city: Tile, b: Building, simple = false, anyCount = false): number | null {
  if (!anyCount && freeSlots(city, simple) === 0) return null;
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const h of cityLayout(state, city).hexes) {
    if (h.keep || !openFor(state, city, h.index, b)) continue;
    const s = siteScore(state, city, h.index, b);
    if (s > bestScore) {
      bestScore = s;
      best = h.index;
    }
  }
  return best;
}

// "the grass hex 1 east of the Keep (+1 gold: Market next to the Harbor)"
export function describePlacement(state: GameState, city: Tile, index: number, b: Building): string {
  const h = cityLayout(state, city).byIndex.get(index);
  if (!h) return 'a spot still to be found';
  const pb = siteBonus(state, city, index, b);
  return `${hexLabel(h)}${pb.notes.length ? ` (${pb.notes.join('; ')})` : ''}`;
}

// ---------- keeping amenities on the city's land ----------

// Where an amenity goes when its spot is gone: the best hex it fits, else any free hex (it's grandfathered there).
// Ignores the amenity limit: it's already built.
function fallbackSite(state: GameState, city: Tile, b: Building): number | null {
  const best = bestSite(state, city, b, true, true);
  if (best !== null) return best;
  for (const h of cityLayout(state, city).hexes) if (!h.keep && !siteUsed(city, h.index)) return h.index;
  return null;
}

// Make sure every finished amenity stands on its own hex of the city's land (and the one under construction has a
// reserved hex). Anything whose hex left the city, or that was waiting, gets the best free hex; with no free hex
// it keeps waiting (-1) and still works. Never removes an amenity. Returns the ones that had to move.
// An amenity standing on the wrong kind of hex (a Harbor on land: an old save, a builder raised its water, or it
// was grandfathered onto any free hex) moves to a hex it fits as soon as one is free. Until then it stays put.
export function settleSites(state: GameState, city: Tile): Building[] {
  if (!city.city) return [];
  const lay = cityLayout(state, city);
  const taken = new Set<number>();
  const pending: { b: Building; was: number | undefined }[] = [];
  for (const b of BUILDING_ORDER) {
    const at = city.sites[b];
    if (!city.buildings.includes(b)) {
      delete city.sites[b];
      continue;
    }
    const h = at !== undefined && at >= 0 ? lay.byIndex.get(at) : undefined;
    if (h && !h.keep && !taken.has(h.index)) taken.add(h.index);
    else pending.push({ b, was: at });
  }
  if (city.project) {
    const at = city.projectSite;
    const h = at !== null ? lay.byIndex.get(at) : undefined;
    if (!h || h.keep || taken.has(h.index)) city.projectSite = null;
  } else city.projectSite = null;
  for (const p of pending) delete city.sites[p.b];
  const moved: Building[] = [];
  for (const p of pending) {
    const to = fallbackSite(state, city, p.b);
    city.sites[p.b] = to ?? -1;
    if (p.was !== undefined && p.was >= 0 && to !== p.was) moved.push(p.b);
  }
  if (city.project && city.projectSite === null) city.projectSite = fallbackSite(state, city, city.project);
  for (const b of BUILDING_ORDER) {
    const at = city.sites[b];
    if (at === undefined || at < 0) continue;
    const h = lay.byIndex.get(at);
    if (!h || terrainFits(h.terrain, b)) continue;
    delete city.sites[b]; // free its hex so the search can't count it as taken
    const to = bestSite(state, city, b, true, true);
    city.sites[b] = to ?? at;
    if (to !== null && !moved.includes(b)) moved.push(b);
  }
  return moved;
}

// Old saves (six plots around the Keep): plot i faced the map hex in direction i, so the amenity on it moves onto
// that hex when the city owns it and the amenity fits there (no Harbor on land). Anything else gets the best free
// hex (settleSites). Nothing is dropped.
export function migratePlots(state: GameState, city: Tile, placed: (Building | null)[], projectPlot: number | null): void {
  city.sites = {};
  city.projectSite = null;
  const dirHex = (i: number, b: Building): number | null => {
    const t = state.map.neighborAt(city, i);
    if (!t) return null;
    const at = state.tileIndex(t);
    const h = siteHex(state, city, at);
    return h && !siteUsed(city, at) && terrainFits(h.terrain, b) ? at : null;
  };
  placed.forEach((b, i) => {
    if (!b || !city.buildings.includes(b) || city.sites[b] !== undefined) return;
    const at = dirHex(i, b);
    if (at !== null) city.sites[b] = at;
  });
  if (city.project && projectPlot !== null && projectPlot >= 0) city.projectSite = dirHex(projectPlot, city.project);
  settleSites(state, city);
}

// ---------- beauty (City Builder task 7) ----------
// Decorations make a city nicer to live in: every BEAUTY_STEP beauty is +1 happy, up to BEAUTY_MAX.
// Normal and Hard only: on Easy and Free Play decorations are just for looks. Most decorations are 1 beauty,
// a Statue 2, a Fountain 3; paths and grass count 0 (beauty in DECOS, world/deco.ts). No AI decorates, but a
// captured city keeps its decorations and their beauty.
export const BEAUTY_STEP = 8;
export const BEAUTY_MAX = 2;

export function cityBeauty(city: Tile): number {
  if (!city.city) return 0;
  return decoList(city).reduce((s, [, , k]) => s + (decoInfo(k)?.beauty ?? 0), 0);
}

// Does beauty count in this game for this player? (free = Free Play for that player)
export function beautyOn(difficulty: Difficulty, free: boolean): boolean {
  return difficulty !== 'easy' && !free;
}

export function beautyBonus(city: Tile, difficulty: Difficulty, free: boolean): number {
  if (!beautyOn(difficulty, free)) return 0;
  return Math.min(BEAUTY_MAX, Math.floor(cityBeauty(city) / BEAUTY_STEP));
}
