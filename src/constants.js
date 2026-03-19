export const AGENT_DEFS = [
  { id: 'A1', name: 'Archon', color: '#e07a5f' },
  { id: 'A2', name: 'Bion', color: '#3d85c6' },
  { id: 'A3', name: 'Callias', color: '#81b29a' },
];

export const SEED_TYPES = new Set(['definition', 'postulate', 'common_notion']);

export function computeStatus(node, requiredApprovals = 2) {
  if (SEED_TYPES.has(node.type)) return 'axiom';
  const vs = node.verifications || [];
  if (vs.some(v => v.verdict === 'dispute')) return 'disputed';
  if (vs.filter(v => v.verdict === 'approve').length >= requiredApprovals) return 'accepted';
  return 'pending';
}

export const STATUS_COLORS = {
  axiom: '#9ca3af',
  accepted: '#22c55e',
  pending: '#f59e0b',
  disputed: '#ef4444',
};

export const STATUS_BG = {
  axiom: '#1f2937',
  accepted: '#14532d',
  pending: '#78350f',
  disputed: '#7f1d1d',
};

export const STATUS_TEXT = {
  axiom: '#9ca3af',
  accepted: '#4ade80',
  pending: '#fbbf24',
  disputed: '#f87171',
};

export const LOG_COLORS = {
  publish: '#93c5fd',
  approve: '#4ade80',
  dispute: '#f87171',
  verify_start: '#c084fc',
  derive_start: '#c084fc',
  protocol_reject: '#fbbf24',
  error: '#f87171',
  init: '#71717a',
  revision_start: '#f97316',
  retract: '#fb923c',
  defend: '#06b6d4',
};
