// PC-as-Scanner: TCP connect → RegisterSession → Forward Open → UDP cyclic I/O
//
// FANUC R-30iB deviations from CIP standard (§150 EthernetIP-Byte-Level-Protocol-Reference.md):
//  1. Connection Path: producing (T→O, 152/0x98) FIRST, consuming (O→T, 102/0x66) SECOND
//     — standard CIP has consuming first; any other order gives error 0x0117
//  2. O→T Connection Size = 8 (CIP seq 2B + Run/Idle 4B + data 2B)
//     T→O Connection Size = 4 (CIP seq 2B + data 2B) — FANUC counts CIP seq in size (0x0109 otherwise)
//  3. Run/Idle Header = 0x00000001 in every O→T packet — 0x00000000 zeroes robot outputs
//  4. Transport Class/Trigger must be 0x01 (Client + Cyclic + Class 1) — 0x40 gives 0x0108
//  5. Both directions Point-to-Point — Multicast gives 0x0108
//  6. UDP port 2222 — FANUC Adapter sends T→O to standard EtherNet/IP port 2222

import * as net from 'net';
import * as dgram from 'dgram';
import type { ScannerConfig } from '../types.ts';

const UDP_PORT = 2222;
const TCP_TIMEOUT_MS = 10_000;
const RPI_US = 50_000; // 50 ms in microseconds

export class PCScannerService {
  isActive = false;

  private tcp: net.Socket | null = null;
  private udp: dgram.Socket | null = null;
  private tcpRxBuf = Buffer.alloc(0);

  private sessionHandle = 0;
  private otConnId = 0; // O→T ConnID: PC inserts into every O→T packet
  private toConnId = 0; // T→O ConnID: FANUC inserts; PC filters incoming packets by this

  private cipSeqCount = 0;   // 16-bit, wraps
  private encapSeqNum = 0;   // 32-bit, wraps

  private txBuffer = Buffer.alloc(2); // current output word (UINT16 LE)
  private ioInterval: ReturnType<typeof setInterval> | null = null;

  private fanucIp = '';
  private onInputWord: (word: number) => void = () => {};
  private onRuntimeError: (msg: string) => void = () => {};

  // ── Public API ──────────────────────────────────────────────────────────────

  async connect(
    config: ScannerConfig,
    callbacks: {
      onInputWord: (word: number) => void;
      onError: (msg: string) => void;
    }
  ): Promise<void> {
    this.onInputWord = callbacks.onInputWord;
    this.onRuntimeError = callbacks.onError;
    this.fanucIp = config.ip;

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        if (err) {
          this.cleanup();
          reject(err);
        } else {
          resolve();
        }
      };

      const connectTimeout = setTimeout(
        () => done(new Error('Connection timed out')),
        TCP_TIMEOUT_MS
      );

      this.tcp = new net.Socket();

      this.tcp.on('error', (err) => done(err));

      this.tcp.on('close', () => {
        if (this.isActive) {
          this.isActive = false;
          this.stopIO();
          this.onRuntimeError('TCP connection closed unexpectedly');
        }
      });

      this.tcp.connect(config.port, config.ip, () => {
        this.sendRegisterSession();
      });

      this.tcp.on('data', (chunk: Buffer) => {
        this.tcpRxBuf = Buffer.concat([this.tcpRxBuf, chunk]);
        this.processTcpBuffer(
          () => done(),              // Forward Open succeeded → resolve promise
          (err) => done(err)         // any protocol error → reject promise
        );
      });
    });
  }

  async disconnect(): Promise<void> {
    this.cleanup();
  }

  setOutputWord(word: number): void {
    this.txBuffer.writeUInt16LE(word >>> 0, 0);
  }

  // ── TCP stream parser ──────────────────────────────────────────────────────
  // Each EIP packet starts with a 24-byte encapsulation header.
  // Bytes [2..3] give the payload length, so total = 24 + payloadLen.

  private processTcpBuffer(onReady: () => void, onError: (e: Error) => void) {
    while (this.tcpRxBuf.length >= 4) {
      const payloadLen = this.tcpRxBuf.readUInt16LE(2);
      const totalLen = 24 + payloadLen;
      if (this.tcpRxBuf.length < totalLen) break;

      const pkt = this.tcpRxBuf.slice(0, totalLen);
      this.tcpRxBuf = this.tcpRxBuf.slice(totalLen);

      const cmd = pkt.readUInt16LE(0);
      try {
        if (cmd === 0x0065) {
          this.handleRegisterSessionReply(pkt);
        } else if (cmd === 0x006F) {
          this.handleSendRRDataReply(pkt, onReady, onError);
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }
  }

  // ── Krok 2: RegisterSession ────────────────────────────────────────────────
  // Scanner sends 28 bytes; Adapter replies with Session Handle in bytes [4..7].

  private sendRegisterSession() {
    const pkt = Buffer.alloc(28);
    pkt.writeUInt16LE(0x0065, 0); // Command: RegisterSession
    pkt.writeUInt16LE(4, 2);      // Payload length = 4
    // [4..23]: Session Handle=0, Status=0, Context=0, Options=0 (all zeros)
    pkt.writeUInt16LE(1, 24);     // Protocol Version = 1
    pkt.writeUInt16LE(0, 26);     // Option Flags = 0
    this.tcp!.write(pkt);
  }

  private handleRegisterSessionReply(pkt: Buffer) {
    const status = pkt.readUInt32LE(8);
    if (status !== 0) {
      throw new Error(`RegisterSession failed: status=0x${status.toString(16).padStart(8, '0')}`);
    }
    const protocolVersion = pkt.readUInt16LE(24);
    if (protocolVersion !== 1) {
      throw new Error(`RegisterSession: unexpected Protocol Version ${protocolVersion}`);
    }
    this.sessionHandle = pkt.readUInt32LE(4);
    if (this.sessionHandle === 0) {
      throw new Error('RegisterSession: Adapter returned Session Handle = 0');
    }
    this.sendForwardOpen();
  }

  // ── Krok 3: Forward Open ───────────────────────────────────────────────────
  // Wrapped in SendRRData (0x006F) → CPF → UCMM (0x00B2) → CIP FO service (0x54).
  //
  // Packet layout:
  //   24B  Encapsulation header
  //    4B  Interface Handle = 0
  //    2B  Timeout = 0
  //    2B  Item Count = 2
  //    4B  Null Address item (type 0x0000, len 0)
  //    4B  UCMM item header (type 0x00B2, len = 50)
  //   50B  CIP message (6B router + 36B FO data + 8B path)
  // Total: 90 bytes

  private sendForwardOpen() {
    // CIP message: 6B router header + 36B FO data + 8B connection path = 50 bytes
    const cipMsg = Buffer.alloc(50);
    let p = 0;

    // CIP Message Router Request (6 bytes)
    cipMsg[p++] = 0x54;             // Service: Forward Open
    cipMsg[p++] = 0x02;             // Request Path Size: 2 words
    cipMsg[p++] = 0x20; cipMsg[p++] = 0x06; // Class segment: Connection Manager (6)
    cipMsg[p++] = 0x24; cipMsg[p++] = 0x01; // Instance segment: Instance 1

    // Forward Open Service Data (36 bytes)
    cipMsg[p++] = 0x07;             // Priority / Time Tick
    cipMsg[p++] = 0xE8;             // Timeout Ticks

    // Scanner proposes Connection IDs; Adapter may return different values in reply
    const proposedOtId = (Math.random() * 0x100000000) >>> 0;
    const proposedToId = (Math.random() * 0x100000000) >>> 0;
    cipMsg.writeUInt32LE(proposedOtId, p); p += 4; // O→T Connection ID (proposed)
    cipMsg.writeUInt32LE(proposedToId, p); p += 4; // T→O Connection ID (proposed)

    cipMsg.writeUInt16LE((Math.random() * 0x10000) >>> 0, p); p += 2; // Connection Serial
    cipMsg.writeUInt16LE(0x0001, p); p += 2;                          // Originator Vendor ID
    cipMsg.writeUInt32LE((Math.random() * 0x100000000) >>> 0, p); p += 4; // Originator SN
    cipMsg[p++] = 0x00;             // Connection Timeout Multiplier (×4)
    cipMsg[p++] = 0x00; cipMsg[p++] = 0x00; cipMsg[p++] = 0x00; // Reserved

    cipMsg.writeUInt32LE(RPI_US, p); p += 4;   // O→T RPI = 50 000 µs
    // O→T NCP: Exclusive(0), P2P(10), Fixed(0), Size=8
    // 0x4008 = 0100 0000 0000 1000 — FANUC includes CIP Sequence Count in size
    cipMsg.writeUInt16LE(0x4008, p); p += 2;

    cipMsg.writeUInt32LE(RPI_US, p); p += 4;   // T→O RPI = 50 000 µs
    // T→O NCP: Exclusive(0), P2P(10), Fixed(0), Size=4
    // 0x4004 = 0100 0000 0000 0100 — CIP Sequence Count also included
    cipMsg.writeUInt16LE(0x4004, p); p += 2;

    cipMsg[p++] = 0x01;             // Transport Class/Trigger: Client + Cyclic + Class 1
    cipMsg[p++] = 0x04;             // Connection Path Size: 4 words = 8 bytes

    // Connection Path — ⚠ FANUC deviation: producing (T→O) FIRST, consuming (O→T) SECOND
    // Standard CIP: consuming first. FANUC: reversed. Any other order → error 0x0117.
    cipMsg[p++] = 0x20; cipMsg[p++] = 0x04; // Class segment: Assembly (0x04)
    cipMsg[p++] = 0x24; cipMsg[p++] = 0x64; // Instance: Config assembly 100 (0x64)
    cipMsg[p++] = 0x2C; cipMsg[p++] = 0x98; // Connection Point: 152 (0x98) — T→O producing ← FIRST
    cipMsg[p++] = 0x2C; cipMsg[p++] = 0x66; // Connection Point: 102 (0x66) — O→T consuming ← SECOND

    // CPF wrapper (16 bytes) + CIP message
    const cpf = Buffer.alloc(16 + cipMsg.length);
    let q = 0;
    cpf.writeUInt32LE(0, q); q += 4;             // Interface Handle
    cpf.writeUInt16LE(0, q); q += 2;             // Timeout
    cpf.writeUInt16LE(2, q); q += 2;             // Item Count = 2
    cpf.writeUInt16LE(0x0000, q); q += 2;        // Null Address Item type
    cpf.writeUInt16LE(0x0000, q); q += 2;        // Null Address Item length
    cpf.writeUInt16LE(0x00B2, q); q += 2;        // UCMM Item type
    cpf.writeUInt16LE(cipMsg.length, q); q += 2; // UCMM Item length
    cipMsg.copy(cpf, q);

    // Encapsulation header (24 bytes)
    const pkt = Buffer.alloc(24 + cpf.length);
    pkt.writeUInt16LE(0x006F, 0);             // Command: SendRRData
    pkt.writeUInt16LE(cpf.length, 2);         // Payload length
    pkt.writeUInt32LE(this.sessionHandle, 4); // Session Handle from RegisterSession
    // [8..23]: Status=0, Context=0, Options=0
    cpf.copy(pkt, 24);

    this.tcp!.write(pkt);
  }

  // ── Krok 4: Forward Open Reply ─────────────────────────────────────────────
  // On success: extract O→T and T→O Connection IDs, start UDP I/O.
  // On failure: decode CIP error code and reject with human-readable message.

  private handleSendRRDataReply(
    pkt: Buffer,
    onSuccess: () => void,
    onError: (e: Error) => void
  ) {
    const cipData = this.extractUcmmData(pkt);
    if (!cipData || cipData.length < 4) {
      onError(new Error('Forward Open reply: missing or malformed UCMM data'));
      return;
    }

    const service = cipData.readUInt8(0);
    if (service !== 0xD4) {
      // 0xD4 = 0x54 | 0x80 = Forward Open reply
      onError(new Error(`Unexpected CIP service byte: 0x${service.toString(16)}`));
      return;
    }

    const generalStatus = cipData.readUInt8(2);
    if (generalStatus !== 0x00) {
      const extSize = cipData.readUInt8(3);
      const extCode =
        extSize > 0 && cipData.length >= 6
          ? cipData.readUInt16LE(4)
          : 0;
      onError(new Error(this.formatCipError(generalStatus, extCode)));
      return;
    }

    // Success — Connection IDs assigned by FANUC Adapter
    // FO Reply layout: [4..7] = O→T ConnID, [8..11] = T→O ConnID
    this.otConnId = cipData.readUInt32LE(4); // PC inserts this in every O→T packet
    this.toConnId = cipData.readUInt32LE(8); // FANUC inserts this in T→O; PC filters by it

    this.startPeriodicIO(onSuccess, onError);
  }

  // Scan CPF items to find the UCMM (0x00B2) data item and return its payload.
  // Handles variable number of CPF items (FANUC may include Sockaddr Info items).
  private extractUcmmData(pkt: Buffer): Buffer | null {
    let off = 24; // skip 24-byte encapsulation header
    if (pkt.length < off + 8) return null;

    off += 4; // Interface Handle
    off += 2; // Timeout
    const itemCount = pkt.readUInt16LE(off); off += 2;

    for (let i = 0; i < itemCount; i++) {
      if (pkt.length < off + 4) return null;
      const typeId = pkt.readUInt16LE(off); off += 2;
      const length = pkt.readUInt16LE(off); off += 2;
      if (typeId === 0x00B2) return pkt.slice(off, off + length);
      off += length;
    }
    return null;
  }

  private formatCipError(status: number, extCode: number): string {
    const known: Record<number, string> = {
      0x0108: 'FANUC 0x0108: Invalid connection type — Transport must be 0x01 (Client+Cyclic+Class1) and both directions must be Point-to-Point',
      0x0109: 'FANUC 0x0109: Invalid connection size — O→T must be 8, T→O must be 4 (FANUC includes CIP Sequence Count in size)',
      0x0117: 'FANUC 0x0117: Invalid application path — Connection Path must be T→O (152) first, O→T (102) second (FANUC reverses standard CIP order)',
    };
    const key = extCode !== 0 ? extCode : status;
    return (
      known[key] ??
      `CIP error: generalStatus=0x${status.toString(16).padStart(2, '0')}, extCode=0x${extCode.toString(16).padStart(4, '0')}`
    );
  }

  // ── Krok 5: Cyclic UDP I/O ─────────────────────────────────────────────────
  // PC Scanner binds UDP:2222 — FANUC sends T→O to this port.
  // PC sends O→T to FANUC_IP:2222 every 50 ms.

  private startPeriodicIO(onReady: () => void, onError: (e: Error) => void) {
    this.udp = dgram.createSocket('udp4');

    // One-time error listener for bind failure — before the socket is ready
    this.udp.once('error', (err) => onError(err));

    // T→O receiver: FANUC → PC (Modeless — no Run/Idle header)
    this.udp.on('message', (msg: Buffer) => {
      if (msg.length < 22) return;

      // Filter by T→O Connection ID at bytes [6..9]
      const connId = msg.readUInt32LE(6);
      if (connId !== this.toConnId) return;

      // Data at byte 20: 18B CPF header + 2B CIP Sequence Count (no Run/Idle in T→O)
      const inputWord = msg.readUInt16LE(20);
      this.onInputWord(inputWord);
    });

    this.udp.bind(UDP_PORT, () => {
      // Swap to runtime error handler after successful bind
      this.udp!.removeAllListeners('error');
      this.udp!.on('error', (err) => {
        console.error('[Scanner UDP]', err.message);
        this.onRuntimeError(`UDP error: ${err.message}`);
      });

      this.isActive = true;
      this.ioInterval = setInterval(() => this.sendOtPacket(), 50);
      onReady();
    });
  }

  // O→T packet: 26 bytes = 18B CPF header + 8B Data Item
  //
  //  [0-1]   Item Count = 2           (0x0002)
  //  [2-3]   Sequenced Address Type   (0x8002)
  //  [4-5]   Address Item Length = 8  (0x0008)
  //  [6-9]   O→T Connection ID        ← from Forward Open Reply [4..7]
  //  [10-13] Encap Sequence Number    ← increments each packet
  //  [14-15] Connected Data Type      (0x00B1)
  //  [16-17] Data Item Length = 8     (0x0008)
  //  [18-19] CIP Sequence Count       ← 16-bit, wraps at 65535
  //  [20-23] Run/Idle Header          ← ALWAYS 0x00000001 (RUN); 0 zeroes robot outputs
  //  [24-25] UINT16 output data       ← current txBuffer word
  private sendOtPacket() {
    if (!this.udp || !this.isActive) return;

    const pkt = Buffer.alloc(26);
    let p = 0;

    pkt.writeUInt16LE(0x0002, p); p += 2;
    pkt.writeUInt16LE(0x8002, p); p += 2;
    pkt.writeUInt16LE(0x0008, p); p += 2;
    pkt.writeUInt32LE(this.otConnId, p); p += 4;
    pkt.writeUInt32LE((this.encapSeqNum++) >>> 0, p); p += 4;
    pkt.writeUInt16LE(0x00B1, p); p += 2;
    pkt.writeUInt16LE(0x0008, p); p += 2;
    pkt.writeUInt16LE((this.cipSeqCount++) & 0xFFFF, p); p += 2;
    pkt.writeUInt32LE(0x00000001, p); p += 4; // Run/Idle = RUN
    this.txBuffer.copy(pkt, p);               // 2-byte output word

    this.udp.send(pkt, 0, pkt.length, UDP_PORT, this.fanucIp);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private stopIO() {
    if (this.ioInterval) {
      clearInterval(this.ioInterval);
      this.ioInterval = null;
    }
    try { this.udp?.close(); } catch { /* already closed */ }
    this.udp = null;
  }

  private cleanup() {
    this.stopIO();
    this.tcp?.destroy();
    this.tcp = null;
    this.tcpRxBuf = Buffer.alloc(0);
    this.sessionHandle = 0;
    this.otConnId = 0;
    this.toConnId = 0;
    this.cipSeqCount = 0;
    this.encapSeqNum = 0;
    this.txBuffer.fill(0);
    this.isActive = false;
  }
}

export const scannerService = new PCScannerService();
