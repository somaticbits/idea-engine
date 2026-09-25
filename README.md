# Idea Engine

A local-first creative technology playground. Start with a seed, explore associations filtered by Jev, and pin interesting nodes into buildable concept cards. One user per instance; you bring an OpenRouter key.

## Quick start

```sh
git clone <repository-url> idea-engine
cd idea-engine
docker compose up --build
```

Open <http://127.0.0.1:8080>. Paste an OpenRouter key on the setup screen, or mount one as a read-only file. The setup validates both chat and Jev access. Set a spending limit on your key in [OpenRouter settings](https://openrouter.ai/settings/keys) and consider disabling auto-recharge.

The Compose port is bound to loopback and there is **no login**. Do not publish the app on your network: anyone who can reach it can spend your credits. Data is stored on a local Docker volume; seeds, kit and graph context are sent to OpenRouter and serving providers during model calls. No analytics are included.

### Key file

In `compose.yaml`, add a read-only bind mount under `app.volumes` such as `- ./secrets/openrouter:/run/secrets/openrouter:ro`, and set `OPENROUTER_API_KEY_FILE=/run/secrets/openrouter` in the service environment. Protect that file with `chmod 600`. File-managed keys take precedence over pasted keys.

### Development

Requires Node 22. Run `npm ci`, then `npm run dev`. The UI runs at <http://127.0.0.1:5173> and proxies API requests to port 8080. Run `npm run check`, `npm test`, and `npm run build` before shipping.

### Cost and privacy

The default caps are 200 expansions/day, 30 pins/day, and $2 in any rolling hour. Every model call is charged to your OpenRouter key, including setup validation and retries. The UI shows **budgeted** spend: provider-reported `usage.cost` where available, plus conservative reservations for uncertain calls. It is not your OpenRouter bill. Actual trip cost and latency depend on provider routing. Jev is required; a failed filter never falls back to unfiltered candidates. A timed-out call is never silently retried; a manual retry may be billed again.

Pinned concept cards preserve the original idea, its association path and a prototype-sized plan. Export a card as Markdown or as a prompt for a coding agent from the card view.

**Release gate:** OpenRouter chat privacy-routing parameters are sent on chat calls; System One / Jev zero-retention support, fallback provider support, model IDs and parameter behavior must be confirmed with a live key before claiming zero retention or publishing a release. No key is bundled with the app.

### Architecture

Browser (Svelte + a stable SVG branch map) → Node/Hono gateway → OpenRouter Dreamer → Jev filter → SQLite; pinning invokes Narrator. The browser never calls OpenRouter directly. Expansion streams progress stages, then returns accepted nodes after filtering.

### Design workflow

The project includes [Impeccable](https://impeccable.style/) project-local skills, `PRODUCT.md`, `DESIGN.md`, and a focused-explorer surface brief. Impeccable's CLI requires Node 22.18 or newer. Restart OpenCode after installing or updating the project-local skill, then use `/impeccable` for future design sessions. Its detector can scan the Svelte UI with `npx impeccable detect web/` when a compatible Node is available. The app itself does not require Impeccable to run.

MIT licensed. See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.
