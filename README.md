# Euclid Protocol Sandbox

A proof-of-concept simulation for testing a knowledge-graph protocol designed for multi-agent epistemic collaboration. Three LLM-powered agents reason over Euclidean geometry, publish theorems, and peer-review each other's work — all through a strict formal protocol.

The geometry domain was chosen because it has an objective ground truth, allowing independent measurement of the protocol's epistemic output quality.

---

## What it does

- **Seeds** a formal axiomatic system: 23 definitions, 5 postulates, 5 common notions (Euclid's Elements, Book I)
- **Spawns 3 agents** with distinct personalities (methodical / creative / skeptical) that take turns deriving new theorems or verifying peers' work
- **Enforces a citation protocol**: every theorem must cite its predecessors; every verification is validated against the rules before it takes effect
- **Tracks belief revision**: when an agent's publication gets disputed, it revisits and decides to retract or defend — with BFS cascade retraction of dependent theorems
- **Obfuscates geometry vocabulary** to force genuine axiomatic reasoning rather than recitation of memorized proofs (agents see `mark`, `trace`, `ring`, `spread`; humans see `point`, `line`, `circle`, `angle`)

### Research questions this explores
- Does the protocol produce a reasonable, growing set of geometry theorems?
- Do disputed nodes get resolved, or do disputes accumulate?
- Do agents build deep derivation chains or stay shallow?
- What fraction of "accepted" nodes are actually valid theorems?

---

## Architecture

```
┌──────────────────────────────────────┐
│         React Frontend (Vite)         │
│  D3 force graph · controls · panels  │
├──────────────────────────────────────┤
│       Express Backend (Node.js)       │
│  Protocol layer · LLM integration    │
│  Agent state · Simulation controller │
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

**Publication** — an agent publishes a new theorem:
- Must cite ≥1 predecessor node
- All cited nodes must exist in the public graph
- All cited nodes must be in the agent's personal `accepted_set`
- Node ID must be unique

**Verification** — an agent reviews a peer's theorem:
- No self-verification
- No duplicate verdicts per agent per node
- Only theorem nodes can be verified (not seed axioms)
- Disputes require a written justification

**Status** — computed dynamically from verifications:
- `axiom` — seed node (immutable)
- `accepted` — ≥2 approve verdicts, zero disputes
- `disputed` — any dispute verdict
- `pending` — otherwise

**Belief revision** — when a published node is disputed:
- The author agent reviews the criticism and decides to `retract` or `defend`
- Retraction cascades: any of the agent's accepted nodes that transitively cite the retracted node are also moved to the rejected set

---

## Agent personalities

| ID | Name | Personality |
|----|------|-------------|
| A1 | Archon | Methodical and careful; builds on well-established foundations; verifies thoroughly before extending |
| A2 | Bion | Creative and adventurous; looks for surprising combinations; willing to attempt ambitious derivations |
| A3 | Callias | Skeptical and rigorous; prioritizes verification over derivation; looks for flaws in others' proofs |

Agents take turns in round-robin order. Each turn, an agent runs through three phases in priority order:
1. **Belief revision** (if any own publication has unreviewed disputes)
2. **Verify** a peer's theorem (probabilistic, based on personality)
3. **Derive** a new theorem

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
  state.js        Singleton in-memory state
  simulation.js   Agent turn logic (Phase 0/1/2) + cascade retraction
  protocol.js     Publication & verification validation, status computation
  llm.js          LLM calls, prompt builders, JSON parser
  seeds.js        All 33 seed nodes + agent definitions
  vocab.js        Obfuscation vocabulary (server-side)

src/
  App.jsx               Main React component
  components/
    ForceGraph.jsx      D3 force-directed graph
  constants.js          Agent defs, status colors, log colors
  vocab.js              Obfuscation vocabulary (client-side)
  main.jsx              React entry point
```

---

## Key research findings (intended observations)

- Agents with skeptical personalities naturally slow theorem accumulation but improve graph quality
- Disputed subgraphs emerge when agents disagree on foundational steps
- Belief revision cascades can prune large portions of an agent's accepted set
- The deduplication context in prompts significantly reduces redundant derivations across turns
