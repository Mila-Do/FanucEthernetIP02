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
  appState.scanner.errorMessage = null;

  // Mock: special IPs simulate error conditions
  // 192.0.2.x = IANA TEST-NET-1, reserved for documentation/testing
  if (config.ip === '192.0.2.99') {
    appState.scanner.status = 'connecting';
    setTimeout(() => {
      appState.scanner.status = 'error';
      appState.scanner.errorMessage = 'Connection timed out';
    }, 5000);
  } else if (config.ip === '192.0.2.98') {
    appState.scanner.status = 'error';
    appState.scanner.errorMessage = `Connection refused: ${config.ip}:${config.port}`;
  } else {
    // Mock: normal connection — simulate 1.5s TCP handshake + Forward Open
    appState.scanner.status = 'connecting';
    setTimeout(() => {
      if (appState.scanner.status === 'connecting') {
        appState.scanner.status = 'connected';
      }
    }, 1500);
  }

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
