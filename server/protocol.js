const SEED_TYPES = new Set(['definition', 'postulate', 'common_notion']);

// ── Status computation ────────────────────────────────────────────────────────

export function hasConjectureDependency(node, graph, visited = new Set()) {
  if (!graph || visited.has(node.id)) return false;
  visited.add(node.id);

  for (const citedId of (node.cites || [])) {
    const cited = graph[citedId];
    if (!cited) continue;

    if (cited.type === 'conjecture' && computeStatus(cited, graph) !== 'proven') {
      return true;
    }
    if (cited.type === 'theorem') {
      if (hasConjectureDependency(cited, graph, visited)) return true;
    }
  }
  return false;
}

export function computeStatus(node, graph, requiredApprovals = 2) {
  if (SEED_TYPES.has(node.type)) return 'axiom';

  // Collapsed override (set by collapse cascade)
  if (node.status_override === 'collapsed') return 'collapsed';

  // Conjecture state model
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

  // Theorem state model
  const vs = node.verifications || [];
  if (vs.some(v => v.verdict === 'dispute')) return 'disputed';

  const approvals = vs.filter(v => v.verdict === 'approve' || v.verdict === 'conditional_approve').length;
  if (approvals < requiredApprovals) return 'pending';

  // Enough approvals, no disputes — check for unresolved conjecture ancestry
  if (hasConjectureDependency(node, graph)) return 'conditional';

  return 'accepted';
}

// ── Cascade helpers ───────────────────────────────────────────────────────────

function findDirectDependents(nodeId, graph) {
  return Object.values(graph)
    .filter(n => n.cites?.includes(nodeId))
    .map(n => n.id);
}

/** When a conjecture is proven: mark resolved_by and return list of newly-accepted node IDs. */
export function runPromotionCascade(conjectureId, resolvingTheoremId, graph) {
  graph[conjectureId].resolved_by = resolvingTheoremId;

  const promoted = [];
  const visited = new Set([conjectureId]);
  const queue = [...findDirectDependents(conjectureId, graph)];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph[nodeId];
    if (!node || node.type !== 'theorem') continue;

    const newStatus = computeStatus(node, graph);
    if (newStatus === 'accepted') {
      promoted.push(nodeId);
      for (const dep of findDirectDependents(nodeId, graph)) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }
  }

  return promoted;
}

/** When a conjecture is disproven: mark resolved_by, collapse all dependent theorems, return collapsed IDs. */
export function runCollapseCascade(conjectureId, resolvingTheoremId, graph) {
  graph[conjectureId].resolved_by = resolvingTheoremId;

  const collapsed = [];
  const visited = new Set([conjectureId]);
  const queue = [...findDirectDependents(conjectureId, graph)];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph[nodeId];
    if (!node || node.type !== 'theorem' || node.status_override === 'collapsed') continue;

    node.status_override = 'collapsed';
    collapsed.push(nodeId);

    for (const dep of findDirectDependents(nodeId, graph)) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  return collapsed;
}

// ── Validation ────────────────────────────────────────────────────────────────

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
        // Conjectures in agent's accepted_set are acceptable citations
        if (!agentAcceptedSet.has(cid)) errors.push(`Cited node '${cid}' is not in agent's accepted set`);
      }
    }
  }
  if (graph[node.id]) errors.push(`Node ID '${node.id}' already exists`);

  // Validate resolves/contradicts fields
  const resolves = node.resolves || [];
  const contradicts = node.contradicts || [];
  for (const cid of resolves) {
    const cn = graph[cid];
    if (!cn) errors.push(`resolves: conjecture '${cid}' does not exist`);
    else if (cn.type !== 'conjecture') errors.push(`resolves: '${cid}' is not a conjecture`);
    else if (computeStatus(cn, graph) !== 'open') errors.push(`resolves: conjecture '${cid}' is not open`);
  }
  for (const cid of contradicts) {
    const cn = graph[cid];
    if (!cn) errors.push(`contradicts: conjecture '${cid}' does not exist`);
    else if (cn.type !== 'conjecture') errors.push(`contradicts: '${cid}' is not a conjecture`);
    else if (computeStatus(cn, graph) !== 'open') errors.push(`contradicts: conjecture '${cid}' is not open`);
  }
  const overlap = resolves.filter(id => contradicts.includes(id));
  if (overlap.length > 0) errors.push(`Cannot both resolve and contradict: ${overlap.join(', ')}`);

  return { valid: errors.length === 0, errors };
}

export function validateConjecturePublication(node, graph) {
  const errors = [];

  if (!node.id || !node.author || !node.claim) {
    errors.push('Missing required fields (id, author, claim)');
  }
  if (node.proof_steps && node.proof_steps.length > 0) {
    errors.push('Conjectures must not have proof steps');
  }
  if (graph[node.id]) errors.push(`Node ID '${node.id}' already exists`);

  for (const cid of (node.cites || [])) {
    if (!graph[cid]) errors.push(`Cited node '${cid}' does not exist`);
  }

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
  if (target.status_override === 'collapsed') {
    errors.push('Collapsed nodes cannot be verified');
  }
  if (target.author === agentId) {
    errors.push('Self-verification is not permitted');
  }
  if (target.verifications?.some(v => v.agentId === agentId)) {
    errors.push('Duplicate verification: agent already verified this node');
  }
  if (!['approve', 'conditional_approve', 'dispute'].includes(verdict)) {
    errors.push("Verdict must be 'approve', 'conditional_approve', or 'dispute'");
  }
  if (verdict === 'dispute' && !justification) {
    errors.push('Disputes must include a justification');
  }

  return { valid: errors.length === 0, errors };
}

// ── Edge type computation ─────────────────────────────────────────────────────

export function computeEdgeType(citingNode, citedNodeId, graph) {
  if (citingNode.resolves?.includes(citedNodeId)) return 'resolves';
  if (citingNode.contradicts?.includes(citedNodeId)) return 'contradicts';

  const cited = graph[citedNodeId];
  if (!cited) return 'support';

  if (cited.type === 'conjecture' && computeStatus(cited, graph) !== 'proven') return 'conditional';
  if (cited.type === 'theorem' && computeStatus(cited, graph) === 'conditional') return 'conditional';

  return 'support';
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function computeStats(graph) {
  const all = Object.values(graph);
  const theorems = all.filter(n => n.type === 'theorem');
  const conjectures = all.filter(n => n.type === 'conjecture');
  return {
    total: all.length,
    definitions: all.filter(n => n.type === 'definition').length,
    postulates: all.filter(n => n.type === 'postulate' || n.type === 'common_notion').length,
    theorems: theorems.length,
    accepted: theorems.filter(n => computeStatus(n, graph) === 'accepted').length,
    pending: theorems.filter(n => computeStatus(n, graph) === 'pending').length,
    disputed: theorems.filter(n => computeStatus(n, graph) === 'disputed').length,
    conditional: theorems.filter(n => computeStatus(n, graph) === 'conditional').length,
    collapsed: theorems.filter(n => computeStatus(n, graph) === 'collapsed').length,
    conjectures: conjectures.length,
    conjectures_open: conjectures.filter(n => computeStatus(n, graph) === 'open').length,
    conjectures_proven: conjectures.filter(n => computeStatus(n, graph) === 'proven').length,
    conjectures_disproven: conjectures.filter(n => computeStatus(n, graph) === 'disproven').length,
  };
}
