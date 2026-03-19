# Euclid Protocol Sandbox — Implementation Spec

## 1. Project Overview

This is a **proof-of-concept simulation** for testing a knowledge-graph protocol designed for multi-agent epistemic collaboration. The simulation seeds a formal axiomatic system (Euclidean geometry, with obfuscated vocabulary) and spawns 3 LLM-powered agents that reason, publish theorems, and verify each other's work **strictly through the protocol**. The goal is to observe whether the protocol produces a healthy, growing, self-correcting knowledge graph — or decays into chaos and garbage.

This is part of a larger research project on information vetting and citation systems for AI agents. The Euclidean geometry domain was chosen because it has an objective, verifiable ground truth, allowing us to measure the protocol's epistemic output quality independently.

### Key Research Questions
- Does the protocol produce a reasonable set of geometry theorems discovered gradually?
- Do disputed nodes get resolved, or do disputes pile up?
- Do agents build deep derivation chains or stay shallow?
- What fraction of "accepted" nodes are actually valid theorems?

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│                  Web Frontend                    │
│  (React + d3 force graph + control panel)        │
├─────────────────────────────────────────────────┤
│                  Backend Server                  │
│  (Node.js / Express or similar)                  │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Protocol Layer │  │ LLM Integration Layer  │  │
│  │ (validation,   │  │ (switchable: Gemini,   │  │
│  │  status, rules)│  │  Claude, OpenAI)       │  │
│  └───────────────┘  └────────────────────────┘  │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Agent Manager  │  │ Simulation Controller  │  │
│  │ (state, turns) │  │ (step, run N, stop)    │  │
│  └───────────────┘  └────────────────────────┘  │
├─────────────────────────────────────────────────┤
│              In-Memory Graph Store               │
│  (public graph + per-agent private state)        │
└─────────────────────────────────────────────────┘
```

**Why a backend is needed:** LLM API calls (Gemini, Claude, OpenAI) must happen server-side to avoid browser CORS restrictions. The frontend communicates with the backend via REST or WebSocket.

---

## 3. The Protocol Layer

This is the core of the experiment — the protocol being tested. It enforces the rules that all agent interactions must conform to.

### 3.1 Node Types

There are four node types in the graph:

| Type | ID Pattern | Verifiable? | Description |
|------|-----------|-------------|-------------|
| `definition` | D01–D23 | No | Vocabulary agreements (Euclid's 23 definitions) |
| `postulate` | P1–P5 | No | Constructive axioms |
| `common_notion` | CN1–CN5 | No | Rules of equality/comparison |
| `theorem` | T001, T002, ... | Yes | Agent-derived results |

### 3.2 Node Schema

```typescript
interface GraphNode {
  id: string;                // Unique ID
  type: "definition" | "postulate" | "common_notion" | "theorem";
  author: string;            // Agent ID or "SYSTEM" for seeds
  claim: string;             // The statement (in obfuscated vocabulary)
  proof_steps: ProofStep[];  // Empty for seed nodes
  cites: string[];           // Node IDs this node depends on (empty for seeds)
  verifications: Verification[];
  confidence?: string;       // "high" | "medium" | "low" (self-assessed by author)
}

interface ProofStep {
  step: number;
  claim: string;
  justification: string;
  cites: string[];           // Which prior nodes this step relies on
}

interface Verification {
  agentId: string;
  verdict: "approve" | "dispute";
  justification: string;
  reasoning?: string;
}
```

### 3.3 Publication Validation Rules

When an agent publishes a new theorem node, the protocol layer checks:

1. **Required fields present:** id, author, claim, proof_steps, cites
2. **Non-empty citations:** `cites.length > 0` (theorems must cite at least one predecessor)
3. **Citation existence:** Every ID in `cites` must exist in the public graph
4. **No duplicate IDs:** The node ID must not already exist in the graph
5. **Citation from accepted set:** Every ID in `cites` must be in the publishing agent's `accepted_set` (agents can only build on what they personally trust)

If any check fails, the publication is rejected with a specific error, and the rejection is logged.

### 3.4 Verification Validation Rules

When an agent submits a verification, the protocol checks:

1. **Target exists:** The target node must exist in the public graph
2. **Not a seed node:** Definitions, postulates, and common notions cannot be verified
3. **No self-verification:** An agent cannot verify a node they authored
4. **No duplicate verification:** Each agent can only verify each node once
5. **Valid verdict:** Must be "approve" or "dispute"
6. **Justification required for disputes:** Disputes must include a justification string

### 3.5 Status Transitions

A theorem node's status is computed from its verifications:

- **pending:** No verifications yet, or has some approvals but hasn't met the threshold
- **accepted:** Has received `requiredApprovals` (default: 2) approve verdicts AND zero dispute verdicts
- **disputed:** Has at least one dispute verdict

Seed nodes (definitions, postulates, common notions) always have status "axiom."

---

## 4. Agent Design

### 4.1 Agent State

Each agent maintains private state separate from the public graph:

```typescript
interface AgentState {
  id: string;                    // "A1", "A2", "A3"
  name: string;                  // "Archon", "Bion", "Callias"
  personality: string;           // Influences behavior (see below)
  accepted_set: Set<string>;     // Node IDs personally verified and approved
  rejected_set: Set<string>;     // Node IDs personally verified and disputed
  published: Set<string>;        // Node IDs this agent authored
}
```

The three sets (`accepted_set`, `rejected_set`, `published`) partition the agent's view of every theorem in the public graph:
- **Unverified frontier** = all theorem nodes NOT in any of the three sets
- An agent will never re-evaluate a node already in `accepted_set` or `rejected_set`
- An agent's own publications are auto-added to their `accepted_set`

### 4.2 Agent Definitions

| ID | Name | Personality | Behavioral Tendency |
|----|------|------------|---------------------|
| A1 | Archon | Methodical and careful, prefers building on well-established foundations, verifies thoroughly before extending | Balanced verify/derive |
| A2 | Bion | Creative and adventurous, looks for surprising combinations of existing results, willing to attempt ambitious derivations | Skews toward derivation |
| A3 | Callias | Skeptical and rigorous, prioritizes verification over derivation, looks for flaws in others' proofs | Skews toward verification |

### 4.3 Agent Turn Logic

Agents take turns in round-robin order: A1 → A2 → A3 → A1 → ...

Each turn, an agent does ONE of the following:

**Option A: Verify an existing node**
1. Compute `unverified = public_graph.theorems - accepted_set - rejected_set - published`
2. Filter to nodes whose cited predecessors are ALL in the agent's `accepted_set` (can't verify what you can't trace)
3. If verifiable nodes exist, pick one (random or by priority)
4. Call the LLM with the verification prompt (see Section 6)
5. Parse the LLM's JSON response
6. Run the verification through protocol validation
7. If valid: add to `accepted_set` or `rejected_set` accordingly; record verification on the public graph node
8. Log the event

**Option B: Derive a new theorem**
1. Call the LLM with the derivation prompt containing all nodes in the agent's `accepted_set`
2. Parse the LLM's JSON response
3. Check that ALL cited node IDs are in the agent's `accepted_set`
4. Assign a new sequential ID (T001, T002, ...)
5. Run the publication through protocol validation
6. If valid: add node to the public graph; add to the agent's `accepted_set` and `published` set
7. Log the event

**Decision heuristic** for whether to verify or derive:
- If `unverified` (and verifiable) nodes exist AND (agent is "skeptical" OR random < 0.5): verify
- Otherwise: derive

---

## 5. Obfuscation Layer

### 5.1 Purpose

LLMs have memorized Euclidean geometry from training data. To force genuine reasoning from axioms rather than recitation, ALL communication uses an obfuscated vocabulary. Agents never see standard geometry terms.

### 5.2 Vocabulary Mapping

```javascript
const VOCAB = {
  point: "mark",
  line: "trace",
  circle: "ring",
  angle: "spread",
  triangle: "triad",
  right_angle: "square spread",
  parallel: "co-running",
  congruent: "matched",
  equal: "alike",
  perpendicular: "cross-standing",
  bisect: "halve",
  segment: "span",
  ray: "beam",
  straight: "true",
  plane: "field",
  distance: "gap",
  midpoint: "center mark",
  equilateral: "all-alike-span",
  isosceles: "two-alike-span",
  scalene: "no-alike-span",
  acute: "narrow spread",
  obtuse: "wide spread",
  polygon: "closed trace figure",
  quadrilateral: "four-trace figure",
  rectangle: "all-square-spread figure",
  square: "alike-span square-spread figure",
  radius: "ring-span",
  diameter: "full ring-span",
  circumference: "ring-path",
  arc: "ring-part",
  chord: "ring-cut",
  tangent: "ring-touch",
  exterior: "outside",
  interior: "inside",
  adjacent: "neighboring",
  supplementary: "completing spreads",
  complementary: "half-completing spreads",
  vertical_angles: "cross-spreads",
  corresponding: "echo-placed",
  alternate: "flip-placed",
  transversal: "crossing trace",
};
```

### 5.3 De-obfuscation (Human View Only)

The frontend provides a de-obfuscation function that translates obfuscated terms back to standard geometry terms. This is displayed ONLY to the human observer, never to agents. When displaying a node's detail, show both:
- **AGENT VIEW:** The raw obfuscated text (what agents see)
- **HUMAN VIEW:** The de-obfuscated text (standard geometry terms)

The de-obfuscation function should sort terms by length descending before replacing, so multi-word terms like "square spread" get matched before "spread."

---

## 6. Seed Nodes

The system starts with 33 seed nodes, all authored by "SYSTEM" and pre-loaded into every agent's `accepted_set`.

### 6.1 Definitions (D01–D23)

```
D01: "A mark is that which has no part."
D02: "A trace is breadthless length."
D03: "The extremities of a trace are marks."
D04: "A true trace is a trace which lies evenly with the marks on itself."
D05: "A surface is that which has length and breadth only."
D06: "The extremities of a surface are traces."
D07: "A flat surface, or field, is a surface which lies evenly with the true traces on itself."
D08: "A field spread is the inclination to one another of two traces in a field which meet one another and do not lie in a true trace."
D09: "When the traces containing the spread are true, the spread is called a true-trace spread."
D10: "When a true trace standing on a true trace makes the neighboring spreads alike to one another, each of the alike spreads is a square spread, and the true trace standing on the other is called cross-standing to that on which it stands."
D11: "A wide spread is a spread greater than a square spread."
D12: "A narrow spread is a spread less than a square spread."
D13: "A boundary is that which is an extremity of anything."
D14: "A figure is that which is contained by any boundary or boundaries."
D15: "A ring is a field figure contained by one trace such that all the true traces falling upon it from one mark among those lying within the figure are alike to one another."
D16: "And that mark is called the center mark of the ring."
D17: "A full ring-span is any true trace drawn through the center mark and terminated in both directions by the ring-path, and such a true trace also halves the ring."
D18: "A half-ring is the figure contained by the full ring-span and the ring-path cut off by it."
D19: "True-trace figures are those contained by true traces: triads being those contained by three, four-trace figures by four, and many-trace figures by more than four true traces."
D20: "Of triads, an all-alike-span triad has its three spans alike, a two-alike-span triad has two of its spans alone alike, and a no-alike-span triad has its three spans all unalike."
D21: "Further, of triads: a square-spread triad has a square spread, a wide-spread triad has a wide spread, and a narrow-spread triad has three narrow spreads."
D22: "Of four-trace figures: an alike-span square-spread figure is both all-alike-span and all-square-spread; a long figure is square-spread but not alike-span; a tilt-alike figure is alike-span but not square-spread; and a tilt-long figure has its opposite spans and spreads alike to one another but is neither alike-span nor square-spread."
D23: "Co-running true traces are true traces which, being in the same field and being extended indefinitely in both directions, do not meet one another in either direction."
```

### 6.2 Postulates (P1–P5)

```
P1: "A true trace can be drawn from any mark to any mark."
P2: "A finite true trace can be extended continuously in a true trace."
P3: "A ring can be described with any center mark and any gap."
P4: "All square spreads are alike to one another."
P5: "If a true trace falling on two true traces makes the inside spreads on the same side less than two square spreads, the two true traces, if extended indefinitely, meet on that side."
```

### 6.3 Common Notions (CN1–CN5)

```
CN1: "Things which are alike to the same thing are alike to one another."
CN2: "If alikes are added to alikes, the wholes are alike."
CN3: "If alikes are subtracted from alikes, the remainders are alike."
CN4: "Things which coincide with one another are alike to one another."
CN5: "The whole is greater than the part."
```

---

## 7. LLM Integration

### 7.1 Switchable Backend

The LLM provider must be configurable. Support at minimum:

| Provider | Model | Auth |
|----------|-------|------|
| Gemini | `gemini-3.1-flash-preview` | API key as query param |
| Claude | `claude-sonnet-4-20250514` | API key in header |
| OpenAI | `gpt-4o-mini` | API key in Bearer header |

The provider and API key should be configurable via environment variable or UI setting. API calls happen **server-side** to avoid CORS.

### 7.2 System Prompt (shared by all agents, personalized by name/personality)

```
You are {agent.name}, a reasoning agent in a formal axiomatic system. You are {agent.personality}.

CRITICAL RULES:
- You operate in a formal system with specific terminology. NEVER use standard geometry terms.
- The vocabulary of this system uses: marks (fundamental objects), traces (connections between marks), rings (curved figures), spreads (measures between traces), triads (three-mark figures), etc.
- You must reason ONLY from the axioms and previously established results provided to you. Do NOT rely on any external knowledge.
- Every claim must be justified by explicit reference to specific axiom or theorem IDs.
- Your proofs must be step-by-step, with each step citing exactly which prior result it uses.

You must respond ONLY in valid JSON with no markdown formatting, no backticks, no preamble. Just raw JSON.
```

### 7.3 Derivation Prompt

Present the agent's accepted knowledge base in three tiers:

```
Here is your complete accepted knowledge base, organized by tier:

=== DEFINITIONS (vocabulary of the system) ===
[D01]: A mark is that which has no part.
[D02]: A trace is breadthless length.
... (all definitions)

=== POSTULATES (constructive axioms) ===
[P1]: A true trace can be drawn from any mark to any mark.
... (all postulates)

=== COMMON NOTIONS (rules of equality and comparison) ===
[CN1]: Things which are alike to the same thing are alike to one another.
... (all common notions)

=== ACCEPTED THEOREMS (previously derived and verified) ===
[T001]: ... (or "No theorems derived yet")

Nodes in the public graph you have NOT yet verified:
[T003]: ... (status: pending)

Your task: Derive a NEW result that follows logically from your accepted knowledge base. The result should be non-trivial and not a simple restatement of an existing result. Think about what interesting consequences follow from combining definitions, postulates, common notions, and any existing theorems. You may cite definitions when using defined terms.

Respond with ONLY this JSON (no markdown, no backticks):
{
  "theorem_claim": "A clear statement of your new result using only system vocabulary",
  "proof_steps": [
    {"step": 1, "claim": "...", "justification": "...", "cites": ["P1", "D03"]},
    {"step": 2, "claim": "...", "justification": "...", "cites": ["CN1", "P3"]}
  ],
  "all_cited_ids": ["P1", "P3", "CN1", "D03"],
  "confidence": "high/medium/low"
}
```

### 7.4 Verification Prompt

```
You are verifying a claimed result published by another agent. Your job is to check whether the proof is logically valid given the cited predecessors.

Your accepted knowledge base:

=== DEFINITIONS ===
... (all definitions)

=== POSTULATES ===
... (all postulates)

=== COMMON NOTIONS ===
... (all common notions)

=== ACCEPTED THEOREMS ===
... (if any)

Node to verify [{target.id}] by agent {target.author}:
Claim: {target.claim}
Proof steps:
  Step 1: {claim} [justification: ...] [cites: P1, D03]
  Step 2: ...
Cited predecessors: P1, D03, CN1

Check:
1. Are all cited predecessors in your accepted set? (Required to proceed)
2. Does each proof step logically follow from its cited predecessors and the definitions?
3. Does the final claim follow from the proof steps?
4. Are there any gaps, circular reasoning, or unjustified leaps?
5. Are defined terms used consistently with their definitions?

Respond with ONLY this JSON (no markdown, no backticks):
{
  "verdict": "approve" or "dispute",
  "reasoning": "Your step-by-step analysis of the proof",
  "problem_step": null or step_number_where_error_is,
  "justification": "If disputing, explain the specific flaw"
}
```

### 7.5 JSON Parsing

LLMs sometimes wrap JSON in markdown backticks or add preamble. The parser should:
1. Strip leading/trailing whitespace
2. Remove ```json and ``` wrappers
3. Find the first `{` and last `}` and extract that substring
4. Parse as JSON
5. On failure, log the raw response for debugging

---

## 8. Frontend

### 8.1 Layout

```
┌──────────────────────────────────────────────────────┐
│ HEADER: Title | LLM provider dropdown | API key input│
├──────────────────────────────────────────────────────┤
│ CONTROLS: [Step] [Run 3 rounds] [Stop] [Vocab]      │
│ STATS: Turn | Seeds: 23D+10P | Theorems | Accepted   │
├────────────────────────────┬─────────────────────────┤
│                            │  Agent: Archon (A1)     │
│   FORCE-DIRECTED GRAPH     │  Accepted: 33           │
│   (d3.js)                  │  Rejected: 0            │
│                            │  Published: 0           │
│   - Click nodes to inspect ├─────────────────────────┤
│   - Drag to rearrange      │  Agent: Bion (A2)       │
│   - Scroll to zoom         │  ...                    │
│                            ├─────────────────────────┤
│                            │  Agent: Callias (A3)    │
│                            │  ...                    │
├────────────────────────────┼─────────────────────────┤
│ NODE DETAIL PANEL          │  EVENT LOG              │
│ [D05] DEFINITION  axiom    │  Archon [derive_start]  │
│ AGENT: A surface is that.. │  Archon [publish] T001  │
│ HUMAN: A surface is that.. │  Bion [verify_start]    │
│ Proof steps (if theorem)   │  Bion [approve] T001    │
│ Verifications              │  ...                    │
└────────────────────────────┴─────────────────────────┘
```

### 8.2 Graph Visualization

Use d3 force-directed graph. Node appearance:

| Node Type | Radius | Fill Color | Opacity | Label Font |
|-----------|--------|------------|---------|------------|
| definition | 7 | #374151 (dark grey) | 0.7 | 7px |
| postulate / common_notion | 10 | #4b5563 (grey) | 0.92 | 9px |
| theorem | 14 | Agent color | 0.92 | 9px |

Agent colors: Archon=#e07a5f (terracotta), Bion=#3d85c6 (blue), Callias=#81b29a (sage)

Node border color indicates status:
- axiom: #9ca3af (grey)
- accepted: #22c55e (green)
- pending: #f59e0b (amber)
- disputed: #ef4444 (red)

Selected node gets thicker border (4px vs 2.5px).

Directed edges (arrows) from cited node → citing node, using d3 markers.

Force simulation tuning:
- Definitions: weaker charge (-60), smaller collision radius (12), shorter link distance (40)
- Other nodes: standard charge (-200), collision radius (25), link distance (80)

### 8.3 Node Detail Panel

When a node is clicked, show:
- Header: Node ID + type label + status badge
- **AGENT VIEW** (grey, italic): The obfuscated claim text
- **HUMAN VIEW** (gold): The de-obfuscated claim text
- For theorems:
  - Author name + cited node IDs
  - Each proof step, with de-obfuscated translation shown below (↳ prefix)
  - Verification records with verdicts and justifications

### 8.4 Agent Panels

Clickable panels for each agent showing:
- Name (in agent color) + ID
- Counts: accepted / rejected / published
- Expandable: personality description + full list of accepted/rejected IDs

Active agent (whose turn it is) gets a highlighted border and glow effect.

### 8.5 Event Log

Reverse-chronological log with color-coded entries:
- publish: blue
- approve: green
- dispute: red
- verify_start / derive_start: purple
- protocol_reject: amber
- error: red

Each entry shows: agent name (in agent color) + [action] + detail text.

### 8.6 Controls

- **Step**: Execute one agent turn (show whose turn it is)
- **Run 3 rounds (9 steps)**: Execute 9 turns sequentially with ~300ms delay
- **Stop**: Abort a running batch
- **Show/Hide Vocabulary**: Toggle the obfuscation mapping display

---

## 9. Event Logging Schema

```typescript
interface LogEntry {
  turn: number;
  agent: string;           // Agent ID or "SYSTEM"
  action: "init" | "derive_start" | "publish" | "verify_start" |
          "approve" | "dispute" | "protocol_reject" | "error";
  detail: string;          // Human-readable description
  ts: number;              // Timestamp
  raw_llm_response?: string;  // Optional: full LLM response for debugging
}
```

---

## 10. API Endpoints (Backend)

Suggested REST API:

```
GET  /api/state              → Full graph + agent states + stats
POST /api/step               → Execute one agent turn, return updated state
POST /api/run                → Execute N turns, stream updates via SSE or WebSocket
POST /api/stop               → Abort a running batch
GET  /api/node/:id           → Full node detail with de-obfuscated text
GET  /api/log                → Event log (with pagination)
POST /api/config             → Update provider, API key, model settings
```

Alternatively, a WebSocket approach where the frontend connects once and receives real-time updates as each turn completes may provide a smoother UX.

---

## 11. Running the Project

```bash
# Install dependencies
npm install

# Set environment variables (or configure via UI)
export LLM_PROVIDER=gemini
export LLM_API_KEY=your_key_here
export LLM_MODEL=gemini-3.1-flash-preview

# Start the server
npm run dev

# Open http://localhost:3000
```

---

## 12. Future Extensions (Not in v1, but design with them in mind)

- **Token economy**: Each publication and verification costs/earns tokens. Agents have budgets.
- **Adversarial agents**: Agents that publish plausible but subtly wrong theorems, or rubber-stamp everything.
- **Configurable honesty**: Slider for each agent's probability of careful vs lazy verification.
- **Ground-truth oracle**: Post-hoc comparison of accepted nodes against known Euclid propositions.
- **Axiom mutation**: Swap in modified postulates to create a novel formal system where no LLM has memorized the theorems.
- **Export**: Save the full graph state + log as JSON for offline analysis.
- **Replay**: Step backward through the simulation history.

---

## 13. Reference: Existing Code

There is a working React artifact in this project's chat history (`euclid_protocol_sandbox.jsx`) that implements most of the logic above as a single-file browser app. It works except for the LLM API calls, which fail due to browser CORS restrictions. The protocol layer, agent state management, graph visualization, obfuscation, de-obfuscation, and UI are all implemented there and can be used as reference. The main change needed is moving the LLM calls to a server-side backend.
