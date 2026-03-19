export const AGENT_DEFS = [
  { id: 'A1', name: 'Archon', color: '#e07a5f' },
  { id: 'A2', name: 'Bion', color: '#3d85c6' },
  { id: 'A3', name: 'Callias', color: '#81b29a' },
];

export const SEED_TYPES = new Set(['definition', 'postulate', 'common_notion']);

export function hasConjectureDependency(node, graph, visited = new Set()) {
  if (!graph || visited.has(node.id)) return false;
  visited.add(node.id);
  for (const citedId of (node.cites || [])) {
    const cited = graph[citedId];
    if (!cited) continue;
    if (cited.type === 'conjecture' && computeStatus(cited, graph) !== 'proven') return true;
    if (cited.type === 'theorem' && hasConjectureDependency(cited, graph, visited)) return true;
  }
  return false;
}

export function computeStatus(node, graph, requiredApprovals = 2) {
  if (SEED_TYPES.has(node.type)) return 'axiom';

  if (node.status_override === 'collapsed') return 'collapsed';

  if (node.type === 'conjecture') {
    if (node.resolved_by && graph) {
      const resolver = graph[node.resolved_by];
      if (resolver && computeStatus(resolver, graph, requiredApprovals) === 'accepted') {
        if (resolver.resolves?.includes(node.id)) return 'proven';
        if (resolver.contradicts?.includes(node.id)) return 'disproven';
      }
    }
    return 'open';
  }

  const vs = node.verifications || [];
  if (vs.some(v => v.verdict === 'dispute')) return 'disputed';
  const approvals = vs.filter(v => v.verdict === 'approve' || v.verdict === 'conditional_approve').length;
  if (approvals < requiredApprovals) return 'pending';
  if (hasConjectureDependency(node, graph)) return 'conditional';
  return 'accepted';
}

export const STATUS_COLORS = {
  axiom: '#9ca3af',
  accepted: '#22c55e',
  pending: '#f59e0b',
  disputed: '#ef4444',
  conditional: '#f59e0b',  // same hue as pending, distinguished by dashed border
  open: '#e4e4e7',
  proven: '#22c55e',
  disproven: '#ef4444',
  collapsed: '#4b5563',
};

export const STATUS_BG = {
  axiom: '#1f2937',
  accepted: '#14532d',
  pending: '#78350f',
  disputed: '#7f1d1d',
  conditional: '#451a03',
  open: '#27272a',
  proven: '#14532d',
  disproven: '#7f1d1d',
  collapsed: '#18181b',
};

export const STATUS_TEXT = {
  axiom: '#9ca3af',
  accepted: '#4ade80',
  pending: '#fbbf24',
  disputed: '#f87171',
  conditional: '#fb923c',
  open: '#d4d4d8',
  proven: '#4ade80',
  disproven: '#f87171',
  collapsed: '#6b7280',
};

export const LOG_COLORS = {
  publish: '#93c5fd',
  publish_conjecture: '#a855f7',
  approve: '#4ade80',
  conditional_approve: '#84cc16',
  dispute: '#f87171',
  verify_start: '#c084fc',
  derive_start: '#c084fc',
  protocol_reject: '#fbbf24',
  error: '#f87171',
  init: '#71717a',
  revision_start: '#f97316',
  retract: '#fb923c',
  defend: '#06b6d4',
  promotion: '#10b981',
  collapse: '#991b1b',
  mechanical_retract: '#6b7280',
};
