import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { appState } from '../index.ts';
import { StartAdapterSchema, WriteOutputSchema } from '../types.ts';

export const adapterRoutes = new Hono();

adapterRoutes.post('/start', zValidator('json', StartAdapterSchema), async (c) => {
  const config = c.req.valid('json');

  if (appState.adapter.status === 'connecting' || appState.adapter.status === 'connected') {
    return c.json({ error: 'Adapter already running' }, 409);
  }

  appState.adapter.config = config;
  appState.adapter.errorMessage = null;

  // Mock: simulate waiting for FANUC Scanner to connect (1.5s)
  appState.adapter.status = 'connecting';
  setTimeout(() => {
    if (appState.adapter.status === 'connecting') {
      appState.adapter.status = 'connected';
    }
  }, 1500);

  return c.json({ status: appState.adapter.status });
});

adapterRoutes.post('/stop', async (c) => {
  if (appState.adapter.status === 'disconnected') {
    return c.json({ error: 'Adapter is not running' }, 409);
  }

  // AdapterService.stop() will be wired here in Phase 4
  appState.adapter.status = 'disconnected';
  appState.adapter.config = null;
  appState.adapter.errorMessage = null;
  appState.adapter.inputWord = 0;
  appState.adapter.outputWord = 0;

  return c.json({ status: 'disconnected' });
});

adapterRoutes.post('/write', zValidator('json', WriteOutputSchema), async (c) => {
  const { word } = c.req.valid('json');

  if (appState.adapter.status !== 'connected') {
    return c.json({ error: 'Adapter is not connected' }, 409);
  }

  appState.adapter.outputWord = word;

  // AdapterService.setOutputWord() will be wired here in Phase 4

  return c.json({ outputWord: appState.adapter.outputWord });
});
