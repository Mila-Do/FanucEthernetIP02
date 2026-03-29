import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { AppState, WsPayload } from './types.ts';
import { scannerRoutes } from './routes/scanner.ts';
import { adapterRoutes } from './routes/adapter.ts';
import { startBroadcast } from './ws/broadcast.ts';

// ── In-memory application state ──────────────────────────────────────────────

export const appState: AppState = {
  scanner: {
    config: null,
    status: 'disconnected',
    errorMessage: null,
    inputWord: 0,
    outputWord: 0,
  },
  adapter: {
    config: null,
    status: 'disconnected',
    errorMessage: null,
    inputWord: 0,
    outputWord: 0,
  },
};

// ── WebSocket clients registry ────────────────────────────────────────────────

export const wsClients = new Set<ServerWebSocket<unknown>>();

// ── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono();

app.route('/api/scanner', scannerRoutes);
app.route('/api/adapter', adapterRoutes);

app.get('/api/state', (c) => c.json(appState));

// Serve React SPA (production build from dist/)
app.use('/*', serveStatic({ root: './dist' }));
app.get('/*', serveStatic({ path: './dist/index.html' }));

// ── Bun server with WebSocket upgrade ────────────────────────────────────────

const server = Bun.serve({
  port: 3000,
  hostname: '0.0.0.0',

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return undefined;
    }

    return app.fetch(req);
  },

  websocket: {
    open(ws) {
      wsClients.add(ws);
      // Send current state immediately on connect
      const scannerPayload: WsPayload = {
        mode: 'scanner',
        status: appState.scanner.status,
        errorMessage: appState.scanner.errorMessage ?? undefined,
        input: appState.scanner.inputWord,
        output: appState.scanner.outputWord,
        timestamp: Date.now(),
      };
      const adapterPayload: WsPayload = {
        mode: 'adapter',
        status: appState.adapter.status,
        errorMessage: appState.adapter.errorMessage ?? undefined,
        input: appState.adapter.inputWord,
        output: appState.adapter.outputWord,
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(scannerPayload));
      ws.send(JSON.stringify(adapterPayload));
    },
    close(ws) {
      wsClients.delete(ws);
    },
    message(_ws, _msg) {
      // WebSocket is server→client only; control commands use REST
    },
  },
});

// Start 100ms broadcast loop
startBroadcast();

// Mock data generator — Phase 1 only, replaced in Phase 3/4 by real services
// Simulates incoming I/O data from FANUC robot when connected
setInterval(() => {
  if (appState.scanner.status === 'connected') {
    appState.scanner.inputWord = Math.floor(Math.random() * 65536);
  }
  if (appState.adapter.status === 'connected') {
    appState.adapter.inputWord = Math.floor(Math.random() * 65536);
  }
}, 100);

console.log(`EtherNet/IP FANUC Connector running on http://0.0.0.0:${server.port}`);
console.log(`WebSocket: ws://0.0.0.0:${server.port}/ws`);
