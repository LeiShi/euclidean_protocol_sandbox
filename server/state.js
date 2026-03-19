import { AGENT_DEFS, ALL_SEEDS } from './seeds.js';
import { computeStats } from './protocol.js';

function createInitialState() {
  const graph = {};
  for (const seed of ALL_SEEDS) {
    graph[seed.id] = { ...seed, author: 'SYSTEM', cites: [], proof_steps: [], verifications: [] };
  }

  const agents = AGENT_DEFS.map(a => ({
    ...a,
    accepted_set: new Set(ALL_SEEDS.map(s => s.id)),
    rejected_set: new Set(),
    published: new Set(),
    reviewed_disputes: new Set(), // "nodeId:disputerAgentId" pairs already processed
  }));

  // Capture initial state (turn 0, before any agent turns)
  const initialState = {
    graph: Object.fromEntries(Object.entries(graph).map(([k, v]) => [k, { ...v }])),
    agents: agents.map(a => ({
      id: a.id,
      accepted_set: [...a.accepted_set],
      rejected_set: [],
      published: [],
      reviewed_disputes: [],
    })),
  };

  const log = [{
    turn: 0,
    agent: 'SYSTEM',
    action: 'init',
    detail: 'Seeded 23 definitions + 5 postulates + 5 common notions. All agents initialized.',
    ts: Date.now(),
  }];

  return {
    graph,
    agents,
    log,
    turn: 0,
    nodeCounter: 1,
    running: false,
    abortFlag: false,
    config: {
      provider: process.env.LLM_PROVIDER || 'gemini',
      apiKey: process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || '',
    },
    turnHistory: [],   // TurnRecord[]
    snapshots: [],     // FullSnapshot[]
    initialState,      // captured at startup
  };
}

export const state = createInitialState();

export function captureSnapshot() {
  state.snapshots.push({
    after_turn: state.turn,
    graph: JSON.parse(JSON.stringify(state.graph)),
    agents: state.agents.map(a => ({
      id: a.id,
      accepted_set: [...a.accepted_set],
      rejected_set: [...a.rejected_set],
      published: [...a.published],
      reviewed_disputes: [...a.reviewed_disputes],
    })),
  });
}

export function serializeState() {
  return {
    graph: state.graph,
    agents: state.agents.map(a => ({
      id: a.id,
      name: a.name,
      color: a.color,
      personality: a.personality,
      accepted_set: [...a.accepted_set],
      rejected_set: [...a.rejected_set],
      published: [...a.published],
      reviewed_disputes: [...a.reviewed_disputes],
    })),
    log: state.log,
    turn: state.turn,
    stats: computeStats(state.graph),
    running: state.running,
    config: {
      provider: state.config.provider,
      model: state.config.model,
      hasApiKey: !!state.config.apiKey,
    },
  };
}
