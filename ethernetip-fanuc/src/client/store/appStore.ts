import { create } from 'zustand';
import type { ConnectionStatus, WsPayload } from '@shared/types';
import { toggleBit } from '@shared/types';

export type PanelState = {
  status: ConnectionStatus;
  errorMessage?: string;
  inputWord: number;
  outputWord: number;
};

type WsStatus = 'connecting' | 'open' | 'closed';

type AppStore = {
  scanner: PanelState;
  adapter: PanelState;
  wsStatus: WsStatus;
  updateFromPayload: (payload: WsPayload) => void;
  toggleScannerBit: (bitIndex: number) => void;
  toggleAdapterBit: (bitIndex: number) => void;
  setWsStatus: (s: WsStatus) => void;
  setStatus: (mode: 'scanner' | 'adapter', status: ConnectionStatus, errorMessage?: string) => void;
  setInputWord: (mode: 'scanner' | 'adapter', word: number) => void;
};

const defaultPanel: PanelState = {
  status: 'disconnected',
  inputWord: 0,
  outputWord: 0,
};

export const useAppStore = create<AppStore>((set) => ({
  scanner: { ...defaultPanel },
  adapter: { ...defaultPanel },
  wsStatus: 'connecting',

  updateFromPayload: (payload) => {
    const patch: Partial<PanelState> = {
      status: payload.status,
      errorMessage: payload.errorMessage,
      inputWord: payload.input,
      outputWord: payload.output,
    };
    if (payload.mode === 'scanner') {
      set((s) => ({ scanner: { ...s.scanner, ...patch } }));
    } else {
      set((s) => ({ adapter: { ...s.adapter, ...patch } }));
    }
  },

  toggleScannerBit: (bitIndex) =>
    set((s) => ({
      scanner: { ...s.scanner, outputWord: toggleBit(s.scanner.outputWord, bitIndex) },
    })),

  toggleAdapterBit: (bitIndex) =>
    set((s) => ({
      adapter: { ...s.adapter, outputWord: toggleBit(s.adapter.outputWord, bitIndex) },
    })),

  setWsStatus: (wsStatus) => set({ wsStatus }),

  setStatus: (mode, status, errorMessage) =>
    set((s) => ({ [mode]: { ...s[mode], status, errorMessage } })),

  setInputWord: (mode, word) =>
    set((s) => ({ [mode]: { ...s[mode], inputWord: word } })),
}));
