# Euclid Protocol Sandbox — Patch Spec: Conjecture System

---

## 1. Motivation

Agents produce theorems that contain implicit assumptions — claims introduced in a proof step that are not justified by any cited predecessor. The most notable example: "if two circles meet at a point" is assumed without proof in the construction of an equilateral triangle (historically, this is the exact gap in Euclid's Proposition 1 that wasn't resolved until Hilbert's axiomatization).

Currently, the protocol has no way to represent this. Agents either approve the theorem (ignoring the hidden assumption) or dispute it (losing the valid reasoning). We need a middle path: a theorem can be **conditionally accepted** — its proof logic is sound, but it depends on one or more unproven claims (conjectures).

This patch adds conjectures as a first-class node type, conditional acceptance as a node state, and the cascade rules that propagate conditionality through the graph.

**Design principle:** The protocol layer defines types, states, edges, and cascades. It does NOT make judgment calls about whether a claim should be a conjecture, whether a theorem should be abandoned, or whether a conjecture looks plausible. Those are agent decisions. The protocol just computes the consequences.

---

## 2. New Node Type: Conjecture

### 2.1 Definition

A **conjecture** is a published claim that the author explicitly acknowledges is unproven. It has no proof steps. It serves as a named placeholder for an assumption that other theorems may depend on.

### 2.2 Schema

```typescript
interface ConjectureNode {
  id: string;                  // "C001", "C002", ...
  type: "conjecture";
  author: string;              // Agent ID
  claim: string;               // The unproven statement
  motivation?: string;         // Why the author thinks this might be true
  cites: string[];             // Nodes that motivated this conjecture (optional context, not logical dependencies)
  proof_steps: [];             // Always empty — conjectures have no proof
  verifications: Verification[];
  resolved_by?: string;        // Node ID of the theorem that proved/disproved this (set by cascade)
}
```

### 2.3 Publication validation

Conjecture publication follows the same protocol validation as theorems, with these differences:

- `proof_steps` MUST be empty (a conjecture with proof steps is a theorem, not a conjecture)
- `cites` MAY be empty (a conjecture can be a freestanding open question)
- Self-verification ban still applies
- ID pattern: `C001`, `C002`, ... (separate counter from theorems)

### 2.4 Conjecture states

| State | Condition |
|-------|-----------|
| `open` | Default state. The claim is unproven. |
| `proven` | A theorem has been accepted that establishes this claim. Set by promotion cascade (Section 5). |
| `disproven` | A theorem has been accepted that contradicts this claim. Set by collapse cascade (Section 6). |

State transitions for conjectures:
```
open → proven      (when a resolving theorem is accepted)
open → disproven   (when a contradicting theorem is accepted)
```

Once a conjecture is `proven` or `disproven`, it does not change state again.

### 2.5 Verification of conjectures

Agents CAN verify conjectures, but the semantics are different from theorem verification:

- `approve` on a conjecture means "I believe this is likely true and worth depending on" (an endorsement, not a proof)
- `dispute` on a conjecture means "I believe this is likely false or ill-formed"

Conjecture verifications do NOT change the conjecture's state — only a resolving or contradicting theorem does. But verification records are preserved for agents to read as social signal when deciding whether to depend on the conjecture.

---

## 3. New Edge Types

Currently all citation edges are implicit "support" relationships. With conjectures, we need to distinguish edge types.

### 3.1 Edge type definitions

| Edge Type | Meaning | When Created |
|-----------|---------|--------------|
| `support` | Normal logical dependency. The citing node's proof uses the cited node as a justified premise. | A theorem cites a definition, postulate, common notion, or accepted theorem. |
| `conditional` | The citing node's proof depends on an unproven claim. | A theorem cites a conjecture (directly), OR a theorem cites a conditional theorem (transitively). |
| `resolves` | The citing theorem, once accepted, proves the cited conjecture. | An agent publishes a theorem and explicitly marks it as resolving a conjecture. |
| `contradicts` | The citing theorem, once accepted, disproves the cited conjecture. | An agent publishes a theorem and explicitly marks it as contradicting a conjecture. |

### 3.2 Edge type determination (protocol-computed)

Agents do NOT manually label edge types. The protocol computes them from the cited node's type and state:

```
function computeEdgeType(citingNode, citedNodeId, graph):
  citedNode = graph[citedNodeId]

  // Explicit resolution/contradiction (declared by the author)
  if citingNode.resolves and citedNodeId in citingNode.resolves:
    return "resolves"
  if citingNode.contradicts and citedNodeId in citingNode.contradicts:
    return "contradicts"

  // Citing a conjecture → conditional edge
  if citedNode.type === "conjecture" and citedNode.status !== "proven":
    return "conditional"

  // Citing a conditional theorem → conditional edge (contagion)
  if citedNode.type === "theorem" and computeStatus(citedNode) === "conditional":
    return "conditional"

  // Everything else (axioms, accepted theorems, proven conjectures)
  return "support"
```

### 3.3 Node schema additions

Add two optional fields to the theorem node schema:

```typescript
interface TheoremNode {
  // ... existing fields ...
  resolves?: string[];       // Conjecture IDs this theorem claims to prove
  contradicts?: string[];    // Conjecture IDs this theorem claims to disprove
}
```

These are set by the publishing agent and validated by the protocol:
- Every ID in `resolves` must reference an existing conjecture node in state `open`
- Every ID in `contradicts` must reference an existing conjecture node in state `open`
- A theorem cannot both resolve and contradict the same conjecture

---

## 4. Updated Status Computation

### 4.1 Full status function

Replace the existing `computeStatus` function:

```
function computeStatus(node, graph, requiredApprovals = 2):

  // Seed nodes
  if node.type in ["definition", "postulate", "common_notion"]:
    return "axiom"

  // Conjectures have their own state model
  if node.type === "conjecture":
    if node.resolved_by:
      resolverStatus = computeStatus(graph[node.resolved_by], graph)
      if resolverStatus === "accepted":
        return "proven"      // if it contradicts, handled separately
      // resolver not yet accepted → still open
    return "open"

  // Theorems
  verifications = node.verifications or []
  if verifications.some(v => v.verdict === "dispute"):
    return "disputed"

  approvals = verifications.filter(v => v.verdict === "approve"
                                     or v.verdict === "conditional_approve").length
  if approvals < requiredApprovals:
    return "pending"

  // Enough approvals, no disputes — check for conjecture dependencies
  if hasConjectureDependency(node, graph):
    return "conditional"

  return "accepted"
```

### 4.2 Conjecture dependency check (transitive)

This is where **conditionality contagion** is enforced. A theorem is conditional if ANY node in its transitive citation ancestry is an unresolved conjecture.

```
function hasConjectureDependency(node, graph, visited = new Set()):
  if visited.has(node.id):
    return false              // prevent cycles
  visited.add(node.id)

  for citedId in node.cites:
    cited = graph[citedId]

    // Direct conjecture dependency
    if cited.type === "conjecture" and cited.status !== "proven":
      return true

    // Transitive: if cited theorem is conditional, we are too
    if cited.type === "theorem":
      if hasConjectureDependency(cited, graph, visited):
        return true

  return false
```

**Key property:** This is a recursive graph traversal, not a single-hop check. If T001 depends on C001, and T004 depends on T001 (but not directly on C001), T004 is still conditional because T001 is conditional. The conditionality propagates through any depth of citation chain until it reaches axioms, accepted theorems (with no conjecture roots), or proven conjectures.

### 4.3 Status precedence

For theorems, the status evaluation order is:

1. `disputed` — any dispute overrides everything (highest priority)
2. `pending` — not enough approvals yet
3. `conditional` — approved but has unresolved conjecture in ancestry
4. `accepted` — approved and all ancestry is proven/axiomatic

A theorem can transition: `pending → conditional → accepted` (as conjectures get proven), or `pending → conditional → collapsed` (if a conjecture is disproven), or `pending → disputed` (if someone disputes it).

---

## 5. Promotion Cascade (Conjecture Proven)

When a conjecture transitions from `open` to `proven`, some `conditional` theorems may become `accepted`.

### 5.1 Trigger

A conjecture C transitions to `proven` when a theorem T is accepted where `C in T.resolves`.

### 5.2 Cascade procedure

```
function promotionCascade(conjectureId, graph):
  promoted = []

  // Find all conditional theorems in the graph
  // (recompute status for each — some may no longer have unresolved conjecture deps)
  queue = findDirectDependents(conjectureId, graph)

  while queue not empty:
    nodeId = queue.shift()
    node = graph[nodeId]
    oldStatus = node.cached_status
    newStatus = computeStatus(node, graph)   // recompute from scratch

    if oldStatus === "conditional" and newStatus === "accepted":
      promoted.push(nodeId)
      // This node's promotion might promote its own dependents
      queue.push(...findDirectDependents(nodeId, graph))

  return promoted
```

Note: `computeStatus` is always recomputed from the graph, never cached permanently. The transitive check in `hasConjectureDependency` will naturally find that C is now `proven` and stop propagating conditionality through it.

### 5.3 Side effects

- Log a `"promotion"` event listing the conjecture and all promoted theorem IDs
- Agent accepted sets do NOT change automatically — agents still maintain their own belief states. But the public graph status updates, which agents will observe on their next turn.

---

## 6. Collapse Cascade (Conjecture Disproven)

When a conjecture transitions from `open` to `disproven`, all `conditional` theorems depending on it collapse.

### 6.1 Trigger

A conjecture C transitions to `disproven` when a theorem T is accepted where `C in T.contradicts`.

### 6.2 Cascade procedure

```
function collapseCascade(conjectureId, graph):
  collapsed = []

  // Find all theorems that transitively depend on this conjecture
  queue = findDirectDependents(conjectureId, graph)

  while queue not empty:
    nodeId = queue.shift()
    node = graph[nodeId]
    if node is already collapsed or not conditional:
      continue

    // Mark as collapsed
    node.status_override = "collapsed"
    collapsed.push(nodeId)

    // Cascade to dependents of collapsed node
    queue.push(...findDirectDependents(nodeId, graph))

  return collapsed
```

### 6.3 Collapsed state

`collapsed` is a terminal state for a theorem — it means "the logical foundation of this theorem has been disproven." A collapsed theorem:

- Cannot be approved or used as a citation for new theorems
- Remains in the graph for historical record (not deleted)
- Can be visually distinguished (greyed out, strikethrough, etc.)

### 6.4 Agent state implications

When collapse happens, it is a graph-level event. Individual agents may still have collapsed nodes in their `accepted_set`. On their next turn, the belief revision phase (Phase 0) should detect that an accepted node is now `collapsed` in the public graph and trigger retraction automatically — no LLM call needed for this, it's a mechanical state sync.

Add to Phase 0, before the LLM-based dispute review:

```
// Mechanical retraction: sync agent state with collapsed nodes
for nodeId in agent.accepted_set:
  if graph[nodeId].status === "collapsed":
    agent.accepted_set.remove(nodeId)
    agent.rejected_set.add(nodeId)
    // cascade retraction within agent's own belief state
    dependents = findDependents(nodeId, graph, agent.accepted_set)
    for depId in dependents:
      agent.accepted_set.remove(depId)
      agent.rejected_set.add(depId)
    log("mechanical_retract", ...)
```

---

## 7. Updated Publication Validation

### 7.1 Theorem publication (updated)

Add to existing validation:

- If `resolves` is present: every ID must reference an existing conjecture in `open` state
- If `contradicts` is present: every ID must reference an existing conjecture in `open` state
- A theorem cannot both resolve and contradict the same conjecture ID
- `resolves` and `contradicts` are optional fields (most theorems have neither)

### 7.2 Conjecture publication (new)

```
function validateConjecturePublication(node, graph):
  errors = []
  if node.type !== "conjecture": errors.push("Wrong type")
  if !node.id or !node.author or !node.claim: errors.push("Missing required fields")
  if node.proof_steps and node.proof_steps.length > 0: errors.push("Conjectures must not have proof steps")
  if graph[node.id]: errors.push("Node ID already exists")
  // cites are optional for conjectures — they provide context, not logical dependency
  for citedId in (node.cites or []):
    if !graph[citedId]: errors.push("Cited node does not exist")
  return { valid: errors.length === 0, errors }
```

---

## 8. Updated Verification System

### 8.1 New verdict type: `conditional_approve`

Add a third verdict option for theorem verification:

| Verdict | Meaning |
|---------|---------|
| `approve` | The proof is logically valid and all premises are established. |
| `conditional_approve` | The proof logic is valid, but it depends on one or more unproven claims (conjectures). |
| `dispute` | The proof contains a logical flaw. |

`conditional_approve` counts toward the approval threshold the same as `approve`. The distinction is informational — it signals that the verifier noticed the conjecture dependency. The actual `conditional` status is computed by the protocol from the graph structure (Section 4.2), not from the verdict type.

### 8.2 Updated verification prompt guidance

Add to the verification prompt's checklist:

```
6. Does any proof step introduce a claim that is NOT justified by a cited
   predecessor and is NOT self-evident from the definitions alone?
   - If yes, this is an UNPROVEN ASSUMPTION. Check if it is declared as a
     conjecture dependency (cited as a conjecture node).
   - If the assumption is cited as a conjecture: use "conditional_approve"
     as your verdict — the proof logic is valid but rests on unproven ground.
   - If the assumption is NOT cited as a conjecture (i.e., it is smuggled in
     without acknowledgment): DISPUTE the proof. Hidden assumptions are a
     protocol violation. The author must either prove the assumption, cite an
     existing conjecture, or publish a new conjecture and re-derive the theorem.
```

### 8.3 Updated verification response schema

```json
{
  "verdict": "approve" | "conditional_approve" | "dispute",
  "reasoning": "Step-by-step analysis",
  "implicit_assumptions_found": [
    {
      "claim": "Description of the unproven assumption",
      "at_step": 3,
      "is_declared_conjecture": true | false
    }
  ],
  "problem_step": null | number,
  "justification": "If disputing, the specific flaw"
}
```

The `implicit_assumptions_found` field is informational — logged for analysis but not used by the protocol for state computation.

---

## 9. Updated Agent Derivation Prompt

When an agent derives a new theorem, the prompt should now present conjectures as available (but flagged):

Add a new section after ACCEPTED THEOREMS:

```
=== OPEN CONJECTURES (unproven — citing these makes your theorem conditional) ===
[C001] (open, by A1): Two rings described with the extremities of a finite
true trace as center marks and the true trace as gap always meet at a mark.
[C002] (open, by A3): ...
```

And add to the derivation instructions:

```
CONJECTURES:
- You may cite open conjectures as premises, but your theorem will be marked
  as CONDITIONAL until the conjecture is proven.
- If your proof requires an assumption that is not established by any existing
  node, you have three options:
  1. Find a way to prove it from existing accepted results.
  2. Publish it as a separate CONJECTURE first, then cite it.
  3. Abandon this line of reasoning and try a different derivation.
- Do NOT smuggle in unproven assumptions without declaring them.

If you want to publish a CONJECTURE instead of a theorem, respond with:
{
  "type": "conjecture",
  "conjecture_claim": "The unproven claim",
  "motivation": "Why you believe this might be true",
  "relevant_node_ids": ["P3", "D15"]
}

If you want to publish a THEOREM that resolves or contradicts a conjecture:
{
  "type": "theorem",
  "theorem_claim": "...",
  "proof_steps": [...],
  "all_cited_ids": [...],
  "resolves": ["C001"],
  "contradicts": [],
  "confidence": "high/medium/low"
}
```

---

## 10. Visual Representation

### 10.1 Conjecture node appearance

| Property | Value |
|----------|-------|
| Shape | Diamond (rotated square) — distinct from circles used by other nodes |
| Radius | 12 |
| Fill | Agent color (same as theorems) |
| Border | Status-dependent (see below) |
| Label | "C001" etc. |

### 10.2 Updated status colors

| Status | Border Color | Hex |
|--------|-------------|-----|
| axiom | Grey | #9ca3af |
| open | Dashed white | #e4e4e7 |
| proven | Green | #22c55e |
| disproven | Red with strikethrough | #ef4444 |
| accepted | Green | #22c55e |
| conditional | Blue-amber gradient or dashed amber | #f59e0b (dashed) |
| pending | Amber | #f59e0b (solid) |
| disputed | Red | #ef4444 |
| collapsed | Dark grey, reduced opacity | #4b5563 at 0.4 opacity |

The key visual distinction: `conditional` uses a **dashed amber border** while `pending` uses a **solid amber border**. This makes it immediately visible which amber-bordered nodes are waiting for approvals vs. waiting for conjectures.

### 10.3 Edge appearance

| Edge Type | Style |
|-----------|-------|
| support | Solid grey arrow |
| conditional | Dashed amber arrow |
| resolves | Solid green arrow (thicker) |
| contradicts | Solid red arrow (thicker) |

### 10.4 Updated legend

```
Node shapes: ○ Axiom/Theorem  ◇ Conjecture
Borders: ── accepted  ╌╌ conditional  ── pending  ── disputed  ░░ collapsed
Edges: ── support  ╌╌ conditional  ══ resolves  ══ contradicts
```

---

## 11. New Log Actions

| Action | Description | Color |
|--------|-------------|-------|
| `publish_conjecture` | Agent published a new conjecture | Purple #a855f7 |
| `conditional_approve` | Agent conditionally approved a theorem | Amber-green #84cc16 |
| `promotion` | Conjecture proven → conditional theorems promoted | Bright green #10b981 |
| `collapse` | Conjecture disproven → conditional theorems collapsed | Dark red #991b1b |
| `mechanical_retract` | Agent's accepted_set synced with collapsed nodes (no LLM) | Grey #6b7280 |

---

## 12. Implementation Checklist

| # | Task | Priority | Layer |
|---|------|----------|-------|
| 1 | Add `conjecture` node type + ID counter (C001, C002, ...) | High | Protocol |
| 2 | Add `computeStatus` with transitive `hasConjectureDependency` | High | Protocol |
| 3 | Add `resolves` and `contradicts` fields to theorem schema | High | Protocol |
| 4 | Add conjecture publication validation | High | Protocol |
| 5 | Update theorem publication validation for `resolves`/`contradicts` | High | Protocol |
| 6 | Add `conditional_approve` verdict to verification validation | High | Protocol |
| 7 | Implement promotion cascade (conjecture proven) | High | Protocol |
| 8 | Implement collapse cascade (conjecture disproven) | High | Protocol |
| 9 | Add mechanical retraction in Phase 0 for collapsed nodes | High | Agent |
| 10 | Update verification prompt with conjecture-awareness instructions | High | Agent |
| 11 | Update derivation prompt with conjecture section + publishing option | High | Agent |
| 12 | Diamond shape for conjecture nodes in graph visualization | Medium | Frontend |
| 13 | Dashed borders for conditional status | Medium | Frontend |
| 14 | Edge styling by type (dashed, colored) | Medium | Frontend |
| 15 | Updated legend | Medium | Frontend |
| 16 | Conjecture detail panel (show open/proven/disproven, resolved_by) | Medium | Frontend |
| 17 | Add conjecture stats to dashboard (open, proven, disproven counts) | Low | Frontend |
| 18 | Save/load schema update for conjecture nodes and new fields | Low | Integration |
