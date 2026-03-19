# Euclid Protocol Sandbox

A proof-of-concept simulation for testing a knowledge-graph protocol designed for multi-agent epistemic collaboration. Three LLM-powered agents reason over Euclidean geometry, publish theorems and conjectures, and peer-review each other's work — all through a strict formal protocol.

The geometry domain was chosen because it has an objective ground truth, allowing independent measurement of the protocol's epistemic output quality.

---

## What it does

- **Seeds** a formal axiomatic system: 23 definitions, 5 postulates, 5 common notions (Euclid's Elements, Book I)
- **Spawns 3 agents** with distinct personalities (methodical / creative / skeptical) that take turns deriving new theorems or conjectures, or verifying peers' work
- **Enforces a citation protocol**: every theorem must cite its predecessors; every verification is validated against the rules before it takes effect
- **Supports conjectures**: agents can publish named assumptions they can't yet prove; theorems that cite unproven conjectures are marked *conditional*; when a conjecture is later proven or disproven, a cascade promotes or collapses all dependent theorems
- **Tracks belief revision**: when an agent's publication gets disputed, it revisits and decides to retract or defend — with BFS cascade retraction of dependent theorems
- **Obfuscates geometry vocabulary** to force genuine axiomatic reasoning rather than recitation of memorized proofs (agents see `mark`, `trace`, `ring`, `spread`; humans see `point`, `line`, `circle`, `angle`)
- **Save / Load / Replay**: runs can be saved to JSON, reloaded to continue, or replayed turn-by-turn with full LLM debug traces (system prompt, user prompt, raw response, latency)

### Research questions this explores
- Does the protocol produce a reasonable, growing set of geometry theorems?
- Do disputed nodes get resolved, or do disputes accumulate?
- Do agents build deep derivation chains or stay shallow?
- Do conjectures get resolved, and how quickly does the conditional status cascade clear?
- What fraction of "accepted" nodes are actually valid theorems?

---

## Architecture

```
┌──────────────────────────────────────┐
│         React Frontend (Vite)         │
│  D3 force graph · controls · panels  │
│  Replay scrubber · LLM debug view    │
├──────────────────────────────────────┤
│       Express Backend (Node.js)       │
│  Protocol layer · LLM integration    │
│  Agent state · Simulation controller │
│  Save / Load / Snapshot system       │
├──────────────────────────────────────┤
│        In-Memory Graph Store          │
│  Public graph + per-agent Sets        │
└──────────────────────────────────────┘
```

The backend handles all LLM API calls server-side (avoiding browser CORS restrictions) and exposes a REST + SSE API. The frontend visualizes the evolving knowledge graph in real time.

---

## Getting started

### Prerequisites
- Node.js 18+
- An API key for Gemini, Claude, or OpenAI

### Install & run

```bash
git clone https://github.com/LeiShi/euclidean_protocol_sandbox.git
cd euclidean_protocol_sandbox
npm install

# Option A: set credentials via env vars
export LLM_PROVIDER=gemini        # gemini | claude | openai
export LLM_API_KEY=your_key_here
export LLM_MODEL=                 # optional model override

# Option B: enter credentials in the UI after launch

npm run dev
# Open http://localhost:3000
```

### Available commands

```bash
npm run dev          # Start backend (port 3001) + Vite dev server (port 3000)
npm run dev:server   # Backend only (node --watch)
npm run dev:client   # Frontend only
npm run build        # Build frontend for production
npm start            # Start backend only (production)
```

---

## Protocol rules

**Publication — theorem** — an agent publishes a new theorem:
- Must cite ≥1 predecessor node
- All cited nodes must exist in the public graph and be in the agent's personal `accepted_set`
- May include `resolves` or `contradicts` fields targeting an open conjecture

**Publication — conjecture** — an agent names an unproven assumption:
- Assigned a `C`-series ID (C1, C2, …)
- Starts as `open`; transitions to `proven` or `disproven` when a theorem with a matching `resolves`/`contradicts` field reaches `accepted` status

**Verification** — an agent reviews a peer's theorem:
- No self-verification; no duplicate verdicts
- Verdicts: `approve`, `conditional_approve` (flags implicit conjecture dependency), `dispute`
- Only theorems and conjectures can be verified (not seed axioms)

**Status** — computed dynamically:

| Status | Meaning |
|--------|---------|
| `axiom` | Seed node (immutable) |
| `accepted` | ≥2 approvals, no disputes, no unproven conjecture dependency |
| `conditional` | ≥2 approvals but transitively depends on an unproven conjecture |
| `pending` | Fewer than 2 approvals |
| `disputed` | Any dispute verdict |
| `collapsed` | Depended on a conjecture that was later disproven |
| `open` | Conjecture awaiting resolution |
| `proven` | Conjecture resolved by an accepted theorem |
| `disproven` | Conjecture contradicted by an accepted theorem |

**Belief revision** — when a published node is disputed:
- The author agent reviews the criticism and decides to `retract` or `defend`
- Retraction cascades: dependent accepted nodes are also moved to the rejected set
- Collapsed nodes (disproven conjecture dependents) are mechanically retracted without an LLM call

---

## Graph visualization

The force-directed graph uses visual encoding to convey the full protocol state at a glance. A **`? Legend`** button in the bottom-left of the graph explains all symbols. Summary:

| Visual | Meaning |
|--------|---------|
| Circle | Axiom or theorem |
| Diamond | Conjecture |
| Green border | Accepted / proven |
| Amber dashed border | Conditional (transitive conjecture dependency) |
| Amber solid border | Pending |
| Red border | Disputed / disproven |
| Grey dim | Collapsed |
| Dashed outline | Open conjecture |
| Grey edge | Support (normal dependency) |
| Amber dashed edge | Conditional dependency |
| Green thick edge | Resolves (proves a conjecture) |
| Red thick edge | Contradicts (disproves a conjecture) |

---

## Agent personalities

| ID | Name | Personality |
|----|------|-------------|
| A1 | Archon | Methodical and careful; builds on well-established foundations; verifies thoroughly before extending |
| A2 | Bion | Creative and adventurous; looks for surprising combinations; willing to attempt ambitious derivations and conjectures |
| A3 | Callias | Skeptical and rigorous; prioritizes verification over derivation; looks for flaws in others' proofs |

Each turn an agent runs through phases in priority order:
1. **Mechanical retraction** — collapse any accepted nodes that depend on a newly disproven conjecture (no LLM call)
2. **Belief revision** — if any own publication has unreviewed disputes, decide to retract or defend
3. **Verify** — review a peer's unverified theorem or conjecture
4. **Derive** — publish a new theorem or conjecture

---

## Save / Load / Replay

Runs are saved as self-contained JSON files (named `euclid_run_{date}_{time}_{N}turns.json`) containing:
- Full turn history with graph deltas and LLM debug traces
- Periodic snapshots (every 10 turns) for fast state reconstruction
- Agent summaries and configuration

**Replay mode** lets you scrub through any saved run turn-by-turn, filter by agent/action, and inspect the full LLM input/output for each decision.

---

## LLM support

| Provider | Default model |
|----------|--------------|
| Gemini | `gemini-3-flash-preview` |
| Claude | `claude-sonnet-4-5` |
| OpenAI | `gpt-4o-mini` |

The model can be overridden per-provider from the UI dropdown or via `LLM_MODEL` env var.

---

## Obfuscation vocabulary

All agent communication uses a renamed vocabulary to prevent memorized proof recitation:

| Standard | Obfuscated |
|----------|-----------|
| point | mark |
| line | trace |
| circle | ring |
| angle | spread |
| triangle | triad |
| right angle | square spread |
| parallel | co-running |
| perpendicular | cross-standing |
| … | … |

The frontend de-obfuscates for human display only. Each node's detail panel shows both the **AGENT VIEW** (obfuscated) and the **HUMAN VIEW** (standard terms).

---

## Project structure

```
server/
  index.js        Express server & API routes
  state.js        Singleton in-memory state (graph, agents, turn history, snapshots)
  simulation.js   Agent turn logic (Phase 0a/0b/1/2) + cascade logic
  protocol.js     Publication & verification validation, status computation, cascades
  llm.js          LLM calls (with trace), prompt builders, JSON parser
  seeds.js        All 33 seed nodes + agent definitions
  save.js         Save file assembly, validation, and state restoration
  vocab.js        Obfuscation vocabulary (server-side)

src/
  App.jsx               Main React component (live + replay mode)
  components/
    ForceGraph.jsx      D3 force-directed graph (nodes, edges, highlight)
    ReplayControls.jsx  Replay banner, scrubber, nav, filters, auto-play
    ReplayTurnDetail.jsx Per-turn delta + collapsible LLM debug panel
  utils/
    replay.js           State reconstruction, delta application, filename builder
  constants.js          Agent defs, computeStatus(), color maps
  vocab.js              Obfuscation vocabulary (client-side)
  main.jsx              React entry point
```

---

## Key research findings (intended observations)

- Agents with skeptical personalities naturally slow theorem accumulation but improve graph quality
- Disputed subgraphs emerge when agents disagree on foundational steps
- Belief revision cascades can prune large portions of an agent's accepted set
- The deduplication context in prompts significantly reduces redundant derivations across turns
- Conjectures create "frontier" zones of conditional knowledge that resolve in bursts when proven
