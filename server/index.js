import express from 'express';
import cors from 'cors';
import { state, serializeState } from './state.js';
import { doAgentTurn } from './simulation.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// GET /api/state — full graph + agent states + stats
app.get('/api/state', (_req, res) => {
  res.json(serializeState());
});

// POST /api/step — execute one agent turn
app.post('/api/step', async (req, res) => {
  if (state.running) {
    return res.status(409).json({ error: 'Simulation is already running' });
  }

  const { provider, apiKey, model } = req.body || {};
  if (provider) state.config.provider = provider;
  if (apiKey) state.config.apiKey = apiKey;
  if (model !== undefined) state.config.model = model;

  if (!state.config.apiKey) {
    return res.status(400).json({ error: 'No API key configured' });
  }

  state.running = true;
  try {
    await doAgentTurn();
    res.json(serializeState());
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    state.running = false;
  }
});

// POST /api/run — execute N turns, stream updates via SSE
app.post('/api/run', async (req, res) => {
  if (state.running) {
    return res.status(409).json({ error: 'Simulation is already running' });
  }

  const { n = 9, provider, apiKey, model } = req.body || {};
  if (provider) state.config.provider = provider;
  if (apiKey) state.config.apiKey = apiKey;
  if (model !== undefined) state.config.model = model;

  if (!state.config.apiKey) {
    return res.status(400).json({ error: 'No API key configured' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  state.running = true;
  state.abortFlag = false;

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    for (let i = 0; i < n; i++) {
      if (state.abortFlag) break;
      await doAgentTurn();
      send(serializeState());
      if (i < n - 1 && !state.abortFlag) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  } catch (e) {
    // Errors are logged inside doAgentTurn
  } finally {
    state.running = false;
  }

  send({ ...serializeState(), done: true });
  res.end();
});

// POST /api/stop — abort a running batch
app.post('/api/stop', (_req, res) => {
  state.abortFlag = true;
  res.json({ ok: true });
});

// POST /api/config — update provider/key/model
app.post('/api/config', (req, res) => {
  const { provider, apiKey, model } = req.body || {};
  if (provider) state.config.provider = provider;
  if (apiKey !== undefined) state.config.apiKey = apiKey;
  if (model !== undefined) state.config.model = model;
  res.json({
    ok: true,
    provider: state.config.provider,
    model: state.config.model,
    hasApiKey: !!state.config.apiKey,
  });
});

// GET /api/log — event log with pagination
app.get('/api/log', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const total = state.log.length;
  const start = Math.max(0, total - page * limit);
  const end = total - (page - 1) * limit;
  res.json({
    log: [...state.log.slice(start, end)].reverse(),
    total,
  });
});

// GET /api/node/:id — full node detail
app.get('/api/node/:id', (req, res) => {
  const node = state.graph[req.params.id];
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(node);
});

app.listen(PORT, () => {
  console.log(`Euclid Protocol Sandbox server running on http://localhost:${PORT}`);
  if (state.config.apiKey) {
    console.log(`LLM provider: ${state.config.provider} (key loaded from env)`);
  } else {
    console.log('No API key set — configure via UI or LLM_API_KEY env var');
  }
});
