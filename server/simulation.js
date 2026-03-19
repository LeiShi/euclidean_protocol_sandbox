import { state } from './state.js';
import { validatePublication, validateVerification, computeStatus } from './protocol.js';
import {
  callLLM,
  buildSystemPrompt,
  buildDerivationPrompt,
  buildVerificationPrompt,
  buildBeliefRevisionPrompt,
  parseJSON,
} from './llm.js';

function addLog(entry) {
  state.log.push({ ...entry, ts: Date.now(), turn: state.turn });
}

function getAcceptedNodes(agent) {
  const result = {};
  for (const nid of agent.accepted_set) {
    if (state.graph[nid]) result[nid] = state.graph[nid];
  }
  return result;
}

// Patch 2: BFS to find all nodes in acceptedSet that transitively cite nodeId
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

// Patch 2: find own publications that have unreviewed disputes
function findDisputedPublications(agent) {
  return [...agent.published].filter(nodeId => {
    const node = state.graph[nodeId];
    if (!node || !agent.accepted_set.has(nodeId)) return false;
    const disputes = (node.verifications || []).filter(v => v.verdict === 'dispute');
    return disputes.some(d => !agent.reviewed_disputes.has(`${nodeId}:${d.agentId}`));
  });
}

export async function doAgentTurn() {
  const agentIdx = state.turn % 3;
  const agent = state.agents[agentIdx];
  const acceptedNodes = getAcceptedNodes(agent);

  // ── Phase 0: Belief Revision ─────────────────────────────────────────
  const disputedPubs = findDisputedPublications(agent);
  if (disputedPubs.length > 0) {
    const nodeId = disputedPubs[0];
    const node = state.graph[nodeId];
    const allDisputes = (node.verifications || []).filter(v => v.verdict === 'dispute');

    addLog({
      agent: agent.id,
      action: 'revision_start',
      detail: `Reviewing ${allDisputes.length} dispute(s) on own publication [${nodeId}]: "${node.claim.slice(0, 60)}..."`,
    });

    try {
      const sysPrompt = buildSystemPrompt(agent);
      const userPrompt = buildBeliefRevisionPrompt(agent, node, allDisputes, acceptedNodes);
      const raw = await callLLM(state.config, sysPrompt, userPrompt);
      const parsed = parseJSON(raw);

      // Mark all current disputes on this node as reviewed
      for (const d of allDisputes) {
        agent.reviewed_disputes.add(`${nodeId}:${d.agentId}`);
      }

      if (parsed.decision === 'retract') {
        agent.accepted_set.delete(nodeId);
        agent.rejected_set.add(nodeId);

        // Cascade: BFS retraction of dependents still in accepted_set
        const dependents = findDependents(nodeId, state.graph, agent.accepted_set);
        const cascaded = [];
        for (const depId of dependents) {
          agent.accepted_set.delete(depId);
          agent.rejected_set.add(depId);
          cascaded.push(depId);
        }

        addLog({
          agent: agent.id,
          action: 'retract',
          detail: `Retracted [${nodeId}]${cascaded.length > 0 ? ` + cascade [${cascaded.join(', ')}]` : ''}: ${(parsed.flaw_acknowledged || parsed.reasoning || '').slice(0, 120)}`,
        });
      } else {
        addLog({
          agent: agent.id,
          action: 'defend',
          detail: `Defended [${nodeId}]: ${(parsed.defense || parsed.reasoning || '').slice(0, 120)}`,
        });
      }
    } catch (e) {
      addLog({
        agent: agent.id,
        action: 'error',
        detail: `LLM error during belief revision: ${e.message}`,
      });
    }

    state.turn++;
    return;
  }

  // ── Phase 1: Verify ───────────────────────────────────────────────────
  const unverified = Object.values(state.graph).filter(n =>
    !agent.accepted_set.has(n.id) &&
    !agent.rejected_set.has(n.id) &&
    !agent.published.has(n.id) &&
    n.type === 'theorem'
  );

  const shouldVerify = unverified.length > 0 && (
    agent.personality.includes('skeptical') || Math.random() < 0.5
  );

  if (shouldVerify && unverified.length > 0) {
    const verifiable = unverified.filter(n =>
      n.cites.every(cid => agent.accepted_set.has(cid))
    );

    if (verifiable.length > 0) {
      const target = verifiable[Math.floor(Math.random() * verifiable.length)];
      addLog({
        agent: agent.id,
        action: 'verify_start',
        detail: `Attempting to verify [${target.id}]: "${target.claim.slice(0, 60)}..."`,
      });

      try {
        const sysPrompt = buildSystemPrompt(agent);
        const userPrompt = buildVerificationPrompt(agent, target, acceptedNodes);
        const raw = await callLLM(state.config, sysPrompt, userPrompt);
        const parsed = parseJSON(raw);

        const verification = {
          targetId: target.id,
          agentId: agent.id,
          verdict: parsed.verdict,
          justification: parsed.justification || parsed.reasoning || '',
          reasoning: parsed.reasoning || '',
        };

        const val = validateVerification(verification, state.graph);
        if (!val.valid) {
          addLog({
            agent: agent.id,
            action: 'protocol_reject',
            detail: `Verification rejected: ${val.errors.join('; ')}`,
          });
          state.turn++;
          return;
        }

        state.graph[target.id] = {
          ...state.graph[target.id],
          verifications: [...(state.graph[target.id].verifications || []), verification],
        };

        if (parsed.verdict === 'approve') {
          agent.accepted_set.add(target.id);
        } else {
          agent.rejected_set.add(target.id);
        }

        addLog({
          agent: agent.id,
          action: parsed.verdict === 'approve' ? 'approve' : 'dispute',
          detail: `${parsed.verdict === 'approve' ? 'Approved' : 'Disputed'} [${target.id}]: ${(parsed.reasoning || parsed.justification || '').slice(0, 120)}`,
        });
      } catch (e) {
        addLog({
          agent: agent.id,
          action: 'error',
          detail: `LLM error during verification: ${e.message}`,
        });
      }

      state.turn++;
      return;
    }
  }

  // ── Phase 2: Derive ───────────────────────────────────────────────────
  addLog({
    agent: agent.id,
    action: 'derive_start',
    detail: `Attempting new derivation from ${agent.accepted_set.size} accepted nodes...`,
  });

  try {
    const sysPrompt = buildSystemPrompt(agent);
    const userPrompt = buildDerivationPrompt(agent, acceptedNodes, state.graph);
    const raw = await callLLM(state.config, sysPrompt, userPrompt);
    const parsed = parseJSON(raw);

    if (!parsed.theorem_claim || !parsed.proof_steps || !parsed.all_cited_ids) {
      addLog({
        agent: agent.id,
        action: 'error',
        detail: 'LLM response missing required fields (theorem_claim, proof_steps, all_cited_ids)',
      });
      state.turn++;
      return;
    }

    const invalidCites = parsed.all_cited_ids.filter(cid => !agent.accepted_set.has(cid));
    if (invalidCites.length > 0) {
      addLog({
        agent: agent.id,
        action: 'protocol_reject',
        detail: `Derivation cites nodes not in accepted set: ${invalidCites.join(', ')}`,
      });
      state.turn++;
      return;
    }

    const newId = `T${String(state.nodeCounter++).padStart(3, '0')}`;
    const newNode = {
      id: newId,
      author: agent.id,
      claim: parsed.theorem_claim,
      proof_steps: parsed.proof_steps,
      cites: parsed.all_cited_ids,
      type: 'theorem',
      verifications: [],
      confidence: parsed.confidence || 'medium',
    };

    const val = validatePublication(newNode, state.graph, agent.accepted_set);
    if (!val.valid) {
      addLog({
        agent: agent.id,
        action: 'protocol_reject',
        detail: `Publication rejected: ${val.errors.join('; ')}`,
      });
      state.turn++;
      return;
    }

    state.graph[newId] = newNode;
    agent.accepted_set.add(newId);
    agent.published.add(newId);

    addLog({
      agent: agent.id,
      action: 'publish',
      detail: `Published [${newId}]: "${parsed.theorem_claim.slice(0, 100)}..." (cites: ${parsed.all_cited_ids.join(', ')})`,
    });
  } catch (e) {
    addLog({
      agent: agent.id,
      action: 'error',
      detail: `LLM error during derivation: ${e.message}`,
    });
  }

  state.turn++;
}
