import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";

// ─── OBFUSCATION VOCABULARY ────────────────────────────────────────
const VOCAB = {
  point: "mark", line: "trace", circle: "ring", angle: "spread",
  triangle: "triad", right_angle: "square spread", parallel: "co-running",
  congruent: "matched", equal: "alike", perpendicular: "cross-standing",
  bisect: "halve", segment: "span", ray: "beam", straight: "true",
  plane: "field", distance: "gap", midpoint: "center mark",
  equilateral: "all-alike-span", isosceles: "two-alike-span",
  scalene: "no-alike-span", acute: "narrow spread", obtuse: "wide spread",
  polygon: "closed trace figure", quadrilateral: "four-trace figure",
  rectangle: "all-square-spread figure", square: "alike-span square-spread figure",
  radius: "ring-span", diameter: "full ring-span", circumference: "ring-path",
  arc: "ring-part", chord: "ring-cut", tangent: "ring-touch",
  exterior: "outside", interior: "inside", adjacent: "neighboring",
  supplementary: "completing spreads", complementary: "half-completing spreads",
  vertical_angles: "cross-spreads", corresponding: "echo-placed",
  alternate: "flip-placed", transversal: "crossing trace",
};

const REVERSE_VOCAB = Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [v, k]));

// De-obfuscation: replace obfuscated terms with standard geometry terms
// Sort by length descending so multi-word terms get matched first
const DEOBFUSCATE_ENTRIES = Object.entries(VOCAB)
  .map(([standard, obfuscated]) => [obfuscated, standard])
  .sort((a, b) => b[0].length - a[0].length);

function deobfuscate(text) {
  if (!text) return text;
  let result = text;
  for (const [obfuscated, standard] of DEOBFUSCATE_ENTRIES) {
    const regex = new RegExp(obfuscated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, (match) => {
      // Preserve original casing style
      if (match[0] === match[0].toUpperCase()) {
        return standard.charAt(0).toUpperCase() + standard.slice(1);
      }
      return standard;
    });
  }
  return result;
}

// ─── SEED AXIOMS (in obfuscated language) ──────────────────────────
const POSTULATES = [
  { id: "P1", claim: "A true trace can be drawn from any mark to any mark.", type: "postulate" },
  { id: "P2", claim: "A finite true trace can be extended continuously in a true trace.", type: "postulate" },
  { id: "P3", claim: "A ring can be described with any center mark and any gap.", type: "postulate" },
  { id: "P4", claim: "All square spreads are alike to one another.", type: "postulate" },
  { id: "P5", claim: "If a true trace falling on two true traces makes the inside spreads on the same side less than two square spreads, the two true traces, if extended indefinitely, meet on that side.", type: "postulate" },
];

const COMMON_NOTIONS = [
  { id: "CN1", claim: "Things which are alike to the same thing are alike to one another.", type: "common_notion" },
  { id: "CN2", claim: "If alikes are added to alikes, the wholes are alike.", type: "common_notion" },
  { id: "CN3", claim: "If alikes are subtracted from alikes, the remainders are alike.", type: "common_notion" },
  { id: "CN4", claim: "Things which coincide with one another are alike to one another.", type: "common_notion" },
  { id: "CN5", claim: "The whole is greater than the part.", type: "common_notion" },
];

const DEFINITIONS = [
  { id: "D01", claim: "A mark is that which has no part.", type: "definition" },
  { id: "D02", claim: "A trace is breadthless length.", type: "definition" },
  { id: "D03", claim: "The extremities of a trace are marks.", type: "definition" },
  { id: "D04", claim: "A true trace is a trace which lies evenly with the marks on itself.", type: "definition" },
  { id: "D05", claim: "A surface is that which has length and breadth only.", type: "definition" },
  { id: "D06", claim: "The extremities of a surface are traces.", type: "definition" },
  { id: "D07", claim: "A flat surface, or field, is a surface which lies evenly with the true traces on itself.", type: "definition" },
  { id: "D08", claim: "A field spread is the inclination to one another of two traces in a field which meet one another and do not lie in a true trace.", type: "definition" },
  { id: "D09", claim: "When the traces containing the spread are true, the spread is called a true-trace spread.", type: "definition" },
  { id: "D10", claim: "When a true trace standing on a true trace makes the neighboring spreads alike to one another, each of the alike spreads is a square spread, and the true trace standing on the other is called cross-standing to that on which it stands.", type: "definition" },
  { id: "D11", claim: "A wide spread is a spread greater than a square spread.", type: "definition" },
  { id: "D12", claim: "A narrow spread is a spread less than a square spread.", type: "definition" },
  { id: "D13", claim: "A boundary is that which is an extremity of anything.", type: "definition" },
  { id: "D14", claim: "A figure is that which is contained by any boundary or boundaries.", type: "definition" },
  { id: "D15", claim: "A ring is a field figure contained by one trace such that all the true traces falling upon it from one mark among those lying within the figure are alike to one another.", type: "definition" },
  { id: "D16", claim: "And that mark is called the center mark of the ring.", type: "definition" },
  { id: "D17", claim: "A full ring-span is any true trace drawn through the center mark and terminated in both directions by the ring-path, and such a true trace also halves the ring.", type: "definition" },
  { id: "D18", claim: "A half-ring is the figure contained by the full ring-span and the ring-path cut off by it.", type: "definition" },
  { id: "D19", claim: "True-trace figures are those contained by true traces: triads being those contained by three, four-trace figures by four, and many-trace figures by more than four true traces.", type: "definition" },
  { id: "D20", claim: "Of triads, an all-alike-span triad has its three spans alike, a two-alike-span triad has two of its spans alone alike, and a no-alike-span triad has its three spans all unalike.", type: "definition" },
  { id: "D21", claim: "Further, of triads: a square-spread triad has a square spread, a wide-spread triad has a wide spread, and a narrow-spread triad has three narrow spreads.", type: "definition" },
  { id: "D22", claim: "Of four-trace figures: an alike-span square-spread figure is both all-alike-span and all-square-spread; a long figure is square-spread but not alike-span; a tilt-alike figure is alike-span but not square-spread; and a tilt-long figure has its opposite spans and spreads alike to one another but is neither alike-span nor square-spread.", type: "definition" },
  { id: "D23", claim: "Co-running true traces are true traces which, being in the same field and being extended indefinitely in both directions, do not meet one another in either direction.", type: "definition" },
];

const ALL_SEEDS = [...POSTULATES, ...COMMON_NOTIONS, ...DEFINITIONS];

// ─── AGENT DEFINITIONS ─────────────────────────────────────────────
const AGENT_DEFS = [
  { id: "A1", name: "Archon", color: "#e07a5f", personality: "methodical and careful, prefers building on well-established foundations, verifies thoroughly before extending" },
  { id: "A2", name: "Bion", color: "#3d85c6", personality: "creative and adventurous, looks for surprising combinations of existing results, willing to attempt ambitious derivations" },
  { id: "A3", name: "Callias", color: "#81b29a", personality: "skeptical and rigorous, prioritizes verification over derivation, looks for flaws in others' proofs" },
];

// ─── PROTOCOL LAYER ────────────────────────────────────────────────
function validatePublication(node, graph) {
  const errors = [];
  if (!node.id || !node.author || !node.claim || !node.proof_steps || !node.cites) {
    errors.push("Missing required fields (id, author, claim, proof_steps, cites)");
  }
  if (node.cites.length === 0) {
    errors.push("Publication must cite at least one predecessor");
  }
  for (const cid of node.cites) {
    if (!graph[cid]) errors.push(`Cited node '${cid}' does not exist in the public graph`);
  }
  const existing = Object.values(graph).find(n => n.id === node.id);
  if (existing) errors.push(`Node ID '${node.id}' already exists`);
  return { valid: errors.length === 0, errors };
}

function validateVerification(verification, graph) {
  const errors = [];
  const { targetId, agentId, verdict, justification } = verification;
  const target = graph[targetId];
  if (!target) { errors.push(`Target node '${targetId}' does not exist`); return { valid: false, errors }; }
  if (["postulate", "common_notion", "definition"].includes(target.type)) errors.push("Seed nodes (definitions, postulates, common notions) cannot be verified");
  if (target.author === agentId) errors.push("Self-verification is not permitted");
  if (target.verifications?.some(v => v.agentId === agentId)) errors.push("Duplicate verification: agent already verified this node");
  if (!["approve", "dispute"].includes(verdict)) errors.push("Verdict must be 'approve' or 'dispute'");
  if (verdict === "dispute" && !justification) errors.push("Disputes must include a justification");
  return { valid: errors.length === 0, errors };
}

function computeStatus(node, requiredApprovals = 2) {
  if (node.type === "postulate" || node.type === "common_notion" || node.type === "definition") return "axiom";
  const vs = node.verifications || [];
  if (vs.some(v => v.verdict === "dispute")) return "disputed";
  if (vs.filter(v => v.verdict === "approve").length >= requiredApprovals) return "accepted";
  return "pending";
}

// ─── LLM INTEGRATION LAYER ────────────────────────────────────────
async function callLLM(provider, apiKey, systemPrompt, userPrompt, retries = 1) {
  try {
    if (provider === "gemini") {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-preview:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }),
        }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (provider === "claude") {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.content?.map(b => b.text || "").join("") || "";
    } else if (provider === "openai") {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          max_tokens: 2048, temperature: 0.7,
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.choices?.[0]?.message?.content || "";
    }
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return callLLM(provider, apiKey, systemPrompt, userPrompt, retries - 1);
    }
    throw e;
  }
}

function buildSystemPrompt(agent) {
  return `You are ${agent.name}, a reasoning agent in a formal axiomatic system. You are ${agent.personality}.

CRITICAL RULES:
- You operate in a formal system with specific terminology. NEVER use standard geometry terms.
- The vocabulary of this system uses: marks (fundamental objects), traces (connections between marks), rings (curved figures), spreads (measures between traces), triads (three-mark figures), etc.
- You must reason ONLY from the axioms and previously established results provided to you. Do NOT rely on any external knowledge.
- Every claim must be justified by explicit reference to specific axiom or theorem IDs.
- Your proofs must be step-by-step, with each step citing exactly which prior result it uses.

You must respond ONLY in valid JSON with no markdown formatting, no backticks, no preamble. Just raw JSON.`;
}

function buildDerivationPrompt(agent, acceptedNodes, allNodes) {
  const defs = Object.values(acceptedNodes).filter(n => n.type === "definition")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");
  const posts = Object.values(acceptedNodes).filter(n => n.type === "postulate")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");
  const cns = Object.values(acceptedNodes).filter(n => n.type === "common_notion")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");
  const theorems = Object.values(acceptedNodes).filter(n => n.type === "theorem")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");

  const pending = Object.values(allNodes).filter(n =>
    !acceptedNodes[n.id] && !["postulate", "common_notion", "definition"].includes(n.type)
  ).map(n => `[${n.id}]: ${n.claim} (status: ${computeStatus(n)})`).join("\n");

  return `Here is your complete accepted knowledge base, organized by tier:

=== DEFINITIONS (vocabulary of the system) ===
${defs}

=== POSTULATES (constructive axioms) ===
${posts}

=== COMMON NOTIONS (rules of equality and comparison) ===
${cns}

${theorems ? `=== ACCEPTED THEOREMS (previously derived and verified) ===\n${theorems}` : "=== No theorems derived yet ==="}

${pending ? `\nNodes in the public graph you have NOT yet verified:\n${pending}` : ""}

Your task: Derive a NEW result that follows logically from your accepted knowledge base. The result should be non-trivial and not a simple restatement of an existing result. Think about what interesting consequences follow from combining definitions, postulates, common notions, and any existing theorems. You may cite definitions when using defined terms.

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
}

function buildVerificationPrompt(agent, targetNode, acceptedNodes) {
  const defs = Object.values(acceptedNodes).filter(n => n.type === "definition")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");
  const posts = Object.values(acceptedNodes).filter(n => n.type === "postulate")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");
  const cns = Object.values(acceptedNodes).filter(n => n.type === "common_notion")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");
  const theorems = Object.values(acceptedNodes).filter(n => n.type === "theorem")
    .map(n => `[${n.id}]: ${n.claim}`).join("\n");

  return `You are verifying a claimed result published by another agent. Your job is to check whether the proof is logically valid given the cited predecessors.

Your accepted knowledge base:

=== DEFINITIONS ===
${defs}

=== POSTULATES ===
${posts}

=== COMMON NOTIONS ===
${cns}

${theorems ? `=== ACCEPTED THEOREMS ===\n${theorems}` : ""}

Node to verify [${targetNode.id}] by agent ${targetNode.author}:
Claim: ${targetNode.claim}
Proof steps:
${targetNode.proof_steps.map(s =>
    `  Step ${s.step}: ${s.claim} [justification: ${s.justification}] [cites: ${s.cites.join(", ")}]`
  ).join("\n")}
Cited predecessors: ${targetNode.cites.join(", ")}

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

function parseJSON(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const startIdx = cleaned.indexOf("{");
  const endIdx = cleaned.lastIndexOf("}");
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.slice(startIdx, endIdx + 1);
  }
  return JSON.parse(cleaned);
}

// ─── FORCE GRAPH COMPONENT ────────────────────────────────────────
function ForceGraph({ graph, selectedNode, onSelectNode }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);

  const { nodes, links } = useMemo(() => {
    const ns = Object.values(graph).map(n => ({
      ...n,
      status: computeStatus(n),
      fx: (n.type === "postulate" || n.type === "common_notion") ? undefined : undefined,
    }));
    const ls = [];
    for (const n of ns) {
      for (const cid of (n.cites || [])) {
        if (graph[cid]) ls.push({ source: cid, target: n.id });
      }
    }
    return { nodes: ns, links: ls };
  }, [graph]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 700;
    const height = svgRef.current.clientHeight || 420;
    svg.selectAll("*").remove();

    svg.append("defs").append("marker")
      .attr("id", "arrowhead").attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20).attr("refY", 0).attr("orient", "auto")
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .append("path").attr("d", "M 0,-5 L 10,0 L 0,5").attr("fill", "#666");

    const g = svg.append("g");

    svg.call(d3.zoom().scaleExtent([0.3, 4]).on("zoom", (e) => {
      g.attr("transform", e.transform);
    }));

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(d => {
        // Shorter links for citation edges to definitions
        const target = graph[d.target?.id || d.target];
        if (target && target.type === "definition") return 40;
        return 80;
      }))
      .force("charge", d3.forceManyBody().strength(d => d.type === "definition" ? -60 : -200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(d => d.type === "definition" ? 12 : 25));

    const link = g.append("g").selectAll("line").data(links).join("line")
      .attr("stroke", "#555").attr("stroke-opacity", 0.5).attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    const node = g.append("g").selectAll("g").data(nodes).join("g")
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on("click", (e, d) => onSelectNode(d.id));

    const statusColor = d => {
      if (d.status === "axiom") return "#9ca3af";
      if (d.status === "accepted") return "#22c55e";
      if (d.status === "disputed") return "#ef4444";
      return "#f59e0b";
    };

    const agentColor = d => {
      const a = AGENT_DEFS.find(a => a.id === d.author);
      return a ? a.color : "#9ca3af";
    };

    const nodeRadius = d => {
      if (d.type === "definition") return 7;
      if (d.type === "postulate" || d.type === "common_notion") return 10;
      return 14;
    };

    const nodeFill = d => {
      if (d.type === "definition") return "#374151";
      if (d.type === "postulate" || d.type === "common_notion") return "#4b5563";
      return agentColor(d);
    };

    node.append("circle")
      .attr("r", nodeRadius)
      .attr("fill", nodeFill)
      .attr("stroke", statusColor)
      .attr("stroke-width", d => selectedNode === d.id ? 4 : 2.5)
      .attr("opacity", d => d.type === "definition" ? 0.7 : 0.92);

    node.append("text")
      .text(d => d.id)
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .attr("font-size", d => d.type === "definition" ? "7px" : "9px")
      .attr("fill", "#fff").attr("font-weight", "600")
      .attr("pointer-events", "none");

    simulation.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    simRef.current = simulation;
    return () => simulation.stop();
  }, [nodes, links, selectedNode, onSelectNode]);

  return <svg ref={svgRef} style={{ width: "100%", height: "100%", background: "#111216", borderRadius: 8 }} />;
}

// ─── MAIN APP ──────────────────────────────────────────────────────
export default function EuclidSandbox() {
  const [provider, setProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [graph, setGraph] = useState(() => {
    const g = {};
    for (const p of ALL_SEEDS) {
      g[p.id] = { ...p, author: "SYSTEM", cites: [], proof_steps: [], verifications: [] };
    }
    return g;
  });
  const [agents, setAgents] = useState(() =>
    AGENT_DEFS.map(a => ({
      ...a,
      accepted_set: new Set(ALL_SEEDS.map(p => p.id)),
      rejected_set: new Set(),
      published: new Set(),
    }))
  );
  const [log, setLog] = useState([{ turn: 0, agent: "SYSTEM", action: "init", detail: "Seeded 23 definitions + 5 postulates + 5 common notions. All agents initialized." }]);
  const [turn, setTurn] = useState(0);
  const [running, setRunning] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [error, setError] = useState(null);
  const [showVocab, setShowVocab] = useState(false);
  const nodeCounter = useRef(1);
  const abortRef = useRef(false);

  const addLog = useCallback((entry) => {
    setLog(prev => [...prev, { turn, ...entry, ts: Date.now() }]);
  }, [turn]);

  const getAcceptedNodes = useCallback((agent) => {
    const result = {};
    for (const nid of agent.accepted_set) {
      if (graph[nid]) result[nid] = graph[nid];
    }
    return result;
  }, [graph]);

  const doAgentTurn = useCallback(async (agentIdx) => {
    if (!apiKey) { setError("Please enter an API key"); return; }
    const agent = agents[agentIdx];
    const acceptedNodes = getAcceptedNodes(agent);

    // Phase 1: Check for unverified nodes to verify
    const unverified = Object.values(graph).filter(n =>
      !agent.accepted_set.has(n.id) &&
      !agent.rejected_set.has(n.id) &&
      !agent.published.has(n.id) &&
      !["postulate", "common_notion", "definition"].includes(n.type)
    );

    // Decide: verify or derive?
    const shouldVerify = unverified.length > 0 && (
      agent.personality.includes("skeptical") || Math.random() < 0.5
    );

    if (shouldVerify && unverified.length > 0) {
      // Pick a verifiable node (all its cites must be in our accepted set)
      const verifiable = unverified.filter(n =>
        n.cites.every(cid => agent.accepted_set.has(cid))
      );

      if (verifiable.length > 0) {
        const target = verifiable[Math.floor(Math.random() * verifiable.length)];
        addLog({ agent: agent.id, action: "verify_start", detail: `Attempting to verify [${target.id}]: "${target.claim.slice(0, 60)}..."` });

        try {
          const sysPrompt = buildSystemPrompt(agent);
          const userPrompt = buildVerificationPrompt(agent, target, acceptedNodes);
          const resp = await callLLM(provider, apiKey, sysPrompt, userPrompt);
          const parsed = parseJSON(resp);

          const verification = {
            targetId: target.id,
            agentId: agent.id,
            verdict: parsed.verdict,
            justification: parsed.justification || parsed.reasoning,
          };

          const val = validateVerification(verification, graph);
          if (!val.valid) {
            addLog({ agent: agent.id, action: "protocol_reject", detail: `Verification rejected: ${val.errors.join("; ")}` });
            return;
          }

          setGraph(prev => {
            const updated = { ...prev };
            updated[target.id] = {
              ...updated[target.id],
              verifications: [...(updated[target.id].verifications || []), verification],
            };
            return updated;
          });

          setAgents(prev => prev.map((a, i) => {
            if (i !== agentIdx) return a;
            const newAccepted = new Set(a.accepted_set);
            const newRejected = new Set(a.rejected_set);
            if (parsed.verdict === "approve") newAccepted.add(target.id);
            else newRejected.add(target.id);
            return { ...a, accepted_set: newAccepted, rejected_set: newRejected };
          }));

          addLog({
            agent: agent.id,
            action: parsed.verdict === "approve" ? "approve" : "dispute",
            detail: `${parsed.verdict === "approve" ? "Approved" : "Disputed"} [${target.id}]: ${(parsed.reasoning || parsed.justification || "").slice(0, 120)}...`,
          });
        } catch (e) {
          addLog({ agent: agent.id, action: "error", detail: `LLM error during verification: ${e.message}` });
        }
        return;
      }
    }

    // Phase 2: Derive something new
    addLog({ agent: agent.id, action: "derive_start", detail: `Attempting new derivation from ${agent.accepted_set.size} accepted nodes...` });

    try {
      const sysPrompt = buildSystemPrompt(agent);
      const userPrompt = buildDerivationPrompt(agent, acceptedNodes, graph);
      const resp = await callLLM(provider, apiKey, sysPrompt, userPrompt);
      const parsed = parseJSON(resp);

      if (!parsed.theorem_claim || !parsed.proof_steps || !parsed.all_cited_ids) {
        addLog({ agent: agent.id, action: "error", detail: "LLM response missing required fields" });
        return;
      }

      // Check all cited IDs are in agent's accepted set
      const invalidCites = parsed.all_cited_ids.filter(cid => !agent.accepted_set.has(cid));
      if (invalidCites.length > 0) {
        addLog({ agent: agent.id, action: "protocol_reject", detail: `Derivation cites unaccepted nodes: ${invalidCites.join(", ")}` });
        return;
      }

      const newId = `T${String(nodeCounter.current++).padStart(3, "0")}`;
      const newNode = {
        id: newId,
        author: agent.id,
        claim: parsed.theorem_claim,
        proof_steps: parsed.proof_steps,
        cites: parsed.all_cited_ids,
        type: "theorem",
        verifications: [],
        confidence: parsed.confidence || "medium",
      };

      const val = validatePublication(newNode, graph);
      if (!val.valid) {
        addLog({ agent: agent.id, action: "protocol_reject", detail: `Publication rejected: ${val.errors.join("; ")}` });
        return;
      }

      setGraph(prev => ({ ...prev, [newId]: newNode }));
      setAgents(prev => prev.map((a, i) => {
        if (i !== agentIdx) return a;
        const newAccepted = new Set(a.accepted_set);
        newAccepted.add(newId);
        const newPublished = new Set(a.published);
        newPublished.add(newId);
        return { ...a, accepted_set: newAccepted, published: newPublished };
      }));

      addLog({
        agent: agent.id,
        action: "publish",
        detail: `Published [${newId}]: "${parsed.theorem_claim.slice(0, 100)}..." (cites: ${parsed.all_cited_ids.join(", ")})`,
      });
    } catch (e) {
      addLog({ agent: agent.id, action: "error", detail: `LLM error during derivation: ${e.message}` });
    }
  }, [agents, graph, apiKey, provider, addLog, getAcceptedNodes]);

  const stepOnce = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    const agentIdx = turn % 3;
    await doAgentTurn(agentIdx);
    setTurn(t => t + 1);
    setRunning(false);
  }, [turn, running, doAgentTurn]);

  const runN = useCallback(async (n) => {
    setRunning(true);
    abortRef.current = false;
    setError(null);
    for (let i = 0; i < n; i++) {
      if (abortRef.current) break;
      const agentIdx = (turn + i) % 3;
      await doAgentTurn(agentIdx);
      setTurn(t => t + 1);
      await new Promise(r => setTimeout(r, 300));
    }
    setRunning(false);
  }, [turn, doAgentTurn]);

  const stop = useCallback(() => { abortRef.current = true; }, []);

  const selectedNodeData = selectedNode ? graph[selectedNode] : null;

  const stats = useMemo(() => {
    const all = Object.values(graph);
    const theorems = all.filter(n => n.type === "theorem");
    return {
      total: all.length,
      definitions: all.filter(n => n.type === "definition").length,
      postulates: all.filter(n => n.type === "postulate" || n.type === "common_notion").length,
      theorems: theorems.length,
      accepted: theorems.filter(n => computeStatus(n) === "accepted").length,
      pending: theorems.filter(n => computeStatus(n) === "pending").length,
      disputed: theorems.filter(n => computeStatus(n) === "disputed").length,
    };
  }, [graph]);

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', monospace", background: "#0a0b0e", color: "#d4d4d8", minHeight: "100vh", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #27272a", paddingBottom: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, color: "#f4f4f5", letterSpacing: 1 }}>EUCLID PROTOCOL SANDBOX</h1>
          <span style={{ fontSize: 11, color: "#71717a" }}>Axiomatic reasoning through structured protocol</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={provider} onChange={e => setProvider(e.target.value)}
            style={{ background: "#18181b", color: "#d4d4d8", border: "1px solid #3f3f46", borderRadius: 4, padding: "4px 8px", fontSize: 12 }}>
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
            <option value="openai">OpenAI</option>
          </select>
          <input type="password" placeholder="API Key" value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={{ background: "#18181b", color: "#d4d4d8", border: "1px solid #3f3f46", borderRadius: 4, padding: "4px 8px", fontSize: 12, width: 200 }} />
        </div>
      </div>

      {error && <div style={{ background: "#7f1d1d", padding: "6px 12px", borderRadius: 4, fontSize: 12 }}>{error}</div>}

      {/* CONTROLS + STATS */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={stepOnce} disabled={running || !apiKey}
          style={{ background: running ? "#27272a" : "#3b82f6", color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 12, cursor: running ? "wait" : "pointer", fontFamily: "inherit" }}>
          {running ? "Running..." : `Step (${AGENT_DEFS[turn % 3].name}'s turn)`}
        </button>
        <button onClick={() => runN(9)} disabled={running || !apiKey}
          style={{ background: "#1e3a5f", color: "#93c5fd", border: "1px solid #3b82f6", borderRadius: 4, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Run 3 rounds (9 steps)
        </button>
        {running && <button onClick={stop}
          style={{ background: "#7f1d1d", color: "#fca5a5", border: "none", borderRadius: 4, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Stop
        </button>}
        <button onClick={() => setShowVocab(!showVocab)}
          style={{ background: "#18181b", color: "#a1a1aa", border: "1px solid #3f3f46", borderRadius: 4, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", marginLeft: "auto" }}>
          {showVocab ? "Hide" : "Show"} Vocabulary
        </button>
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#a1a1aa" }}>
          <span>Turn: <b style={{ color: "#f4f4f5" }}>{turn}</b></span>
          <span>Seeds: <span style={{ color: "#71717a" }}>{stats.definitions}D+{stats.postulates}P</span></span>
          <span>Theorems: <b style={{ color: "#f4f4f5" }}>{stats.theorems}</b></span>
          <span style={{ color: "#22c55e" }}>Accepted: {stats.accepted}</span>
          <span style={{ color: "#f59e0b" }}>Pending: {stats.pending}</span>
          <span style={{ color: "#ef4444" }}>Disputed: {stats.disputed}</span>
        </div>
      </div>

      {/* VOCAB POPUP */}
      {showVocab && (
        <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: 12, fontSize: 11, display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 120, overflowY: "auto" }}>
          {Object.entries(VOCAB).map(([k, v]) => (
            <span key={k} style={{ background: "#27272a", padding: "2px 8px", borderRadius: 3 }}>
              <span style={{ color: "#71717a", textDecoration: "line-through" }}>{k}</span> → <span style={{ color: "#fbbf24" }}>{v}</span>
            </span>
          ))}
        </div>
      )}

      {/* MAIN CONTENT */}
      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
        {/* LEFT: GRAPH */}
        <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ flex: 1, minHeight: 380, position: "relative" }}>
            <ForceGraph graph={graph} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
            {/* Legend */}
            <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(10,11,14,0.85)", padding: "6px 10px", borderRadius: 4, fontSize: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#374151", marginRight: 3, opacity: 0.7 }} />Def</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#4b5563", marginRight: 3 }} />Post/CN</span>
              {AGENT_DEFS.map(a => (
                <span key={a.id}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: a.color, marginRight: 3 }} />{a.name}</span>
              ))}
              <span style={{ marginLeft: 6 }}>Border:</span>
              <span style={{ color: "#22c55e" }}>Accepted</span>
              <span style={{ color: "#f59e0b" }}>Pending</span>
              <span style={{ color: "#ef4444" }}>Disputed</span>
            </div>
          </div>

          {/* NODE DETAIL */}
          {selectedNodeData && (
            <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: 12, fontSize: 11, maxHeight: 260, overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <b style={{ color: "#f4f4f5", fontSize: 13 }}>[{selectedNodeData.id}]</b>
                  <span style={{ fontSize: 10, color: "#71717a", textTransform: "uppercase" }}>{selectedNodeData.type?.replace("_", " ")}</span>
                </div>
                <span style={{
                  padding: "1px 8px", borderRadius: 3, fontSize: 10,
                  background: computeStatus(selectedNodeData) === "accepted" ? "#14532d" : computeStatus(selectedNodeData) === "disputed" ? "#7f1d1d" : computeStatus(selectedNodeData) === "axiom" ? "#1f2937" : "#78350f",
                  color: computeStatus(selectedNodeData) === "accepted" ? "#4ade80" : computeStatus(selectedNodeData) === "disputed" ? "#f87171" : computeStatus(selectedNodeData) === "axiom" ? "#9ca3af" : "#fbbf24",
                }}>{computeStatus(selectedNodeData)}</span>
              </div>
              {/* Obfuscated claim (what agents see) */}
              <div style={{ color: "#a1a1aa", marginBottom: 3, fontSize: 10 }}>AGENT VIEW:</div>
              <div style={{ color: "#e4e4e7", marginBottom: 4, fontStyle: "italic", paddingLeft: 8, borderLeft: "2px solid #3f3f46" }}>{selectedNodeData.claim}</div>
              {/* De-obfuscated claim (human-readable) */}
              <div style={{ color: "#fbbf24", marginBottom: 3, fontSize: 10 }}>HUMAN VIEW:</div>
              <div style={{ color: "#fef3c7", marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid #fbbf24" }}>{deobfuscate(selectedNodeData.claim)}</div>
              {selectedNodeData.author !== "SYSTEM" && (
                <>
                  <div style={{ color: "#71717a", marginBottom: 4 }}>Author: {AGENT_DEFS.find(a => a.id === selectedNodeData.author)?.name || selectedNodeData.author} | Cites: {selectedNodeData.cites.join(", ")}</div>
                  {selectedNodeData.proof_steps?.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ color: "#71717a", marginBottom: 2, fontSize: 10 }}>PROOF STEPS:</div>
                      {selectedNodeData.proof_steps.map((s, i) => (
                        <div key={i} style={{ marginLeft: 8, marginBottom: 4 }}>
                          <div style={{ color: "#a1a1aa" }}>
                            <b>Step {s.step}:</b> {s.claim} <span style={{ color: "#71717a" }}>[{(s.cites || []).join(", ")}]</span>
                          </div>
                          <div style={{ color: "#fef3c7", fontSize: 10, marginLeft: 12, opacity: 0.8 }}>
                            ↳ {deobfuscate(s.claim)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedNodeData.verifications?.length > 0 && (
                    <div style={{ borderTop: "1px solid #27272a", paddingTop: 4 }}>
                      {selectedNodeData.verifications.map((v, i) => (
                        <div key={i} style={{ color: v.verdict === "approve" ? "#4ade80" : "#f87171", marginBottom: 2 }}>
                          {AGENT_DEFS.find(a => a.id === v.agentId)?.name}: {v.verdict} — {(v.justification || "").slice(0, 100)}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: AGENTS + LOG */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 260 }}>
          {/* AGENT PANELS */}
          {agents.map((agent, i) => (
            <div key={agent.id}
              onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
              style={{
                background: "#18181b", border: `1px solid ${turn % 3 === i && running ? agent.color : "#3f3f46"}`,
                borderRadius: 6, padding: "8px 12px", cursor: "pointer",
                boxShadow: turn % 3 === i && running ? `0 0 8px ${agent.color}40` : "none",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: agent.color, fontWeight: 700, fontSize: 13 }}>{agent.name}</span>
                <span style={{ fontSize: 10, color: "#71717a" }}>{agent.id}</span>
              </div>
              <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#a1a1aa" }}>
                <span style={{ color: "#22c55e" }}>Accepted: {agent.accepted_set.size}</span>
                <span style={{ color: "#ef4444" }}>Rejected: {agent.rejected_set.size}</span>
                <span style={{ color: "#93c5fd" }}>Published: {agent.published.size}</span>
              </div>
              {selectedAgent === agent.id && (
                <div style={{ marginTop: 6, fontSize: 10, color: "#71717a", borderTop: "1px solid #27272a", paddingTop: 6 }}>
                  <div style={{ marginBottom: 4 }}><i>{agent.personality}</i></div>
                  <div>Accepted: {[...agent.accepted_set].join(", ")}</div>
                  <div>Rejected: {[...agent.rejected_set].join(", ") || "none"}</div>
                </div>
              )}
            </div>
          ))}

          {/* EVENT LOG */}
          <div style={{ flex: 1, background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: 8, overflowY: "auto", minHeight: 160 }}>
            <div style={{ fontSize: 11, color: "#71717a", marginBottom: 6, fontWeight: 600 }}>EVENT LOG</div>
            <div style={{ display: "flex", flexDirection: "column-reverse", gap: 3 }}>
              {log.slice(-50).reverse().map((entry, i) => {
                const agentDef = AGENT_DEFS.find(a => a.id === entry.agent);
                const actionColors = {
                  publish: "#3b82f6", approve: "#22c55e", dispute: "#ef4444",
                  verify_start: "#a78bfa", derive_start: "#a78bfa",
                  protocol_reject: "#f59e0b", error: "#ef4444", init: "#71717a",
                };
                return (
                  <div key={i} style={{ fontSize: 10, lineHeight: 1.4, color: "#a1a1aa", borderLeft: `2px solid ${actionColors[entry.action] || "#3f3f46"}`, paddingLeft: 6 }}>
                    <span style={{ color: agentDef?.color || "#71717a", fontWeight: 600 }}>{agentDef?.name || entry.agent}</span>
                    {" "}<span style={{ color: actionColors[entry.action] || "#71717a" }}>[{entry.action}]</span>
                    {" "}{entry.detail}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
