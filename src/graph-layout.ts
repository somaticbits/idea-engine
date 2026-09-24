export type Point = { x: number; y: number };

function hash(value: string) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Assign a deterministic, collision-avoiding orbit around a parent. */
export function placeChildren(parentId: string, parent: Point, count: number, occupied: Point[]) {
  const rotation = (hash(parentId) / 0xffffffff) * Math.PI * 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const result: Point[] = [];
  for (let index = 0; index < count; index++) {
    let candidate: Point | undefined;
    for (let attempt = 0; attempt < 256; attempt++) {
      const angle = rotation + (index / Math.max(count, 1)) * Math.PI * 2 + attempt * goldenAngle;
      const radius = 250 + Math.floor(attempt / 12) * 155 + (hash(`${parentId}:${index}:${attempt}`) % 91);
      const point = { x: Math.round(parent.x + Math.cos(angle) * radius), y: Math.round(parent.y + Math.sin(angle) * radius) };
      if (![...occupied, ...result].some(other => distance(point, other) < 155)) { candidate = point; break; }
    }
    if (!candidate) {
      const angle = rotation + (index + result.length) * goldenAngle;
      const radius = 500 + index * 180;
      candidate = { x: Math.round(parent.x + Math.cos(angle) * radius), y: Math.round(parent.y + Math.sin(angle) * radius) };
    }
    result.push(candidate);
  }
  return result;
}

export function normalizeIdea(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
