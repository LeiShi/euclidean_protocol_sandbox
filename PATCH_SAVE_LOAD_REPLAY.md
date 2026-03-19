# Euclid Protocol Sandbox — Patch Spec: Save / Load / Replay

---

## 1. Motivation

A simulation run produces a rich evolution history — agents discovering theorems, disputing each other, retracting beliefs, building derivation chains. Currently all of this is ephemeral: close the tab and it's gone. We need three capabilities:

1. **Save**: Export the complete history of a run to a file, including debug information (raw LLM prompts/responses) for post-hoc analysis.
2. **Load**: Import a saved file to continue the simulation from where it left off, with full agent state restored.
3. **Replay**: Step through a saved run turn-by-turn, watching the graph evolve, without making any LLM calls.

---

## 2. Design Decisions

### 2.1 Event-sourced vs. snapshot-based

Two approaches:

- **Full snapshots**: Store the complete graph + all agent states at every turn. Simple to implement, but grows linearly with (turns × graph size). A 100-turn run with 50 nodes would store 100 copies of the graph.
- **Event-sourced**: Store the initial state + a sequence of events (deltas). Replay by applying events sequentially from the initial state. Compact, but requires a replay engine and you can't jump to turn 73 without replaying turns 1–72.

**Choice: Hybrid.** Store events for every turn (compact, complete), plus periodic full snapshots every N turns (default N=10) for fast random-access during replay. The replay viewer can jump to the nearest snapshot and apply a few events forward rather than replaying from the beginning.

### 2.2 File format

A single `.json` file. Rationale: human-readable, easy to parse in any language, easy to inspect/grep, and the data is structured but not enormous (a typical run is hundreds of KB, not GB). Gzip compression is optional for large runs.

### 2.3 What counts as debug information

For each LLM call, capture: the system prompt, the user prompt, the raw response text (before JSON parsing), the parsed result (or parse error), latency in ms, and which provider/model was used. This is essential for diagnosing why an agent made a particular decision.

---

## 3. Save File Schema

```typescript
interface SaveFile {
  // ── Header ──────────────────────────────────────
  version: "1.0";
  format: "euclid-protocol-sandbox";
  created_at: string;               // ISO 8601 timestamp
  description?: string;             // Optional user-provided note

  // ── Configuration ───────────────────────────────
  config: {
    llm_provider: string;           // "gemini" | "claude" | "openai"
    llm_model: string;              // e.g. "gemini-3.1-pro-preview"
    required_approvals: number;     // threshold for acceptance (default: 2)
    agent_definitions: AgentDefinition[];  // name, personality, color
    vocabulary: Record<string, string>;    // obfuscation mapping used
  };

  // ── Initial State (turn 0) ──────────────────────
  initial_state: {
    graph: Record<string, GraphNode>;     // all seed nodes
    agents: AgentStateSnapshot[];         // all agents with initial accepted_set etc.
  };

  // ── Turn History ────────────────────────────────
  turns: TurnRecord[];

  // ── Periodic Snapshots (for fast replay seeking) ─
  snapshots: {
    interval: number;              // every N turns
    data: FullSnapshot[];          // snapshot at turn N, 2N, 3N, ...
  };

  // ── Summary Statistics ──────────────────────────
  summary: {
    total_turns: number;
    total_theorems: number;
    accepted_theorems: number;
    disputed_theorems: number;
    retracted_theorems: number;
    total_verifications: number;
    total_disputes: number;
    total_retractions: number;
    agents: AgentSummary[];
  };
}

interface AgentDefinition {
  id: string;
  name: string;
  color: string;
  personality: string;
}

interface AgentStateSnapshot {
  id: string;
  accepted_set: string[];          // serialized as array (Sets aren't JSON-native)
  rejected_set: string[];
  published: string[];
  reviewed_disputes: string[];
}

interface TurnRecord {
  turn: number;
  agent_id: string;
  phase: "revision" | "verify" | "derive";
  action: string;                  // "retract" | "defend" | "approve" | "dispute" | "publish" | "protocol_reject" | "error"
  timestamp: string;               // ISO 8601

  // ── What happened ───────────────────────────────
  detail: string;                  // human-readable summary
  target_node_id?: string;         // node being verified/revised (if applicable)
  published_node_id?: string;      // new node ID (if derivation)
  cascade_retracted?: string[];    // node IDs cascade-retracted (if retraction)

  // ── State delta ─────────────────────────────────
  delta: {
    // Nodes added or modified in the public graph
    graph_changes: {
      added?: Record<string, GraphNode>;     // new nodes
      modified?: Record<string, {            // changed nodes (e.g., new verification added)
        verifications_added?: Verification[];
      }>;
    };
    // Agent state changes
    agent_changes: {
      agent_id: string;
      added_to_accepted?: string[];
      removed_from_accepted?: string[];
      added_to_rejected?: string[];
      added_to_published?: string[];
      added_to_reviewed_disputes?: string[];
    };
  };

  // ── Debug / LLM trace ───────────────────────────
  debug: {
    llm_provider: string;
    llm_model: string;
    system_prompt: string;
    user_prompt: string;
    raw_response: string;
    parsed_response: any;          // the parsed JSON, or null if parse failed
    parse_error?: string;          // if JSON parsing failed
    latency_ms: number;
    prompt_tokens?: number;        // if available from API response
    completion_tokens?: number;
  } | null;                        // null if the turn didn't involve an LLM call (e.g., protocol_reject before LLM)
}

interface FullSnapshot {
  after_turn: number;
  graph: Record<string, GraphNode>;
  agents: AgentStateSnapshot[];
}

interface AgentSummary {
  id: string;
  name: string;
  theorems_published: number;
  theorems_accepted: number;
  theorems_retracted: number;
  verifications_performed: number;
  disputes_issued: number;
  approvals_issued: number;
}
```

### 3.1 File naming convention

Auto-generated: `euclid_run_{YYYY-MM-DD}_{HH-mm-ss}_{total_turns}turns.json`

Example: `euclid_run_2026-03-19_14-30-22_54turns.json`

### 3.2 File size estimates

- 33 seed nodes: ~15 KB
- Per turn (event + debug with full prompts): ~8–15 KB
- Per snapshot: ~2–5 KB per node in graph
- A 100-turn run: roughly 1–2 MB uncompressed
- A 500-turn run: roughly 5–10 MB uncompressed

Manageable without compression for typical runs. For long runs (1000+ turns), offer optional gzip download.

---

## 4. Save Implementation

### 4.1 Continuous recording

Recording should happen **during the simulation**, not as a post-hoc export. The system maintains a `TurnRecord[]` array in memory that grows with each turn. This ensures no data is lost if the user forgets to save before navigating away.

Modify the agent turn execution to capture debug info:

```
// Wrap every LLM call to capture timing and full request/response
async function callLLMWithTrace(provider, apiKey, systemPrompt, userPrompt) {
  const start = Date.now();
  const rawResponse = await callLLM(provider, apiKey, systemPrompt, userPrompt);
  const latency = Date.now() - start;
  return {
    raw: rawResponse,
    trace: {
      llm_provider: provider,
      llm_model: getCurrentModel(provider),
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      raw_response: rawResponse,
      latency_ms: latency,
    }
  };
}
```

After each turn completes, construct the `TurnRecord` with the delta and debug info, and push it to the history array. Every N turns, also capture a `FullSnapshot`.

### 4.2 Export

Add a "Save Run" button to the UI. When clicked:

1. Assemble the `SaveFile` object from in-memory state
2. Compute the `summary` statistics by scanning the turn history
3. Serialize as JSON with 2-space indentation
4. Trigger browser download (or save to disk in the Node.js backend)

Also offer "Auto-save" toggle: automatically saves to a file every M turns (default M=20), overwriting the previous auto-save. This protects against browser crashes.

### 4.3 Backend endpoint

```
POST /api/save → returns the save file as JSON download
GET  /api/autosave/status → whether autosave is on, last save timestamp
POST /api/autosave/configure → set interval, toggle on/off
```

---

## 5. Load Implementation

### 5.1 Full state restoration

"Load Run" accepts a save file and restores:

1. **Configuration**: LLM provider, model, vocabulary, agent definitions
2. **Graph**: Reconstruct from the latest snapshot, then apply any subsequent turn deltas
3. **Agent states**: Restore `accepted_set`, `rejected_set`, `published`, `reviewed_disputes` from the latest snapshot + deltas
4. **Turn counter**: Set to `total_turns` from the save file
5. **Node ID counter**: Set to the highest T-number in the graph + 1
6. **Event log**: Restore from turn records
7. **Turn history**: Restore the full `TurnRecord[]` array so future saves include the complete history

After loading, the simulation is ready to continue — pressing "Step" picks up from the next turn with full context.

### 5.2 Validation on load

Before restoring, validate:
- `version` is supported (currently only "1.0")
- `format` is "euclid-protocol-sandbox"
- All seed nodes (D01–D23, P1–P5, CN1–CN5) are present in `initial_state.graph`
- Agent state sets reference valid node IDs
- Turn records are sequential and complete

If validation fails, show a specific error message and don't load.

### 5.3 Backend endpoint

```
POST /api/load   (body: save file JSON) → restores state, returns current state
```

### 5.4 UI

Add a "Load Run" button next to "Save Run". Opens a file picker. After loading, show a brief toast: "Loaded run from {date} — {N} turns, {M} theorems. Ready to continue."

---

## 6. Replay Implementation

### 6.1 Replay mode

Replay mode is a distinct UI state where:
- LLM calls are disabled (no API key needed)
- The graph and agent states are reconstructed from the save file at each step
- The user scrubs through history rather than generating new turns
- All controls change to replay controls

### 6.2 State reconstruction for arbitrary turns

To display the state at turn T:

1. Find the latest snapshot at or before T: `snapshot = snapshots.data.findLast(s => s.after_turn <= T)`
2. If no snapshot (T < first snapshot interval), use `initial_state`
3. Apply turn deltas from `snapshot.after_turn + 1` through `T`
4. Render the resulting graph and agent states

With snapshots every 10 turns, seeking to any turn requires at most 9 delta applications. This is near-instant.

### 6.3 Replay controls

Replace the normal simulation controls with:

```
[|◁ First] [◁ Prev] [▷ Next] [Last ▷|]     Turn: [===●==========] 37 / 54
                                              
[▶ Play] [⏸ Pause]  Speed: [1x ▼]           [Exit Replay]
```

- **Scrubber**: Drag to any turn. Updates graph + agent panels + log instantly.
- **Prev / Next**: Step one turn at a time.
- **Play**: Auto-advance at configurable speed (0.5x, 1x, 2x, 5x). Default interval: 1.5s per turn at 1x.
- **First / Last**: Jump to beginning or end.
- **Exit Replay**: Return to live simulation mode (only if the run was loaded for continuation, not replay-only).

### 6.4 Turn detail panel

During replay, show an expanded detail panel for the current turn:

```
┌────────────────────────────────────────────┐
│ TURN 37 — Bion (A2) — Phase: derive       │
│ Action: publish                            │
│ Published [T012]: "If two true traces..."  │
│ Cites: T003, P1, D08                      │
│                                            │
│ [Show Debug ▼]                             │
│ ┌────────────────────────────────────────┐ │
│ │ LLM: gemini-3.1-pro-preview           │ │
│ │ Latency: 2340ms                        │ │
│ │ System prompt: (collapsible)           │ │
│ │ User prompt: (collapsible)             │ │
│ │ Raw response: (collapsible)            │ │
│ │ Parsed JSON: (collapsible)             │ │
│ └────────────────────────────────────────┘ │
├────────────────────────────────────────────┤
│ Δ Graph: +T012 (new node)                 │
│ Δ Bion: accepted +T012, published +T012   │
└────────────────────────────────────────────┘
```

The debug section is collapsed by default — click to expand. This is where you inspect the full prompts and raw LLM output to understand why an agent made a particular choice.

### 6.5 Visual diff highlighting

When stepping through replay, highlight what changed on the current turn:

- **New node**: Pulsing glow animation on the newly added node in the graph
- **New verification**: Flash the border of the verified node (green flash for approve, red for dispute)
- **Retraction**: Node fades from its agent color to grey, plus any cascade-retracted nodes
- **Citation edges**: New edges added this turn render with a brief animated draw-in effect

This makes it easy to visually track the evolution without reading the log.

### 6.6 Replay filtering and search

For studying specific aspects of a run:

- **Filter by agent**: Show only turns by a specific agent (others greyed out in the scrubber)
- **Filter by action**: Show only publish / dispute / retract turns
- **Search by claim text**: Find the turn where a specific theorem was published or disputed (searches both obfuscated and de-obfuscated text)
- **Highlight derivation chain**: Click a node in replay mode → highlight all its ancestors (citations) and descendants (nodes that cite it) in the graph, and mark the turns where each was published in the scrubber

### 6.7 Backend endpoint

Replay is purely frontend — no backend endpoints needed. The save file contains everything required.

However, if loading a large save file for replay-only (not continuation), the backend doesn't need to restore simulation state:

```
POST /api/replay/load   → validates the file, returns it as-is for the frontend to use
```

---

## 7. UI Changes Summary

### 7.1 New buttons in the control bar

```
[Step] [Run 3 rounds] [Stop]  |  [Save Run] [Load Run]  |  [Show Vocab]
```

"Save Run" and "Load Run" are always visible. "Load Run" opens a file picker. When a file is loaded, show a dialog:

```
┌──────────────────────────────────────────┐
│  Loaded: euclid_run_2026-03-19_54turns   │
│  54 turns, 12 theorems (8 accepted)      │
│                                          │
│  [Continue Simulation]  [Replay Mode]    │
└──────────────────────────────────────────┘
```

- **Continue Simulation**: Restores full state, enables LLM calls, picks up where the run left off.
- **Replay Mode**: Enters replay viewer, no LLM calls, read-only.

### 7.2 Replay mode visual indicator

When in replay mode, show a banner at the top:

```
▶ REPLAY MODE — Turn 37 / 54 — euclid_run_2026-03-19_54turns.json    [Exit Replay]
```

The banner uses a distinct color (e.g., amber background) so the user always knows they're in replay, not live simulation.

---

## 8. Export Formats (Future Extension)

The save file is the canonical format. But for analysis in external tools, offer additional export options:

- **Graph-only export** (`.graphml` or `.dot`): Just the final graph topology with node metadata, importable into Gephi, Graphviz, etc.
- **Log-only export** (`.csv`): Turn records as flat CSV for spreadsheet analysis (turn, agent, action, node_id, claim_deobfuscated, verdict, latency_ms)
- **Prompt archive** (`.jsonl`): One JSON object per LLM call, for fine-tuning or prompt engineering analysis

These are secondary to the core save/load/replay and can be added later.

---

## 9. Implementation Checklist

| # | Task | Priority |
|---|------|----------|
| 1 | Add `TurnRecord` accumulation during simulation (capture deltas + debug) | High |
| 2 | Add `callLLMWithTrace` wrapper to capture prompts/responses/latency | High |
| 3 | Add periodic snapshot capture every N turns | High |
| 4 | Implement "Save Run" button + file assembly + download | High |
| 5 | Implement "Load Run" + file validation + state restoration | High |
| 6 | Implement replay mode state machine (replay vs live) | High |
| 7 | Implement replay scrubber + prev/next/play/pause controls | High |
| 8 | Implement state reconstruction from snapshots + deltas | High |
| 9 | Turn detail panel with collapsible debug info | Medium |
| 10 | Visual diff highlighting (glow, flash, fade) on replay step | Medium |
| 11 | Replay filtering by agent/action | Medium |
| 12 | Search by claim text (obfuscated + de-obfuscated) | Medium |
| 13 | Derivation chain highlighting on node click in replay | Low |
| 14 | Auto-save toggle | Low |
| 15 | Additional export formats (graphml, csv, jsonl) | Low |
