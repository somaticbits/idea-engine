<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowUpRight, Bookmark, Check, ChevronDown, Copy, Maximize2, Minimize2, Minus, Moon, Plus, Settings, Sun } from '@lucide/svelte';
  import ThreadCanvas from './ThreadCanvas.svelte';
  import { DEFAULT_MODELS, type ModelSettings } from '../src/config.js';

  type Node = { id: string; trip_id: string; parent_id: string | null; label: string; expanded: number; pinned: number; x: number; y: number };
  type Trip = { id: string; seed: string; dose: string; created_at: string; kit: string };
  type Card = { id: string; node_id: string; pitch: string; chain: string; stack: string; prototype: string; wildcard: string };
  type Connection = { id: string; from_node_id: string; to_node_id: string; kind: string };
  type Route = { nodes: string[]; cursor: number };
  type Theme = 'light' | 'dark';
  type Setup = { status: 'none' | 'set' | 'managed'; masked: string | null };
  type Action = 'expand' | 'pin';
  type ModelRole = keyof ModelSettings;
  type ModelTestResult = { passed: boolean; results: Partial<Record<ModelRole, { ok: boolean; message: string }>> };

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
  let canvasFocused = $state(false);
  let nearbyCollapsed = $state(false);
  let focusId = $state('');
  let selectedId = $state('');
  let busy = $state('');
  let loadingId = $state('');
  let loadingNote = $state('');
  let loadingNoteTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingNoteCycle: ReturnType<typeof setInterval> | undefined;
  let failedExpansionId = $state('');
  let queuedExpansionId = $state('');
  let routeSaveVersion = 0;
  let routeSaveChain: Promise<unknown> = Promise.resolve();
  let error = $state('');
  let dialogFeedback = $state('');
  let dialogBusy = $state('');
  let settingsSaved = $state<'kit' | 'limits' | 'models' | ''>('');
  let dreamerModel = $state(DEFAULT_MODELS.dreamer);
  let jevModel = $state(DEFAULT_MODELS.jev);
  let narratorModel = $state(DEFAULT_MODELS.narrator);
  let modelTestResult = $state<ModelTestResult | null>(null);
  let uncertain = $state<{ type: Action; id: string } | null>(null);
  let theme = $state<Theme>('light');
  let pinningIds = $state(new Set<string>());
  let spent = $state(0);
  let expansionCap = $state(200);
  let pinCap = $state(30);
  let hourlyLimit = $state(2);
  let exportText = $state('');
  let exportFormat = $state<'markdown' | 'agent' | null>(null);
  let copyStatus = $state('');
  let exportResult = $state<HTMLTextAreaElement>();
  let exportPreviewHeading = $state<HTMLHeadingElement>();
  let exportTrigger: HTMLButtonElement | null = null;
  let historyDialog = $state<HTMLDialogElement>();
  let savedDialog = $state<HTMLDialogElement>();
  let settingsDialog = $state<HTMLDialogElement>();
  let cardDialog = $state<HTMLDialogElement>();
  let pathRail = $state<HTMLElement>();

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

  async function perform(label: string, action: () => Promise<void>, operation?: { type: Action; id: string }, dialog?: 'settings' | 'card'): Promise<boolean> {
    busy = label;
    error = '';
    dialogFeedback = '';
    if (dialog) dialogBusy = label;
    uncertain = null;
    try { await action(); return true; }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Something went wrong. Try again.';
      if (dialog) dialogFeedback = message; else error = message;
      if (operation && /uncertain outcome|aborted due to timeout|timed out|may have been billed/i.test(message)) uncertain = operation;
      return false;
    } finally { busy = ''; dialogBusy = ''; }
  }

  async function refresh() {
    setup = await api<Setup>('/api/setup');
    trips = await api<Trip[]>('/api/trips');
    const settings = await api<{ spend_today: number; daily_expansion_cap: number; daily_pin_cap: number; hourly_spend_limit: number; models: ModelSettings }>('/api/settings');
    spent = settings.spend_today;
    expansionCap = settings.daily_expansion_cap;
    pinCap = settings.daily_pin_cap;
    hourlyLimit = settings.hourly_spend_limit;
    dreamerModel = settings.models.dreamer;
    jevModel = settings.models.jev;
    narratorModel = settings.models.narrator;
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

  function visitNode(id: string, force = false, allowGeneration = true) {
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
    if (!target.expanded && allowGeneration) {
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
      if (current?.id !== tripId) return;
      cards = [...cards.filter(saved => saved.node_id !== id), card];
      nodes = nodes.map(node => node.id === id ? { ...node, pinned: 1 } : node);
      selectedId = id;
      exportText = '';
      const settings = await api<{ spend_today: number }>('/api/settings');
      if (current?.id !== tripId) return;
      spent = settings.spend_today;
      cardDialog?.showModal();
    } catch (cause) {
      if (current?.id !== tripId) return;
      error = cause instanceof Error ? cause.message : 'Could not write the concept card.';
      if (/uncertain outcome|aborted due to timeout|timed out|may have been billed/i.test(error)) uncertain = { type: 'pin', id };
    } finally {
      const nextPinning = new Set(pinningIds);
      nextPinning.delete(id);
      pinningIds = nextPinning;
    }
  }

  async function retryUncertain(dialog?: 'settings' | 'card') {
    if (!uncertain || !confirm('The previous model call may already have been billed. Check OpenRouter activity before another paid call. Retry now?')) return;
    const action = uncertain;
    await perform('Preparing the retry…', async () => {
      await api(`/api/operations/${action.type}/${action.id}/retry`, 'POST', { confirmUncertain: true });
      if (action.type === 'pin') await pin(action.id); else await expand(action.id);
    }, undefined, dialog);
  }

  async function preview(format: 'markdown' | 'agent', trigger: HTMLButtonElement) {
    if (!selectedCard) return;
    if (exportFormat === format && exportText) {
      exportTrigger = trigger;
      await closeExportPreview();
      return;
    }
    exportTrigger = trigger;
    copyStatus = '';
    await perform('Preparing export…', async () => {
      const response = await fetch(`/api/cards/${selectedCard.id}/export?format=${format}`);
      if (!response.ok) throw new Error('Export is unavailable.');
      exportText = await response.text();
      exportFormat = format;
      await tick();
      exportResult?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      exportPreviewHeading?.focus();
    }, undefined, 'card');
  }

  async function closeExportPreview() {
    exportText = '';
    exportFormat = null;
    copyStatus = '';
    await tick();
    exportTrigger?.focus();
  }

  async function copyExport() {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      copyStatus = 'Copied to clipboard';
    } catch {
      copyStatus = 'Copy was blocked. Select the text below and copy it manually.';
      exportResult?.focus();
      exportResult?.select();
    }
  }

  async function connect() {
    await perform('Checking your provider connection…', async () => { setup = await api('/api/setup/key', 'PUT', { key }); key = ''; }, undefined, settingsDialog?.open ? 'settings' : undefined);
  }

  async function saveKit() {
    settingsSaved = '';
    if (await perform('Saving your kit…', async () => {
      await api('/api/kit', 'PUT', kitText.split(',').map(item => item.trim()).filter(Boolean));
    }, undefined, 'settings')) settingsSaved = 'kit';
  }

  async function saveLimits() {
    settingsSaved = '';
    if (await perform('Saving limits…', async () => {
      await api('/api/settings', 'PUT', {
        daily_expansion_cap: Number(expansionCap), daily_pin_cap: Number(pinCap), hourly_spend_limit: Number(hourlyLimit),
      });
      await refresh();
    }, undefined, 'settings')) settingsSaved = 'limits';
  }

  function currentModels(): ModelSettings {
    return { dreamer: dreamerModel, jev: jevModel, narrator: narratorModel };
  }

  function restoreDefaultModels() {
    dreamerModel = DEFAULT_MODELS.dreamer;
    jevModel = DEFAULT_MODELS.jev;
    narratorModel = DEFAULT_MODELS.narrator;
    modelTestResult = null;
    settingsSaved = '';
  }

  async function saveModels() {
    settingsSaved = '';
    modelTestResult = null;
    if (await perform('Saving model choices…', async () => {
      const result = await api<{ models: ModelSettings }>('/api/settings/models', 'PUT', currentModels());
      dreamerModel = result.models.dreamer;
      jevModel = result.models.jev;
      narratorModel = result.models.narrator;
    }, undefined, 'settings')) settingsSaved = 'models';
  }

  async function testModels() {
    modelTestResult = null;
    await perform('Testing model compatibility…', async () => {
      modelTestResult = await api<ModelTestResult>('/api/settings/models/test', 'POST', currentModels());
    }, undefined, 'settings');
  }

  async function deleteData() {
    if (!confirm('Delete every trip and concept card? Your key and spending history will remain. This cannot be undone.')) return;
    await perform('Deleting trips…', async () => {
      await api('/api/data', 'DELETE');
      startNew();
      await refresh();
      settingsDialog?.close();
    }, undefined, 'settings');
  }

  function openSavedConcept(card: Card) {
    selectedId = card.node_id;
    exportText = '';
    exportFormat = null;
    dialogFeedback = '';
    cardDialog?.showModal();
  }

  function showSavedOnMap(card: Card) {
    savedDialog?.close();
    visitNode(card.node_id, false, false);
  }

  $effect(() => {
    focusId;
    nearbyCollapsed = false;
    void tick().then(() => pathRail?.querySelector('.here')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }));
  });

</script>

<svelte:head>
  <title>{current ? `${current.seed} · Idea Engine` : 'Idea Engine — Follow the strange thread'}</title>
  <meta name="description" content="Explore associations, follow promising branches and pin ideas worth building." />
</svelte:head>

<header class="topbar" class:canvas-focus-hidden={canvasFocused} class:in-trip={!!current}>
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
        <Settings size={22} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </nav>
    {/if}
    <button type="button" class="theme-trigger" onclick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {#if theme === 'dark'}<Sun size={22} strokeWidth={1.8} aria-hidden="true" />
      {:else}<Moon size={22} strokeWidth={1.8} aria-hidden="true" />{/if}
    </button>
  </div>
</header>

{#if error && !settingsDialog?.open && !cardDialog?.open}<div role="alert" class="notice error"><span>{error}</span>{#if uncertain}<button type="button" class="notice-action" onclick={() => void retryUncertain()}>Review & retry</button>{/if}<button type="button" class="notice-close" onclick={() => { error = ''; uncertain = null; }} aria-label="Dismiss error">×</button></div>{/if}
{#if busy && !dialogBusy && (!loadingId || loadingId !== focusId)}<div role="status" class="notice progress"><span class="activity" aria-hidden="true"></span>{queuedExpansionId && queuedExpansionId === focusId ? 'This idea is queued; it will use your model budget.' : busy}</div>{/if}

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
        <div class="form-tail"><div class="form-tail-context"><span>{kitText ? `Your kit is in play · ${kitText.split(',').filter(Boolean).length} items` : 'A kit is optional — add one in settings'}</span><small>Starting generates ideas using your model budget · {expansionCap} expansions/day · ${hourlyLimit.toFixed(2)}/hour limit</small></div><button type="submit" class="primary" disabled={!!busy}>Begin exploring <ArrowUpRight size={18} strokeWidth={2} aria-hidden="true" /></button></div>
      </form>
      {#if trips.length}<button type="button" class="resume-link" onclick={() => historyDialog?.showModal()}>Or return to a previous trip <span aria-hidden="true">→</span></button>{/if}
    </div>
    <div class="home-object" aria-hidden="true"><svg viewBox="0 0 480 540"><path d="M238 0v95M77 154h322M238 95v59M94 154v132M383 154v225M23 286h190M89 286v150M203 286v116"/><circle cx="238" cy="154" r="7"/><circle cx="94" cy="286" r="22"/><circle cx="382" cy="380" r="35"/><circle cx="89" cy="436" r="28"/><circle cx="203" cy="402" r="16"/></svg><span class="object-caption">An idea can move in more than one direction.</span></div>
  </main>
{:else if focus && selected}
    <main class="trip-view" class:canvas-focused={canvasFocused}>
      <div class="trip-routebar">
      <div class="route-origin"><span>{current.seed}</span><small>{path.length} {path.length === 1 ? 'idea' : 'ideas'} travelled</small></div>
      <nav bind:this={pathRail} class="path-rail" aria-label="Ideas travelled">
        {#each path as step, index (index)}
          {#if showFullPath || path.length <= 4 || index === 0 || index >= path.length - 2}
          {#if index}<span class="path-join" aria-hidden="true">→</span>{/if}
          <button type="button" class:here={index === path.length - 1} aria-current={index === path.length - 1 ? 'location' : undefined} onclick={() => visitNode(step.id)}>{step.label}</button>
          {#if index === 0 && path.length > 4}<button type="button" class="path-fold" aria-expanded={showFullPath} aria-label={showFullPath ? 'Collapse earlier steps in path' : `Show ${path.length - 3} earlier steps in path`} onclick={() => showFullPath = !showFullPath}>{showFullPath ? 'Less' : `⋯ ${path.length - 3} earlier`}</button>{/if}
          {/if}
        {/each}
        </nav>
        <button type="button" class="saved-concepts-trigger" aria-label={`Saved concepts, ${cards.length}`} title="Open saved concepts" onclick={() => savedDialog?.showModal()}>
          <Bookmark size={18} aria-hidden="true" /><span>Saved concepts</span><b>{cards.length}</b>
        </button>
        <button type="button" class="canvas-focus-toggle" aria-label={canvasFocused ? 'Show header and idea details' : 'Maximize brainstorming canvas'} title={canvasFocused ? 'Show header and idea details' : 'Maximize brainstorming canvas'} onclick={() => canvasFocused = !canvasFocused}>
          {#if canvasFocused}<Minimize2 size={19} strokeWidth={1.9} aria-hidden="true" />{:else}<Maximize2 size={19} strokeWidth={1.9} aria-hidden="true" />{/if}
          <span>{canvasFocused ? 'Show details' : 'Focus canvas'}</span>
        </button>
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
      <section class="nearby-rail" class:canvas-collapsed={canvasFocused} aria-label="Nearby ideas">
        <button type="button" class="nearby-toggle" aria-expanded={!nearbyCollapsed} aria-controls="nearby-options" onclick={() => nearbyCollapsed = !nearbyCollapsed}>
          <span>From this idea{nearbyCollapsed && nearby.length ? ` · ${nearby.length}` : ''}</span>
          <ChevronDown size={17} aria-hidden="true" class={nearbyCollapsed ? 'turned' : ''} />
          <span class="sr-only">{nearbyCollapsed ? 'Expand nearby ideas' : 'Collapse nearby ideas'}</span>
        </button>
        <div id="nearby-options" class="nearby-content" hidden={nearbyCollapsed}>
          {#if nearby.length}
            <div class="nearby-scroll">
              {#each nearby as idea (idea.id)}
                <div class="nearby-choice">
                  <button type="button" class="nearby-follow" aria-label={idea.expanded ? `Follow explored idea ${idea.label}` : `Explore ${idea.label}; generates new ideas using your model budget`} title={idea.expanded ? 'Follow explored idea' : 'Generate new ideas · uses model budget'} onclick={() => visitNode(idea.id)}><span>{idea.label}</span><small>{idea.expanded ? 'Explore this idea' : 'New ideas · uses model budget'}</small></button>
                  <button type="button" class="nearby-pin" class:saved={!!idea.pinned} disabled={pinningIds.has(idea.id)} aria-label={pinningIds.has(idea.id) ? `Writing concept for ${idea.label}` : idea.pinned ? `View saved concept for ${idea.label}` : `Write a concept card for ${idea.label}; uses model budget`} title={idea.pinned ? 'View saved concept' : 'Write concept card · uses model budget'} onclick={() => void pin(idea.id)}>
                    {#if pinningIds.has(idea.id)}<span class="pin-spinner" aria-hidden="true"></span>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1.2 5.1 3.2 3.2v1.2H6v-1.2l3.2-3.2L8 3Zm4 9.5V21"/></svg>{/if}
                  </button>
                </div>
              {/each}
            </div>
          {:else if loadingId === focus.id}<span class="nearby-wait" role="status">Finding nearby ideas…</span>
          {:else if focus.parent_id}<button type="button" class="nearby-back" onclick={() => visitNode(focus!.parent_id!)}>← Back to {nodes.find(node => node.id === focus?.parent_id)?.label ?? 'previous idea'}</button>{/if}
        </div>
      </section>
    {/if}

    <footer class="idea-dock" class:canvas-collapsed={canvasFocused}>
      <div class="idea-dock-copy">
        <span class="idea-dock-kicker">{queuedExpansionId === focus.id ? 'Queued · uses model budget' : loadingId === focus.id ? (loadingNote || busy || 'Following the thread…') : focus.pinned ? 'A concept you saved' : 'Current idea'}</span>
        <h1>{focus.label}</h1>
        <small>{nodes.length} ideas · ${spent.toFixed(3)} budgeted today</small>
        {#if focusCard}<p class="concept-teaser">{focusCard.pitch}</p>{/if}
      </div>
      <div class="idea-dock-actions">
        {#if failedExpansionId === focus.id}<button type="button" class="primary" onclick={() => void expand(focus!.id)}>Try again</button>{/if}
        {#if focus.pinned}<button type="button" class="secondary" onclick={() => { selectedId = focus!.id; exportText = ''; cardDialog?.showModal(); }}>View concept</button>
        {:else}<div class="model-action"><button type="button" class="secondary" title="Write a concept card using your model budget" disabled={pinningIds.has(focus.id)} aria-busy={pinningIds.has(focus.id)} onclick={() => void pin(focus!.id)}>{pinningIds.has(focus.id) ? 'Writing concept…' : 'Write concept'}</button><small>Uses model budget</small></div>{/if}
        {#if focus.parent_id}<button type="button" class="back-idea" onclick={() => visitNode(focus!.parent_id!)} aria-label="Go back to previous idea">← Back</button>{/if}
      </div>
    </footer>
  </main>
{/if}

<dialog bind:this={historyDialog} class="drawer" aria-label="Saved trips" onclose={() => {}}>
  <div class="dialog-top"><h2>Your trips</h2><button type="button" class="close-button" onclick={() => historyDialog?.close()} aria-label="Close trips">×</button></div>
  <p class="dialog-intro">Pick up a thread where you left it.</p>
  {#if trips.length}<div class="trip-list">{#each trips as trip (trip.id)}<button type="button" onclick={() => void perform('Opening trip…', () => loadTrip(trip.id))}><strong>{trip.seed}</strong><span>{new Date(`${trip.created_at.replace(' ', 'T')}Z`).toLocaleDateString()}</span></button>{/each}</div>{:else}<p class="dialog-intro">No trips yet. Start with one small thought.</p>{/if}
  <button type="button" class="primary dialog-new" onclick={startNew}>Start a new trip <span aria-hidden="true">↗</span></button>
</dialog>

<dialog bind:this={savedDialog} class="drawer saved-dialog" aria-label="Saved concepts" onclose={() => {}}>
  <div class="dialog-top"><h2>Saved concepts</h2><button type="button" class="close-button" onclick={() => savedDialog?.close()} aria-label="Close saved concepts">×</button></div>
  <p class="dialog-intro">Ideas you kept from this trip, ready to revisit or export.</p>
  {#if cards.length}
    <div class="saved-concept-list">
      {#each cards as card (card.id)}
        <article class="saved-concept-item">
          <button type="button" class="saved-concept-open" onclick={() => openSavedConcept(card)}>
            <strong>{nodes.find(node => node.id === card.node_id)?.label ?? 'Saved idea'}</strong>
            <span>{card.pitch}</span>
            <small>View concept and export →</small>
          </button>
          <button type="button" class="saved-concept-map" onclick={() => showSavedOnMap(card)}>Show on map</button>
        </article>
      {/each}
    </div>
  {:else}
    <p class="saved-empty">No concepts saved yet. Explore a promising branch, then write a concept card to keep it here.</p>
  {/if}
</dialog>

<dialog bind:this={settingsDialog} class="settings-dialog" aria-label="Settings" onclose={() => { dialogFeedback = ''; dialogBusy = ''; settingsSaved = ''; uncertain = null; }}>
  <div class="dialog-top"><h2>Settings</h2><button type="button" class="close-button" onclick={() => settingsDialog?.close()} aria-label="Close settings"><span aria-hidden="true">×</span></button></div>
  {#if dialogBusy}<p class="dialog-feedback progress" role="status"><span class="activity" aria-hidden="true"></span>{dialogBusy}</p>{/if}
  {#if dialogFeedback}<div class="dialog-feedback error" role="alert"><span>{dialogFeedback}</span>{#if uncertain}<button type="button" onclick={() => void retryUncertain('settings')}>Review & retry</button>{/if}<button type="button" aria-label="Dismiss message" onclick={() => { dialogFeedback = ''; uncertain = null; }}>Dismiss</button></div>{/if}
  <section><h3>Your kit</h3><p>Materials you own can tug the next trip toward what you could actually make.</p><label for="kit">Comma-separated items</label><textarea id="kit" bind:value={kitText} rows="3" placeholder="ESP32, thermal printer" oninput={() => settingsSaved = ''}></textarea><button type="button" class="secondary" disabled={!!busy} onclick={() => void saveKit()}>Save kit</button>{#if settingsSaved === 'kit'}<p class="save-confirmation" role="status">Kit saved. It will shape your next trip.</p>{/if}</section>
   <section><h3>Models</h3><p>Choose model IDs independently. Jev must support the OpenRouter System One endpoint; Dreamer and Narrator use chat completions. Testing sends paid requests.</p>
     <label for="dreamer-model">Dreamer · associations</label><input id="dreamer-model" bind:value={dreamerModel} oninput={() => { settingsSaved = ''; modelTestResult = null; }} />
     <label for="jev-model">Jev · filtering</label><input id="jev-model" bind:value={jevModel} oninput={() => { settingsSaved = ''; modelTestResult = null; }} />
     <label for="narrator-model">Narrator · concept cards</label><input id="narrator-model" bind:value={narratorModel} oninput={() => { settingsSaved = ''; modelTestResult = null; }} />
     <div class="settings-actions"><button type="button" class="secondary" disabled={!!busy} onclick={() => void saveModels()}>Save models</button><button type="button" class="secondary" disabled={!!busy || setup.status === 'none'} onclick={() => void testModels()}>Test models</button><button type="button" class="text-button" disabled={!!busy} onclick={restoreDefaultModels}>Restore defaults</button></div>
     {#if settingsSaved === 'models'}<p class="save-confirmation" role="status">Model choices saved.</p>{/if}
     {#if modelTestResult}<ul class="model-test-results" aria-label="Model test results">{#each Object.entries(modelTestResult.results) as [role, result]}<li class:success={result.ok} class:failure={!result.ok}><strong>{role}:</strong> {result.message}</li>{/each}</ul>{/if}
   </section>
   <section><h3>OpenRouter key</h3><p>{setup.masked} {setup.status === 'managed' ? '· Managed by file' : ''}</p>{#if setup.status !== 'managed'}<form onsubmit={event => { event.preventDefault(); void connect(); }}><label for="replace-key">Replace key</label><input id="replace-key" type="password" autocomplete="off" bind:value={key} required /><button type="submit" class="secondary" disabled={!!busy}>Validate & replace</button></form><button type="button" class="subtle-link" onclick={() => void perform('Removing key…', async () => { setup = await api('/api/setup/key', 'DELETE'); settingsDialog?.close(); }, undefined, 'settings')}>Remove key</button>{/if}</section>
  <section><h3>Spend limits</h3><p>Model calls reserve against these limits before running. Today’s budgeted spend is ${spent.toFixed(3)}; usage can settle at a different amount.</p><form onsubmit={event => { event.preventDefault(); void saveLimits(); }}><label for="expansion-cap">Daily expansions</label><input id="expansion-cap" type="number" min="1" max="1000" bind:value={expansionCap} oninput={() => settingsSaved = ''} /><label for="pin-cap">Daily pins</label><input id="pin-cap" type="number" min="1" max="1000" bind:value={pinCap} oninput={() => settingsSaved = ''} /><label for="hourly-limit">Hourly limit ($)</label><input id="hourly-limit" type="number" min="0.01" max="100" step="0.01" bind:value={hourlyLimit} oninput={() => settingsSaved = ''} /><button type="submit" class="secondary" disabled={!!busy}>Save limits</button></form>{#if settingsSaved === 'limits'}<p class="save-confirmation" role="status">Spend limits saved.</p>{/if}</section>
  <button type="button" class="danger-link" onclick={() => void deleteData()}>Delete all creative data</button>
</dialog>

<dialog bind:this={cardDialog} class="card-dialog" aria-label="Concept card" onclose={() => { exportText = ''; exportFormat = null; copyStatus = ''; exportTrigger = null; dialogFeedback = ''; dialogBusy = ''; uncertain = null; }}>
  <div class="dialog-top"><h2>Concept: {selected?.label}</h2><button type="button" class="close-button" onclick={() => cardDialog?.close()} aria-label="Close concept"><span aria-hidden="true">×</span></button></div>
  {#if dialogBusy}<p class="dialog-feedback progress" role="status"><span class="activity" aria-hidden="true"></span>{dialogBusy}</p>{/if}
  {#if dialogFeedback}<div class="dialog-feedback error" role="alert"><span>{dialogFeedback}</span>{#if uncertain}<button type="button" onclick={() => void retryUncertain('card')}>Review & retry</button>{/if}<button type="button" aria-label="Dismiss message" onclick={() => { dialogFeedback = ''; uncertain = null; }}>Dismiss</button></div>{/if}
  {#if selectedCard}<div class="card-actions-top"><button type="button" class="primary" aria-pressed={exportFormat === 'markdown'} onclick={event => void preview('markdown', event.currentTarget)}><span>Preview Markdown</span>{#if exportFormat === 'markdown'}<Minus size={17} aria-hidden="true" />{:else}<Plus size={17} aria-hidden="true" />{/if}</button><button type="button" class="secondary" aria-pressed={exportFormat === 'agent'} onclick={event => void preview('agent', event.currentTarget)}><span>Preview agent prompt</span>{#if exportFormat === 'agent'}<Minus size={17} aria-hidden="true" />{:else}<Plus size={17} aria-hidden="true" />{/if}</button></div>{#if exportText}<section class="export-result" aria-labelledby="export-result-title"><div class="export-result-heading"><h3 bind:this={exportPreviewHeading} id="export-result-title" tabindex="-1">{exportFormat === 'agent' ? 'Agent prompt preview' : 'Markdown preview'}</h3></div><div class="export-preview-frame"><textarea bind:this={exportResult} id="export-preview" aria-label="Export text" readonly rows="5" value={exportText}></textarea><button type="button" class="export-copy-button" aria-label={copyStatus === 'Copied to clipboard' ? 'Copied to clipboard' : `Copy ${exportFormat === 'agent' ? 'agent prompt' : 'Markdown'} to clipboard`} title={copyStatus === 'Copied to clipboard' ? 'Copied' : 'Copy to clipboard'} onclick={() => void copyExport()}>{#if copyStatus === 'Copied to clipboard'}<Check size={18} strokeWidth={2} aria-hidden="true" />{:else}<Copy size={18} strokeWidth={1.8} aria-hidden="true" />{/if}</button></div><p class="copy-status" role="status" aria-live="polite">{copyStatus || 'Review the text, then copy it when ready.'}</p></section>{/if}<p class="card-pitch">{selectedCard.pitch}</p><div class="card-details"><div><h3>The thread</h3><p>{JSON.parse(selectedCard.chain).join(' → ')}</p></div><div><h3>Rough stack</h3><p>{selectedCard.stack}</p></div><div><h3>Smallest prototype</h3><p>{selectedCard.prototype}</p></div><div><h3>Wildcard</h3><p>{selectedCard.wildcard}</p></div></div>{/if}
</dialog>
