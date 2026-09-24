<script lang="ts">
  import { onMount } from 'svelte';

  type Idea = { id: string; parent_id: string | null; label: string; expanded: number; pinned: number; x: number; y: number };
  type Link = { id: string; from_node_id: string; to_node_id: string; kind: string };
  type Props = {
    nodes: Idea[];
    connections: Link[];
    route: { nodes: string[]; cursor: number };
    currentId: string;
    loading: boolean;
    pinningIds: Set<string>;
    onVisit: (id: string) => void;
    onPin: (id: string) => void;
  };

  let { nodes, connections, route, currentId, loading, pinningIds, onVisit, onPin }: Props = $props();
  let viewport: HTMLDivElement;
  let width = $state(900);
  let height = $state(600);
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
  let dragging = $state(false);
  let pointer = { x: 0, y: 0 };
  let reducedMotion = $state(false);
  let showAllIdeas = $state(false);

  onMount(() => {
    const resize = new ResizeObserver(entries => {
      width = entries[0].contentRect.width;
      height = entries[0].contentRect.height;
    });
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = motion.matches;
    const change = () => { reducedMotion = motion.matches; };
    motion.addEventListener('change', change);
    resize.observe(viewport);
    return () => { resize.disconnect(); motion.removeEventListener('change', change); };
  });

  const centerIdea = $derived(nodes.find(node => node.id === currentId) ?? nodes[0]);
  const activeIds = $derived(new Set([...route.nodes, currentId, ...nodes.filter(node => node.pinned).map(node => node.id)]));
  const nearbyChildren = $derived(nodes.filter(node => node.parent_id === currentId));
  const visibleIds = $derived.by(() => {
    const ids = new Set(showAllIdeas ? nodes.map(node => node.id) : activeIds);
    if (!showAllIdeas) nearbyChildren.slice(0, 8).forEach(node => ids.add(node.id));
    return ids;
  });
  const visibleNodes = $derived(nodes.filter(node => visibleIds.has(node.id)));
  const hiddenCount = $derived(nodes.filter(node => !visibleIds.has(node.id)).length);
  const currentWorld = $derived(centerIdea ? { x: centerIdea.x, y: centerIdea.y } : { x: 0, y: 0 });
  const cameraStyle = $derived(`left:50%;top:50%;transform:translate(${panX - currentWorld.x * zoom}px,${panY - currentWorld.y * zoom}px) scale(${zoom});transition-duration:${reducedMotion ? '0ms' : '520ms'}`);
  const routeEdges = $derived(new Set(route.nodes.slice(0, route.cursor + 1).slice(1).flatMap((id, index) => [`${route.nodes[index]}:${id}`, `${id}:${route.nodes[index]}`])));
  const treeEdges = $derived(visibleNodes.filter(node => node.parent_id && visibleIds.has(node.parent_id)).map(node => ({
    id: `tree:${node.id}`,
    from: nodes.find(parent => parent.id === node.parent_id)!,
    to: node,
    travelled: routeEdges.has(`${node.parent_id}:${node.id}`),
    loop: false,
  })).filter(edge => edge.from));
  const loopEdges = $derived(connections.filter(link => visibleIds.has(link.from_node_id) && visibleIds.has(link.to_node_id)).map(link => ({
    id: link.id,
    from: nodes.find(node => node.id === link.from_node_id)!,
    to: nodes.find(node => node.id === link.to_node_id)!,
    travelled: routeEdges.has(`${link.from_node_id}:${link.to_node_id}`),
    loop: true,
  })).filter(edge => edge.from && edge.to));
  const edges = $derived([...treeEdges, ...loopEdges]);
  function pointerDown(event: PointerEvent) {
    if ((event.target as HTMLElement).closest('.idea-node,button')) return;
    dragging = true;
    pointer = { x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
  }

  function zoomAtPointer(event: WheelEvent) {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const x = event.clientX - rect.left - width / 2;
    const y = event.clientY - rect.top - height / 2;
    const nextZoom = Math.max(.18, Math.min(2.4, zoom * Math.exp(-event.deltaY * .0012)));
    const factor = nextZoom / zoom;
    panX = x - (x - panX) * factor;
    panY = y - (y - panY) * factor;
    zoom = nextZoom;
  }

  function zoomBy(factor: number) {
    const nextZoom = Math.max(.18, Math.min(2.4, zoom * factor));
    zoom = nextZoom;
  }

  function pointerMove(event: PointerEvent) {
    if (!dragging) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    panX += dx;
    panY += dy;
    pointer = { x: event.clientX, y: event.clientY };
  }

  function pointerUp(event: PointerEvent) {
    dragging = false;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }

  function recenter() {
    panX = 0;
    panY = 0;
  }

  function toggleGraph() {
    showAllIdeas = !showAllIdeas;
    if (!showAllIdeas || !nodes.length) {
      panX = 0;
      panY = 0;
      zoom = 1;
      return;
    }
    const bounds = nodes.reduce((result, node) => ({ minX: Math.min(result.minX, node.x), maxX: Math.max(result.maxX, node.x), minY: Math.min(result.minY, node.y), maxY: Math.max(result.maxY, node.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const { minX, maxX, minY, maxY } = bounds;
    zoom = Math.max(.3, Math.min(1, width / (maxX - minX + 300), height / (maxY - minY + 240)));
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;
    panX = (currentWorld.x - graphCenterX) * zoom;
    panY = (currentWorld.y - graphCenterY) * zoom;
  }

  $effect(() => {
    currentId;
    panX = 0;
    panY = 0;
    showAllIdeas = false;
    zoom = 1;
  });

  function edgePath(edge: (typeof edges)[number]) {
    const x1 = edge.from.x, y1 = edge.from.y, x2 = edge.to.x, y2 = edge.to.y;
    if (!edge.loop) return `M${x1},${y1} L${x2},${y2}`;
    const dx = x2 - x1, dy = y2 - y1;
    const length = Math.max(Math.hypot(dx, dy), 1);
    const bend = Math.min(170, length * .28) * (edge.from.id < edge.to.id ? 1 : -1);
    const cx = (x1 + x2) / 2 - (dy / length) * bend;
    const cy = (y1 + y2) / 2 + (dx / length) * bend;
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  }
</script>

<div class="thread-viewport" role="region" aria-label="Idea map. Drag to pan, scroll to zoom, and use idea buttons to follow connections." bind:this={viewport} class:dragging class:overview={showAllIdeas && zoom < .55} onwheel={zoomAtPointer} onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp}>
  <div class="thread-world" style={cameraStyle}>
    <svg class="thread-edges" style={`left:${-width / 2}px;top:${-height / 2}px`} width={width} height={height} viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`} aria-hidden="true">
      {#each edges as edge (edge.id)}
        <path d={edgePath(edge)} class:travelled={edge.travelled} class:loop={edge.loop} />
      {/each}
    </svg>
    {#each visibleNodes as node (node.id)}
      <div class="idea-point" style={`left:${node.x}px;top:${node.y}px`}>
        <button
          type="button"
          class="idea-node"
          class:current={node.id === currentId}
          class:visited={route.nodes.includes(node.id)}
          class:pinned={!!node.pinned}
          aria-current={node.id === currentId ? 'location' : undefined}
          aria-label={`${node.label}${node.id === currentId ? ', current idea' : ', follow this idea'}${node.pinned ? ', pinned concept' : ''}`}
          disabled={showAllIdeas && zoom < .55}
          onclick={() => onVisit(node.id)}
          onpointerdown={event => event.stopPropagation()}
        >
          <span class="idea-dot" aria-hidden="true"></span><span class="idea-label">{node.label}</span>
        </button>
        <button type="button" class="node-pin" class:saved={!!node.pinned} class:saving={pinningIds.has(node.id)} aria-label={pinningIds.has(node.id) ? `Saving ${node.label} as a concept` : node.pinned ? `View saved concept for ${node.label}` : `Pin ${node.label} as a concept`} title={pinningIds.has(node.id) ? 'Saving concept…' : node.pinned ? 'View saved concept' : 'Pin this idea without following it'} disabled={pinningIds.has(node.id)} onclick={() => onPin(node.id)} onpointerdown={event => event.stopPropagation()}>
        {#if pinningIds.has(node.id)}<span class="pin-spinner" aria-hidden="true"></span>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1.2 5.1 3.2 3.2v1.2H6v-1.2l3.2-3.2L8 3Zm4 9.5V21"/></svg>{/if}
        </button>
      </div>
    {/each}
    {#if loading}
      <div class="idea-loading-ring" style={`left:${centerIdea?.x ?? 0}px;top:${centerIdea?.y ?? 0}px`} role="status" aria-label="Generating ideas from the current node">
        <span class="loading-ring ring-one" aria-hidden="true"></span><span class="loading-ring ring-two" aria-hidden="true"></span><span class="loading-ring ring-three" aria-hidden="true"></span>
      </div>
    {/if}
  </div>

  <div class="canvas-hint">{showAllIdeas ? 'Zoom in to read names · drag to wander' : 'Drag to pan · scroll to zoom · tap an idea to follow'}</div>
  <button type="button" class="graph-toggle" aria-pressed={showAllIdeas} onclick={toggleGraph}>{showAllIdeas ? 'Focus path' : `Show full graph${hiddenCount ? ` · ${hiddenCount} hidden` : ''}`}</button>
  <div class="map-controls" role="group" aria-label="Map controls">
    <button type="button" class="zoom-button" onclick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
    <span class="zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</span>
    <button type="button" class="zoom-button" onclick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
    <button type="button" class="recenter-button" onclick={recenter} aria-label="Center the current idea" title="Center current idea">◎</button>
  </div>
</div>
