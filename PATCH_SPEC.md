# Euclid Protocol Sandbox — Patch Spec v1.1

Apply these changes on top of the original SPEC.md implementation. Each section is independent and can be applied in any order unless noted.

---

## Patch 1: Feature — Deduplication Awareness in Derivation Prompt

**Problem:** Agents re-derive theorems that already exist in the public graph — including theorems they themselves disputed on a previous turn. This wastes turns and creates redundant nodes.

**Fix:** Expand the derivation prompt (Section 7.3 of the original spec) with three new context sections. These appear AFTER the accepted knowledge base and BEFORE the task instruction.

### New sections to add to the derivation prompt:

```
=== ALL THEOREMS IN THE PUBLIC GRAPH (for your awareness — do NOT re-derive any of these) ===
[T001] (by A1, status: accepted): <claim text>
[T002] (by A2, status: pending): <claim text>
[T003] (by A1, status: disputed): <claim text>
```

**Source:** All nodes in the public graph where `type === "theorem"`, regardless of status or authorship. Include author ID and current status.

```
=== YOUR OWN PUBLICATIONS ===
[T001] (status: accepted): <claim text>
```

**Source:** All node IDs in the agent's `published` set, looked up from the public graph.

```
=== NODES YOU PREVIOUSLY REJECTED (do NOT re-derive these or anything equivalent) ===
[T003]: <claim text> — REJECTED BECAUSE: <agent's own justification from when it disputed>
```

**Source:** All node IDs in the agent's `rejected_set`, looked up from the public graph. For each, find the agent's own verification record on that node and extract the `justification` or `reasoning` field. Truncate to ~150 chars if needed.

### Updated task instruction (replaces the old one):

```
Your task: Derive a NEW result that follows logically from your accepted knowledge base.

CRITICAL CONSTRAINTS:
- Your result must be GENUINELY NEW — not a restatement, rephrasing, or minor variation of any theorem listed above (whether accepted, pending, disputed, or rejected).
- Do NOT re-derive anything you previously rejected — the flaw you identified still applies.
- Do NOT re-derive anything already in the public graph, even if it was published by another agent.
- Think about what interesting consequences follow from combining definitions, postulates, common notions, and any existing theorems in ways that have NOT been explored yet.
```

### Also update the "unverified nodes" list:

Exclude nodes already in the agent's `rejected_set` from the "Nodes in the public graph you have NOT yet verified" list, since they appear in the rejected section instead.

---

## Patch 2: Feature — Belief Revision (Phase 0)

**Problem:** When an agent publishes a theorem and other agents dispute it, the author keeps building on top of it because it auto-accepted its own publication and never revisits that belief. This creates chains of theorems built on disputed foundations.

### 2a. New agent state field

Add to `AgentState`:

```typescript
reviewed_disputes: Set<string>  // stores "nodeId:disputerAgentId" pairs
```

Initialize as empty set. This tracks which specific disputes the agent has already processed, so each dispute triggers revision exactly once.

### 2b. New turn phase: Phase 0 (Belief Revision)

Insert as the FIRST thing checked in the agent turn, before verify or derive. If Phase 0 triggers, it consumes the entire turn.

**Trigger condition:** The agent has at least one publication where:
- The node is still in the agent's `accepted_set` (hasn't already been retracted)
- The node has dispute verifications where the `"nodeId:disputerAgentId"` pair is NOT in `reviewed_disputes`

**Procedure:**
1. Select one such disputed publication (first found; process one per turn)
2. Gather ALL disputes on that node (including previously reviewed ones, for full context to the LLM)
3. Call the LLM with the belief revision prompt (see 2c below)
4. Parse JSON response: `{ decision, reasoning, flaw_acknowledged, defense }`
5. Mark ALL current disputes on this node as reviewed: add `"nodeId:disputerAgentId"` to `reviewed_disputes` for each
6. If `decision === "retract"`:
   - Move the node from `accepted_set` to `rejected_set`
   - **Cascade retraction**: BFS from the retracted node through the public graph — any node in the agent's `accepted_set` that transitively cites the retracted node gets moved to `rejected_set` too
   - Log with action `"retract"`, include cascade details
7. If `decision === "defend"`:
   - Node stays in `accepted_set`
   - Log with action `"defend"`
8. Return (turn consumed)

**Cascade retraction implementation:**

```javascript
function findDependents(nodeId, graph, acceptedSet) {
  const dependents = new Set();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const n of Object.values(graph)) {
      if (n.cites.includes(current) && acceptedSet.has(n.id) && !dependents.has(n.id)) {
        dependents.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return dependents;
}
```

### 2c. Belief revision prompt

```
One of your published results has been DISPUTED by other agents. You must carefully consider their criticism and decide whether to retract or defend your result.

=== RELEVANT DEFINITIONS ===
{all definitions from agent's accepted set}

=== POSTULATES ===
{all postulates}

=== COMMON NOTIONS ===
{all common notions}

=== YOUR PUBLISHED NODE [{node.id}] ===
Claim: {node.claim}
Proof steps:
  Step 1: {claim} [justification: ...] [cites: ...]
  Step 2: ...

=== DISPUTES RECEIVED ===
Dispute 1 by {agentId}:
  Verdict: dispute
  Reasoning: {justification or reasoning field}

Dispute 2 by {agentId}:
  Verdict: dispute
  Reasoning: {justification or reasoning field}

Carefully re-examine your proof in light of these disputes. Be intellectually honest:
- If the dispute identifies a genuine flaw (a step that doesn't follow, a missing justification, a wrong citation), you should RETRACT.
- If the dispute is mistaken and your proof is actually valid, you may DEFEND — but you must explain specifically why each dispute is wrong.
- Err on the side of retracting if there is genuine ambiguity. False results in the graph are worse than missing results.

Respond with ONLY this JSON (no markdown, no backticks):
{
  "decision": "retract" or "defend",
  "reasoning": "Your honest re-assessment of your proof and the disputes",
  "flaw_acknowledged": "If retracting, describe what was wrong. If defending, null.",
  "defense": "If defending, explain why each dispute is mistaken. If retracting, null."
}
```

### 2d. New log actions

Add these to the event logging and frontend action color map:

| Action | Description | Color |
|--------|-------------|-------|
| `revision_start` | Agent begins reviewing disputes on own publication | Orange #f97316 |
| `retract` | Agent retracts own publication (may include cascade) | Light orange #fb923c |
| `defend` | Agent defends own publication against disputes | Cyan #06b6d4 |

---

## Patch 3: Bug Fix — Derivation Prompt Token Bloat

**Problem:** With 33 seed nodes + growing theorem list + dedup context (Patch 1), the derivation prompt can get very large and approach context limits, especially on smaller models.

**Fix:** If the total prompt length exceeds a threshold (e.g., 12000 characters), apply progressive trimming in this priority order (trim lowest priority first):

1. **Lowest priority — definitions:** Replace the full definitions list with just the IDs: `[D01–D23]: (23 definitions available, cite by ID as needed)`
2. **Medium priority — own publications:** Truncate to just IDs and status: `[T001] (accepted), [T005] (disputed)`
3. **Highest priority — keep in full:** Postulates, common notions, accepted theorems, rejected nodes with reasons, all-theorems dedup list

This ensures the agent always sees what it needs for deduplication and correctness, while the definitions (which are stable reference material the agent has seen many times) get compressed first.

---

## Summary of all changes

| Patch | Type | What |
|-------|------|------|
| 1 | Feature | Dedup awareness: all theorems + own publications + rejected nodes in derivation prompt |
| 2 | Feature | Belief revision: Phase 0 with retract/defend + cascade retraction + dispute tracking |
| 3 | Bug fix | Progressive prompt trimming to avoid token overflow |
