import { state, captureSnapshot } from './state.js';
import { validatePublication, validateVerification, computeStatus } from './protocol.js';
import {
  callLLMWithTrace,
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

// BFS to find all nodes in acceptedSet that transitively cite nodeId
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

// Find own publications that have unreviewed disputes
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
  const turnNum = state.turn;

  // Snapshot agent state BEFORE turn for delta computation
  const beforeAccepted = new Set(agent.accepted_set);
  const beforeRejected = new Set(agent.rejected_set);
  const beforePublished = new Set(agent.published);
  const beforeReviewedDisputes = new Set(agent.reviewed_disputes);
  const beforeGraphKeys = new Set(Object.keys(state.graph));
  const beforeVerifCounts = {};
  for (const [nid, n] of Object.entries(state.graph)) {
    beforeVerifCounts[nid] = (n.verifications || []).length;
  }

  let phase = 'derive';
  let action = 'error';
  let detail = '';
  let targetNodeId = undefined;
  let publishedNodeId = undefined;
  let cascadeRetracted = undefined;
  let llmTrace = null;
  let parsedResponse = null;
  let parseError = null;

  try {
    // ── Phase 0: Belief Revision ─────────────────────────────────────────
    const disputedPubs = findDisputedPublications(agent);
    if (disputedPubs.length > 0) {
      phase = 'revision';
      const nodeId = disputedPubs[0];
      const node = state.graph[nodeId];
      const allDisputes = (node.verifications || []).filter(v => v.verdict === 'dispute');
      targetNodeId = nodeId;

      addLog({
        agent: agent.id,
        action: 'revision_start',
        detail: `Reviewing ${allDisputes.length} dispute(s) on own publication [${nodeId}]: "${node.claim.slice(0, 60)}..."`,
      });

      const sysPrompt = buildSystemPrompt(agent);
      const userPrompt = buildBeliefRevisionPrompt(agent, node, allDisputes, acceptedNodes);
      const result = await callLLMWithTrace(state.config, sysPrompt, userPrompt);
      llmTrace = result.trace;

      try { parsedResponse = parseJSON(result.raw); }
      catch (e) { parseError = e.message; throw e; }

      // Mark all current disputes on this node as reviewed
      for (const d of allDisputes) {
        agent.reviewed_disputes.add(`${nodeId}:${d.agentId}`);
      }

      if (parsedResponse.decision === 'retract') {
        agent.accepted_set.delete(nodeId);
        agent.rejected_set.add(nodeId);

        const dependents = findDependents(nodeId, state.graph, agent.accepted_set);
        cascadeRetracted = [];
        for (const depId of dependents) {
          agent.accepted_set.delete(depId);
          agent.rejected_set.add(depId);
          cascadeRetracted.push(depId);
        }

        action = 'retract';
        detail = `Retracted [${nodeId}]${cascadeRetracted.length > 0 ? ` + cascade [${cascadeRetracted.join(', ')}]` : ''}: ${(parsedResponse.flaw_acknowledged || parsedResponse.reasoning || '').slice(0, 120)}`;
        addLog({ agent: agent.id, action, detail });
      } else {
        action = 'defend';
        detail = `Defended [${nodeId}]: ${(parsedResponse.defense || parsedResponse.reasoning || '').slice(0, 120)}`;
        addLog({ agent: agent.id, action, detail });
      }

      return; // finally still runs
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
        phase = 'verify';
        const target = verifiable[Math.floor(Math.random() * verifiable.length)];
        targetNodeId = target.id;

        addLog({
          agent: agent.id,
          action: 'verify_start',
          detail: `Attempting to verify [${target.id}]: "${target.claim.slice(0, 60)}..."`,
        });

        const sysPrompt = buildSystemPrompt(agent);
        const userPrompt = buildVerificationPrompt(agent, target, acceptedNodes);
        const result = await callLLMWithTrace(state.config, sysPrompt, userPrompt);
        llmTrace = result.trace;

        try { parsedResponse = parseJSON(result.raw); }
        catch (e) { parseError = e.message; throw e; }

        const verification = {
          targetId: target.id,
          agentId: agent.id,
          verdict: parsedResponse.verdict,
          justification: parsedResponse.justification || parsedResponse.reasoning || '',
          reasoning: parsedResponse.reasoning || '',
        };

        const val = validateVerification(verification, state.graph);
        if (!val.valid) {
          action = 'protocol_reject';
          detail = `Verification rejected: ${val.errors.join('; ')}`;
          addLog({ agent: agent.id, action, detail });
          return;
        }

        state.graph[target.id] = {
          ...state.graph[target.id],
          verifications: [...(state.graph[target.id].verifications || []), verification],
        };

        if (parsedResponse.verdict === 'approve') {
          agent.accepted_set.add(target.id);
          action = 'approve';
        } else {
          agent.rejected_set.add(target.id);
          action = 'dispute';
        }
        detail = `${action === 'approve' ? 'Approved' : 'Disputed'} [${target.id}]: ${(parsedResponse.reasoning || parsedResponse.justification || '').slice(0, 120)}`;
        addLog({ agent: agent.id, action, detail });
        return;
      }
    }

    // ── Phase 2: Derive ───────────────────────────────────────────────────
    phase = 'derive';
    addLog({
      agent: agent.id,
      action: 'derive_start',
      detail: `Attempting new derivation from ${agent.accepted_set.size} accepted nodes...`,
    });

    const sysPrompt = buildSystemPrompt(agent);
    const userPrompt = buildDerivationPrompt(agent, acceptedNodes, state.graph);
    const result = await callLLMWithTrace(state.config, sysPrompt, userPrompt);
    llmTrace = result.trace;

    try { parsedResponse = parseJSON(result.raw); }
    catch (e) { parseError = e.message; throw e; }

    if (!parsedResponse.theorem_claim || !parsedResponse.proof_steps || !parsedResponse.all_cited_ids) {
      action = 'error';
      detail = 'LLM response missing required fields (theorem_claim, proof_steps, all_cited_ids)';
      addLog({ agent: agent.id, action, detail });
      return;
    }

    const invalidCites = parsedResponse.all_cited_ids.filter(cid => !agent.accepted_set.has(cid));
    if (invalidCites.length > 0) {
      action = 'protocol_reject';
      detail = `Derivation cites nodes not in accepted set: ${invalidCites.join(', ')}`;
      addLog({ agent: agent.id, action, detail });
      return;
    }

    const newId = `T${String(state.nodeCounter++).padStart(3, '0')}`;
    const newNode = {
      id: newId,
      author: agent.id,
      claim: parsedResponse.theorem_claim,
      proof_steps: parsedResponse.proof_steps,
      cites: parsedResponse.all_cited_ids,
      type: 'theorem',
      verifications: [],
      confidence: parsedResponse.confidence || 'medium',
    };

    const val = validatePublication(newNode, state.graph, agent.accepted_set);
    if (!val.valid) {
      action = 'protocol_reject';
      detail = `Publication rejected: ${val.errors.join('; ')}`;
      addLog({ agent: agent.id, action, detail });
      return;
    }

    state.graph[newId] = newNode;
    agent.accepted_set.add(newId);
    agent.published.add(newId);
    publishedNodeId = newId;

    action = 'publish';
    detail = `Published [${newId}]: "${parsedResponse.theorem_claim.slice(0, 100)}..." (cites: ${parsedResponse.all_cited_ids.join(', ')})`;
    addLog({ agent: agent.id, action, detail });

  } catch (e) {
    const phaseLabel = phase === 'revision' ? 'belief revision' : phase === 'verify' ? 'verification' : 'derivation';
    action = 'error';
    detail = `LLM error during ${phaseLabel}: ${e.message}`;
    addLog({ agent: agent.id, action, detail });

  } finally {
    // Compute graph delta
    const graphAdded = {};
    const graphModified = {};
    for (const [nid, n] of Object.entries(state.graph)) {
      if (!beforeGraphKeys.has(nid)) {
        graphAdded[nid] = n;
      } else {
        const curCount = (n.verifications || []).length;
        if (curCount > (beforeVerifCounts[nid] || 0)) {
          graphModified[nid] = {
            verifications_added: (n.verifications || []).slice(beforeVerifCounts[nid] || 0),
          };
        }
      }
    }

    // Compute agent state delta
    const agentChanges = { agent_id: agent.id };
    const addedToAccepted = [...agent.accepted_set].filter(id => !beforeAccepted.has(id));
    const removedFromAccepted = [...beforeAccepted].filter(id => !agent.accepted_set.has(id));
    const addedToRejected = [...agent.rejected_set].filter(id => !beforeRejected.has(id));
    const addedToPublished = [...agent.published].filter(id => !beforePublished.has(id));
    const addedToReviewedDisputes = [...agent.reviewed_disputes].filter(id => !beforeReviewedDisputes.has(id));

    if (addedToAccepted.length) agentChanges.added_to_accepted = addedToAccepted;
    if (removedFromAccepted.length) agentChanges.removed_from_accepted = removedFromAccepted;
    if (addedToRejected.length) agentChanges.added_to_rejected = addedToRejected;
    if (addedToPublished.length) agentChanges.added_to_published = addedToPublished;
    if (addedToReviewedDisputes.length) agentChanges.added_to_reviewed_disputes = addedToReviewedDisputes;

    const graphChanges = {};
    if (Object.keys(graphAdded).length) graphChanges.added = graphAdded;
    if (Object.keys(graphModified).length) graphChanges.modified = graphModified;

    state.turnHistory.push({
      turn: turnNum,
      agent_id: agent.id,
      phase,
      action,
      timestamp: new Date().toISOString(),
      detail,
      ...(targetNodeId !== undefined && { target_node_id: targetNodeId }),
      ...(publishedNodeId !== undefined && { published_node_id: publishedNodeId }),
      ...(cascadeRetracted?.length && { cascade_retracted: cascadeRetracted }),
      delta: {
        graph_changes: graphChanges,
        agent_changes: agentChanges,
      },
      debug: llmTrace ? {
        llm_provider: llmTrace.llm_provider,
        llm_model: llmTrace.llm_model,
        system_prompt: llmTrace.system_prompt,
        user_prompt: llmTrace.user_prompt,
        raw_response: llmTrace.raw_response,
        parsed_response: parsedResponse,
        ...(parseError !== null && { parse_error: parseError }),
        latency_ms: llmTrace.latency_ms,
      } : null,
    });

    state.turn++;

    // Capture snapshot every 10 turns
    if (state.turn > 0 && state.turn % 10 === 0) {
      captureSnapshot();
    }
  }
}
