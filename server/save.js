import { state } from './state.js';
import { AGENT_DEFS, ALL_SEEDS } from './seeds.js';
import { VOCAB } from './vocab.js';
import { DEFAULT_MODELS } from './llm.js';
import { computeStats } from './protocol.js';

export function assembleSaveFile() {
  const totalTurns = state.turn;
  const stats = computeStats(state.graph);

  const agentSummaries = state.agents.map(a => {
    const published = [...a.published];
    const accepted = published.filter(id => a.accepted_set.has(id));
    const retracted = published.filter(id => a.rejected_set.has(id));
    const approveTurns = state.turnHistory.filter(t => t.agent_id === a.id && t.action === 'approve');
    const disputeTurns = state.turnHistory.filter(t => t.agent_id === a.id && t.action === 'dispute');
    const retractTurns = state.turnHistory.filter(t => t.agent_id === a.id && t.action === 'retract');
    return {
      id: a.id,
      name: a.name,
      theorems_published: published.length,
      theorems_accepted: accepted.length,
      theorems_retracted: retractTurns.length,
      verifications_performed: approveTurns.length + disputeTurns.length,
      disputes_issued: disputeTurns.length,
      approvals_issued: approveTurns.length,
    };
  });

  const totalVerifications = state.turnHistory.filter(t => t.action === 'approve' || t.action === 'dispute').length;
  const totalDisputes = state.turnHistory.filter(t => t.action === 'dispute').length;
  const totalRetractions = state.turnHistory.filter(t => t.action === 'retract').length;

  return {
    version: '1.0',
    format: 'euclid-protocol-sandbox',
    created_at: new Date().toISOString(),
    config: {
      llm_provider: state.config.provider,
      llm_model: state.config.model || DEFAULT_MODELS[state.config.provider],
      required_approvals: 2,
      agent_definitions: AGENT_DEFS.map(a => ({
        id: a.id,
        name: a.name,
        color: a.color,
        personality: a.personality,
      })),
      vocabulary: VOCAB,
    },
    initial_state: state.initialState,
    turns: state.turnHistory,
    snapshots: {
      interval: 10,
      data: state.snapshots,
    },
    summary: {
      total_turns: totalTurns,
      total_theorems: Object.values(state.graph).filter(n => n.type === 'theorem').length,
      accepted_theorems: stats.accepted,
      disputed_theorems: stats.disputed,
      retracted_theorems: totalRetractions,
      total_verifications: totalVerifications,
      total_disputes: totalDisputes,
      total_retractions: totalRetractions,
      agents: agentSummaries,
    },
  };
}

export function validateSaveFile(data) {
  const errors = [];
  if (data.version !== '1.0') errors.push(`Unsupported version: ${data.version}`);
  if (data.format !== 'euclid-protocol-sandbox') errors.push(`Unknown format: ${data.format}`);
  if (!data.initial_state?.graph) errors.push('Missing initial_state.graph');
  if (!Array.isArray(data.turns)) errors.push('Missing turns array');
  if (!data.snapshots?.data) errors.push('Missing snapshots.data');
  if (!data.config?.agent_definitions) errors.push('Missing config.agent_definitions');

  if (data.initial_state?.graph) {
    for (const seed of ALL_SEEDS) {
      if (!data.initial_state.graph[seed.id]) {
        errors.push(`Missing seed node ${seed.id} in initial_state`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function applyDeltaToState(graph, agents, delta) {
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
        a.published = [...new Set([...a.published, ...delta.agent_changes.added_to_published])];
      }
      if (delta.agent_changes.added_to_reviewed_disputes) {
        a.reviewed_disputes = [...new Set([...(a.reviewed_disputes || []), ...delta.agent_changes.added_to_reviewed_disputes])];
      }
    }
  }
}

export function restoreFromSaveFile(data) {
  const { snapshots, turns, initial_state, config, summary } = data;
  const totalTurns = summary.total_turns;
  const snapshotData = snapshots.data || [];

  // Find latest snapshot at or before totalTurns
  const latestSnapshot = snapshotData
    .filter(s => s.after_turn <= totalTurns)
    .reduce((best, s) => (!best || s.after_turn > best.after_turn) ? s : best, null);

  let graphState = JSON.parse(JSON.stringify(latestSnapshot ? latestSnapshot.graph : initial_state.graph));
  let agentStates = JSON.parse(JSON.stringify(latestSnapshot ? latestSnapshot.agents : initial_state.agents));
  const startTurn = latestSnapshot ? latestSnapshot.after_turn : 0;

  // Apply remaining deltas from snapshot forward to totalTurns
  for (const turnRecord of turns) {
    if (turnRecord.turn < startTurn) continue;
    if (turnRecord.turn >= totalTurns) break;
    applyDeltaToState(graphState, agentStates, turnRecord.delta);
  }

  // Mutate state in place (state is a singleton export)
  for (const key of Object.keys(state.graph)) delete state.graph[key];
  Object.assign(state.graph, graphState);

  for (const agentSnap of agentStates) {
    const agent = state.agents.find(a => a.id === agentSnap.id);
    if (agent) {
      agent.accepted_set = new Set(agentSnap.accepted_set);
      agent.rejected_set = new Set(agentSnap.rejected_set);
      agent.published = new Set(agentSnap.published);
      agent.reviewed_disputes = new Set(agentSnap.reviewed_disputes || []);
    }
  }

  state.turn = totalTurns;
  const tNums = Object.keys(state.graph)
    .filter(id => /^T\d+$/.test(id))
    .map(id => parseInt(id.slice(1)));
  state.nodeCounter = tNums.length > 0 ? Math.max(...tNums) + 1 : 1;

  state.turnHistory = [...turns];
  state.snapshots = [...snapshotData];
  state.initialState = JSON.parse(JSON.stringify(initial_state));

  if (config.llm_provider) state.config.provider = config.llm_provider;
  if (config.llm_model) state.config.model = config.llm_model;

  // Rebuild event log from turn history
  state.log = [
    { turn: 0, agent: 'SYSTEM', action: 'init', detail: `Loaded run from save file (${totalTurns} turns).`, ts: Date.now() },
    ...turns.map(t => ({
      turn: t.turn,
      agent: t.agent_id,
      action: t.action,
      detail: t.detail,
      ts: new Date(t.timestamp).getTime(),
    })),
  ];
}
