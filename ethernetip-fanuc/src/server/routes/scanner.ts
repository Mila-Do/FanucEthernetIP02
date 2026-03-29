import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { appState } from '../index.ts';
import { ConnectScannerSchema, WriteOutputSchema } from '../types.ts';

export const scannerRoutes = new Hono();

scannerRoutes.post('/connect', zValidator('json', ConnectScannerSchema), async (c) => {
  const config = c.req.valid('json');

  if (appState.scanner.status === 'connecting' || appState.scanner.status === 'connected') {
    return c.json({ error: 'Scanner already connected or connecting' }, 409);
  }

  appState.scanner.config = config;
  appState.scanner.status = 'connecting';
  appState.scanner.errorMessage = null;

  // ScannerService will be wired here in Phase 3
  // For now: placeholder that will be replaced with real EtherNet/IP connection

  return c.json({ status: appState.scanner.status });
});

scannerRoutes.post('/disconnect', async (c) => {
  if (appState.scanner.status === 'disconnected') {
    return c.json({ error: 'Scanner is not connected' }, 409);
  }

  // ScannerService.disconnect() will be wired here in Phase 3
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

  // ScannerService.setOutputWord() will be wired here in Phase 3

  return c.json({ outputWord: appState.scanner.outputWord });
});
