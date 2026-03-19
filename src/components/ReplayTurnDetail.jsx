import { useState } from 'react';
import { AGENT_DEFS, LOG_COLORS } from '../constants.js';

const AGENT_COLOR = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.color]));
const AGENT_NAME = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.name]));

const S = {
  panel: { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, padding: '8px 12px', fontSize: 11 },
  section: { marginTop: 8, paddingTop: 8, borderTop: '1px solid #27272a' },
  label: { color: '#71717a', fontSize: 10, marginBottom: 2 },
  code: { background: '#09090b', border: '1px solid #27272a', borderRadius: 3, padding: 8, fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflowY: 'auto', color: '#a1a1aa', lineHeight: 1.4 },
};

export default function ReplayTurnDetail({ saveFile, replayTurn }) {
  const [debugOpen, setDebugOpen] = useState(false);

  if (replayTurn === 0) {
    return (
      <div style={S.panel}>
        <div style={{ color: '#71717a', fontSize: 11 }}>Initial state — no turns applied yet.</div>
      </div>
    );
  }

  const record = saveFile.turns[replayTurn - 1];
  if (!record) return null;

  const agentColor = AGENT_COLOR[record.agent_id] || '#d4d4d8';
  const agentName = AGENT_NAME[record.agent_id] || record.agent_id;
  const actionColor = LOG_COLORS[record.action] || '#a1a1aa';

  const gc = record.delta?.graph_changes;
  const ac = record.delta?.agent_changes;

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
        <b style={{ color: '#f4f4f5' }}>Turn {replayTurn}</b>
        <span style={{ color: agentColor, fontWeight: 700 }}>{agentName}</span>
        <span style={{ color: '#71717a' }}>({record.agent_id})</span>
        <span style={{ background: '#27272a', padding: '0 6px', borderRadius: 3, color: actionColor }}>
          {record.action}
        </span>
        <span style={{ color: '#71717a', fontSize: 10 }}>Phase: {record.phase}</span>
      </div>

      {/* Detail */}
      <div style={{ color: '#a1a1aa', marginBottom: 4 }}>{record.detail}</div>

      {/* Node references */}
      <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#71717a', flexWrap: 'wrap' }}>
        {record.target_node_id && <span>Target: <b style={{ color: '#f4f4f5' }}>{record.target_node_id}</b></span>}
        {record.published_node_id && <span>Published: <b style={{ color: '#4ade80' }}>{record.published_node_id}</b></span>}
        {record.cascade_retracted?.length > 0 && (
          <span>Cascade: <b style={{ color: '#f87171' }}>{record.cascade_retracted.join(', ')}</b></span>
        )}
        {record.debug && (
          <span style={{ color: '#71717a' }}>⏱ {record.debug.latency_ms}ms</span>
        )}
      </div>

      {/* Delta summary */}
      {(gc || ac) && (
        <div style={{ ...S.section, fontSize: 10 }}>
          <div style={S.label}>Δ CHANGES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {gc?.added && (
              <span style={{ color: '#4ade80' }}>
                Graph +{Object.keys(gc.added).join(', ')}
              </span>
            )}
            {gc?.modified && (
              <span style={{ color: '#93c5fd' }}>
                Verif on {Object.keys(gc.modified).join(', ')}
              </span>
            )}
            {ac?.added_to_accepted?.length > 0 && (
              <span style={{ color: '#4ade80' }}>
                {agentName} accepted +{ac.added_to_accepted.join(', ')}
              </span>
            )}
            {ac?.removed_from_accepted?.length > 0 && (
              <span style={{ color: '#f87171' }}>
                {agentName} removed from accepted: {ac.removed_from_accepted.join(', ')}
              </span>
            )}
            {ac?.added_to_rejected?.length > 0 && (
              <span style={{ color: '#f87171' }}>
                {agentName} rejected +{ac.added_to_rejected.join(', ')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Debug / LLM trace */}
      {record.debug && (
        <div style={S.section}>
          <button
            onClick={() => setDebugOpen(o => !o)}
            style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 11, padding: 0, fontFamily: 'inherit' }}
          >
            {debugOpen ? '▲ Hide' : '▼ Show'} Debug (LLM trace — {record.debug.llm_model})
          </button>

          {debugOpen && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <CollapsibleBlock label={`System Prompt (${record.debug.system_prompt?.length} chars)`} content={record.debug.system_prompt} />
              <CollapsibleBlock label={`User Prompt (${record.debug.user_prompt?.length} chars)`} content={record.debug.user_prompt} />
              <CollapsibleBlock label={`Raw Response (${record.debug.raw_response?.length} chars)`} content={record.debug.raw_response} />
              {record.debug.parsed_response && (
                <CollapsibleBlock label="Parsed JSON" content={JSON.stringify(record.debug.parsed_response, null, 2)} />
              )}
              {record.debug.parse_error && (
                <div style={{ color: '#f87171', fontSize: 10 }}>Parse error: {record.debug.parse_error}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleBlock({ label, content }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: 10, padding: 0, fontFamily: 'inherit', marginBottom: 2 }}
      >
        {open ? '▲' : '▶'} {label}
      </button>
      {open && <div style={S.code}>{content}</div>}
    </div>
  );
}
