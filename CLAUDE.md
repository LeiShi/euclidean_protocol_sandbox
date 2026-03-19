# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `state.js` — singleton in-memory state: `graph` (node dict), `agents[]` (with `accepted_set`, `rejected_set`, `published` as Sets), `log[]`, `turn`, `nodeCounter`, `config`, `running`, `abortFlag`
- `seeds.js` — all 33 seed nodes (DEFINITIONS, POSTULATES, COMMON_NOTIONS) + AGENT_DEFS
- `protocol.js` — `validatePublication()`, `validateVerification()`, `computeStatus()`, `computeStats()`
- `simulation.js` — `doAgentTurn()`: reads `state.turn % 3` to pick agent, decides verify vs derive, calls LLM, validates, mutates state
- `llm.js` — `callLLM(config, sysPrompt, userPrompt)`, `buildSystemPrompt()`, `buildDerivationPrompt()`, `buildVerificationPrompt()`, `parseJSON()`
- `vocab.js` — VOCAB map + `deobfuscate()` (server-side copy)
- `index.js` — Express routes: `GET /api/state`, `POST /api/step`, `POST /api/run` (SSE stream), `POST /api/stop`, `POST /api/config`, `GET /api/log`, `GET /api/node/:id`

**Frontend** (`src/`) served by Vite on port 3000, proxies `/api` to port 3001:
- `App.jsx` — main component; fetches `/api/state` on mount, calls `/api/step` and `/api/run` (SSE via fetch ReadableStream), holds provider/apiKey in local state
- `components/ForceGraph.jsx` — D3 force-directed graph; rebuilds simulation when node/link count changes, only updates stroke widths on selectedNode change (no full rebuild)
- `vocab.js` — client-side copy of VOCAB + `deobfuscate()`
- `constants.js` — AGENT_DEFS, `computeStatus()`, color maps for status/log entries

## Protocol Layer

The core of the experiment. See `SPEC.md` for the full spec. Key rules:
- **Publication**: theorems must cite ≥1 predecessor; all cited IDs must exist in public graph AND in the publishing agent's `accepted_set`
- **Verification**: no self-verification, no duplicate verdicts, only on theorem nodes (not seeds)
- **Status**: computed dynamically — `axiom` for seeds, `accepted` if ≥2 approves and no disputes, `disputed` if any dispute, else `pending`
- Seed nodes are pre-loaded into every agent's `accepted_set` at init

## Obfuscation Layer

All LLM communication uses obfuscated geometry vocabulary (e.g., `point→mark`, `line→trace`, `circle→ring`) to force agents to reason from axioms rather than reciting memorized proofs. The frontend de-obfuscates for human display only. Sort by length descending before replacing to handle multi-word terms like `square spread` before `spread`.

## LLM Integration

`callLLM()` supports Gemini, Claude, OpenAI server-side. Default models:
- Gemini: `gemini-3-flash-preview`
- Claude: `claude-sonnet-4-5`
- OpenAI: `gpt-4o-mini`

Claude requires headers `x-api-key` and `anthropic-version: 2023-06-01`. JSON responses from LLMs may be wrapped in markdown backticks — `parseJSON()` strips these before parsing.
