const SEED_TYPES = new Set(['definition', 'postulate', 'common_notion']);

export function validatePublication(node, graph, agentAcceptedSet) {
  const errors = [];

  if (!node.id || !node.author || !node.claim || !node.proof_steps || !node.cites) {
    errors.push('Missing required fields (id, author, claim, proof_steps, cites)');
  }
  if (!node.cites || node.cites.length === 0) {
    errors.push('Publication must cite at least one predecessor');
  }
  if (node.cites) {
    for (const cid of node.cites) {
      if (!graph[cid]) errors.push(`Cited node '${cid}' does not exist in the public graph`);
    }
    if (agentAcceptedSet) {
      for (const cid of node.cites) {
        if (!agentAcceptedSet.has(cid)) errors.push(`Cited node '${cid}' is not in agent's accepted set`);
      }
    }
  }
  if (graph[node.id]) errors.push(`Node ID '${node.id}' already exists`);

  return { valid: errors.length === 0, errors };
}

export function validateVerification(verification, graph) {
  const errors = [];
  const { targetId, agentId, verdict, justification } = verification;

  const target = graph[targetId];
  if (!target) {
    return { valid: false, errors: [`Target node '${targetId}' does not exist`] };
  }
  if (SEED_TYPES.has(target.type)) {
    errors.push('Seed nodes (definitions, postulates, common notions) cannot be verified');
  }
  if (target.author === agentId) {
    errors.push('Self-verification is not permitted');
  }
  if (target.verifications?.some(v => v.agentId === agentId)) {
    errors.push('Duplicate verification: agent already verified this node');
  }
  if (!['approve', 'dispute'].includes(verdict)) {
    errors.push("Verdict must be 'approve' or 'dispute'");
  }
  if (verdict === 'dispute' && !justification) {
    errors.push('Disputes must include a justification');
  }

  return { valid: errors.length === 0, errors };
}

export function computeStatus(node, requiredApprovals = 2) {
  if (SEED_TYPES.has(node.type)) return 'axiom';
  const vs = node.verifications || [];
  if (vs.some(v => v.verdict === 'dispute')) return 'disputed';
  if (vs.filter(v => v.verdict === 'approve').length >= requiredApprovals) return 'accepted';
  return 'pending';
}

export function computeStats(graph) {
  const all = Object.values(graph);
  const theorems = all.filter(n => n.type === 'theorem');
  return {
    total: all.length,
    definitions: all.filter(n => n.type === 'definition').length,
    postulates: all.filter(n => n.type === 'postulate' || n.type === 'common_notion').length,
    theorems: theorems.length,
    accepted: theorems.filter(n => computeStatus(n) === 'accepted').length,
    pending: theorems.filter(n => computeStatus(n) === 'pending').length,
    disputed: theorems.filter(n => computeStatus(n) === 'disputed').length,
  };
}
