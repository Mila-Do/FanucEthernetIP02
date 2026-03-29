// Phase 4 implementation: PC as EtherNet/IP Adapter ← FANUC R-30iB as Scanner
// TCP listen :44818 → parse RegisterSession → parse Forward Open → Forward Open Reply
// → UDP cyclic I/O on port 2223
//
// FANUC deviations (§150 EthernetIP-Byte-Level-Protocol-Reference.md):
//   - FANUC sends Connection Path: producing (T→O, 150) FIRST, consuming (O→T, 100) SECOND
//   - O→T Connection Size = 8 (CIP seq 2B + Run/Idle 4B + data 2B)
//   - T→O Connection Size = 4 (CIP seq 2B + data 2B) — Modeless, no Run/Idle
//   - Forward Open Reply must include Sockaddr Info (0x8000) with UDP port 2223
//   - UDP port 2223 (announced in Sockaddr Info so FANUC Scanner sends O→T here)

export class AdapterService {
  isActive = false;

  async start(_config: { port: number }): Promise<void> {
    throw new Error('AdapterService not yet implemented (Phase 4)');
  }

  async stop(): Promise<void> {
    throw new Error('AdapterService not yet implemented (Phase 4)');
  }

  setOutputWord(_word: number): void {
    throw new Error('AdapterService not yet implemented (Phase 4)');
  }
}

export const adapterService = new AdapterService();
