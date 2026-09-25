export type Point = { x: number; y: number };
export type LayoutNode = Point & { id: string; parent_id: string | null; label: string };

/** Apply a stable, presentation-only overlap pass while keeping root anchors fixed. */
export function resolveNodeCollisions<T extends LayoutNode>(nodes: T[], gap = 16) {
  const positions = new Map(nodes.map(node => [node.id, { x: node.x, y: node.y }]));
  const dimensions = new Map(nodes.map(node => {
    const width = Math.min(190, Math.max(64, node.label.length * 7.4 + 22));
    const lines = Math.max(1, Math.ceil((node.label.length * 7.4) / (width - 18)));
    const height = 64 + lines * 18;
    return [node.id, { width, height }];
  }));
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const movable = (node: T) => node.parent_id !== null;

  for (let pass = 0; pass < 160; pass++) {
    let collisions = 0;
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      const pa = positions.get(a.id)!;
      const da = dimensions.get(a.id)!;
      for (let j = i + 1; j < ordered.length; j++) {
        const b = ordered[j];
        const pb = positions.get(b.id)!;
        const db = dimensions.get(b.id)!;
        const overlapX = (da.width + db.width) / 2 + gap - Math.abs(pa.x - pb.x);
        const overlapY = (da.height + db.height) / 2 + gap - Math.abs(pa.y - pb.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const canMoveA = movable(a), canMoveB = movable(b);
        if (!canMoveA && !canMoveB) continue;
        collisions++;
        const horizontal = overlapX <= overlapY;
        const direction = horizontal
          ? (pa.x === pb.x ? (a.id < b.id ? -1 : 1) : Math.sign(pa.x - pb.x))
          : (pa.y === pb.y ? (a.id < b.id ? -1 : 1) : Math.sign(pa.y - pb.y));
        const amount = (horizontal ? overlapX : overlapY) + .5;
        const axis = horizontal ? 'x' : 'y';
        if (canMoveA && canMoveB) {
          pa[axis] += direction * amount / 2;
          pb[axis] -= direction * amount / 2;
        } else if (canMoveA) {
          pa[axis] += direction * amount;
        } else {
          pb[axis] -= direction * amount;
        }
      }
    }
    if (!collisions) break;
  }

  return nodes.map(node => ({ ...node, ...positions.get(node.id)! }));
}

export function fitGraph(nodes: Point[], width: number, height: number, center: Point, padding = 36) {
  if (!nodes.length || width <= 0 || height <= 0) return { zoom: 1, panX: 0, panY: 0 };
  const bounds = nodes.reduce((result, node) => ({
    minX: Math.min(result.minX, node.x), maxX: Math.max(result.maxX, node.x),
    minY: Math.min(result.minY, node.y), maxY: Math.max(result.maxY, node.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const graphCenter = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const graphWidth = Math.max(bounds.maxX - bounds.minX, 1) + 220;
  const graphHeight = Math.max(bounds.maxY - bounds.minY, 1) + 150;
  const zoom = Math.min(1, Math.max(1, width - padding * 2) / graphWidth, Math.max(1, height - padding * 2) / graphHeight);
  return {
    zoom,
    panX: (center.x - graphCenter.x) * zoom,
    panY: (center.y - graphCenter.y) * zoom,
  };
}

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
