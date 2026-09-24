<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  type BranchNode = { id: string; label: string; expanded: number; pinned: number };
  type Props = {
    focus: BranchNode;
    children: BranchNode[];
    onSelect: (id: string) => void;
  };

  let { focus, children, onSelect }: Props = $props();
  let shell: HTMLDivElement;
  let compact = $state(false);
  let orbiting = $state(false);
  let reducedMotion = $state(false);
  let traveling = $state<{ x: number; y: number; number: number } | null>(null);
  let orbitTimer: ReturnType<typeof setTimeout>;
  let travelTimer: ReturnType<typeof setTimeout>;

  onMount(() => {
    const observer = new ResizeObserver(entries => { compact = entries[0].contentRect.width < 620; });
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = motion.matches;
    const updateMotion = () => { reducedMotion = motion.matches; };
    motion.addEventListener('change', updateMotion);
    observer.observe(shell);
    return () => { observer.disconnect(); motion.removeEventListener('change', updateMotion); clearTimeout(orbitTimer); clearTimeout(travelTimer); };
  });

  const width = $derived(compact ? 390 : 900);
  const height = $derived(compact ? 430 : 620);
  const center = $derived({ x: width / 2, y: height / 2 });
  const positions = $derived(children.map((child, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(children.length, 1);
    const rx = compact ? 132 : 318;
    const ry = compact ? 157 : 218;
    return { child, x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry, angle };
  }));

  function choose(id: string) {
    const origin = positions.find(position => position.child.id === id);
    const index = positions.findIndex(position => position.child.id === id);
    traveling = origin && !reducedMotion ? { x: origin.x, y: origin.y, number: index + 1 } : null;
    clearTimeout(travelTimer);
    if (traveling) travelTimer = setTimeout(() => { traveling = null; }, 460);
    orbiting = true;
    clearTimeout(orbitTimer);
    orbitTimer = setTimeout(() => { orbiting = false; }, 520);
    onSelect(id);
  }

  function keyChoose(event: KeyboardEvent, id: string) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(id); }
  }
</script>

<div class="orbit-map" bind:this={shell}>
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Branch orbit around ${focus.label}; choose any of ${children.length} surrounding branches to move there`}>
    <defs>
      <pattern id="orbit-register" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="currentColor" /></pattern>
      <filter id="orbit-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#12292b" flood-opacity=".16" /></filter>
    </defs>
    <rect width={width} height={height} fill="url(#orbit-register)" class="register" />
    <circle class="orbit-guide" cx={center.x} cy={center.y} rx={compact ? 132 : 318} ry={compact ? 157 : 218} />

    {#each positions as position, index (position.child.id)}
      <g class="orbit-branch" class:pinned={!!position.child.pinned} in:fade={{ duration: reducedMotion ? 0 : 240 }}>
        <line class="orbit-wire" x1={center.x} y1={center.y} x2={position.x} y2={position.y} />
        <g
          class:pinned={!!position.child.pinned}
          class="branch-weight"
          role="button"
          tabindex="0"
          aria-label={`Move to branch ${index + 1}: ${position.child.label}${position.child.pinned ? ', pinned' : ''}${position.child.expanded ? ', explored' : ''}`}
          onclick={() => choose(position.child.id)}
          onkeydown={event => keyChoose(event, position.child.id)}
        >
          <circle class="hit-target" cx={position.x} cy={position.y} r={compact ? 27 : 30} />
          <circle class="weight" cx={position.x} cy={position.y} r={compact ? 19 : 23} filter="url(#orbit-shadow)" />
          <text x={position.x} y={position.y + 5} text-anchor="middle">{index + 1}</text>
          {#if position.child.pinned}<circle class="pin-mark" cx={position.x + 16} cy={position.y - 16} r="4" />{/if}
        </g>
      </g>
    {/each}

    {#if traveling}
      <g class="traveling-weight" transform={`translate(${traveling.x} ${traveling.y})`} aria-hidden="true">
        <animateTransform attributeName="transform" type="translate" from={`${traveling.x} ${traveling.y}`} to={`${center.x} ${center.y}`} dur="420ms" fill="freeze" />
        <circle class="travel-disc" r={compact ? 19 : 23} filter="url(#orbit-shadow)" />
        <text y="5" text-anchor="middle">{traveling.number}</text>
      </g>
    {/if}

    <g class="center-weight" class:landing={orbiting}>
      <circle class="center-halo" cx={center.x} cy={center.y} r={compact ? 45 : 60} />
      <circle class="center-disc" cx={center.x} cy={center.y} r={compact ? 35 : 47} filter="url(#orbit-shadow)" />
      <circle class="center-core" cx={center.x} cy={center.y} r="5" />
    </g>
    {#if !children.length}<text class="empty-map-label" x={center.x} y={center.y + (compact ? 78 : 94)} text-anchor="middle">{focus.expanded ? 'No new branches here' : 'Explore from this center'}</text>{/if}
  </svg>
  <div class="orbit-legend"><span><i class="legend-center"></i> Your current center</span>{#if children.length}<span><i class="legend-branch"></i> Tap a branch to move there</span>{:else}<span><i class="legend-branch"></i> Explore to create branches</span>{/if}{#if children.some(child => child.pinned)}<span><i class="legend-pinned"></i> Pinned idea</span>{/if}</div>
</div>

<style>
  .orbit-map{min-width:0;width:100%;color:#9caca7}.orbit-map svg{display:block;width:100%;height:auto;overflow:visible}.register{opacity:.33}.orbit-guide{fill:none;stroke:#a8beb5;stroke-width:1;stroke-dasharray:2 8;vector-effect:non-scaling-stroke}.orbit-wire{stroke:#728c83;stroke-width:1.15;opacity:.78;vector-effect:non-scaling-stroke}.branch-weight{cursor:pointer;outline:none}.hit-target{fill:transparent}.weight{fill:#e7efeb;stroke:#597672;stroke-width:1.6;transition:fill .24s ease,stroke .24s ease,transform .42s cubic-bezier(.16,1,.3,1)}.branch-weight text,.traveling-weight text{font:700 17px 'Atkinson Hyperlegible',sans-serif;fill:#203f40;pointer-events:none}.pinned .weight{fill:#568577;stroke:#1f5148}.pinned text{fill:#fffdf7}.pin-mark{fill:#d39a56;stroke:#f3f3e8;stroke-width:2}.branch-weight:hover .weight,.branch-weight:focus-visible .weight{stroke:#a75432;stroke-width:3;transform:scale(1.12);transform-box:fill-box;transform-origin:center}.branch-weight:focus-visible .hit-target{stroke:#1a5150;stroke-width:2}.travel-disc{fill:#bf663e;stroke:#753922;stroke-width:2}.traveling-weight text{fill:#fff9ef}.center-halo{fill:none;stroke:#a1b9b3;stroke-width:1.1}.center-disc{fill:#173638;stroke:#071f21;stroke-width:1.6}.center-core{fill:#cb925c}.landing .center-disc{animation:center-land 420ms cubic-bezier(.16,1,.3,1);stroke:#bf663e;stroke-width:3;transform-box:fill-box;transform-origin:center}@keyframes center-land{0%{transform:scale(.72)}65%{transform:scale(1.08)}100%{transform:scale(1)}}.empty-map-label{font:400 18px 'Atkinson Hyperlegible',sans-serif;fill:#516965}.orbit-legend{display:flex;justify-content:center;flex-wrap:wrap;gap:12px 22px;padding:0 12px 17px;color:#455f59;font-size:.8rem}.orbit-legend span{display:flex;align-items:center;gap:7px}.orbit-legend i{display:block;width:10px;height:10px;border-radius:50%;border:1px solid #567873}.legend-center{background:#173638}.legend-branch{background:#e7efeb}.legend-pinned{background:#568577}@media(max-width:750px){.orbit-legend{gap:8px 14px;font-size:.72rem}.orbit-legend span:last-child{display:none}}@media(prefers-reduced-motion:reduce){.weight,.orbit-wire,.landing .center-disc{transition:none;animation:none}}
</style>
