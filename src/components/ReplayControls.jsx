import { useState, useEffect, useRef } from 'react';
import { AGENT_DEFS } from '../constants.js';

const S = {
  input: { background: '#18181b', color: '#d4d4d8', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' },
  btn: (active, color = '#3b82f6') => ({
    background: active ? color : '#27272a',
    color: active ? '#fff' : '#71717a',
    border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12,
    cursor: active ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
  }),
};

const SPEED_OPTIONS = [0.5, 1, 2, 5];
const ACTION_OPTIONS = ['publish', 'approve', 'dispute', 'retract', 'defend', 'protocol_reject', 'error'];

export default function ReplayControls({
  saveFile,
  replayTurn,
  onSeek,
  onExit,
}) {
  const totalTurns = saveFile.summary.total_turns;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const playRef = useRef(null);

  // Auto-play interval
  useEffect(() => {
    if (playing) {
      const ms = 1500 / speed;
      playRef.current = setInterval(() => {
        onSeek(prev => {
          if (prev >= totalTurns) { setPlaying(false); return prev; }
          const next = findNextTurn(prev + 1, totalTurns, saveFile.turns, filterAgent, filterAction);
          if (next === null) { setPlaying(false); return prev; }
          return next;
        });
      }, ms);
    }
    return () => clearInterval(playRef.current);
  }, [playing, speed, filterAgent, filterAction, totalTurns, saveFile.turns, onSeek]);

  const go = (target) => onSeek(Math.max(0, Math.min(totalTurns, target)));

  const goPrev = () => {
    const t = findPrevTurn(replayTurn - 1, saveFile.turns, filterAgent, filterAction);
    if (t !== null) onSeek(t);
  };

  const goNext = () => {
    const t = findNextTurn(replayTurn + 1, totalTurns, saveFile.turns, filterAgent, filterAction);
    if (t !== null) onSeek(t);
  };

  const filename = saveFile.created_at
    ? new Date(saveFile.created_at).toISOString().slice(0, 19).replace('T', ' ')
    : 'unknown';

  return (
    <div style={{ background: '#78350f', borderBottom: '2px solid #f59e0b', padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13 }}>
          ▶ REPLAY MODE — Turn {replayTurn} / {totalTurns} — {filename}
        </span>
        <button onClick={onExit} style={S.btn(true, '#1c1917')}>
          Exit Replay
        </button>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => go(0)} style={S.btn(true, '#27272a')} title="First">|◁</button>
        <button onClick={goPrev} style={S.btn(replayTurn > 0, '#27272a')} title="Prev">◁ Prev</button>
        <button
          onClick={() => setPlaying(p => !p)}
          style={S.btn(true, playing ? '#b45309' : '#3b82f6')}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={goNext} style={S.btn(replayTurn < totalTurns, '#27272a')} title="Next">Next ▷</button>
        <button onClick={() => go(totalTurns)} style={S.btn(true, '#27272a')} title="Last">Last ▷|</button>

        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={totalTurns}
          value={replayTurn}
          onChange={e => { setPlaying(false); onSeek(parseInt(e.target.value)); }}
          style={{ flex: 1, minWidth: 120, accentColor: '#f59e0b' }}
        />
        <span style={{ color: '#fbbf24', fontSize: 12, minWidth: 60 }}>
          {replayTurn} / {totalTurns}
        </span>

        {/* Speed */}
        <select
          value={speed}
          onChange={e => setSpeed(parseFloat(e.target.value))}
          style={{ ...S.input, background: '#27272a' }}
        >
          {SPEED_OPTIONS.map(s => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>

        {/* Filters */}
        <select
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          style={{ ...S.input, background: '#27272a' }}
        >
          <option value="">All agents</option>
          {AGENT_DEFS.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          style={{ ...S.input, background: '#27272a' }}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Find the next turn >= start that matches filters. Returns turn number (replayTurn), or null if none. */
function findNextTurn(start, totalTurns, turns, filterAgent, filterAction) {
  for (let t = start; t <= totalTurns; t++) {
    if (matchesTurn(t, turns, filterAgent, filterAction)) return t;
  }
  return null;
}

/** Find the prev turn <= end that matches filters. Returns turn number, or null if none. */
function findPrevTurn(end, turns, filterAgent, filterAction) {
  for (let t = end; t >= 0; t--) {
    if (matchesTurn(t, turns, filterAgent, filterAction)) return t;
  }
  return null;
}

/** replayTurn T corresponds to TurnRecord turn:T-1. If no filters, always match. */
function matchesTurn(replayTurn, turns, filterAgent, filterAction) {
  if (!filterAgent && !filterAction) return true;
  if (replayTurn === 0) return !filterAgent && !filterAction;
  const record = turns[replayTurn - 1];
  if (!record) return false;
  if (filterAgent && record.agent_id !== filterAgent) return false;
  if (filterAction && record.action !== filterAction) return false;
  return true;
}
