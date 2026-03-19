/**
 * Reconstruct the graph + agent state at a given replay position.
 *
 * replayTurn=0 → initial state (before any turns)
 * replayTurn=N → state after TurnRecords turn:0 through turn:N-1 applied
 *
 * Snapshots: after_turn=S means the snapshot captures state at replayTurn=S
 * (i.e., TurnRecords 0..S-1 have been applied).
 */
export function reconstructStateAtTurn(saveFile, replayTurn) {
  const { initial_state, turns, snapshots } = saveFile;
  const snapshotData = snapshots.data || [];

  // Find nearest snapshot with after_turn <= replayTurn
  const nearestSnapshot = snapshotData
    .filter(s => s.after_turn <= replayTurn)
    .reduce((best, s) => (!best || s.after_turn > best.after_turn) ? s : best, null);

  let graph = JSON.parse(JSON.stringify(nearestSnapshot ? nearestSnapshot.graph : initial_state.graph));
  let agents = JSON.parse(JSON.stringify(nearestSnapshot ? nearestSnapshot.agents : initial_state.agents));
  const startTurn = nearestSnapshot ? nearestSnapshot.after_turn : 0;

  // Apply TurnRecords from startTurn up to (but not including) replayTurn
  for (const turnRecord of turns) {
    if (turnRecord.turn < startTurn) continue;
    if (turnRecord.turn >= replayTurn) break;
    applyDelta(graph, agents, turnRecord.delta);
  }

  return { graph, agents };
}

export function applyDelta(graph, agents, delta) {
  if (delta.graph_changes?.added) {
    Object.assign(graph, delta.graph_changes.added);
  }
  if (delta.graph_changes?.modified) {
    for (const [nid, changes] of Object.entries(delta.graph_changes.modified)) {
      if (graph[nid] && changes.verifications_added) {
        graph[nid] = {
          ...graph[nid],
          verifications: [...(graph[nid].verifications || []), ...changes.verifications_added],
        };
      }
    }
  }
  if (delta.agent_changes) {
    const a = agents.find(ag => ag.id === delta.agent_changes.agent_id);
    if (a) {
      if (delta.agent_changes.added_to_accepted) {
        a.accepted_set = [...new Set([...a.accepted_set, ...delta.agent_changes.added_to_accepted])];
      }
      if (delta.agent_changes.removed_from_accepted) {
        const toRemove = new Set(delta.agent_changes.removed_from_accepted);
        a.accepted_set = a.accepted_set.filter(id => !toRemove.has(id));
      }
      if (delta.agent_changes.added_to_rejected) {
        a.rejected_set = [...new Set([...a.rejected_set, ...delta.agent_changes.added_to_rejected])];
      }
      if (delta.agent_changes.added_to_published) {
        a.published = [...new Set([...(a.published || []), ...delta.agent_changes.added_to_published])];
      }
      if (delta.agent_changes.added_to_reviewed_disputes) {
        a.reviewed_disputes = [...new Set([...(a.reviewed_disputes || []), ...delta.agent_changes.added_to_reviewed_disputes])];
      }
    }
  }
}

/** Returns the set of node IDs that changed in a TurnRecord's delta */
export function getChangedNodeIds(turnRecord) {
  if (!turnRecord) return new Set();
  const changed = new Set();
  const gc = turnRecord.delta?.graph_changes;
  if (gc?.added) for (const id of Object.keys(gc.added)) changed.add(id);
  if (gc?.modified) for (const id of Object.keys(gc.modified)) changed.add(id);
  return changed;
}

/** Build a filename for saving */
export function buildSaveFilename(saveFile) {
  const ts = saveFile.created_at ? new Date(saveFile.created_at) : new Date();
  const date = ts.toISOString().slice(0, 10);
  const time = ts.toISOString().slice(11, 19).replace(/:/g, '-');
  return `euclid_run_${date}_${time}_${saveFile.summary.total_turns}turns.json`;
}
