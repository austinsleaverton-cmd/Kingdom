// New-game presets and saved-world dimensions. No game-state or browser dependencies.
export type MapSize = 'small' | 'medium' | 'large' | 'huge';
export interface MapDimensions { width: number; height: number }

export const MAP_SIZES: Record<MapSize, MapDimensions & { label: string }> = {
  small: { label: 'Small', width: 30, height: 20 },
  medium: { label: 'Medium', width: 50, height: 35 },
  large: { label: 'Large', width: 75, height: 50 },
  huge: { label: 'Huge', width: 100, height: 70 },
};

// Saves written before explicit dimensions always used these presets. Never change these.
export const LEGACY_MAP_SIZES: Record<MapSize, MapDimensions> = {
  small: { width: 20, height: 14 },
  medium: { width: 30, height: 20 },
  large: { width: 44, height: 30 },
  huge: { width: 60, height: 40 },
};

export function validMapDimensions(value: unknown): value is MapDimensions {
  if (!value || typeof value !== 'object') return false;
  const { width, height } = value as MapDimensions;
  return Number.isInteger(width) && Number.isInteger(height) && width >= 2 && height >= 2 && width <= 200 && height <= 140;
}

// Missing dimensions mean an old save, not today's preset. Reject inconsistent data before allocating a map.
export function savedMapDimensions(size: MapSize, tileCount: number, explicit?: unknown): MapDimensions | null {
  const dims = explicit === undefined ? LEGACY_MAP_SIZES[size] : explicit;
  if (!validMapDimensions(dims) || dims.width * dims.height !== tileCount) return null;
  return { width: dims.width, height: dims.height };
}
