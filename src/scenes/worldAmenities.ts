// World-map buildings use the SAME saved site indices and Kenney art as City View.
// Read-only rendering: no placement, migration, economy or save writes.
import type Phaser from 'phaser';
import type { GameState } from '../world/game';
import type { Tile } from '../world/tile';
import { BUILDINGS } from '../world/tile';
import { damaged } from '../world/raidState';
import { ART, BUILDING_ART, SHEET_KEY, canDraw } from './cityArt';
import { MapScene } from './MapScene';

interface MapSurface extends Phaser.Scene {
  drawUnits(state: GameState): void;
  tilePanel(state: GameState, tile: Tile): { title: string; sections: { lines?: string[] }[] };
  seen(tile: Tile): boolean;
  sees(tile: Tile): boolean;
}
interface Marker {
  root: Phaser.GameObjects.Container;
  signature: string;
}
const pools = new WeakMap<MapSurface, Map<string, Marker>>();
const SCALE = 0.46; // About 20% smaller than the initial world-map buildings; City View is unchanged.
let installed = false;

export function installWorldAmenities(): void {
  if (installed) return;
  installed = true;
  const proto = MapScene.prototype as unknown as MapSurface;
  const draw = proto.drawUnits;
  proto.drawUnits = function(state) {
    draw.call(this, state);
    let pool = pools.get(this);
    if (!pool) { pool = new Map(); pools.set(this, pool); }
    for (const marker of pool.values()) marker.root.setVisible(false);
    for (const city of state.cities()) for (const building of city.buildings) {
      const index = city.sites[building];
      if (index === undefined || index < 0) continue;
      const tile = state.map.tiles[index];
      // Ignore waiting/stale sites rather than drawing a building in another city's territory.
      if (!tile || tile.city || tile.owner !== city.owner || tile.home !== state.tileIndex(city) || !this.seen(tile)) continue;
      const key = `${state.tileIndex(city)}:${building}`;
      const art = BUILDING_ART[building];
      const cells = [...art.cells, ...art.props];
      const available = canDraw(this, cells);
      const broken = damaged(state, city, building);
      const signature = `${building}/${available}/${broken}`;
      let marker = pool.get(key);
      if (!marker || !marker.root.active) {
        // Above terrain/workers, below fog, troops and selection. No input hitbox: hex selection stays unchanged.
        marker = { root: this.add.container(0, 0).setDepth(1.4), signature: '' };
        pool.set(key, marker);
      }
      if (marker.signature !== signature) {
        marker.root.removeAll(true);
        if (available) {
          for (const cell of cells) {
            const image = this.add.image(
              (cell.x + 0.5 - 1.5) * ART * SCALE,
              (cell.y + 0.5 - 1.5) * ART * SCALE,
              SHEET_KEY[cell.s], cell.f,
            ).setScale(SCALE);
            if (broken) image.setTint(0x999999);
            marker.root.add(image);
          }
        } else {
          marker.root.add(this.add.text(0, -2, BUILDINGS[building].icon, {
            fontFamily: 'system-ui, sans-serif', fontSize: '16px',
          }).setOrigin(0.5));
        }
        // Smaller labels sit closer to the building so neighboring amenities have more breathing room.
        marker.root.add(this.add.text(0, 14, `${BUILDINGS[building].name}${broken ? ' (pillaged)' : ''}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: '7px', color: broken ? '#fecaca' : '#ffffff',
          backgroundColor: '#18202bdd', padding: { x: 2, y: 1 },
        }).setOrigin(0.5));
        marker.signature = signature;
      }
      marker.root.setPosition(28 * Math.sqrt(3) * (tile.col + 0.5 * (tile.row & 1)), 42 * tile.row);
      marker.root.setVisible(true);
    }
    // Reuse markers on ordinary redraws; discard ones belonging to removed cities or changed buildings.
    const live = new Set(state.cities().flatMap((city) => city.buildings.map((b) => `${state.tileIndex(city)}:${b}`)));
    for (const [key, marker] of pool) if (!live.has(key)) { marker.root.destroy(); pool.delete(key); }
  };
  const panel = proto.tilePanel;
  proto.tilePanel = function(state, tile) {
    const model = panel.call(this, state, tile);
    if (!this.seen(tile)) return model;
    const home = state.homeCity(tile);
    const building = home?.buildings.find((b) => home.sites[b] === state.tileIndex(tile));
    if (home && building) {
      model.title = `${BUILDINGS[building].name}${damaged(state, home, building) ? ' (pillaged)' : ''}`;
      model.sections.unshift({ lines: [
        `${state.cityName(home)}'s ${BUILDINGS[building].name}, on this territory hex.`,
        damaged(state, home, building) ? 'Effects disabled until repaired.' : BUILDINGS[building].note,
        tile.improvement || tile.road ? 'The improvement and road on this hex remain separate from the amenity.' : '',
      ].filter(Boolean) });
    }
    return model;
  };
}
