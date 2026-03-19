import { computeStatus } from './protocol.js';

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

You must respond ONLY in valid JSON with no markdown formatting, no backticks, no preamble. Just raw JSON.`;
}

export function buildDerivationPrompt(agent, acceptedNodes, allNodes) {
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
    .map(n => `[${n.id}]: ${n.claim}`)
    .join('\n');

  // Patch 1: unverified (exclude rejected nodes — they appear in rejected section)
  const pending = Object.values(allNodes)
    .filter(n => !acceptedNodes[n.id] && !agent.rejected_set.has(n.id) && n.type === 'theorem')
    .map(n => `[${n.id}]: ${n.claim} (status: ${computeStatus(n)})`)
    .join('\n');

  // Patch 1: all public theorems for dedup awareness
  const allPublicTheorems = Object.values(allNodes)
    .filter(n => n.type === 'theorem')
    .map(n => `[${n.id}] (by ${n.author}, status: ${computeStatus(n)}): ${n.claim}`)
    .join('\n');

  // Patch 1: own publications — full and compact variants
  const ownPubsFull = [...agent.published]
    .filter(id => allNodes[id])
    .map(id => {
      const n = allNodes[id];
      return `[${n.id}] (status: ${computeStatus(n)}): ${n.claim}`;
    })
    .join('\n');
  const ownPubsCompact = [...agent.published]
    .filter(id => allNodes[id])
    .map(id => `[${id}] (${computeStatus(allNodes[id])})`)
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

  const jsonFooter = `
Respond with ONLY this JSON (no markdown, no backticks):
{
  "theorem_claim": "A clear statement of your new result using only system vocabulary",
  "proof_steps": [
    {"step": 1, "claim": "First step of reasoning", "justification": "Description of why this follows", "cites": ["P1", "D03"]},
    {"step": 2, "claim": "Second step", "justification": "Why this follows from step 1 and cited result", "cites": ["CN1", "P3"]}
  ],
  "all_cited_ids": ["P1", "P3", "CN1", "D03"],
  "confidence": "high/medium/low"
}`;

  const taskInstruction = `Your task: Derive a NEW result that follows logically from your accepted knowledge base.

CRITICAL CONSTRAINTS:
- Your result must be GENUINELY NEW — not a restatement, rephrasing, or minor variation of any theorem listed above (whether accepted, pending, disputed, or rejected).
- Do NOT re-derive anything you previously rejected — the flaw you identified still applies.
- Do NOT re-derive anything already in the public graph, even if it was published by another agent.
- Think about what interesting consequences follow from combining definitions, postulates, common notions, and any existing theorems in ways that have NOT been explored yet.`;

  const buildPrompt = (defs, ownPubs) => {
    const sections = [
      `Here is your complete accepted knowledge base, organized by tier:`,
      `\n=== DEFINITIONS (vocabulary of the system) ===\n${defs}`,
      `\n=== POSTULATES (constructive axioms) ===\n${posts}`,
      `\n=== COMMON NOTIONS (rules of equality and comparison) ===\n${cns}`,
      acceptedTheorems
        ? `\n=== ACCEPTED THEOREMS (previously derived and verified) ===\n${acceptedTheorems}`
        : `\n=== No theorems derived yet ===`,
      pending ? `\nNodes in the public graph you have NOT yet verified:\n${pending}` : '',
      allPublicTheorems
        ? `\n=== ALL THEOREMS IN THE PUBLIC GRAPH (for your awareness — do NOT re-derive any of these) ===\n${allPublicTheorems}`
        : '',
      ownPubs
        ? `\n=== YOUR OWN PUBLICATIONS ===\n${ownPubs}`
        : '',
      rejectedNodes
        ? `\n=== NODES YOU PREVIOUSLY REJECTED (do NOT re-derive these or anything equivalent) ===\n${rejectedNodes}`
        : '',
      `\n${taskInstruction}`,
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

  const steps = targetNode.proof_steps
    .map(s => `  Step ${s.step}: ${s.claim} [justification: ${s.justification}] [cites: ${(s.cites || []).join(', ')}]`)
    .join('\n');

  return `You are verifying a claimed result published by another agent. Your job is to check whether the proof is logically valid given the cited predecessors.

Your accepted knowledge base:

=== DEFINITIONS ===
${byType('definition')}

=== POSTULATES ===
${byType('postulate')}

=== COMMON NOTIONS ===
${byType('common_notion')}

${theorems ? `=== ACCEPTED THEOREMS ===\n${theorems}\n` : ''}
Node to verify [${targetNode.id}] by agent ${targetNode.author}:
Claim: ${targetNode.claim}
Proof steps:
${steps}
Cited predecessors: ${targetNode.cites.join(', ')}

Check:
1. Are all cited predecessors in your accepted set? (Required to proceed)
2. Does each proof step logically follow from its cited predecessors and the definitions?
3. Does the final claim follow from the proof steps?
4. Are there any gaps, circular reasoning, or unjustified leaps?
5. Are defined terms used consistently with their definitions?

Respond with ONLY this JSON (no markdown, no backticks):
{
  "verdict": "approve" or "dispute",
  "reasoning": "Your step-by-step analysis of the proof",
  "problem_step": null or step_number_where_error_is,
  "justification": "If disputing, explain the specific flaw"
}`;
}
