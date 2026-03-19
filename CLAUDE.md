# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branches

- `main` — stable, tested releases only
- `dev` — this Claude Code instance's development branch
- `dev1` — parallel development branch (separate Claude Code instance)

Never push directly to `main`. Commit to `dev`, then merge when tested.

## Commands

```bash
npm install           # Install all dependencies
npm run dev           # Start both backend (port 3001) and frontend dev server (port 3000)
npm run dev:server    # Backend only (node --watch)
npm run dev:client    # Frontend only (Vite)
npm run build         # Build frontend for production
npm start             # Start backend server only (no Vite)

# Open http://localhost:3000 in the browser
```

Set LLM credentials via environment or configure in the UI after launch:
```bash
export LLM_PROVIDER=gemini    # gemini | claude | openai
export LLM_API_KEY=your_key
export LLM_MODEL=             # optional model override
```

## Architecture

**Backend** (`server/`) runs on port 3001 (Express, ES modules):
- `state.js` — singleton in-memory state: `graph` (node dict), `agents[]` (with `accepted_set`, `rejected_set`, `published` as Sets), `log[]`, `turn`, `nodeCounter`, `config`, `running`, `abortFlag`, `turnHistory[]`, `snapshots[]`, `initialState`
- `seeds.js` — all 33 seed nodes (DEFINITIONS, POSTULATES, COMMON_NOTIONS) + AGENT_DEFS
- `protocol.js` — `validatePublication()`, `validateVerification()`, `computeStatus()`, `computeStats()`
- `simulation.js` — `doAgentTurn()`: Phase 0 (belief revision) → Phase 1 (verify) → Phase 2 (derive); uses try/finally to always record a `TurnRecord` with delta + LLM debug trace; captures full snapshots every 10 turns
- `llm.js` — `callLLM()`, `callLLMWithTrace()` (returns raw + timing trace), `DEFAULT_MODELS`, prompt builders, `parseJSON()`
- `save.js` — `assembleSaveFile()`, `validateSaveFile()`, `restoreFromSaveFile()`
- `vocab.js` — VOCAB map + `deobfuscate()` (server-side copy)
- `index.js` — Express routes (JSON body limit: 50mb):
  - `GET /api/state`, `POST /api/step`, `POST /api/run` (SSE), `POST /api/stop`, `POST /api/config`
  - `GET /api/log`, `GET /api/node/:id`
  - `POST /api/save` — assemble and return save file as JSON
  - `POST /api/load` — restore full state from save file, return new state
  - `POST /api/replay/load` — validate save file and return it for client-side replay

**Frontend** (`src/`) served by Vite on port 3000, proxies `/api` to port 3001:
- `App.jsx` — main component; live simulation mode + replay mode state machine; Save Run / Load Run buttons; configurable rounds input
- `components/ForceGraph.jsx` — D3 force-directed graph; rebuilds on node/link count change; separate effect for `selectedNode` and `highlightNodes` (no full rebuild)
- `components/ReplayControls.jsx` — replay banner, scrubber, First/Prev/Next/Last, Play/Pause, speed (0.5×–5×), agent/action filters
- `components/ReplayTurnDetail.jsx` — per-turn summary, delta display, collapsible LLM debug (system prompt, user prompt, raw response, parsed JSON)
- `utils/replay.js` — `reconstructStateAtTurn()`, `applyDelta()`, `getChangedNodeIds()`, `buildSaveFilename()`
- `vocab.js` — client-side copy of VOCAB + `deobfuscate()`
- `constants.js` — AGENT_DEFS, `computeStatus()`, color maps for status/log entries

## Protocol Layer

The core of the experiment. See `SPEC.md` for the full spec. Key rules:
- **Publication**: theorems must cite ≥1 predecessor; all cited IDs must exist in public graph AND in the publishing agent's `accepted_set`
- **Verification**: no self-verification, no duplicate verdicts, only on theorem nodes (not seeds)
- **Status**: computed dynamically — `axiom` for seeds, `accepted` if ≥2 approves and no disputes, `disputed` if any dispute, else `pending`
- Seed nodes are pre-loaded into every agent's `accepted_set` at init

## Agent Turn Structure

Each `doAgentTurn()` call:
1. Snapshots agent state (accepted/rejected/published sets) and graph verification counts before execution
2. Runs Phase 0 → 1 → 2 (only one phase executes per turn, using early `return`)
3. In `finally`: computes delta (graph additions/modifications, agent set changes), builds `TurnRecord`, pushes to `state.turnHistory`, increments `state.turn`, captures a full snapshot every 10 turns

## Save / Load / Replay

- **TurnRecord** schema: `turn`, `agent_id`, `phase`, `action`, `timestamp`, `detail`, optional `target_node_id` / `published_node_id` / `cascade_retracted`, `delta` (graph + agent changes), `debug` (full LLM prompts/response/latency or null)
- **Snapshots**: `{ after_turn: N, graph, agents }` captured when `state.turn % 10 === 0`; `after_turn: N` means TurnRecords 0..N-1 have been applied (= `replayTurn=N` in the UI)
- **Replay state reconstruction**: find nearest snapshot with `after_turn <= replayTurn`, then apply TurnRecords with `turn >= after_turn && turn < replayTurn`
- Save files named: `euclid_run_{YYYY-MM-DD}_{HH-mm-ss}_{N}turns.json`

## Obfuscation Layer

All LLM communication uses obfuscated geometry vocabulary (e.g., `point→mark`, `line→trace`, `circle→ring`) to force agents to reason from axioms rather than reciting memorized proofs. The frontend de-obfuscates for human display only. Sort by length descending before replacing to handle multi-word terms like `square spread` before `spread`.

## LLM Integration

`callLLM()` / `callLLMWithTrace()` support Gemini, Claude, OpenAI server-side. Default models:
- Gemini: `gemini-3-flash-preview`
- Claude: `claude-sonnet-4-5`
- OpenAI: `gpt-4o-mini`

Claude requires headers `x-api-key` and `anthropic-version: 2023-06-01`. JSON responses from LLMs may be wrapped in markdown backticks — `parseJSON()` strips these before parsing. `maxOutputTokens`/`max_tokens`: 16384. Gemini throws on `finishReason === 'MAX_TOKENS'`.

## Prompt Engineering (Patches 1–3)

- **Patch 1 (dedup)**: Derivation prompt includes all public theorems + own publications + rejected nodes with reasons so agents don't re-derive existing results
- **Patch 2 (belief revision)**: Phase 0 triggers when own publications have unreviewed disputes; cascade retraction via BFS through dependent nodes in `accepted_set`
- **Patch 3 (trimming)**: If derivation prompt >12000 chars, compress definitions first (→ compact reference), then own publications (→ ID list only)
