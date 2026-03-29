import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { appState } from '../index.ts';
import { StartAdapterSchema, WriteOutputSchema } from '../types.ts';
import { adapterService } from '../services/PCAdapterService.ts';

export const adapterRoutes = new Hono();

adapterRoutes.post('/start', zValidator('json', StartAdapterSchema), async (c) => {
  const config = c.req.valid('json');

  if (appState.adapter.status === 'connecting' || appState.adapter.status === 'connected') {
    return c.json({ error: 'Adapter already running' }, 409);
  }

  appState.adapter.config = config;
  appState.adapter.status = 'connecting';
  appState.adapter.errorMessage = null;
  appState.adapter.inputWord = 0;
  appState.adapter.outputWord = 0;

  // Fire-and-forget — UI receives status updates via WebSocket broadcast.
  // start() resolves when TCP server is listening (still 'connecting').
  // onConnected fires after FANUC completes Forward Open handshake ('connected').
  adapterService
    .start(config, {
      onConnected: () => {
        appState.adapter.status = 'connected';
      },
      onInputWord: (word) => {
        appState.adapter.inputWord = word;
      },
      onError: (msg) => {
        appState.adapter.status = 'error';
        appState.adapter.errorMessage = msg;
        adapterService.stop();
      },
    })
    .catch((err: Error) => {
      appState.adapter.status = 'error';
      appState.adapter.errorMessage = err.message;
    });

  return c.json({ status: 'connecting' });
});

adapterRoutes.post('/stop', async (c) => {
  if (appState.adapter.status === 'disconnected') {
    return c.json({ error: 'Adapter is not running' }, 409);
  }

  await adapterService.stop();

  appState.adapter.status = 'disconnected';
  appState.adapter.config = null;
  appState.adapter.errorMessage = null;
  appState.adapter.inputWord = 0;
  appState.adapter.outputWord = 0;

  return c.json({ status: 'disconnected' });
});

adapterRoutes.get('/diag', (c) => {
  return c.json(adapterService.getDiag());
});

adapterRoutes.post('/write', zValidator('json', WriteOutputSchema), async (c) => {
  const { word } = c.req.valid('json');

  if (appState.adapter.status !== 'connected') {
    return c.json({ error: 'Adapter is not connected' }, 409);
  }

  appState.adapter.outputWord = word;
  adapterService.setOutputWord(word);

  return c.json({ outputWord: appState.adapter.outputWord });
});
