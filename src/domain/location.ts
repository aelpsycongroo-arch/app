import type { Block, Floor } from './types';

/** Unique storage-location code combining block and floor, e.g. "A-F2". */
export function locationCode(block: Pick<Block, 'code'>, floor: Pick<Floor, 'level'>): string {
  return `${block.code}-F${floor.level}`;
}

export function floorLabel(floor: Floor): string {
  const def = `Floor ${floor.level}`;
  return floor.name && floor.name !== def ? `${def} (${floor.name})` : def;
}

export function findFloor(blocks: Block[], blockId: string, floorId: string) {
  const block = blocks.find((b) => b.id === blockId);
  const floor = block?.floors.find((f) => f.id === floorId);
  return { block, floor };
}

export function sortFloors(floors: Floor[]): Floor[] {
  return [...floors].sort((a, b) => a.level - b.level);
}
