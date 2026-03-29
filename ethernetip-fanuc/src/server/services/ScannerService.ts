// Phase 3 implementation: PC as EtherNet/IP Scanner → FANUC R-30iB as Adapter
// TCP connect → RegisterSession → Forward Open → UDP cyclic I/O on port 2222
//
// FANUC deviations (§150 EthernetIP-Byte-Level-Protocol-Reference.md):
//   - Connection Path: producing (T→O, 152) FIRST, consuming (O→T, 102) SECOND
//   - O→T Connection Size = 8 (CIP seq 2B + Run/Idle 4B + data 2B)
//   - T→O Connection Size = 4 (CIP seq 2B + data 2B)
//   - Transport Class/Trigger = 0x01 (Client + Cyclic + Class 1)
//   - Run/Idle Header = 0x00000001 in every O→T packet
//   - UDP port 2222 (FANUC sends T→O to standard port 2222)

export class ScannerService {
  isActive = false;

  async connect(_config: { ip: string; port: number }): Promise<void> {
    throw new Error('ScannerService not yet implemented (Phase 3)');
  }

  async disconnect(): Promise<void> {
    throw new Error('ScannerService not yet implemented (Phase 3)');
  }

  setOutputWord(_word: number): void {
    throw new Error('ScannerService not yet implemented (Phase 3)');
  }
}

export const scannerService = new ScannerService();
