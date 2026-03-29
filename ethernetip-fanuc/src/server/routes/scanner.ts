import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { appState } from '../index.ts';
import { ConnectScannerSchema, WriteOutputSchema } from '../types.ts';
import { scannerService } from '../services/PCScannerService.ts';

export const scannerRoutes = new Hono();

scannerRoutes.post('/connect', zValidator('json', ConnectScannerSchema), async (c) => {
  const config = c.req.valid('json');

  if (appState.scanner.status === 'connecting' || appState.scanner.status === 'connected') {
    return c.json({ error: 'Scanner already connected or connecting' }, 409);
  }

  appState.scanner.config = config;
  appState.scanner.status = 'connecting';
  appState.scanner.errorMessage = null;

  // Fire-and-forget — UI receives status updates via WebSocket broadcast
  scannerService
    .connect(config, {
      onInputWord: (word) => {
        appState.scanner.inputWord = word;
      },
      onError: (msg) => {
        appState.scanner.status = 'error';
        appState.scanner.errorMessage = msg;
        scannerService.disconnect();
      },
    })
    .then(() => {
      appState.scanner.status = 'connected';
    })
    .catch((err: Error) => {
      appState.scanner.status = 'error';
      appState.scanner.errorMessage = err.message;
    });

  return c.json({ status: 'connecting' });
});

scannerRoutes.post('/disconnect', async (c) => {
  if (appState.scanner.status === 'disconnected') {
    return c.json({ error: 'Scanner is not connected' }, 409);
  }

  await scannerService.disconnect();

  appState.scanner.status = 'disconnected';
  appState.scanner.config = null;
  appState.scanner.errorMessage = null;
  appState.scanner.inputWord = 0;
  appState.scanner.outputWord = 0;

  return c.json({ status: 'disconnected' });
});

scannerRoutes.post('/write', zValidator('json', WriteOutputSchema), async (c) => {
  const { word } = c.req.valid('json');

  if (appState.scanner.status !== 'connected') {
    return c.json({ error: 'Scanner is not connected' }, 409);
  }

  appState.scanner.outputWord = word;
  scannerService.setOutputWord(word);

  return c.json({ outputWord: appState.scanner.outputWord });
});
