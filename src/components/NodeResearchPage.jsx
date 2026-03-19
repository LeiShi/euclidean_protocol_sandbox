import { useState, useEffect, useRef } from 'react';
import { deobfuscate } from '../vocab.js';
import { AGENT_DEFS, computeStatus, STATUS_BG, STATUS_TEXT } from '../constants.js';

const AGENT_COLOR = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.color]));
const AGENT_NAME = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.name]));

// ── Shared helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status, small }) {
  return (
    <span style={{
      padding: small ? '1px 5px' : '2px 8px',
      borderRadius: 3,
      fontSize: small ? 9 : 11,
      background: STATUS_BG[status] || '#1f2937',
      color: STATUS_TEXT[status] || '#9ca3af',
      flexShrink: 0,
    }}>{status}</span>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function SidebarRow({ node, isSelected, onSelect }) {
  const status = computeStatus(node);
  const isSeed = node.type !== 'theorem';
  return (
    <div
      onClick={() => onSelect(node.id)}
      style={{
        padding: '5px 10px',
        cursor: 'pointer',
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        background: isSelected ? '#1e2433' : 'transparent',
        borderLeft: `2px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#18181b'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        color: isSeed ? '#52525b' : (AGENT_COLOR[node.author] || '#71717a'),
        fontSize: 11,
        flexShrink: 0,
        width: 34,
        fontWeight: isSelected ? 700 : 400,
      }}>{node.id}</span>
      <StatusBadge status={status} small />
    </div>
  );
}

function Sidebar({ graph, selectedId, onSelect, collapsed, onToggle }) {
  const [seedsOpen, setSeedsOpen] = useState(false);
  const selectedRef = useRef(null);

  const nodes = Object.values(graph);
  const theorems = nodes
    .filter(n => n.type === 'theorem')
    .sort((a, b) => (parseInt(a.id.slice(1)) || 0) - (parseInt(b.id.slice(1)) || 0));
  const seeds = nodes.filter(n => n.type !== 'theorem');

  // Scroll selected node into view in sidebar
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div style={{
      width: collapsed ? 32 : 220,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      borderRight: '1px solid #27272a',
      background: '#0d0d10',
      transition: 'width 0.15s ease',
      overflow: 'hidden',
    }}>
      {/* Toggle */}
      <div style={{
        padding: '8px',
        borderBottom: '1px solid #27272a',
        display: 'flex',
        justifyContent: collapsed ? 'center' : 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {!collapsed && (
          <span style={{ color: '#52525b', fontSize: 10, letterSpacing: 1 }}>
            NODES ({theorems.length})
          </span>
        )}
        <button
          onClick={onToggle}
          style={{
            background: 'none', border: 'none', color: '#52525b',
            cursor: 'pointer', fontSize: 12, padding: 2, lineHeight: 1,
          }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* Node list */}
      {!collapsed && (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {theorems.length === 0 && (
            <div style={{ color: '#52525b', fontSize: 11, padding: '12px 10px' }}>
              No theorems yet.
            </div>
          )}
          {theorems.map(node => (
            <div key={node.id} ref={selectedId === node.id ? selectedRef : null}>
              <SidebarRow node={node} isSelected={selectedId === node.id} onSelect={onSelect} />
            </div>
          ))}

          {/* Seeds collapsible */}
          <div
            onClick={() => setSeedsOpen(o => !o)}
            style={{
              padding: '6px 10px',
              cursor: 'pointer',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              background: '#111113',
              borderTop: '1px solid #27272a',
              borderBottom: seedsOpen ? 'none' : 'none',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#18181b'}
            onMouseLeave={e => e.currentTarget.style.background = '#111113'}
          >
            <span style={{ color: '#3f3f46', fontSize: 9 }}>{seedsOpen ? '▼' : '▶'}</span>
            <span style={{ color: '#52525b', fontSize: 10 }}>Seeds ({seeds.length})</span>
          </div>
          {seedsOpen && seeds.map(node => (
            <div key={node.id} ref={selectedId === node.id ? selectedRef : null}>
              <SidebarRow node={node} isSelected={selectedId === node.id} onSelect={onSelect} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section component ─────────────────────────────────────────────────────────

function Section({ title, badge, children, maxHeight, defaultOpen = true, accentColor }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #1f1f23', flexShrink: 0 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '7px 16px',
          cursor: 'pointer',
          background: '#111113',
          userSelect: 'none',
          borderLeft: accentColor ? `3px solid ${accentColor}` : '3px solid transparent',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#18181b'}
        onMouseLeave={e => e.currentTarget.style.background = '#111113'}
      >
        <span style={{ color: '#3f3f46', fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        <span style={{ color: '#a1a1aa', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{title}</span>
        {badge != null && <span style={{ color: '#52525b', fontSize: 10 }}>{badge}</span>}
      </div>
      {open && (
        <div style={{
          overflowY: 'auto',
          maxHeight: maxHeight || 'none',
          padding: '12px 16px',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main panel sections ───────────────────────────────────────────────────────

function StatementSection({ node }) {
  return (
    <Section title="STATEMENT" maxHeight={200} defaultOpen>
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: '#52525b', fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>AGENT VIEW</div>
        <div style={{
          color: '#d4d4d8', fontStyle: 'italic', fontSize: 12, lineHeight: 1.7,
          paddingLeft: 10, borderLeft: '2px solid #3f3f46',
        }}>
          {node.claim}
        </div>
      </div>
      <div>
        <div style={{ color: '#78350f', fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>HUMAN VIEW</div>
        <div style={{
          color: '#fef3c7', fontSize: 12, lineHeight: 1.7,
          paddingLeft: 10, borderLeft: '2px solid #92400e',
        }}>
          {deobfuscate(node.claim)}
        </div>
      </div>
    </Section>
  );
}

function CitationsSection({ node, graph, onNavigate }) {
  if (!node.cites?.length) return null;
  return (
    <Section title="CITED NODES" badge={`(${node.cites.length})`} maxHeight={240} defaultOpen>
      {node.cites.map(cid => {
        const cited = graph[cid];
        return (
          <div
            key={cid}
            onClick={() => onNavigate(cid)}
            style={{
              padding: '7px 10px',
              marginBottom: 6,
              background: '#0d0d10',
              border: '1px solid #27272a',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#52525b'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#27272a'}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: cited ? 4 : 0 }}>
              <span style={{ color: '#52525b', fontSize: 11, flexShrink: 0 }}>[{cid}]</span>
              {cited && <StatusBadge status={computeStatus(cited)} small />}
            </div>
            {cited ? (
              <div style={{ color: '#a1a1aa', fontSize: 11, fontStyle: 'italic', lineHeight: 1.6 }}>
                {deobfuscate(cited.claim)}
              </div>
            ) : (
              <div style={{ color: '#52525b', fontSize: 11 }}>(not in graph)</div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function ProofStepsSection({ node, onNavigate }) {
  if (!node.proof_steps?.length) return null;
  return (
    <Section title="PROOF STEPS" badge={`(${node.proof_steps.length} steps)`} maxHeight={360} defaultOpen>
      {node.proof_steps.map((s, i) => (
        <div key={i} style={{
          marginBottom: 14,
          paddingLeft: 12,
          borderLeft: '2px solid #27272a',
        }}>
          <div style={{ color: '#d4d4d8', fontSize: 12, lineHeight: 1.7 }}>
            <span style={{ color: '#52525b', marginRight: 6 }}>Step {s.step}.</span>
            {s.claim}
            {s.cites?.length > 0 && (
              <span style={{ marginLeft: 8, color: '#3f3f46' }}>
                [
                {s.cites.map((cid, ci) => (
                  <span key={cid}>
                    <span
                      onClick={() => onNavigate(cid)}
                      style={{ color: '#71717a', cursor: 'pointer', textDecoration: 'underline dotted' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
                      onMouseLeave={e => e.currentTarget.style.color = '#71717a'}
                    >{cid}</span>
                    {ci < s.cites.length - 1 ? ', ' : ''}
                  </span>
                ))}
                ]
              </span>
            )}
          </div>
          <div style={{ color: '#d4a017', fontSize: 11, marginTop: 3, lineHeight: 1.6, opacity: 0.75 }}>
            ↳ {deobfuscate(s.claim)}
          </div>
          {s.justification && (
            <div style={{ color: '#71717a', fontSize: 11, fontStyle: 'italic', marginTop: 3, lineHeight: 1.5 }}>
              {s.justification}
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

function VerificationCard({ v }) {
  const isApprove = v.verdict === 'approve';
  return (
    <div style={{
      marginBottom: 8,
      padding: '8px 12px',
      background: '#0d0d10',
      borderRadius: 4,
      borderLeft: `3px solid ${isApprove ? '#16a34a' : '#dc2626'}`,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
        <span style={{ color: AGENT_COLOR[v.agentId] || '#d4d4d8', fontWeight: 700, fontSize: 12 }}>
          {AGENT_NAME[v.agentId] || v.agentId}
        </span>
        <span style={{ color: isApprove ? '#4ade80' : '#f87171', fontSize: 11 }}>
          {v.verdict}
        </span>
      </div>
      {v.reasoning && (
        <div style={{ color: '#a1a1aa', fontSize: 11, lineHeight: 1.7, marginBottom: v.justification && v.justification !== v.reasoning ? 6 : 0 }}>
          {v.reasoning}
        </div>
      )}
      {v.justification && v.justification !== v.reasoning && (
        <div style={{ color: '#d4d4d8', fontSize: 11, fontStyle: 'italic', lineHeight: 1.7 }}>
          {v.justification}
        </div>
      )}
    </div>
  );
}

function VerificationsSection({ node }) {
  if (node.type !== 'theorem') return null;
  const approvals = (node.verifications || []).filter(v => v.verdict === 'approve');
  const disputes = (node.verifications || []).filter(v => v.verdict === 'dispute');

  return (
    <>
      <Section
        title="APPROVALS"
        badge={approvals.length ? `(${approvals.length})` : '— none'}
        maxHeight={260}
        defaultOpen={approvals.length > 0}
        accentColor={approvals.length ? '#16a34a' : undefined}
      >
        {approvals.length === 0 ? (
          <div style={{ color: '#52525b', fontSize: 11 }}>No approvals yet.</div>
        ) : approvals.map((v, i) => <VerificationCard key={i} v={v} />)}
      </Section>

      <Section
        title="DISPUTES &amp; CORRECTIONS"
        badge={disputes.length ? `(${disputes.length})` : '— none'}
        maxHeight={300}
        defaultOpen={disputes.length > 0}
        accentColor={disputes.length ? '#dc2626' : undefined}
      >
        {disputes.length === 0 ? (
          <div style={{ color: '#52525b', fontSize: 11 }}>No disputes.</div>
        ) : disputes.map((v, i) => <VerificationCard key={i} v={v} />)}
      </Section>
    </>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

function MainPanel({ node, graph, onNavigate }) {
  if (!node) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#3f3f46', fontSize: 13,
      }}>
        Select a node from the sidebar.
      </div>
    );
  }

  const status = computeStatus(node);
  const isSeed = node.type !== 'theorem';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowY: 'auto' }}>
      {/* Node header — fixed at top of main panel */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #27272a',
        flexShrink: 0,
        background: '#0f1015',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <span style={{ color: '#f4f4f5', fontWeight: 700, fontSize: 16 }}>[{node.id}]</span>
        <span style={{ color: '#52525b', fontSize: 11, textTransform: 'uppercase' }}>
          {node.type?.replace(/_/g, ' ')}
        </span>
        <StatusBadge status={status} />
        {!isSeed && node.author && (
          <span style={{ color: AGENT_COLOR[node.author] || '#71717a', fontSize: 12 }}>
            {AGENT_NAME[node.author] || node.author}
          </span>
        )}
        {!isSeed && node.confidence && (
          <span style={{ color: '#52525b', fontSize: 11 }}>confidence: {node.confidence}</span>
        )}
        {!isSeed && node.cites?.length > 0 && (
          <span style={{ color: '#52525b', fontSize: 11 }}>
            cites: {node.cites.join(', ')}
          </span>
        )}
      </div>

      {/* Sections */}
      <StatementSection node={node} />
      {!isSeed && <CitationsSection node={node} graph={graph} onNavigate={onNavigate} />}
      {!isSeed && <ProofStepsSection node={node} onNavigate={onNavigate} />}
      {!isSeed && <VerificationsSection node={node} />}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function NodeResearchPage({ graph, focusId, onClose }) {
  const [selectedId, setSelectedId] = useState(focusId || null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const selectedNode = selectedId ? graph[selectedId] : null;

  const navigateTo = (nodeId) => {
    if (graph[nodeId]) setSelectedId(nodeId);
  };

  // Apply initial focus
  useEffect(() => {
    if (focusId && graph[focusId]) setSelectedId(focusId);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#0a0b0e',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'IBM Plex Mono', 'SF Mono', monospace",
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '9px 16px',
        borderBottom: '1px solid #27272a',
        background: '#111113',
        flexShrink: 0,
      }}>
        <span style={{ color: '#f4f4f5', fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>
          NODE RESEARCH
        </span>
        <button
          onClick={onClose}
          style={{
            background: '#27272a', border: 'none', color: '#d4d4d8',
            cursor: 'pointer', borderRadius: 4, padding: '4px 14px',
            fontFamily: 'inherit', fontSize: 12,
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* Body: sidebar + main */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar
          graph={graph}
          selectedId={selectedId}
          onSelect={navigateTo}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(c => !c)}
        />
        <MainPanel node={selectedNode} graph={graph} onNavigate={navigateTo} />
      </div>
    </div>
  );
}
