import { z } from 'zod';

// ── Connection status ────────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ── I/O word representation ──────────────────────────────────────────────────

export type IOWord = {
  /** UINT16, 0–65535 */
  raw: number;
  /** [0..15], bit 0 = LSB */
  bits: boolean[];
};

// ── Per-mode state ───────────────────────────────────────────────────────────

export type ScannerConfig = {
  ip: string;
  port: number;
};

export type AdapterConfig = {
  port: number;
};

export type ConnectionState<TConfig> = {
  config: TConfig | null;
  status: ConnectionStatus;
  errorMessage: string | null;
  /** UINT16 — data received FROM robot */
  inputWord: number;
  /** UINT16 — data sent TO robot */
  outputWord: number;
};

// ── Application state (shared between REST + WS) ────────────────────────────

export type AppState = {
  scanner: ConnectionState<ScannerConfig>;
  adapter: ConnectionState<AdapterConfig>;
};

// ── WebSocket payload (broadcast every 100 ms) ───────────────────────────────

export type WsPayload = {
  mode: 'scanner' | 'adapter';
  status: ConnectionStatus;
  errorMessage?: string;
  /** UINT16, 0–65535 — data received FROM robot */
  input: number;
  /** UINT16, 0–65535 — data sent TO robot */
  output: number;
  timestamp: number;
};

// ── Zod schemas (single source of truth for validation) ─────────────────────

export const ConnectScannerSchema = z.object({
  ip: z.string().ip({ version: 'v4' }),
  port: z.number().int().min(1).max(65535),
});

export const StartAdapterSchema = z.object({
  port: z.number().int().min(1).max(65535),
});

export const WriteOutputSchema = z.object({
  word: z.number().int().min(0).max(65535),
});

// ── Type inference from schemas ──────────────────────────────────────────────

export type ConnectScannerInput = z.infer<typeof ConnectScannerSchema>;
export type StartAdapterInput = z.infer<typeof StartAdapterSchema>;
export type WriteOutputInput = z.infer<typeof WriteOutputSchema>;

// ── Bit helpers ──────────────────────────────────────────────────────────────

/** UINT16 → boolean[16], index 0 = LSB */
export const wordToBits = (word: number): boolean[] =>
  Array.from({ length: 16 }, (_, i) => Boolean(word & (1 << i)));

/** boolean[16] → UINT16 */
export const bitsToWord = (bits: boolean[]): number =>
  bits.reduce((acc, bit, i) => acc | (bit ? 1 << i : 0), 0);

/** Toggle single bit in UINT16 */
export const toggleBit = (word: number, bitIndex: number): number =>
  word ^ (1 << bitIndex);
