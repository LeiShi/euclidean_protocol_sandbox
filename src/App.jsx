import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ForceGraph from './components/ForceGraph.jsx';
import ReplayControls from './components/ReplayControls.jsx';
import ReplayTurnDetail from './components/ReplayTurnDetail.jsx';
import NodeListPanel from './components/NodeListPanel.jsx';
import NodeResearchPage from './components/NodeResearchPage.jsx';
import { deobfuscate, VOCAB } from './vocab.js';
import { AGENT_DEFS, computeStatus, STATUS_BG, STATUS_TEXT, LOG_COLORS } from './constants.js';
import { reconstructStateAtTurn, getChangedNodeIds, buildSaveFilename } from './utils/replay.js';

const S = {
  app: { fontFamily: "'IBM Plex Mono', 'SF Mono', monospace", background: '#0a0b0e', color: '#d4d4d8', height: '100vh', overflow: 'hidden', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  input: { background: '#18181b', color: '#d4d4d8', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' },
  btn: (active, color = '#3b82f6') => ({
    background: active ? color : '#27272a',
    color: active ? '#fff' : '#71717a',
    border: 'none', borderRadius: 4, padding: '6px 16px', fontSize: 12,
    cursor: active ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
  }),
  panel: { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, padding: '8px 12px' },
};

const AGENT_COLOR = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.color]));
const AGENT_NAME = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.name]));

const PROVIDER_MODELS = {
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  claude: ['claude-sonnet-4-5', 'claude-opus-4-5'],
  openai: ['gpt-4o-mini', 'gpt-4o'],
};

function statusBadge(status) {
  return (
    <span style={{
      padding: '1px 8px', borderRadius: 3, fontSize: 10,
      background: STATUS_BG[status] || '#1f2937',
      color: STATUS_TEXT[status] || '#9ca3af',
    }}>{status}</span>
  );
}

function NodeDetail({ node, graph, onClose }) {
  if (!node) return null;
  const status = computeStatus(node, graph);
  return (
    <div style={{ ...S.panel, fontSize: 11, border: 'none', borderRadius: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <b style={{ color: '#f4f4f5', fontSize: 13 }}>[{node.id}]</b>
          <span style={{ fontSize: 10, color: '#71717a', textTransform: 'uppercase' }}>{node.type?.replace('_', ' ')}</span>
          {statusBadge(status)}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      <div style={{ color: '#a1a1aa', marginBottom: 2, fontSize: 10 }}>AGENT VIEW:</div>
      <div style={{ color: '#e4e4e7', marginBottom: 6, fontStyle: 'italic', paddingLeft: 8, borderLeft: '2px solid #3f3f46' }}>
        {node.claim}
      </div>

      <div style={{ color: '#fbbf24', marginBottom: 2, fontSize: 10 }}>HUMAN VIEW:</div>
      <div style={{ color: '#fef3c7', marginBottom: 8, paddingLeft: 8, borderLeft: '2px solid #fbbf24' }}>
        {deobfuscate(node.claim)}
      </div>

      {node.author !== 'SYSTEM' && (
        <>
          <div style={{ color: '#71717a', marginBottom: 6, fontSize: 10 }}>
            Author: <span style={{ color: AGENT_COLOR[node.author] || '#d4d4d8' }}>
              {AGENT_NAME[node.author] || node.author}
            </span>
            {node.type !== 'conjecture' && <>{' | '}Confidence: {node.confidence || '—'}</>}
            {node.cites?.length > 0 && <>{' | '}Cites: {node.cites.join(', ')}</>}
            {node.resolved_by && <>{' | '}Resolved by: <b>{node.resolved_by}</b></>}
          </div>
          {node.type === 'conjecture' && node.motivation && (
            <div style={{ color: '#a1a1aa', marginBottom: 6, fontSize: 10, fontStyle: 'italic' }}>
              Motivation: {node.motivation}
            </div>
          )}
          {node.resolves?.length > 0 && (
            <div style={{ color: '#4ade80', fontSize: 10, marginBottom: 4 }}>Resolves: {node.resolves.join(', ')}</div>
          )}
          {node.contradicts?.length > 0 && (
            <div style={{ color: '#f87171', fontSize: 10, marginBottom: 4 }}>Contradicts: {node.contradicts.join(', ')}</div>
          )}

          {node.proof_steps?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#71717a', marginBottom: 4, fontSize: 10 }}>PROOF STEPS:</div>
              {node.proof_steps.map((s, i) => (
                <div key={i} style={{ marginLeft: 8, marginBottom: 6 }}>
                  <div style={{ color: '#a1a1aa' }}>
                    <b>Step {s.step}:</b> {s.claim}{' '}
                    <span style={{ color: '#71717a' }}>[{(s.cites || []).join(', ')}]</span>
                  </div>
                  <div style={{ color: '#fef3c7', fontSize: 10, marginLeft: 12, opacity: 0.8 }}>
                    ↳ {deobfuscate(s.claim)}
                  </div>
                  {s.justification && (
                    <div style={{ color: '#71717a', fontSize: 10, marginLeft: 12, fontStyle: 'italic' }}>
                      {s.justification}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {node.verifications?.length > 0 && (
            <div style={{ borderTop: '1px solid #27272a', paddingTop: 6 }}>
              <div style={{ color: '#71717a', marginBottom: 4, fontSize: 10 }}>VERIFICATIONS:</div>
              {node.verifications.map((v, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: AGENT_COLOR[v.agentId] || '#d4d4d8' }}>
                    {AGENT_NAME[v.agentId] || v.agentId}
                  </span>
                  {': '}
                  <span style={{ color: v.verdict === 'approve' ? '#4ade80' : '#f87171' }}>
                    {v.verdict}
                  </span>
                  {' — '}
                  <span style={{ color: '#a1a1aa' }}>{(v.justification || '').slice(0, 150)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentPanel({ agent, isActive, isRunning }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        ...S.panel,
        cursor: 'pointer',
        border: `1px solid ${isActive && isRunning ? agent.color : '#3f3f46'}`,
        boxShadow: isActive && isRunning ? `0 0 8px ${agent.color}40` : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: agent.color, fontWeight: 700, fontSize: 13 }}>{agent.name}</span>
        <span style={{ fontSize: 10, color: '#71717a' }}>{agent.id} {isActive ? '▶' : ''}</span>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
        <span style={{ color: '#22c55e' }}>✓ {agent.accepted_set.length}</span>
        <span style={{ color: '#ef4444' }}>✗ {agent.rejected_set.length}</span>
        <span style={{ color: '#93c5fd' }}>↑ {agent.published.length}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 10, color: '#71717a', borderTop: '1px solid #27272a', paddingTop: 6 }}>
          <div style={{ marginBottom: 4, color: '#a1a1aa', fontStyle: 'italic' }}>{agent.personality}</div>
          <div>
            <span style={{ color: '#22c55e' }}>Accepted IDs: </span>
            {agent.accepted_set.filter(id => id.startsWith('T')).join(', ') || '—'}
          </div>
          {agent.rejected_set.length > 0 && (
            <div style={{ marginTop: 2 }}>
              <span style={{ color: '#ef4444' }}>Rejected IDs: </span>
              {agent.rejected_set.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventLog({ log }) {
  return (
    <div style={{ ...S.panel, flex: 1, overflowY: 'auto', fontSize: 10, minHeight: 0 }}>
      <div style={{ color: '#71717a', marginBottom: 4, fontSize: 10, fontWeight: 700 }}>EVENT LOG</div>
      {[...log].reverse().map((entry, i) => (
        <div key={i} style={{ marginBottom: 4, lineHeight: 1.5 }}>
          <span style={{ color: AGENT_COLOR[entry.agent] || '#71717a' }}>
            {AGENT_NAME[entry.agent] || entry.agent}
          </span>
          {' '}
          <span style={{
            color: LOG_COLORS[entry.action] || '#a1a1aa',
            background: '#27272a',
            padding: '0 4px',
            borderRadius: 2,
          }}>
            [{entry.action}]
          </span>
          {' '}
          <span style={{ color: '#a1a1aa' }}>{entry.detail}</span>
        </div>
      ))}
    </div>
  );
}

function GraphLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Show legend"
        style={{
          background: 'rgba(10,11,14,0.88)', border: '1px solid #3f3f46',
          color: '#a1a1aa', borderRadius: 4, padding: '3px 10px',
          fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        {open ? '✕ Legend' : '? Legend'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 32, left: 0,
          background: 'rgba(10,11,14,0.97)', border: '1px solid #3f3f46',
          borderRadius: 6, padding: '12px 14px', fontSize: 10,
          minWidth: 260, maxWidth: 320, color: '#a1a1aa', lineHeight: 1.9,
        }}>
          <Section title="Node shapes">
            <Row symbol={<CircleSvg r={7} fill="#555" stroke="#9ca3af" />}>Axiom (definition / postulate / common notion)</Row>
            <Row symbol={<CircleSvg r={8} fill="#3d85c6" stroke="#9ca3af" />}>Theorem (published by an agent)</Row>
            <Row symbol={<DiamondSvg fill="#e07a5f" stroke="#e4e4e7" dashed />}>Conjecture (unproven named assumption)</Row>
          </Section>

          <Section title="Node fill color">
            <Row symbol={<CircleSvg r={7} fill="#374151" stroke="#9ca3af" />}>Definition</Row>
            <Row symbol={<CircleSvg r={7} fill="#4b5563" stroke="#9ca3af" />}>Postulate / Common notion</Row>
            {AGENT_DEFS.map(a => (
              <Row key={a.id} symbol={<CircleSvg r={8} fill={a.color} stroke="#9ca3af" />}>{a.name} ({a.id})</Row>
            ))}
          </Section>

          <Section title="Border style (theorems &amp; conjectures)">
            <Row symbol={<CircleSvg r={8} fill="#27272a" stroke="#22c55e" />}>Accepted — fully proven</Row>
            <Row symbol={<CircleSvg r={8} fill="#27272a" stroke="#f59e0b" dashed />}>Conditional — transitively depends on an unproven conjecture</Row>
            <Row symbol={<CircleSvg r={8} fill="#27272a" stroke="#f59e0b" />}>Pending — awaiting approvals</Row>
            <Row symbol={<CircleSvg r={8} fill="#27272a" stroke="#ef4444" />}>Disputed — logical flaw found</Row>
            <Row symbol={<CircleSvg r={8} fill="#1a1a1a" stroke="#4b5563" dim />}>Collapsed — conjecture was disproven</Row>
            <Row symbol={<DiamondSvg fill="#27272a" stroke="#e4e4e7" dashed />}>Open conjecture</Row>
            <Row symbol={<DiamondSvg fill="#27272a" stroke="#22c55e" />}>Proven conjecture</Row>
            <Row symbol={<DiamondSvg fill="#27272a" stroke="#ef4444" />}>Disproven conjecture</Row>
          </Section>

          <Section title="Edge (arrow) types">
            <Row symbol={<EdgeSvg color="#666" />}>Support — normal logical dependency</Row>
            <Row symbol={<EdgeSvg color="#f59e0b" dashed />}>Conditional — cites an unproven conjecture or conditional theorem</Row>
            <Row symbol={<EdgeSvg color="#22c55e" thick />}>Resolves — theorem proves a conjecture</Row>
            <Row symbol={<EdgeSvg color="#ef4444" thick />}>Contradicts — theorem disproves a conjecture</Row>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: '#f4f4f5', fontWeight: 700, fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ symbol, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, flexShrink: 0 }}>{symbol}</span>
      <span>{children}</span>
    </div>
  );
}

function CircleSvg({ r, fill, stroke, dashed, dim }) {
  return (
    <svg width={22} height={22}>
      <circle cx={11} cy={11} r={r} fill={fill} stroke={stroke} strokeWidth={2}
        strokeDasharray={dashed ? '3,2' : undefined} opacity={dim ? 0.35 : 1} />
    </svg>
  );
}

function DiamondSvg({ fill, stroke, dashed }) {
  return (
    <svg width={22} height={22}>
      <polygon points="11,2 20,11 11,20 2,11" fill={fill} stroke={stroke} strokeWidth={2}
        strokeDasharray={dashed ? '3,2' : undefined} />
    </svg>
  );
}

function EdgeSvg({ color, dashed, thick }) {
  return (
    <svg width={22} height={14}>
      <line x1={1} y1={7} x2={17} y2={7} stroke={color} strokeWidth={thick ? 2.5 : 1.5}
        strokeDasharray={dashed ? '4,2' : undefined} />
      <polygon points="17,4 22,7 17,10" fill={color} />
    </svg>
  );
}

function VocabPanel() {
  return (
    <div style={{
      background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6,
      padding: 12, fontSize: 11, display: 'flex', flexWrap: 'wrap',
      gap: 6, maxHeight: 130, overflowY: 'auto',
    }}>
      {Object.entries(VOCAB).map(([standard, obfuscated]) => (
        <span key={standard} style={{ background: '#27272a', padding: '2px 8px', borderRadius: 3 }}>
          <span style={{ color: '#71717a', textDecoration: 'line-through' }}>{standard.replace('_', ' ')}</span>
          {' → '}
          <span style={{ color: '#fbbf24' }}>{obfuscated}</span>
        </span>
      ))}
    </div>
  );
}

/** Dialog shown after loading a file — choose Continue or Replay */
function LoadDialog({ saveFile, onContinue, onReplay, onCancel }) {
  const s = saveFile.summary;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{ ...S.panel, width: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: '#f4f4f5', fontWeight: 700, fontSize: 14 }}>
          Load Save File
        </div>
        <div style={{ fontSize: 12, color: '#a1a1aa' }}>
          <div>{buildSaveFilename(saveFile)}</div>
          <div style={{ marginTop: 4 }}>
            {s.total_turns} turns · {s.total_theorems} theorems
            ({s.accepted_theorems} accepted, {s.disputed_theorems} disputed)
          </div>
          <div>Agents: {s.agents?.map(a => `${a.name}: ${a.theorems_published} published`).join(' · ')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={S.btn(true, '#27272a')}>Cancel</button>
          <button onClick={onReplay} style={S.btn(true, '#78350f')}>▶ Replay Mode</button>
          <button onClick={onContinue} style={S.btn(true, '#14532d')}>▶ Continue Simulation</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [serverState, setServerState] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showVocab, setShowVocab] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState(PROVIDER_MODELS.gemini[0]);
  const [apiKey, setApiKey] = useState('');
  const [rounds, setRounds] = useState(3);
  const runningRef = useRef(false);

  // Main panel tab
  const [mainTab, setMainTab] = useState('graph'); // 'graph' | 'nodelist'

  // Research page
  const [showResearch, setShowResearch] = useState(false);
  const [researchFocusId, setResearchFocusId] = useState(null);

  const handleOpenResearch = useCallback((nodeId = null) => {
    setResearchFocusId(nodeId);
    setShowResearch(true);
  }, []);

  // Save/Load/Replay state
  const [loadDialog, setLoadDialog] = useState(null); // { saveFile }
  const [replayFile, setReplayFile] = useState(null);  // SaveFile object
  const [replayTurn, setReplayTurn] = useState(0);
  const fileInputRef = useRef(null);

  // Fetch initial state
  useEffect(() => {
    fetch('/api/state')
      .then(r => r.json())
      .then(data => {
        setServerState(data);
        setProvider(data.config?.provider || 'gemini');
      })
      .catch(e => setError(`Failed to connect to server: ${e.message}`));
  }, []);

  const handleStep = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, model }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Step failed');
      setServerState(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [loading, provider, apiKey, model]);

  const handleRun = useCallback(async (n = 9) => {
    if (loading) return;
    setLoading(true);
    runningRef.current = true;
    setError(null);

    try {
      const resp = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n, provider, apiKey, model }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || 'Run failed');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              setServerState(data);
              if (data.done) break;
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (e) {
      if (runningRef.current) setError(e.message);
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  }, [loading, provider, apiKey, model]);

  const handleStop = useCallback(() => {
    runningRef.current = false;
    fetch('/api/stop', { method: 'POST' }).catch(() => {});
  }, []);

  const handleConfigChange = useCallback((newProvider, newModel, newKey) => {
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: newProvider, model: newModel, apiKey: newKey }),
    }).catch(() => {});
  }, []);

  // ── Save / Load / Replay ────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      const resp = await fetch('/api/save', { method: 'POST' });
      const saveFile = await resp.json();
      if (!resp.ok) throw new Error(saveFile.error || 'Save failed');
      const filename = buildSaveFilename(saveFile);
      const blob = new Blob([JSON.stringify(saveFile, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Save failed: ${e.message}`);
    }
  }, []);

  const handleLoadClick = () => fileInputRef.current?.click();

  const handleFileSelected = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const saveFile = JSON.parse(ev.target.result);
        setLoadDialog({ saveFile });
      } catch {
        setError('Failed to parse save file — invalid JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset so same file can be re-selected
  }, []);

  const handleContinueSimulation = useCallback(async () => {
    const { saveFile } = loadDialog;
    setLoadDialog(null);
    setError(null);
    try {
      const resp = await fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveFile),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Load failed');
      setServerState(data);
      setReplayFile(null);
    } catch (e) {
      setError(`Load failed: ${e.message}`);
    }
  }, [loadDialog]);

  const handleEnterReplay = useCallback(() => {
    const { saveFile } = loadDialog;
    setLoadDialog(null);
    setReplayFile(saveFile);
    setReplayTurn(saveFile.summary.total_turns);
    setSelectedNode(null);
  }, [loadDialog]);

  const handleExitReplay = useCallback(() => {
    setReplayFile(null);
    setReplayTurn(0);
    setSelectedNode(null);
  }, []);

  // Compute replay state (reconstructed graph + agents at replayTurn)
  const replayState = useMemo(() => {
    if (!replayFile) return null;
    return reconstructStateAtTurn(replayFile, replayTurn);
  }, [replayFile, replayTurn]);

  // Nodes that changed in the current replay turn (for highlighting)
  const highlightNodes = useMemo(() => {
    if (!replayFile || replayTurn === 0) return null;
    const record = replayFile.turns[replayTurn - 1];
    return getChangedNodeIds(record);
  }, [replayFile, replayTurn]);

  if (!serverState) {
    return (
      <div style={{ ...S.app, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#71717a', fontSize: 14 }}>
          {error || 'Connecting to server...'}
        </div>
        {error && (
          <div style={{ color: '#a1a1aa', fontSize: 11, marginTop: 8 }}>
            Make sure the server is running: <code>npm run dev</code>
          </div>
        )}
      </div>
    );
  }

  // Determine which state/agents/graph to display
  const displayGraph = replayFile ? replayState.graph : serverState.graph;
  const displayAgents = replayFile ? replayState.agents : serverState.agents;

  const { log, turn, stats } = serverState;
  const activeAgentIdx = turn % 3;
  const activeAgentId = ['A1', 'A2', 'A3'][activeAgentIdx];
  const activeAgentName = AGENT_NAME[activeAgentId];
  const selectedNodeData = selectedNode ? displayGraph[selectedNode] : null;
  const canStep = !loading && !!apiKey && !replayFile;

  return (
    <div style={S.app}>
      {/* Hidden file input for load */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* Load dialog */}
      {loadDialog && (
        <LoadDialog
          saveFile={loadDialog.saveFile}
          onContinue={handleContinueSimulation}
          onReplay={handleEnterReplay}
          onCancel={() => setLoadDialog(null)}
        />
      )}

      {/* HEADER (hidden in replay mode — replaced by replay banner) */}
      {!replayFile && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #27272a', paddingBottom: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, color: '#f4f4f5', letterSpacing: 1 }}>
              EUCLID PROTOCOL SANDBOX
            </h1>
            <span style={{ fontSize: 11, color: '#71717a' }}>
              Axiomatic reasoning through structured protocol
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={provider}
              onChange={e => {
                const newProvider = e.target.value;
                const newModel = PROVIDER_MODELS[newProvider][0];
                setProvider(newProvider);
                setModel(newModel);
                handleConfigChange(newProvider, newModel, apiKey);
              }}
              style={S.input}
            >
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
              <option value="openai">OpenAI</option>
            </select>
            <select
              value={model}
              onChange={e => {
                setModel(e.target.value);
                handleConfigChange(provider, e.target.value, apiKey);
              }}
              style={S.input}
            >
              {(PROVIDER_MODELS[provider] || []).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="password"
              placeholder="API Key"
              value={apiKey}
              onChange={e => {
                setApiKey(e.target.value);
                handleConfigChange(provider, model, e.target.value);
              }}
              style={{ ...S.input, width: 220 }}
            />
          </div>
        </div>
      )}

      {/* REPLAY BANNER + CONTROLS */}
      {replayFile && (
        <ReplayControls
          saveFile={replayFile}
          replayTurn={replayTurn}
          onSeek={setReplayTurn}
          onExit={handleExitReplay}
        />
      )}

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '6px 12px', borderRadius: 4, fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* CONTROLS + STATS (live mode only) */}
      {!replayFile && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleStep} disabled={!canStep} style={S.btn(canStep, '#3b82f6')}>
            {loading ? 'Running...' : `Step (${activeAgentName}'s turn)`}
          </button>
          <input
            type="number"
            min={1}
            max={9999}
            value={rounds}
            onChange={e => setRounds(Math.max(1, parseInt(e.target.value) || 1))}
            disabled={!canStep}
            style={{ ...S.input, width: 52, textAlign: 'center', opacity: canStep ? 1 : 0.4 }}
            title="Number of rounds"
          />
          <button
            onClick={() => handleRun(rounds * 3)}
            disabled={!canStep}
            style={{ ...S.btn(canStep, '#1e3a5f'), color: canStep ? '#93c5fd' : '#71717a', border: `1px solid ${canStep ? '#3b82f6' : '#3f3f46'}` }}
          >
            Run {rounds} round{rounds !== 1 ? 's' : ''} ({rounds * 3} steps)
          </button>
          {loading && (
            <button onClick={handleStop} style={S.btn(true, '#7f1d1d')}>Stop</button>
          )}

          {/* Save / Load */}
          <div style={{ width: 1, background: '#3f3f46', height: 24 }} />
          <button onClick={handleSave} style={S.btn(true, '#18181b')} title="Save run to JSON file">
            💾 Save Run
          </button>
          <button onClick={handleLoadClick} style={S.btn(true, '#18181b')} title="Load a saved run">
            📂 Load Run
          </button>
          <button onClick={() => handleOpenResearch(null)} style={S.btn(true, '#18181b')} title="Open node research view">
            🔬 Research
          </button>

          <button
            onClick={() => setShowVocab(v => !v)}
            style={{ ...S.btn(true, '#18181b'), color: '#a1a1aa', border: '1px solid #3f3f46', marginLeft: 'auto' }}
          >
            {showVocab ? 'Hide' : 'Show'} Vocabulary
          </button>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#a1a1aa' }}>
            <span>Turn: <b style={{ color: '#f4f4f5' }}>{turn}</b></span>
            <span>Seeds: <span style={{ color: '#71717a' }}>{stats.definitions}D+{stats.postulates}P</span></span>
            <span>Theorems: <b style={{ color: '#f4f4f5' }}>{stats.theorems}</b></span>
            <span style={{ color: '#22c55e' }}>✓ {stats.accepted}</span>
            <span style={{ color: '#fb923c' }}>◌ {stats.conditional ?? 0}</span>
            <span style={{ color: '#f59e0b' }}>⏳ {stats.pending}</span>
            <span style={{ color: '#ef4444' }}>✗ {stats.disputed}</span>
            {stats.conjectures > 0 && (
              <span style={{ color: '#a855f7' }}>◇ {stats.conjectures_open}/{stats.conjectures} conj.</span>
            )}
            {stats.collapsed > 0 && (
              <span style={{ color: '#6b7280' }}>⊘ {stats.collapsed} collapsed</span>
            )}
          </div>
        </div>
      )}

      {showVocab && <VocabPanel />}

      {/* MAIN CONTENT */}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        {/* LEFT: GRAPH / NODE LIST */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #27272a', flexShrink: 0 }}>
            {[
              { key: 'graph', label: 'Graph' },
              { key: 'nodelist', label: `Nodes (${Object.values(displayGraph).filter(n => n.type === 'theorem').length})` },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setMainTab(tab.key)}
                style={{
                  background: 'none', border: 'none',
                  borderBottom: mainTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
                  color: mainTab === tab.key ? '#f4f4f5' : '#71717a',
                  cursor: 'pointer', padding: '6px 16px',
                  fontSize: 12, fontFamily: 'inherit', marginBottom: -1,
                }}
              >{tab.label}</button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {mainTab === 'graph' ? (
              <>
                <ForceGraph
                  graph={displayGraph}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                  highlightNodes={highlightNodes}
                />
                <GraphLegend />
                {/* NodeDetail overlay */}
                {selectedNodeData && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    maxHeight: '45%', overflowY: 'auto',
                    background: 'rgba(24,24,27,0.97)',
                    borderTop: '1px solid #3f3f46',
                    borderRadius: '0 0 8px 8px',
                  }}>
                    <NodeDetail node={selectedNodeData} graph={displayGraph} onClose={() => setSelectedNode(null)} />
                  </div>
                )}
              </>
            ) : (
              <NodeListPanel graph={displayGraph} onOpenResearch={handleOpenResearch} />
            )}
          </div>
        </div>

        {/* RIGHT: AGENTS + LOG / REPLAY DETAIL */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240, maxWidth: 320, minHeight: 0 }}>
          {displayAgents.map((agent) => (
            <AgentPanel
              key={agent.id}
              agent={agent}
              isActive={!replayFile && agent.id === activeAgentId}
              isRunning={loading}
            />
          ))}
          {replayFile ? (
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <ReplayTurnDetail saveFile={replayFile} replayTurn={replayTurn} />
            </div>
          ) : (
            <EventLog log={log} />
          )}
        </div>
      </div>

      {/* Research page overlay */}
      {showResearch && (
        <NodeResearchPage
          graph={displayGraph}
          focusId={researchFocusId}
          onClose={() => setShowResearch(false)}
        />
      )}
    </div>
  );
}

