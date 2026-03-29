import { appState, wsClients } from '../index.ts';
import type { WsPayload } from '../types.ts';

export function startBroadcast(): void {
  setInterval(() => {
    if (wsClients.size === 0) return;

    const now = Date.now();

    const scannerPayload: WsPayload = {
      mode: 'scanner',
      status: appState.scanner.status,
      errorMessage: appState.scanner.errorMessage ?? undefined,
      input: appState.scanner.inputWord,
      output: appState.scanner.outputWord,
      timestamp: now,
    };

    const adapterPayload: WsPayload = {
      mode: 'adapter',
      status: appState.adapter.status,
      errorMessage: appState.adapter.errorMessage ?? undefined,
      input: appState.adapter.inputWord,
      output: appState.adapter.outputWord,
      timestamp: now,
    };

    const scannerMsg = JSON.stringify(scannerPayload);
    const adapterMsg = JSON.stringify(adapterPayload);

    for (const ws of wsClients) {
      ws.send(scannerMsg);
      ws.send(adapterMsg);
    }
  }, 100);
}
