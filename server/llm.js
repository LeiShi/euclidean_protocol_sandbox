import { computeStatus, computeEdgeType } from './protocol.js';

export const DEFAULT_MODELS = {
  gemini: 'gemini-3-flash-preview',
  claude: 'claude-sonnet-4-5',
  openai: 'gpt-4o-mini',
};

export async function callLLM(config, systemPrompt, userPrompt, retries = 1) {
  const { provider, apiKey, model } = config;
  const resolvedModel = model || DEFAULT_MODELS[provider];

  try {
    if (provider === 'gemini') {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 16384 },
          }),
        }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason === 'MAX_TOKENS') {
        throw new Error('Response truncated (MAX_TOKENS) — output was cut off mid-JSON');
      }
      return candidate?.content?.parts?.[0]?.text || '';
    }

    if (provider === 'claude') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: 16384,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.content?.map(b => b.text || '').join('') || '';
    }

    if (provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 16384,
          temperature: 0.7,
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.choices?.[0]?.message?.content || '';
    }

    throw new Error(`Unknown provider: ${provider}`);
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return callLLM(config, systemPrompt, userPrompt, retries - 1);
    }
    throw e;
  }
}

export async function callLLMWithTrace(config, systemPrompt, userPrompt) {
  const resolvedModel = config.model || DEFAULT_MODELS[config.provider];
  const start = Date.now();
  const raw = await callLLM(config, systemPrompt, userPrompt);
  return {
    raw,
    trace: {
      llm_provider: config.provider,
      llm_model: resolvedModel,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      raw_response: raw,
      latency_ms: Date.now() - start,
    },
  };
}

export function parseJSON(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.slice(startIdx, endIdx + 1);
  }
  return JSON.parse(cleaned);
}

export function buildSystemPrompt(agent) {
  return `You are ${agent.name}, a reasoning agent in a formal axiomatic system. You are ${agent.personality}.

CRITICAL RULES:
- You operate in a formal system with specific terminology. NEVER use standard geometry terms.
- The vocabulary of this system uses: marks (fundamental objects), traces (connections between marks), rings (curved figures), spreads (measures between traces), triads (three-mark figures), etc.
- You must reason ONLY from the axioms and previously established results provided to you. Do NOT rely on any external knowledge.
- Every claim must be justified by explicit reference to specific axiom or theorem IDs.
- Your proofs must be step-by-step, with each step citing exactly which prior result it uses.

HOW TO DO PRODUCTIVE REASONING IN THIS SYSTEM:

The postulates are CONSTRUCTION tools:
- P1 lets you draw a true trace between any two marks (DRAW)
- P2 lets you extend a true trace indefinitely (EXTEND)
- P3 lets you create a ring with any center and gap (CONSTRUCT)

Productive reasoning COMBINES these constructions to BUILD FIGURES, then uses definitions and common notions to PROVE PROPERTIES of those figures.

EXAMPLE PATTERN (do not copy this literally — use it as a reasoning model):
  "Given a finite true trace with extremities A and B:
   Step 1: Describe a ring with center mark A and gap equal to span AB [P3]
   Step 2: Describe a ring with center mark B and gap equal to span BA [P3]
   Step 3: Suppose these rings meet at a mark C [assumption — state explicitly!]
   Step 4: Draw a true trace from A to C [P1]
   Step 5: Draw a true trace from B to C [P1]
   Step 6: Observe that AC is a span from the center of ring A to its ring-path, so AC is alike to AB [D15, D16]
   Step 7: Similarly BC is alike to BA [D15, D16]
   Step 8: Therefore AC, BC, and AB are all alike to one another [CN1]
   Step 9: The figure ABC is a triad with all spans alike — an all-alike-span triad [D19, D20]"

KEY STRATEGIES:
1. START WITH GIVEN OBJECTS (a true trace, a ring, a triad, etc.)
2. CONSTRUCT NEW OBJECTS using P1, P2, P3
3. USE DEFINITIONS to classify what you have built
4. USE COMMON NOTIONS to prove properties (especially alikeness of spans/spreads)
5. BUILD ON PRIOR THEOREMS — the most valuable results use earlier theorems as stepping stones, not just seed axioms
6. PROVE OPEN CONJECTURES — the most impactful contribution is resolving an open conjecture by providing a rigorous proof (or disproving it)

ABOUT CONJECTURES:
- You may PUBLISH a conjecture if your reasoning requires an assumption you cannot prove. This is honest and encouraged.
- You may CITE a conjecture in a proof. Your theorem will be marked CONDITIONAL.
- You may RESOLVE a conjecture by publishing a theorem that proves it — highest-value contribution.
- You may CONTRADICT a conjecture by publishing a theorem that disproves it.

You must respond ONLY in valid JSON with no markdown formatting, no backticks, no preamble. Just raw JSON.`;
}

function categorizeTheorems(graph) {
  const categories = {
    connectivity: [],
    extensibility: [],
    constructibility: [],
    cn_substitution: [],
    substantive: [],
  };
  for (const node of Object.values(graph)) {
    if (node.type !== 'theorem') continue;
    const claim = node.claim.toLowerCase();
    if (claim.includes('can be drawn from')) categories.connectivity.push(node.id);
    else if (claim.includes('can be extended')) categories.extensibility.push(node.id);
    else if (claim.includes('can be described with')) categories.constructibility.push(node.id);
    else if (claim.includes('added to') || claim.includes('subtracted from')) categories.cn_substitution.push(node.id);
    else categories.substantive.push(node.id);
  }
  return categories;
}

export function buildDerivationPrompt(agent, acceptedNodes, allNodes, allConjectures = {}) {
  const byType = (type) =>
    Object.values(acceptedNodes)
      .filter(n => n.type === type)
      .map(n => `[${n.id}]: ${n.claim}`)
      .join('\n');

  const DEFS_FULL = byType('definition');
  const DEFS_COMPACT = '[D01–D23]: (23 definitions available, cite by ID as needed)';
  const posts = byType('postulate');
  const cns = byType('common_notion');

  const acceptedTheorems = Object.values(acceptedNodes)
    .filter(n => n.type === 'theorem')
    .map(n => `[${n.id}] (${computeStatus(n, allNodes)}): ${n.claim}`)
    .join('\n');

  // Open conjectures visible to this agent (in their accepted_set or public)
  const openConjectures = Object.values(allNodes)
    .filter(n => n.type === 'conjecture' && computeStatus(n, allNodes) === 'open')
    .map(n => `[${n.id}] (open, by ${n.author}): ${n.claim}${n.motivation ? ` — motivation: ${n.motivation}` : ''}`)
    .join('\n');

  // Own publications — full and compact variants
  const ownPubsFull = [...agent.published]
    .filter(id => allNodes[id])
    .map(id => {
      const n = allNodes[id];
      return `[${n.id}] (status: ${computeStatus(n, allNodes)}): ${n.claim}`;
    })
    .join('\n');
  const ownPubsCompact = [...agent.published]
    .filter(id => allNodes[id])
    .map(id => `[${id}] (${computeStatus(allNodes[id], allNodes)})`)
    .join(', ');

  // Patch 1: rejected nodes with agent's own justification
  const rejectedNodes = [...agent.rejected_set]
    .filter(id => allNodes[id])
    .map(id => {
      const n = allNodes[id];
      const myV = (n.verifications || []).find(v => v.agentId === agent.id);
      const reason = (myV?.justification || myV?.reasoning || 'no reason recorded').slice(0, 150);
      return `[${n.id}]: ${n.claim} — REJECTED BECAUSE: ${reason}`;
    })
    .join('\n');

  // Patch 4: categorized theorem summary
  const cats = categorizeTheorems(allNodes);
  const substantiveLines = cats.substantive
    .map(id => {
      const n = allNodes[id];
      return n ? `[${id}] (${computeStatus(n, allNodes)}, by ${n.author}): ${n.claim}` : null;
    })
    .filter(Boolean)
    .join('\n');

  const trivialSummary = [
    cats.connectivity.length > 0
      ? `TRIVIAL CONNECTIVITY RESULTS — do NOT add more of these (${cats.connectivity.length} exist):\n  These establish "a true trace can be drawn from [type X] to [type Y]" — trivial instantiations of P1.\n  IDs: ${cats.connectivity.join(', ')}`
      : '',
    cats.extensibility.length > 0
      ? `TRIVIAL EXTENSIBILITY RESULTS — do NOT add more of these (${cats.extensibility.length} exist):\n  These establish "a true trace can be extended" for specific types — trivial instantiations of P2.\n  IDs: ${cats.extensibility.join(', ')}`
      : '',
    cats.constructibility.length > 0
      ? `TRIVIAL CONSTRUCTIBILITY RESULTS — do NOT add more of these (${cats.constructibility.length} exist):\n  These establish "a ring can be described with [type X]" — trivial instantiations of P3.\n  IDs: ${cats.constructibility.join(', ')}`
      : '',
    cats.cn_substitution.length > 0
      ? `TRIVIAL COMMON NOTION SUBSTITUTIONS — do NOT add more of these (${cats.cn_substitution.length} exist):\n  These substitute specific objects into common notions CN1–CN5.\n  IDs: ${cats.cn_substitution.join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n');

  // Conditional theorems section
  const conditionalTheorems = Object.values(allNodes)
    .filter(n => n.type === 'theorem' && computeStatus(n, allNodes) === 'conditional')
    .map(n => `[${n.id}] (conditional, by ${n.author}): ${n.claim}`)
    .join('\n');

  const qualityGuidelines = `=== QUALITY GUIDELINES — READ CAREFULLY ===

The following patterns are TRIVIAL and must NOT be published as theorems:

PATTERN 1 — TYPE SPECIALIZATION:
If a general statement says "X applies to any mark" and a definition establishes that some object IS a mark, then concluding "X applies to [that specific object]" is NOT a theorem. It is a trivial instantiation.
Examples of what NOT to publish:
- "A true trace can be drawn from [specific type of mark] to [specific type of mark]" — this is just P1 applied to a specific type of mark.
- "A ring can be described with [specific type of mark] as center mark" — this is just P3 applied to a specific type of mark.
- "A [specific type of trace] can be extended continuously" — this is just P2 applied to a specific type of trace.

PATTERN 2 — MECHANICAL SUBSTITUTION INTO COMMON NOTIONS:
Substituting a specific type of object into a common notion is not a theorem. For example, "if square spreads are added to square spreads, the wholes are alike" is just CN2 with "square spreads" substituted.

PATTERN 3 — DEFINITIONAL RESTATEMENT:
Merely restating what a definition says in slightly different words is not a theorem.

A result is worth publishing ONLY if it establishes something that requires CONSTRUCTIVE REASONING — building a figure, proving a property of a figure, or establishing a relationship that is not an immediate consequence of substituting types into existing general statements.`;

  const researchDirections = `=== SUGGESTED RESEARCH DIRECTIONS ===

LEVEL 1 — CONSTRUCTION: Use postulates to build a specific geometric figure.
  "Given [objects], construct [new figure] using P1, P2, P3."

LEVEL 2 — PROPERTIES: Prove a property about a constructed figure.
  "In a [figure] constructed by [method], [property] holds."

LEVEL 3 — GENERAL RESULTS: Prove something about ALL figures of a type.
  "For any [type of figure], [property] holds."

LEVEL 4 — RELATIONSHIPS: Establish when two objects or figures are related.
  "If [condition], then [relationship between objects]."

LEVEL 5 — CONSEQUENCES OF P5: The co-running postulate (P5) is the most powerful and underexplored axiom. What can you derive from it?

LEVEL 6 — RESOLVE CONJECTURES: Prove or disprove an open conjecture. This is the HIGHEST-VALUE contribution. If you can prove one, set "resolves": ["Cxxx"]. If you can disprove one, set "contradicts": ["Cxxx"].

If your reasoning requires an assumption you cannot prove, publish it as a CONJECTURE (option D below) rather than smuggling it in as a hidden assumption.

Your priorities:
1. BEST: Prove or disprove an open conjecture
2. GREAT: Publish a substantive new theorem using constructive reasoning
3. GOOD: Publish a well-motivated new conjecture for something you cannot prove
4. DO NOT: Add to any trivial category`;

  const jsonFooter = `
You may respond with ONE of the following output types (raw JSON only, no markdown):

OPTION A — PUBLISH A THEOREM (standard derivation):
{
  "type": "theorem",
  "theorem_claim": "A clear statement of your new result using only system vocabulary",
  "proof_steps": [
    {"step": 1, "claim": "First step of reasoning", "justification": "Why this follows", "cites": ["P1", "D03"]},
    {"step": 2, "claim": "Second step", "justification": "Why this follows", "cites": ["CN1"]}
  ],
  "all_cited_ids": ["P1", "CN1", "D03"],
  "resolves": [],
  "contradicts": [],
  "confidence": "high/medium/low"
}

OPTION B — PUBLISH A THEOREM THAT RESOLVES A CONJECTURE (proves it):
{
  "type": "theorem",
  "theorem_claim": "A clear statement proving the conjecture",
  "proof_steps": [ ... ],
  "all_cited_ids": ["P1", "P3", "D15", "T001"],
  "resolves": ["C001"],
  "contradicts": [],
  "confidence": "high"
}

OPTION C — PUBLISH A THEOREM THAT CONTRADICTS A CONJECTURE (disproves it):
{
  "type": "theorem",
  "theorem_claim": "A clear statement disproving the conjecture",
  "proof_steps": [ ... ],
  "all_cited_ids": ["P1", "CN5"],
  "resolves": [],
  "contradicts": ["C001"],
  "confidence": "high"
}

OPTION D — PUBLISH A CONJECTURE (an unproven claim you cannot yet prove):
Do NOT include proof_steps — conjectures are explicitly unproven.
{
  "type": "conjecture",
  "conjecture_claim": "A clear statement of the unproven claim",
  "motivation": "Why you believe this might be true and why it matters",
  "relevant_node_ids": ["P3", "D15", "D16"]
}

OPTION E — PUBLISH A CONDITIONAL THEOREM (valid but depends on an open conjecture):
Cite the conjecture in all_cited_ids. Your theorem will be marked CONDITIONAL.
{
  "type": "theorem",
  "theorem_claim": "A clear statement of your result",
  "proof_steps": [
    {"step": 1, "claim": "...", "justification": "...", "cites": ["P3"]},
    {"step": 2, "claim": "Assume conjecture C001 holds", "justification": "Open conjecture — this step is conditional", "cites": ["C001"]},
    {"step": 3, "claim": "...", "justification": "...", "cites": ["CN1"]}
  ],
  "all_cited_ids": ["P3", "C001", "CN1"],
  "resolves": [],
  "contradicts": [],
  "confidence": "medium"
}`;

  const taskInstruction = `Your task: Derive a NEW result that follows logically from your accepted knowledge base, OR name an important unproven assumption as a conjecture.

CRITICAL CONSTRAINTS:
- Your result must be GENUINELY NEW — not a restatement, rephrasing, or minor variation of any theorem listed above (whether accepted, pending, disputed, or rejected).
- Do NOT re-derive anything you previously rejected — the flaw you identified still applies.
- Do NOT re-derive anything already in the public graph, even if it was published by another agent.
- Do NOT add to any trivial category (connectivity, extensibility, constructibility, CN substitution).

CONJECTURE RULES:
- You MAY cite open conjectures as premises. If you do, your theorem will be marked CONDITIONAL.
- If your proof requires an unproven assumption not in any existing node, you MUST either publish it as a CONJECTURE (option D) or find a proof that avoids it. Do NOT smuggle hidden assumptions into a proof.
- If you publish a theorem that PROVES or DISPROVES an open conjecture, set the "resolves" or "contradicts" field accordingly.`;

  const buildPrompt = (defs, ownPubs) => {
    const sections = [
      `Here is your complete accepted knowledge base, organized by tier:`,
      `\n=== DEFINITIONS (vocabulary of the system) ===\n${defs}`,
      `\n=== POSTULATES (constructive axioms) ===\n${posts}`,
      `\n=== COMMON NOTIONS (rules of equality and comparison) ===\n${cns}`,
      acceptedTheorems
        ? `\n=== ACCEPTED/CONDITIONAL THEOREMS (previously derived and verified) ===\n${acceptedTheorems}`
        : `\n=== No theorems derived yet ===`,
      openConjectures
        ? `\n=== OPEN CONJECTURES — PROVE OR DISPROVE THESE (highest priority!) ===\n${openConjectures}`
        : '',
      conditionalTheorems
        ? `\n=== CONDITIONAL THEOREMS (awaiting conjecture resolution) ===\n${conditionalTheorems}`
        : '',
      ownPubs
        ? `\n=== YOUR OWN PUBLICATIONS ===\n${ownPubs}`
        : '',
      rejectedNodes
        ? `\n=== NODES YOU PREVIOUSLY REJECTED (do NOT re-derive these or anything equivalent) ===\n${rejectedNodes}`
        : '',
      `\n=== EXISTING THEOREMS — SUMMARY (do NOT re-derive any of these) ===`,
      trivialSummary ? `\n${trivialSummary}` : '',
      substantiveLines
        ? `\nSUBSTANTIVE THEOREMS (build on these):\n${substantiveLines}`
        : '\n(No substantive theorems yet — you are the pioneer!)',
      `\n\n${qualityGuidelines}`,
      `\n\n${researchDirections}`,
      `\n\n${taskInstruction}`,
      jsonFooter,
    ];
    return sections.join('');
  };

  // Patch 3: progressive trimming if prompt exceeds 12000 chars
  let prompt = buildPrompt(DEFS_FULL, ownPubsFull);
  if (prompt.length > 12000) {
    prompt = buildPrompt(DEFS_COMPACT, ownPubsFull);
  }
  if (prompt.length > 12000) {
    prompt = buildPrompt(DEFS_COMPACT, ownPubsCompact);
  }
  return prompt;
}

export function buildBeliefRevisionPrompt(agent, node, disputes, acceptedNodes) {
  const byType = (type) =>
    Object.values(acceptedNodes)
      .filter(n => n.type === type)
      .map(n => `[${n.id}]: ${n.claim}`)
      .join('\n');

  const steps = (node.proof_steps || [])
    .map(s => `  Step ${s.step}: ${s.claim} [justification: ${s.justification}] [cites: ${(s.cites || []).join(', ')}]`)
    .join('\n');

  const disputeLines = disputes
    .map((d, i) => `Dispute ${i + 1} by ${d.agentId}:\n  Verdict: dispute\n  Reasoning: ${d.justification || d.reasoning || ''}`)
    .join('\n\n');

  return `One of your published results has been DISPUTED by other agents. You must carefully consider their criticism and decide whether to retract or defend your result.

=== RELEVANT DEFINITIONS ===
${byType('definition')}

=== POSTULATES ===
${byType('postulate')}

=== COMMON NOTIONS ===
${byType('common_notion')}

=== YOUR PUBLISHED NODE [${node.id}] ===
Claim: ${node.claim}
Proof steps:
${steps}

=== DISPUTES RECEIVED ===
${disputeLines}

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
}`;
}

export function buildVerificationPrompt(agent, targetNode, acceptedNodes) {
  const byType = (type) =>
    Object.values(acceptedNodes)
      .filter(n => n.type === type)
      .map(n => `[${n.id}]: ${n.claim}`)
      .join('\n');

  const theorems = Object.values(acceptedNodes)
    .filter(n => n.type === 'theorem')
    .map(n => `[${n.id}]: ${n.claim}`)
    .join('\n');

  const isConjecture = targetNode.type === 'conjecture';

  const steps = isConjecture ? '' : (targetNode.proof_steps || [])
    .map(s => `  Step ${s.step}: ${s.claim} [justification: ${s.justification}] [cites: ${(s.cites || []).join(', ')}]`)
    .join('\n');

  const conjectureBlock = isConjecture ? `
VERIFYING A CONJECTURE:
You are reviewing a conjecture — an explicitly unproven claim. Your verdict does NOT prove or disprove it. Instead, assess:
1. Is the claim well-formed and clearly stated?
2. Is it consistent with the axioms and accepted theorems (no obvious contradiction)?
3. Does it seem like a reasonable and useful claim that could support further constructive reasoning if proven?
4. Is it genuinely unproven, or could it actually be derived from existing results? (If so, dispute with: "This can be proven directly from [nodes] and should be published as a theorem, not a conjecture.")

Approve if the conjecture is well-formed, non-trivial, and potentially useful. Dispute if it contradicts known results, is ill-formed, or is actually provable from existing accepted results.
` : `
6. TRIVIALITY CHECK: Even if the proof is logically valid, is the result a trivial consequence of substituting specific object types into a general statement?
   - "A true trace can be drawn from [X] to [Y]" where X and Y are specific types of marks → TRIVIAL (just P1 applied to specific types)
   - "A ring can be described with [X]" where X is a specific mark type → TRIVIAL (just P3 applied to a specific type)
   - Common notion with specific objects substituted → TRIVIAL

   If the theorem is trivial, you SHOULD dispute it:
   "This is a trivial instantiation of [postulate/common notion] and does not constitute a substantive contribution to the knowledge graph."

   Trivial results clutter the graph and waste verification resources. Only approve results that demonstrate genuine constructive reasoning or establish non-obvious properties.

7. HIDDEN ASSUMPTION CHECK: Does any proof step introduce a claim NOT justified by a cited predecessor and NOT self-evident from the definitions alone?
   - If the assumption is cited as a CONJECTURE node: use "conditional_approve" — the logic is valid but rests on unproven ground.
   - If the assumption is NOT cited as any node (smuggled in): DISPUTE the proof. Hidden assumptions are a protocol violation.

   Common hidden assumptions to watch for:
   - "These two rings meet at a mark" (intersection existence)
   - "A mark lies between two other marks" (betweenness)
   - "A true trace can be placed on another true trace" (superposition)
   These are NOT guaranteed by the postulates and MUST be declared as conjectures if used.
`;

  return `You are verifying a ${isConjecture ? 'conjecture' : 'claimed result'} published by another agent. Your job is to check whether it is valid given the accepted knowledge base.

Your accepted knowledge base:

=== DEFINITIONS ===
${byType('definition')}

=== POSTULATES ===
${byType('postulate')}

=== COMMON NOTIONS ===
${byType('common_notion')}

${theorems ? `=== ACCEPTED THEOREMS ===\n${theorems}\n` : ''}
Node to verify [${targetNode.id}] by agent ${targetNode.author}:
Type: ${targetNode.type}
Claim: ${targetNode.claim}
${isConjecture && targetNode.motivation ? `Motivation: ${targetNode.motivation}\n` : ''}${!isConjecture ? `Proof steps:\n${steps}\nCited predecessors: ${(targetNode.cites || []).join(', ')}` : ''}
${isConjecture ? conjectureBlock : `Check:
1. Are all cited predecessors in your accepted set? (Required to proceed)
2. Does each proof step logically follow from its cited predecessors and the definitions?
3. Does the final claim follow from the proof steps?
4. Are there any gaps, circular reasoning, or unjustified leaps?
5. Are defined terms used consistently with their definitions?
${conjectureBlock}`}
Respond with ONLY this JSON (no markdown, no backticks):
{
  "verdict": "approve" or "conditional_approve" or "dispute",
  "reasoning": "Your step-by-step analysis",
  "implicit_assumptions_found": [],
  "problem_step": null or step_number_where_error_is,
  "justification": "If disputing, explain the specific flaw"
}`;
}
