<script lang="ts">
  import { onMount } from 'svelte';
  import ThreadCanvas from './ThreadCanvas.svelte';

  type Node = { id: string; trip_id: string; parent_id: string | null; label: string; expanded: number; pinned: number; x: number; y: number };
  type Trip = { id: string; seed: string; dose: string; created_at: string; kit: string };
  type Card = { id: string; node_id: string; pitch: string; chain: string; stack: string; prototype: string; wildcard: string };
  type Connection = { id: string; from_node_id: string; to_node_id: string; kind: string };
  type Route = { nodes: string[]; cursor: number };
  type Theme = 'light' | 'dark';
  type Setup = { status: 'none' | 'set' | 'managed'; masked: string | null };
  type Action = 'expand' | 'pin';

  let setup = $state<Setup>({ status: 'none', masked: null });
  let seed = $state('');
  let dose = $state<'low' | 'medium' | 'high'>('medium');
  let key = $state('');
  let kitText = $state('');
  let trips = $state<Trip[]>([]);
  let current = $state<Trip | null>(null);
  let nodes = $state<Node[]>([]);
  let connections = $state<Connection[]>([]);
  let cards = $state<Card[]>([]);
  let route = $state<Route>({ nodes: [], cursor: 0 });
  let showFullPath = $state(false);
  let focusId = $state('');
  let selectedId = $state('');
  let busy = $state('');
  let loadingId = $state('');
  let loadingNote = $state('');
  let loadingNoteTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingNoteCycle: ReturnType<typeof setInterval> | undefined;
  let failedExpansionId = $state('');
  let queuedExpansionId = '';
  let routeSaveVersion = 0;
  let routeSaveChain: Promise<unknown> = Promise.resolve();
  let error = $state('');
  let uncertain = $state<{ type: Action; id: string } | null>(null);
  let theme = $state<Theme>('light');
  let pinningIds = $state(new Set<string>());
  let spent = $state(0);
  let expansionCap = $state(200);
  let pinCap = $state(30);
  let hourlyLimit = $state(2);
  let exportText = $state('');
  let historyDialog: HTMLDialogElement;
  let settingsDialog: HTMLDialogElement;
  let cardDialog: HTMLDialogElement;

  const root = $derived(nodes.find(node => !node.parent_id) ?? null);
  const focus = $derived(nodes.find(node => node.id === focusId) ?? root);
  const selected = $derived(nodes.find(node => node.id === selectedId) ?? focus);
  const selectedCard = $derived(cards.find(card => card.node_id === selected?.id) ?? null);
  const focusCard = $derived(cards.find(card => card.node_id === focus?.id) ?? null);
  const path = $derived(route.nodes.slice(0, route.cursor + 1).map(id => nodes.find(node => node.id === id)).filter((node): node is Node => !!node));
  const nearby = $derived(nodes.filter(node => node.parent_id === focus?.id));

  async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
    return result;
  }

  async function perform(label: string, action: () => Promise<void>, operation?: { type: Action; id: string }): Promise<boolean> {
    busy = label;
    error = '';
    uncertain = null;
    try { await action(); return true; }
    catch (cause) {
      error = cause instanceof Error ? cause.message : 'Something went wrong. Try again.';
      if (operation && /uncertain outcome|aborted due to timeout|timed out|may have been billed/i.test(error)) uncertain = operation;
      return false;
    } finally { busy = ''; }
  }

  async function refresh() {
    setup = await api<Setup>('/api/setup');
    trips = await api<Trip[]>('/api/trips');
    const settings = await api<{ spend_today: number; daily_expansion_cap: number; daily_pin_cap: number; hourly_spend_limit: number }>('/api/settings');
    spent = settings.spend_today;
    expansionCap = settings.daily_expansion_cap;
    pinCap = settings.daily_pin_cap;
    hourlyLimit = settings.hourly_spend_limit;
    kitText = (await api<string[]>('/api/kit')).join(', ');
  }

  async function loadTrip(id: string, keepPlace = false) {
    const graph = await api<{ trip: Trip; nodes: Node[]; cards: Card[]; connections: Connection[]; route: Route }>(`/api/trips/${id}`);
    const savedRoute = keepPlace && current?.id === id ? route : graph.route;
    current = graph.trip;
    nodes = graph.nodes;
    connections = graph.connections;
    cards = graph.cards;
    const first = graph.nodes.find(node => !node.parent_id)?.id ?? '';
    route = savedRoute.nodes.length && savedRoute.nodes.every(nodeId => graph.nodes.some(node => node.id === nodeId))
      ? savedRoute
      : { nodes: [first], cursor: 0 };
    focusId = route.nodes[route.cursor] ?? first;
    selectedId = focusId;
    dose = graph.trip.dose === 'high' || graph.trip.dose === 'low' ? graph.trip.dose : 'medium';
    historyDialog?.close();
  }

  onMount(() => {
    const savedTheme = localStorage.getItem('idea-engine-theme');
    theme = savedTheme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    void perform('Opening your workspace…', refresh);
  });

  function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('idea-engine-theme', theme);
  }

  function selectNode(id: string) {
    visitNode(id);
  }

  function persistRoute() {
    if (!current) return;
    const tripId = current.id;
    const snapshot = { nodes: [...route.nodes], cursor: route.cursor };
    const version = ++routeSaveVersion;
    routeSaveChain = routeSaveChain.catch(() => {}).then(() => api(`/api/trips/${tripId}/route`, 'PUT', snapshot)).catch(cause => {
      if (version === routeSaveVersion) error = cause instanceof Error ? `Couldn't save this path: ${cause.message}` : 'Could not save this path.';
    });
  }

  function pathBetween(startId: string, targetId: string) {
    const previous = new Map<string, string | null>([[startId, null]]);
    const pending = [startId];
    while (pending.length) {
      const from = pending.shift()!;
      if (from === targetId) break;
      const parentId = nodes.find(node => node.id === from)?.parent_id;
      const neighbors = [
        ...nodes.filter(node => node.parent_id === from).map(node => node.id),
        ...(parentId ? [parentId] : []),
        ...connections.flatMap(link => link.from_node_id === from ? [link.to_node_id] : link.to_node_id === from ? [link.from_node_id] : []),
      ];
      for (const neighbor of neighbors) {
        if (previous.has(neighbor)) continue;
        previous.set(neighbor, from);
        pending.push(neighbor);
      }
    }
    if (!previous.has(targetId)) return null;
    const result: string[] = [];
    let cursor: string | null = targetId;
    while (cursor !== null) {
      result.unshift(cursor);
      cursor = previous.get(cursor) ?? null;
    }
    return result;
  }

  function visitNode(id: string, force = false) {
    const target = nodes.find(node => node.id === id);
    if (!target || !current) return;
    if (id === focusId && !force) return;
    const existingIndex = route.nodes.lastIndexOf(id);
    if (existingIndex >= 0) {
      route = { ...route, cursor: existingIndex };
    } else {
      const currentPath = route.nodes.slice(0, route.cursor + 1);
      const between = pathBetween(focusId, id);
      const nextNodes = [...currentPath, ...(between?.slice(1) ?? [id])];
      route = { nodes: nextNodes, cursor: nextNodes.length - 1 };
    }
    focusId = id;
    selectedId = id;
    showFullPath = false;
    failedExpansionId = '';
    exportText = '';
    persistRoute();
    if (!target.expanded) {
      if (loadingId) queuedExpansionId = id;
      else void expand(id);
    }
  }

  function ancestryFor(id: string) {
    const ancestry: string[] = [];
    let node = nodes.find(item => item.id === id);
    while (node) {
      ancestry.unshift(node.id);
      node = node.parent_id ? nodes.find(item => item.id === node!.parent_id) : undefined;
    }
    return ancestry;
  }

  function startLoadingNotes() {
    loadingNote = '';
    loadingNoteTimer = setTimeout(() => {
      const notes = ['Still following this thread…', 'Taking a little longer to find a good branch…', 'Checking that the new ideas make sense…'];
      let index = 0;
      loadingNote = notes[index];
      loadingNoteCycle = setInterval(() => { index = (index + 1) % notes.length; loadingNote = notes[index]; }, 8000);
    }, 12_000);
  }

  function clearLoadingNotes() {
    if (loadingNoteTimer) clearTimeout(loadingNoteTimer);
    if (loadingNoteCycle) clearInterval(loadingNoteCycle);
    loadingNoteTimer = undefined;
    loadingNoteCycle = undefined;
    loadingNote = '';
  }

  function startNew() {
    current = null;
    nodes = [];
    connections = [];
    cards = [];
    route = { nodes: [], cursor: 0 };
    focusId = '';
    selectedId = '';
    loadingId = '';
    clearLoadingNotes();
    failedExpansionId = '';
    queuedExpansionId = '';
    historyDialog?.close();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  async function createTrip() {
    const created = await perform('Setting the first point…', async () => {
      const graph = await api<{ trip: Trip }>('/api/trips', 'POST', { seed, dose });
      await refresh();
      await loadTrip(graph.trip.id);
      seed = '';
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    if (created && focusId) void expand(focusId);
  }

  async function expand(id: string) {
    const node = nodes.find(item => item.id === id);
    if (!node || node.expanded || loadingId) return;
    loadingId = id;
    startLoadingNotes();
    failedExpansionId = '';
    const tripId = current?.id;
    const succeeded = await perform('Following the thread…', async () => {
      const response = await fetch(`/api/nodes/${id}/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ dose }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'This branch could not be explored.');
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let complete = false;
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const type = frame.match(/^event: (.+)$/m)?.[1];
            const data = frame.match(/^data: (.+)$/m)?.[1];
            if (!data) continue;
            const message = JSON.parse(data);
            if (type === 'progress') busy = message.stage;
            if (type === 'error') throw new Error(message.error);
            if (type === 'result') complete = true;
          }
          if (done) break;
        }
        if (!complete) throw new Error('Connection closed early. Reload the trip to check whether the branches were saved.');
      }
      const graph = await api<{ trip: Trip; nodes: Node[]; cards: Card[]; connections: Connection[]; route: Route }>(`/api/trips/${tripId}`);
      if (current?.id === tripId) {
        current = graph.trip;
        nodes = graph.nodes.map(node => ({ ...node, pinned: Math.max(node.pinned, cards.some(card => card.node_id === node.id) ? 1 : 0) }));
        connections = graph.connections;
        cards = [...graph.cards, ...cards.filter(saved => !graph.cards.some(card => card.node_id === saved.node_id))];
        spent = (await api<{ spend_today: number }>('/api/settings')).spend_today;
      }
    }, { type: 'expand', id });
    loadingId = '';
    clearLoadingNotes();
    if (!succeeded && !uncertain) failedExpansionId = id;
    const queued = queuedExpansionId;
    queuedExpansionId = '';
    if (queued && queued === focusId && !failedExpansionId) queueMicrotask(() => void expand(queued));
  }

  async function pin(id: string) {
    const existing = cards.find(card => card.node_id === id);
    if (existing) { selectedId = id; exportText = ''; cardDialog?.showModal(); return; }
    if (pinningIds.has(id) || !current) return;
    const tripId = current.id;
    pinningIds = new Set(pinningIds).add(id);
    error = '';
    uncertain = null;
    try {
      const card = await api<Card>(`/api/nodes/${id}/pin`, 'POST', { route: ancestryFor(id) });
      cards = [...cards.filter(saved => saved.node_id !== id), card];
      nodes = nodes.map(node => node.id === id ? { ...node, pinned: 1 } : node);
      selectedId = id;
      exportText = '';
      if (current?.id === tripId) {
        const settings = await api<{ spend_today: number }>('/api/settings');
        spent = settings.spend_today;
      }
      cardDialog?.showModal();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not write the concept card.';
      if (/uncertain outcome|aborted due to timeout|timed out|may have been billed/i.test(error)) uncertain = { type: 'pin', id };
    } finally {
      const nextPinning = new Set(pinningIds);
      nextPinning.delete(id);
      pinningIds = nextPinning;
    }
  }

  async function retryUncertain() {
    if (!uncertain || !confirm('The previous model call may already have been billed. Check OpenRouter activity before another paid call. Retry now?')) return;
    const action = uncertain;
    await perform('Preparing the retry…', async () => {
      await api(`/api/operations/${action.type}/${action.id}/retry`, 'POST', { confirmUncertain: true });
      if (action.type === 'pin') await pin(action.id); else await expand(action.id);
    });
  }

  async function preview(format: 'markdown' | 'agent') {
    if (!selectedCard) return;
    await perform('Preparing export…', async () => {
      const response = await fetch(`/api/cards/${selectedCard.id}/export?format=${format}`);
      if (!response.ok) throw new Error('Export is unavailable.');
      exportText = await response.text();
    });
  }

  async function connect() {
    await perform('Checking chat and Jev…', async () => { setup = await api('/api/setup/key', 'PUT', { key }); key = ''; });
  }

  async function saveKit() {
    await perform('Saving your kit…', async () => {
      await api('/api/kit', 'PUT', kitText.split(',').map(item => item.trim()).filter(Boolean));
    });
  }

  async function saveLimits() {
    await perform('Saving limits…', async () => {
      await api('/api/settings', 'PUT', {
        daily_expansion_cap: Number(expansionCap), daily_pin_cap: Number(pinCap), hourly_spend_limit: Number(hourlyLimit),
      });
      await refresh();
    });
  }

  async function deleteData() {
    if (!confirm('Delete every trip and concept card? Your key and spending history will remain. This cannot be undone.')) return;
    await perform('Deleting trips…', async () => {
      await api('/api/data', 'DELETE');
      startNew();
      await refresh();
      settingsDialog?.close();
    });
  }

</script>

<svelte:head>
  <title>{current ? `${current.seed} · Idea Engine` : 'Idea Engine — Follow the strange thread'}</title>
  <meta name="description" content="Explore associations, follow promising branches and pin ideas worth building." />
</svelte:head>

<header class="topbar">
  <button class="wordmark" type="button" onclick={startNew} aria-label="Idea Engine, new trip">
    <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M18 4v10m0 8v10M4 18h10m8 0h10M8 8l7 7m6 6 7 7M28 8l-7 7m-6 6-7 7"/><circle cx="18" cy="18" r="3"/></svg>
    <span>idea engine</span>
  </button>
  <div class="top-actions">
    {#if setup.status !== 'none'}
    <nav class="workspace-nav" aria-label="Workspace">
      {#if current}<button type="button" class="text-button" onclick={startNew}>New trip</button>{/if}
      <button type="button" class="text-button" onclick={() => historyDialog?.showModal()}>Trips <span class="nav-count">{trips.length}</span></button>
      <button type="button" class="settings-trigger" onclick={() => settingsDialog?.showModal()} aria-label="Open settings">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.7 3.4a2.4 2.4 0 0 1 4.6 0l.3 1.2a7.8 7.8 0 0 1 1.5.9l1.2-.5a2.4 2.4 0 0 1 3.3 2.3l-.1 1.3c.4.5.6 1 .8 1.7l1 .8a2.4 2.4 0 0 1-1.2 4.4l-1.3.2a7.8 7.8 0 0 1-.9 1.5l.2 1.3a2.4 2.4 0 0 1-3.1 2.6l-1.2-.4a7.8 7.8 0 0 1-1.7.7l-.7 1.1a2.4 2.4 0 0 1-4.5-.8l-.3-1.3a7.8 7.8 0 0 1-1.5-1l-1.2.3a2.4 2.4 0 0 1-2.9-2.8l.3-1.3a7.8 7.8 0 0 1-.8-1.6l-1.1-.7a2.4 2.4 0 0 1 .5-4.5l1.3-.4a7.8 7.8 0 0 1 1-1.5l-.4-1.2a2.4 2.4 0 0 1 2.6-3.1l1.3.2a7.8 7.8 0 0 1 1.6-.8l.7-1.1Z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    </nav>
    {/if}
    <button type="button" class="theme-trigger" onclick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {#if theme === 'dark'}<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
      {:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z"/></svg>{/if}
    </button>
  </div>
</header>

{#if error}<div role="alert" class="notice error"><span>{error}</span>{#if uncertain}<button type="button" class="notice-action" onclick={retryUncertain}>Review & retry</button>{/if}<button type="button" class="notice-close" onclick={() => { error = ''; uncertain = null; }} aria-label="Dismiss error">×</button></div>{/if}
{#if busy && !loadingId}<div role="status" class="notice progress"><span class="activity" aria-hidden="true"></span>{busy}</div>{/if}

{#if setup.status === 'none'}
  <main class="home setup-home">
    <div class="home-copy">
      <h1>Every idea starts somewhere.</h1>
      <p>Connect your OpenRouter key to follow the strange thread. Your key stays on this machine; model calls are charged to your account.</p>
      <form class="home-form" onsubmit={event => { event.preventDefault(); void connect(); }}>
        <label for="setup-key">OpenRouter API key</label>
        <input id="setup-key" type="password" bind:value={key} autocomplete="off" placeholder="sk-or-…" required />
        <button type="submit" class="primary" disabled={!!busy}>Validate & connect <span aria-hidden="true">↗</span></button>
      </form>
      <p class="fine-print">Set a spending limit in <a href="https://openrouter.ai/settings/keys" rel="noreferrer" target="_blank">OpenRouter settings</a>. You can also mount a read-only key file.</p>
    </div>
    <div class="home-object" aria-hidden="true"><svg viewBox="0 0 480 540"><path d="M238 0v95M77 154h322M238 95v59M94 154v132M383 154v225M23 286h190M89 286v150M203 286v116"/><circle cx="238" cy="154" r="7"/><circle cx="94" cy="286" r="22"/><circle cx="382" cy="380" r="35"/><circle cx="89" cy="436" r="28"/><circle cx="203" cy="402" r="16"/></svg></div>
  </main>
{:else if !current}
  <main class="home">
    <div class="home-copy">
      <h1>Follow the<br /><em>strange thread.</em></h1>
      <p>A word becomes a connection. A connection becomes something you could build. Start wherever your curiosity lands.</p>
      <form class="home-form" onsubmit={event => { event.preventDefault(); void createTrip(); }}>
        <label for="seed">What’s your starting point?</label>
        <input id="seed" bind:value={seed} maxlength="60" required placeholder="A doorbell. A tide. A forgotten password." />
        <fieldset class="dose-control"><legend>How far should it wander?</legend><div class="dose-options">
          <button type="button" class:active={dose === 'low'} aria-pressed={dose === 'low'} onclick={() => dose = 'low'}>Near</button>
          <button type="button" class:active={dose === 'medium'} aria-pressed={dose === 'medium'} onclick={() => dose = 'medium'}>Open</button>
          <button type="button" class:active={dose === 'high'} aria-pressed={dose === 'high'} onclick={() => dose = 'high'}>Far</button>
        </div></fieldset>
        <div class="form-tail"><span>{kitText ? `Your kit is in play · ${kitText.split(',').filter(Boolean).length} items` : 'A kit is optional — add one in settings'}</span><button type="submit" class="primary" disabled={!!busy}>Begin exploring <span aria-hidden="true">↗</span></button></div>
      </form>
      {#if trips.length}<button type="button" class="resume-link" onclick={() => historyDialog?.showModal()}>Or return to a previous trip <span aria-hidden="true">→</span></button>{/if}
    </div>
    <div class="home-object" aria-hidden="true"><svg viewBox="0 0 480 540"><path d="M238 0v95M77 154h322M238 95v59M94 154v132M383 154v225M23 286h190M89 286v150M203 286v116"/><circle cx="238" cy="154" r="7"/><circle cx="94" cy="286" r="22"/><circle cx="382" cy="380" r="35"/><circle cx="89" cy="436" r="28"/><circle cx="203" cy="402" r="16"/></svg><span class="object-caption">An idea can move in more than one direction.</span></div>
  </main>
{:else if focus && selected}
  <main class="trip-view">
    <div class="trip-routebar">
      <div class="route-origin"><span>{current.seed}</span><small>{path.length} {path.length === 1 ? 'idea' : 'ideas'} travelled</small></div>
      <nav class="path-rail" aria-label="Ideas travelled">
        {#each path as step, index (index)}
          {#if showFullPath || path.length <= 4 || index === 0 || index >= path.length - 2}
          {#if index}<span class="path-join" aria-hidden="true">→</span>{/if}
          <button type="button" class:here={index === path.length - 1} aria-current={index === path.length - 1 ? 'location' : undefined} onclick={() => visitNode(step.id)}>{step.label}</button>
          {#if index === 0 && path.length > 4}<button type="button" class="path-fold" aria-expanded={showFullPath} aria-label={showFullPath ? 'Collapse earlier steps in path' : `Show ${path.length - 3} earlier steps in path`} onclick={() => showFullPath = !showFullPath}>{showFullPath ? 'Less' : `⋯ ${path.length - 3} earlier`}</button>{/if}
          {/if}
        {/each}
      </nav>
    </div>

    <ThreadCanvas
      {nodes}
      {connections}
      {route}
      currentId={focus.id}
      loading={loadingId === focus.id}
      {pinningIds}
      onVisit={selectNode}
      onPin={pin}
    />

    {#if nearby.length || loadingId === focus.id || focus.parent_id}
      <section class="nearby-rail" aria-label="Nearby ideas">
        <span class="nearby-heading">From this idea</span>
        {#if nearby.length}
          <div class="nearby-scroll">
            {#each nearby as idea (idea.id)}
              <div class="nearby-choice">
                <button type="button" class="nearby-follow" aria-label={`Follow ${idea.label}`} onclick={() => visitNode(idea.id)}>{idea.label}</button>
                <button type="button" class="nearby-pin" class:saved={!!idea.pinned} disabled={pinningIds.has(idea.id)} aria-label={pinningIds.has(idea.id) ? `Saving ${idea.label}` : idea.pinned ? `View saved concept for ${idea.label}` : `Pin ${idea.label} without following it`} title={idea.pinned ? 'View saved concept' : 'Pin without following'} onclick={() => void pin(idea.id)}>
                  {#if pinningIds.has(idea.id)}<span class="pin-spinner" aria-hidden="true"></span>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1.2 5.1 3.2 3.2v1.2H6v-1.2l3.2-3.2L8 3Zm4 9.5V21"/></svg>{/if}
                </button>
              </div>
            {/each}
          </div>
        {:else if loadingId === focus.id}<span class="nearby-wait" role="status">Finding nearby ideas…</span>
        {:else if focus.parent_id}<button type="button" class="nearby-back" onclick={() => visitNode(focus!.parent_id!)}>← Back to {nodes.find(node => node.id === focus?.parent_id)?.label ?? 'previous idea'}</button>{/if}
      </section>
    {/if}

    <footer class="idea-dock">
      <div class="idea-dock-copy">
        <span class="idea-dock-kicker">{loadingId === focus.id ? (loadingNote || busy || 'Following the thread…') : focus.pinned ? 'A concept you saved' : 'Current idea'}</span>
        <h1>{focus.label}</h1>
        <small>{nodes.length} ideas · ${spent.toFixed(3)} budgeted today</small>
        {#if focusCard}<p class="concept-teaser">{focusCard.pitch}</p>{/if}
      </div>
      <div class="idea-dock-actions">
        {#if failedExpansionId === focus.id}<button type="button" class="primary" onclick={() => void expand(focus!.id)}>Try again</button>{/if}
        {#if focus.pinned}<button type="button" class="secondary" onclick={() => { selectedId = focus!.id; exportText = ''; cardDialog?.showModal(); }}>View concept</button>
        {:else}<button type="button" class="secondary" disabled={pinningIds.has(focus.id)} aria-busy={pinningIds.has(focus.id)} onclick={() => void pin(focus!.id)}>{pinningIds.has(focus.id) ? 'Writing concept…' : 'Pin idea'}</button>{/if}
        {#if focus.parent_id}<button type="button" class="back-idea" onclick={() => visitNode(focus!.parent_id!)} aria-label="Go back to previous idea">← Back</button>{/if}
      </div>
    </footer>
  </main>
{/if}

<dialog bind:this={historyDialog} class="drawer" aria-label="Saved trips" onclose={() => {}}>
  <div class="dialog-top"><h2>Your trips</h2><button type="button" class="close-button" onclick={() => historyDialog.close()} aria-label="Close trips">×</button></div>
  <p class="dialog-intro">Pick up a thread where you left it.</p>
  {#if trips.length}<div class="trip-list">{#each trips as trip (trip.id)}<button type="button" onclick={() => void perform('Opening trip…', () => loadTrip(trip.id))}><strong>{trip.seed}</strong><span>{new Date(`${trip.created_at.replace(' ', 'T')}Z`).toLocaleDateString()}</span></button>{/each}</div>{:else}<p class="dialog-intro">No trips yet. Start with one small thought.</p>{/if}
  <button type="button" class="primary dialog-new" onclick={startNew}>Start a new trip <span aria-hidden="true">↗</span></button>
</dialog>

<dialog bind:this={settingsDialog} class="settings-dialog" aria-label="Settings">
  <div class="dialog-top"><h2>Settings</h2><button type="button" class="close-button" onclick={() => settingsDialog.close()} aria-label="Close settings">×</button></div>
  <section><h3>Your kit</h3><p>Materials you own can tug the next trip toward what you could actually make.</p><label for="kit">Comma-separated items</label><textarea id="kit" bind:value={kitText} rows="3" placeholder="ESP32, thermal printer"></textarea><button type="button" class="secondary" disabled={!!busy} onclick={() => void saveKit()}>Save kit</button></section>
  <section><h3>OpenRouter key</h3><p>{setup.masked} {setup.status === 'managed' ? '· Managed by file' : ''}</p>{#if setup.status !== 'managed'}<form onsubmit={event => { event.preventDefault(); void connect(); }}><label for="replace-key">Replace key</label><input id="replace-key" type="password" autocomplete="off" bind:value={key} required /><button type="submit" class="secondary" disabled={!!busy}>Validate & replace</button></form><button type="button" class="subtle-link" onclick={() => void perform('Removing key…', async () => { setup = await api('/api/setup/key', 'DELETE'); settingsDialog.close(); })}>Remove key</button>{/if}</section>
  <section><h3>Spend limits</h3><p>Budgeted spend includes conservative reservations for calls with unknown costs.</p><form onsubmit={event => { event.preventDefault(); void saveLimits(); }}><label for="expansion-cap">Daily expansions</label><input id="expansion-cap" type="number" min="1" max="1000" bind:value={expansionCap} /><label for="pin-cap">Daily pins</label><input id="pin-cap" type="number" min="1" max="1000" bind:value={pinCap} /><label for="hourly-limit">Hourly limit ($)</label><input id="hourly-limit" type="number" min="0.01" max="100" step="0.01" bind:value={hourlyLimit} /><button type="submit" class="secondary" disabled={!!busy}>Save limits</button></form></section>
  <button type="button" class="danger-link" onclick={() => void deleteData()}>Delete all creative data</button>
</dialog>

<dialog bind:this={cardDialog} class="card-dialog" aria-label="Concept card" onclose={() => exportText = ''}>
  <div class="dialog-top"><h2>Concept: {selected?.label}</h2><button type="button" class="close-button" onclick={() => cardDialog.close()} aria-label="Close concept">×</button></div>
  {#if selectedCard}<p class="card-pitch">{selectedCard.pitch}</p><div class="card-details"><div><h3>The thread</h3><p>{JSON.parse(selectedCard.chain).join(' → ')}</p></div><div><h3>Rough stack</h3><p>{selectedCard.stack}</p></div><div><h3>Smallest prototype</h3><p>{selectedCard.prototype}</p></div><div><h3>Wildcard</h3><p>{selectedCard.wildcard}</p></div></div><div class="export-actions"><button type="button" class="secondary" onclick={() => void preview('markdown')}>Preview Markdown</button><button type="button" class="secondary" onclick={() => void preview('agent')}>Preview agent prompt</button></div>{#if exportText}<label for="preview">Export preview</label><textarea id="preview" readonly rows="10" value={exportText}></textarea><button type="button" class="primary" onclick={() => void navigator.clipboard.writeText(exportText)}>Copy to clipboard</button>{/if}{/if}
</dialog>
