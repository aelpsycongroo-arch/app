export function formatDistance(cells: number, cellSizeMeters: number): string {
  const m = cells * cellSizeMeters;
  return `${m % 1 === 0 ? m : m.toFixed(1)} m`;
}
