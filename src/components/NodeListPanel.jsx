import { useState } from 'react';
import { deobfuscate } from '../vocab.js';
import { AGENT_DEFS, computeStatus, STATUS_BG, STATUS_TEXT } from '../constants.js';

const AGENT_COLOR = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.color]));
const AGENT_NAME = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.name]));

function StatusBadge({ status }) {
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 3, fontSize: 10, flexShrink: 0,
      background: STATUS_BG[status] || '#1f2937',
      color: STATUS_TEXT[status] || '#9ca3af',
    }}>{status}</span>
  );
}

export default function NodeListPanel({ graph, onOpenResearch }) {
  const [seedsExpanded, setSeedsExpanded] = useState(false);

  const nodes = Object.values(graph);
  const theorems = nodes
    .filter(n => n.type === 'theorem')
    .sort((a, b) => {
      const aNum = parseInt(a.id.slice(1)) || 0;
      const bNum = parseInt(b.id.slice(1)) || 0;
      return aNum - bNum;
    });
  const seeds = nodes.filter(n => n.type !== 'theorem');

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontSize: 11 }}>
      {theorems.length === 0 ? (
        <div style={{ color: '#71717a', padding: 20, textAlign: 'center' }}>
          No theorems yet — run some steps.
        </div>
      ) : theorems.map(node => {
        const status = computeStatus(node);
        return (
          <div
            key={node.id}
            onClick={() => onOpenResearch(node.id)}
            style={{
              padding: '6px 10px',
              cursor: 'pointer',
              borderBottom: '1px solid #27272a',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#1c1c1f'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ color: '#52525b', flexShrink: 0, width: 34 }}>{node.id}</span>
            <StatusBadge status={status} />
            <span style={{ color: AGENT_COLOR[node.author] || '#71717a', flexShrink: 0 }}>
              {AGENT_NAME[node.author] || node.author}
            </span>
            <span style={{
              color: '#a1a1aa', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              {deobfuscate(node.claim).slice(0, 100)}
            </span>
          </div>
        );
      })}

      {/* Seeds collapsible */}
      <div
        onClick={() => setSeedsExpanded(e => !e)}
        style={{
          padding: '8px 10px',
          cursor: 'pointer',
          borderBottom: '1px solid #27272a',
          display: 'flex', gap: 6, alignItems: 'center',
          background: '#111113',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#18181b'}
        onMouseLeave={e => e.currentTarget.style.background = '#111113'}
      >
        <span style={{ color: '#52525b', fontSize: 10 }}>{seedsExpanded ? '▼' : '▶'}</span>
        <span style={{ color: '#71717a' }}>Seeds</span>
        <span style={{ color: '#52525b' }}>({seeds.length})</span>
        <span style={{ color: '#3f3f46', fontSize: 10 }}>definitions · postulates · common notions</span>
      </div>
      {seedsExpanded && seeds.map(node => (
        <div
          key={node.id}
          onClick={() => onOpenResearch(node.id)}
          style={{
            padding: '5px 10px 5px 24px',
            cursor: 'pointer',
            borderBottom: '1px solid #27272a',
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#1c1c1f'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ color: '#52525b', flexShrink: 0, width: 34 }}>{node.id}</span>
          <span style={{ color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {node.claim.slice(0, 100)}
          </span>
        </div>
      ))}
    </div>
  );
}
