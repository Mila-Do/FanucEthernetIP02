// PC as EtherNet/IP Adapter (Tryb A) — FANUC R-30iB as Scanner
// FANUC initiates TCP:44818 → RegisterSession → Forward Open → Forward Open Reply
// → UDP cyclic I/O on port 2222
//
// FANUC deviations (§150 EthernetIP-Byte-Level-Protocol-Reference.md):
//   1. Connection Path: producing (T→O, 150/0x96) FIRST, consuming (O→T, 100/0x64) SECOND
//      (same FANUC reversal as in Scanner mode; standard CIP says consuming first)
//   2. O→T Connection Size = 8: CIP seq (2B) + Run/Idle (4B) + data (2B)
//      T→O Connection Size = 4: CIP seq (2B) + data (2B) — Modeless, no Run/Idle header
//   3. Forward Open Reply MUST include Sockaddr Info (0x8000) advertising UDP port 2222
//      FANUC Scanner will send O→T packets to the port announced here
//   4. UDP port 2222 — standard EtherNet/IP port, same as Scanner mode
//   5. O→T from FANUC: data at byte 24 (18B CPF + 2B CIP seq + 4B Run/Idle)
//   6. T→O to FANUC: Modeless — data at byte 20 (18B CPF + 2B CIP seq), NO Run/Idle header

import * as net from 'net';
import * as dgram from 'dgram';

const TCP_PORT = 44818;
const UDP_PORT = 2222;
const RPI_US = 50_000; // 50 ms in microseconds
const DIAG_MAX = 200;  // keep last N diagnostic entries

// ── Diagnostic log ────────────────────────────────────────────────────────────

export interface DiagEntry {
  ts: string;       // ISO timestamp
  level: 'INFO' | 'WARN' | 'ERROR';
  msg: string;
}

class DiagLog {
  private entries: DiagEntry[] = [];

  add(level: DiagEntry['level'], msg: string) {
    const entry: DiagEntry = { ts: new Date().toISOString(), level, msg };
    console.log(`[Adapter ${level}] ${msg}`);
    this.entries.push(entry);
    if (this.entries.length > DIAG_MAX) this.entries.shift();
  }

  info(msg: string)  { this.add('INFO',  msg); }
  warn(msg: string)  { this.add('WARN',  msg); }
  error(msg: string) { this.add('ERROR', msg); }

  getAll(): DiagEntry[] { return [...this.entries]; }
  clear()               { this.entries = []; }
}

export const adapterDiag = new DiagLog();

// ── PCAdapterService ──────────────────────────────────────────────────────────

export class PCAdapterService {
  isActive = false;

  private tcpServer: net.Server | null = null;
  private clientSocket: net.Socket | null = null;
  private udp: dgram.Socket | null = null;
  private tcpRxBuf = Buffer.alloc(0);

  private sessionHandle = 0;
  private otConnId = 0; // PC assigns; FANUC Scanner puts this in its O→T packets
  private toConnId = 0; // PC assigns; PC puts this in its T→O packets sent to FANUC

  private cipSeqCount = 0; // 16-bit, wraps at 65535
  private encapSeqNum = 0; // 32-bit, wraps

  private txBuffer = Buffer.alloc(2); // current output word (UINT16 LE)
  private ioInterval: ReturnType<typeof setInterval> | null = null;

  private fanucIp = '';
  private onConnected: (() => void) | null = null;
  private onInputWord: (word: number) => void = () => {};
  private onRuntimeError: (msg: string) => void = () => {};

  // UDP diagnostic counters
  private udpRxTotal = 0;
  private udpRxIdMismatch = 0;
  private udpTxTotal = 0;

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Start TCP server and wait for FANUC to initiate the Forward Open handshake.
   * Promise resolves when TCP server is bound and listening ('connecting' phase).
   * onConnected fires when UDP I/O starts after successful Forward Open ('connected' phase).
   */
  async start(
    config: { port: number },
    callbacks: {
      onConnected: () => void;
      onInputWord: (word: number) => void;
      onError: (msg: string) => void;
    }
  ): Promise<void> {
    this.onConnected = callbacks.onConnected;
    this.onInputWord = callbacks.onInputWord;
    this.onRuntimeError = callbacks.onError;

    adapterDiag.clear();
    adapterDiag.info(`Starting PC Adapter on TCP:${config.port} (UDP:${UDP_PORT})`);

    return new Promise((resolve, reject) => {
      this.tcpServer = net.createServer();

      this.tcpServer.on('error', (err) => {
        adapterDiag.error(`TCP server error: ${err.message}`);
        this.cleanup().finally(() => reject(err));
      });

      this.tcpServer.on('connection', (socket) => {
        if (this.clientSocket) {
          adapterDiag.warn(`Rejecting second TCP connection from ${socket.remoteAddress} (already connected)`);
          socket.destroy();
          return;
        }

        this.clientSocket = socket;
        this.fanucIp = socket.remoteAddress?.replace('::ffff:', '') ?? '';
        adapterDiag.info(`FANUC connected from ${this.fanucIp}:${socket.remotePort}`);

        socket.on('data', (chunk: Buffer) => {
          this.tcpRxBuf = Buffer.concat([this.tcpRxBuf, chunk]);
          this.processTcpBuffer();
        });

        socket.on('error', (err) => {
          if (this.isActive) {
            this.isActive = false;
            this.stopIO();
            const msg = `FANUC TCP error: ${err.message}`;
            adapterDiag.error(msg);
            this.onRuntimeError(msg);
          }
        });

        socket.on('close', () => {
          if (this.isActive) {
            this.isActive = false;
            this.stopIO();
            const msg = 'FANUC TCP connection closed unexpectedly';
            adapterDiag.warn(msg);
            this.onRuntimeError(msg);
          }
          this.clientSocket = null;
          adapterDiag.info('FANUC TCP disconnected');
        });
      });

      this.tcpServer.listen(config.port, '0.0.0.0', () => {
        adapterDiag.info(`TCP server listening on 0.0.0.0:${config.port} — waiting for FANUC`);
        resolve(); // TCP is listening — UI transitions to 'connecting'
      });
    });
  }

  async stop(): Promise<void> {
    adapterDiag.info('Stop requested');
    return this.cleanup();
  }

  setOutputWord(word: number): void {
    this.txBuffer.writeUInt16LE(word >>> 0, 0);
  }

  getDiag() {
    return {
      log: adapterDiag.getAll(),
      counters: {
        udpRxTotal:      this.udpRxTotal,
        udpRxIdMismatch: this.udpRxIdMismatch,
        udpTxTotal:      this.udpTxTotal,
        otConnId:        `0x${this.otConnId.toString(16).padStart(8, '0')}`,
        toConnId:        `0x${this.toConnId.toString(16).padStart(8, '0')}`,
        sessionHandle:   `0x${this.sessionHandle.toString(16).padStart(8, '0')}`,
        fanucIp:         this.fanucIp,
        isActive:        this.isActive,
      },
    };
  }

  // ── TCP stream parser ────────────────────────────────────────────────────────
  // EIP encapsulation header is always 24 bytes; bytes [2..3] = payload length.

  private processTcpBuffer() {
    while (this.tcpRxBuf.length >= 4) {
      const payloadLen = this.tcpRxBuf.readUInt16LE(2);
      const totalLen = 24 + payloadLen;
      if (this.tcpRxBuf.length < totalLen) break;

      const pkt = this.tcpRxBuf.slice(0, totalLen);
      this.tcpRxBuf = this.tcpRxBuf.slice(totalLen);

      const cmd = pkt.readUInt16LE(0);
      adapterDiag.info(`TCP rx: cmd=0x${cmd.toString(16).padStart(4,'0')} totalLen=${totalLen}`);

      try {
        if (cmd === 0x0004) {
          this.handleListServices(pkt);
        } else if (cmd === 0x0065) {
          this.handleRegisterSession(pkt);
        } else if (cmd === 0x006F) {
          this.handleSendRRData(pkt);
        } else {
          adapterDiag.warn(`TCP rx: unknown EIP command 0x${cmd.toString(16).padStart(4,'0')} — ignored`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        adapterDiag.error(msg);
        this.onRuntimeError(msg);
      }
    }
  }

  // ── ListServices (cmd 0x0004) ────────────────────────────────────────────────
  // Standard EIP discovery — Scanner asks "are you a valid EIP device?".
  // We MUST reply or the Scanner disconnects before sending RegisterSession.
  //
  // Reply payload (26B):
  //   [0-1]   Item Count = 1
  //   [2-3]   TypeId = 0x0100 (Communications)
  //   [4-5]   Length = 20
  //   [6-7]   Protocol Version = 1
  //   [8-9]   Capability Flags = 0x0100 (supports UCMM/Class3) | 0x0020 (Class0/1)
  //   [10-25] Service Name = "Communications\0\0" (16B, null-padded)

  private handleListServices(pkt: Buffer) {
    adapterDiag.info('ListServices (0x0004) rx — replying with Communications service');

    // Service name: "Communications" + 2 null bytes = 16 bytes
    const name = Buffer.alloc(16);
    Buffer.from('Communications').copy(name, 0);

    // Item data: version(2) + capFlags(2) + name(16) = 20B
    const itemData = Buffer.alloc(20);
    itemData.writeUInt16LE(1,      0); // Protocol Version = 1
    itemData.writeUInt16LE(0x0120, 2); // Capability: UCMM (bit8) + Class0/1 UDP (bit5)
    name.copy(itemData, 4);

    // Payload: itemCount(2) + typeId(2) + len(2) + itemData(20) = 26B
    const payload = Buffer.alloc(26);
    payload.writeUInt16LE(1,      0); // Item Count = 1
    payload.writeUInt16LE(0x0100, 2); // TypeId = Communications
    payload.writeUInt16LE(20,     4); // Length = 20
    itemData.copy(payload, 6);

    // Encapsulation header (24B) + payload
    const reply = Buffer.alloc(24 + payload.length);
    reply.writeUInt16LE(0x0004, 0);           // Command: ListServices
    reply.writeUInt16LE(payload.length, 2);   // Payload length = 26
    // sessionHandle, status, context, options = 0 (already zeros — echo context if needed)
    const ctx = pkt.slice(12, 20); // Sender Context from request
    ctx.copy(reply, 12);
    payload.copy(reply, 24);

    this.clientSocket!.write(reply);
    adapterDiag.info('ListServices reply sent — waiting for RegisterSession');
  }

  // ── Krok 2: RegisterSession ──────────────────────────────────────────────────
  // FANUC sends 28B request (cmd 0x0065).
  // PC replies with the same structure + assigned Session Handle in bytes [4..7].

  private handleRegisterSession(pkt: Buffer) {
    const status = pkt.readUInt32LE(8);
    if (status !== 0) {
      throw new Error(`RegisterSession: bad status 0x${status.toString(16).padStart(8, '0')}`);
    }

    const protoVer = pkt.length >= 26 ? pkt.readUInt16LE(24) : 0;
    adapterDiag.info(`RegisterSession rx: protoVer=${protoVer}`);

    this.sessionHandle = Math.max(1, (Math.random() * 0x100000000) >>> 0);

    const reply = Buffer.alloc(28);
    reply.writeUInt16LE(0x0065, 0); // Command: RegisterSession
    reply.writeUInt16LE(4, 2);      // Payload length = 4
    reply.writeUInt32LE(this.sessionHandle, 4); // Assigned Session Handle
    // [8..23]: Status=0, Context=0, Options=0 — already zeros
    reply.writeUInt16LE(1, 24); // Protocol Version = 1
    reply.writeUInt16LE(0, 26); // Option Flags = 0

    this.clientSocket!.write(reply);
    adapterDiag.info(`RegisterSession reply: sessionHandle=0x${this.sessionHandle.toString(16).padStart(8,'0')}`);
  }

  // ── Krok 3: Forward Open (from FANUC Scanner) ────────────────────────────────
  // FANUC wraps CIP service 0x54 inside SendRRData (0x006F) → CPF → UCMM (0x00B2).
  // FANUC uses its own convention: producing (T→O) FIRST in Connection Path.
  //
  // CIP FO message layout (offsets relative to UCMM payload start):
  //   [0]     Service = 0x54
  //   [1]     Request Path Size = 0x02 (2 words)
  //   [2-3]   Class segment: 20 06 (Connection Manager)
  //   [4-5]   Instance segment: 24 01 (Instance 1)
  //   [6]     Priority/Time Tick
  //   [7]     Timeout Ticks
  //   [8-11]  O→T Connection ID (FANUC proposed, we ignore — PC assigns new ones)
  //   [12-15] T→O Connection ID (FANUC proposed, we ignore)
  //   [16-17] Connection Serial Number  ← echo in reply
  //   [18-19] Originator Vendor ID      ← echo in reply
  //   [20-23] Originator Serial Number  ← echo in reply
  //   [24]    Connection Timeout Multiplier
  //   [25-27] Reserved
  //   [28-31] O→T RPI (µs)              ← echo in reply
  //   [32-33] O→T Network Connection Parameters
  //   [34-37] T→O RPI (µs)
  //   [38-39] T→O Network Connection Parameters
  //   [40]    Transport Class/Trigger = 0x01
  //   [41]    Connection Path Size (words)
  //   [42+]   Connection Path (150→100 from FANUC, producing first)

  private handleSendRRData(pkt: Buffer) {
    const cipData = this.extractUcmmData(pkt);
    if (!cipData || cipData.length < 42) {
      throw new Error(`Forward Open: CIP data too short (${cipData?.length ?? 0}B, need ≥42)`);
    }

    const service = cipData.readUInt8(0);
    if (service !== 0x54) {
      throw new Error(`Unexpected CIP service: 0x${service.toString(16).padStart(2, '0')} (expected 0x54 Forward Open)`);
    }

    const connSerial   = cipData.readUInt16LE(16);
    const vendorId     = cipData.readUInt16LE(18);
    const originatorSN = cipData.readUInt32LE(20);
    const otRPI        = cipData.readUInt32LE(28);
    const otNetParams  = cipData.readUInt16LE(32);
    const toRPI        = cipData.readUInt32LE(34);
    const toNetParams  = cipData.readUInt16LE(38);
    const transport    = cipData.readUInt8(40);
    const pathSizeW    = cipData.readUInt8(41); // in words

    adapterDiag.info(
      `Forward Open rx: connSerial=0x${connSerial.toString(16).padStart(4,'0')} ` +
      `vendorId=0x${vendorId.toString(16).padStart(4,'0')} originatorSN=0x${originatorSN.toString(16).padStart(8,'0')} ` +
      `otRPI=${otRPI}µs toRPI=${toRPI}µs transport=0x${transport.toString(16).padStart(2,'0')} pathWords=${pathSizeW}`
    );

    // Validate Transport Class/Trigger — FANUC requires 0x01
    if (transport !== 0x01) {
      adapterDiag.warn(`Forward Open: transport=0x${transport.toString(16).padStart(2,'0')} (expected 0x01) — may cause 0x0108`);
    }

    // Validate O→T Network Connection Parameters
    const otConnType = (otNetParams >> 13) & 0x3;
    const otSize     = otNetParams & 0x1FF;
    const toConnType = (toNetParams >> 13) & 0x3;
    const toSize     = toNetParams & 0x1FF;

    adapterDiag.info(
      `NetParams O→T: 0x${otNetParams.toString(16).padStart(4,'0')} connType=${otConnType} size=${otSize} | ` +
      `T→O: 0x${toNetParams.toString(16).padStart(4,'0')} connType=${toConnType} size=${toSize}`
    );

    if (otSize !== 8) adapterDiag.warn(`O→T size=${otSize} (expected 8 = CIP seq 2 + Run/Idle 4 + data 2)`);
    if (toSize !== 4) adapterDiag.warn(`T→O size=${toSize} (expected 4 = CIP seq 2 + data 2)`);
    if (otConnType !== 2) adapterDiag.warn(`O→T connType=${otConnType} (expected 2=P2P, bits 14–13)`);
    if (toConnType !== 2) adapterDiag.warn(`T→O connType=${toConnType} (expected 2=P2P, bits 14–13)`);

    // Parse Connection Path — FANUC sends producing (T→O=150) first, consuming (O→T=100) second
    this.parseAndLogConnPath(cipData, 42, pathSizeW * 2);

    // Assign new Connection IDs — PC is the Adapter, so PC assigns the final IDs
    this.otConnId = Math.max(1, (Math.random() * 0x100000000) >>> 0);
    this.toConnId = Math.max(1, (Math.random() * 0x100000000) >>> 0);

    adapterDiag.info(
      `Forward Open: assigned otConnId=0x${this.otConnId.toString(16).padStart(8,'0')} ` +
      `toConnId=0x${this.toConnId.toString(16).padStart(8,'0')}`
    );

    this.sendForwardOpenReply(connSerial, vendorId, originatorSN, otRPI);
  }

  // Parse the Connection Path bytes and log assembly instances.
  // Expected for Tryb A (FANUC as Scanner):
  //   20 04 → Class 0x04 (Assembly)
  //   24 01 → Config Instance 1
  //   2C 96 → Connection Point 150 (0x96) — producing T→O  ← FIRST (FANUC convention)
  //   2C 64 → Connection Point 100 (0x64) — consuming O→T  ← SECOND
  private parseAndLogConnPath(cipData: Buffer, offset: number, byteLen: number) {
    const end = offset + byteLen;
    if (cipData.length < end) {
      adapterDiag.warn(`ConnPath: too short (got ${cipData.length - offset}B, expected ${byteLen}B)`);
      return;
    }

    const path = cipData.slice(offset, end);
    const hexDump = Array.from(path).map(b => b.toString(16).padStart(2,'0')).join(' ');
    adapterDiag.info(`ConnPath raw [${byteLen}B]: ${hexDump}`);

    // Walk segments
    const points: number[] = [];
    let configInst: number | null = null;
    let p = 0;
    while (p < path.length - 1) {
      const segType = path[p];
      const segVal  = path[p + 1];
      if (segType === 0x20) {
        adapterDiag.info(`  ConnPath class=0x${segVal.toString(16).padStart(2,'0')} (expect 0x04=Assembly)`);
        if (segVal !== 0x04) adapterDiag.warn(`    ⚠ class is not Assembly (0x04)`);
        p += 2;
      } else if (segType === 0x24) {
        configInst = segVal;
        adapterDiag.info(`  ConnPath instance=0x${segVal.toString(16).padStart(2,'0')} (${segVal}) (config; expect 1=0x01)`);
        if (segVal !== 0x01) adapterDiag.warn(`    ⚠ config instance is not 1`);
        p += 2;
      } else if (segType === 0x2C) {
        points.push(segVal);
        const role = points.length === 1 ? 'T→O producing' : 'O→T consuming';
        adapterDiag.info(
          `  ConnPath connPoint[${points.length}]=0x${segVal.toString(16).padStart(2,'0')} (${segVal}) — ` +
          `${role} (FANUC order: T→O first, O→T second)`
        );
        p += 2;
      } else {
        adapterDiag.warn(`  ConnPath unknown segment type 0x${segType.toString(16).padStart(2,'0')} at offset ${p}`);
        p += 2;
      }
    }

    if (points.length === 2) {
      const prod = points[0]; // T→O (producing, what FANUC sends)
      const cons = points[1]; // O→T (consuming, what FANUC receives)
      const prodOk = prod === 0x96; // 150
      const consOk = cons === 0x64; // 100
      if (prodOk && consOk) {
        adapterDiag.info(`ConnPath: ✓ VALID — producing=150(0x96) consuming=100(0x64) config=${configInst}`);
      } else {
        adapterDiag.warn(
          `ConnPath: ⚠ UNEXPECTED — producing=${prod}(0x${prod.toString(16)}) consuming=${cons}(0x${cons.toString(16)}) ` +
          `(expected T→O=150/0x96, O→T=100/0x64 for Tryb A Slot 1)`
        );
      }
    } else {
      adapterDiag.warn(`ConnPath: found ${points.length} connection point(s), expected 2`);
    }
  }

  // ── Krok 4: Forward Open Reply ───────────────────────────────────────────────
  // CIP reply (30B) wrapped in SendRRData (0x006F) → CPF with 3 items:
  //   Item 0: Null Address (0x0000)
  //   Item 1: UCMM (0x00B2) — 30B CIP FO Reply
  //   Item 2: Sockaddr Info O→T (0x8000) — 16B sockaddr_in announcing UDP:2222
  //
  // The Sockaddr Info tells FANUC Scanner where to send its O→T UDP packets.
  // Port is in network byte order (big-endian) per sockaddr_in convention.

  private sendForwardOpenReply(
    connSerial: number,
    vendorId: number,
    originatorSN: number,
    otRPI: number
  ) {
    // CIP Forward Open Reply — 30 bytes
    const cip = Buffer.alloc(30);
    cip[0] = 0xD4; // Service reply = 0x54 | 0x80
    cip[1] = 0x00; // Reserved
    cip[2] = 0x00; // General Status = 0x00 (success)
    cip[3] = 0x00; // Extended Status Size = 0
    cip.writeUInt32LE(this.otConnId, 4);   // O→T Connection ID (PC assigned)
    cip.writeUInt32LE(this.toConnId, 8);   // T→O Connection ID (PC assigned)
    cip.writeUInt16LE(connSerial, 12);     // Connection Serial Number (echo)
    cip.writeUInt16LE(vendorId, 14);       // Originator Vendor ID (echo)
    cip.writeUInt32LE(originatorSN, 16);   // Originator Serial Number (echo)
    cip.writeUInt32LE(otRPI, 20);          // O→T Actual Packet Interval (echo)
    cip.writeUInt32LE(RPI_US, 24);         // T→O Actual Packet Interval
    cip[28] = 0x00;                        // Application Reply Size = 0
    cip[29] = 0x00;                        // Reserved

    // Sockaddr Info O→T (0x8000) — 16 bytes
    // sin_family and sin_port are big-endian (network byte order per sockaddr_in spec)
    const sockaddr = Buffer.alloc(16);
    sockaddr.writeUInt16BE(0x0002, 0);   // sin_family = AF_INET
    sockaddr.writeUInt16BE(UDP_PORT, 2); // sin_port = 2222 — FANUC sends O→T here
    // sin_addr = 0 (INADDR_ANY), sin_zero = 0 — already zeros

    // CPF body: Interface Handle(4) + Timeout(2) + ItemCount(2) + 3 items
    // Item 0 Null Addr:    4B
    // Item 1 UCMM:         4B + 30B = 34B
    // Item 2 Sockaddr:     4B + 16B = 20B
    // Total CPF body:      4+2+2 + 4 + 34 + 20 = 66B
    const cpf = Buffer.alloc(66);
    let q = 0;
    cpf.writeUInt32LE(0, q); q += 4;              // Interface Handle = 0
    cpf.writeUInt16LE(0, q); q += 2;              // Timeout = 0
    cpf.writeUInt16LE(3, q); q += 2;              // Item Count = 3

    cpf.writeUInt16LE(0x0000, q); q += 2;         // Item 0: Null Address type
    cpf.writeUInt16LE(0x0000, q); q += 2;         // Item 0: length = 0

    cpf.writeUInt16LE(0x00B2, q); q += 2;         // Item 1: UCMM type
    cpf.writeUInt16LE(cip.length, q); q += 2;     // Item 1: length = 30
    cip.copy(cpf, q); q += cip.length;

    cpf.writeUInt16LE(0x8000, q); q += 2;         // Item 2: Sockaddr Info O→T type
    cpf.writeUInt16LE(sockaddr.length, q); q += 2; // Item 2: length = 16
    sockaddr.copy(cpf, q);

    // Encapsulation header — 24 bytes
    const pkt = Buffer.alloc(24 + cpf.length);
    pkt.writeUInt16LE(0x006F, 0);              // Command: SendRRData
    pkt.writeUInt16LE(cpf.length, 2);          // Payload length = 66
    pkt.writeUInt32LE(this.sessionHandle, 4);  // Session Handle
    // [8..23]: Status=0, Context=0, Options=0 — already zeros
    cpf.copy(pkt, 24);

    this.clientSocket!.write(pkt);
    adapterDiag.info(
      `Forward Open Reply sent: otConnId=0x${this.otConnId.toString(16).padStart(8,'0')} ` +
      `toConnId=0x${this.toConnId.toString(16).padStart(8,'0')} sockaddrPort=${UDP_PORT}`
    );

    // Handshake complete — start UDP cyclic I/O
    this.startPeriodicIO();
  }

  // Scan CPF items to find the UCMM (0x00B2) payload.
  private extractUcmmData(pkt: Buffer): Buffer | null {
    let off = 24; // skip 24B encapsulation header
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

  // ── Krok 5: Cyclic UDP I/O ───────────────────────────────────────────────────
  // PC binds UDP:2222 — FANUC Scanner sends O→T here (as announced in Sockaddr Info).
  // PC sends T→O to FANUC_IP:2222 every 50 ms.

  private startPeriodicIO() {
    this.udp = dgram.createSocket('udp4');

    this.udp.once('error', (err) => {
      const msg = `UDP bind failed on port ${UDP_PORT}: ${err.message}`;
      adapterDiag.error(msg);
      this.onRuntimeError(msg);
    });

    // O→T receiver: FANUC Scanner → PC (with Run/Idle Header)
    //
    // O→T packet structure (26 bytes):
    //   [0-1]   Item Count = 2           (0x0002)
    //   [2-3]   Sequenced Address Type   (0x8002)
    //   [4-5]   Address Item Length = 8  (0x0008)
    //   [6-9]   O→T Connection ID        ← must match otConnId
    //   [10-13] Encap Sequence Number
    //   [14-15] Connected Data Type      (0x00B1)
    //   [16-17] Data Item Length = 8
    //   [18-19] CIP Sequence Count
    //   [20-23] Run/Idle Header          ← 0x00000001 = RUN
    //   [24-25] UINT16 output data       ← data from FANUC Scanner (our input)
    this.udp.on('message', (msg: Buffer, rinfo) => {
      this.udpRxTotal++;

      if (msg.length < 26) {
        if (this.udpRxTotal <= 5) {
          adapterDiag.warn(`UDP rx #${this.udpRxTotal}: too short ${msg.length}B from ${rinfo.address}:${rinfo.port}`);
        }
        return;
      }

      const connId = msg.readUInt32LE(6);

      if (connId !== this.otConnId) {
        this.udpRxIdMismatch++;
        // Log first few mismatches in detail — this is a common silent failure
        if (this.udpRxIdMismatch <= 5) {
          adapterDiag.warn(
            `UDP rx #${this.udpRxTotal}: connId MISMATCH ` +
            `got=0x${connId.toString(16).padStart(8,'0')} ` +
            `expected=0x${this.otConnId.toString(16).padStart(8,'0')} ` +
            `from ${rinfo.address}:${rinfo.port} — packet dropped`
          );
        }
        return;
      }

      const runIdle    = msg.readUInt32LE(20);
      const inputWord  = msg.readUInt16LE(24);

      // Log first few successful packets
      if (this.udpRxTotal - this.udpRxIdMismatch <= 3) {
        adapterDiag.info(
          `UDP rx #${this.udpRxTotal}: ✓ connId match, runIdle=0x${runIdle.toString(16).padStart(8,'0')} ` +
          `inputWord=0x${inputWord.toString(16).padStart(4,'0')} from ${rinfo.address}:${rinfo.port}`
        );
      }

      this.onInputWord(inputWord);
    });

    this.udp.bind(UDP_PORT, () => {
      this.udp!.removeAllListeners('error');
      this.udp!.on('error', (err) => {
        const msg = `UDP error: ${err.message}`;
        adapterDiag.error(msg);
        this.onRuntimeError(msg);
      });

      adapterDiag.info(`UDP socket bound on 0.0.0.0:${UDP_PORT} — cyclic I/O active (50ms)`);
      this.udpRxTotal = 0;
      this.udpRxIdMismatch = 0;
      this.udpTxTotal = 0;
      this.isActive = true;
      this.ioInterval = setInterval(() => this.sendToPacket(), 50);

      if (this.onConnected) {
        this.onConnected();
        this.onConnected = null;
      }
    });
  }

  // T→O packet: 22 bytes = 18B CPF header + 4B Data Item
  // Modeless — NO Run/Idle Header after CIP Sequence Count.
  //
  //   [0-1]   Item Count = 2           (0x0002)
  //   [2-3]   Sequenced Address Type   (0x8002)
  //   [4-5]   Address Item Length = 8  (0x0008)
  //   [6-9]   T→O Connection ID        ← toConnId assigned by PC
  //   [10-13] Encap Sequence Number    ← increments each packet
  //   [14-15] Connected Data Type      (0x00B1)
  //   [16-17] Data Item Length = 4     (0x0004)
  //   [18-19] CIP Sequence Count       ← 16-bit, wraps
  //   [20-21] UINT16 output data       ← data to FANUC Scanner (no Run/Idle!)
  private sendToPacket() {
    if (!this.udp || !this.isActive || !this.fanucIp) return;

    const pkt = Buffer.alloc(22);
    let p = 0;

    pkt.writeUInt16LE(0x0002, p); p += 2;
    pkt.writeUInt16LE(0x8002, p); p += 2;
    pkt.writeUInt16LE(0x0008, p); p += 2;
    pkt.writeUInt32LE(this.toConnId, p); p += 4;
    pkt.writeUInt32LE((this.encapSeqNum++) >>> 0, p); p += 4;
    pkt.writeUInt16LE(0x00B1, p); p += 2;
    pkt.writeUInt16LE(0x0004, p); p += 2;                        // Data Item Length = 4
    pkt.writeUInt16LE((this.cipSeqCount++) & 0xFFFF, p); p += 2; // CIP Sequence Count
    this.txBuffer.copy(pkt, p);                                   // 2-byte output word (Modeless)

    this.udp.send(pkt, 0, pkt.length, UDP_PORT, this.fanucIp);
    this.udpTxTotal++;

    // Log first few TX packets
    if (this.udpTxTotal <= 3) {
      const word = this.txBuffer.readUInt16LE(0);
      adapterDiag.info(
        `UDP tx #${this.udpTxTotal}: T→O to ${this.fanucIp}:${UDP_PORT} ` +
        `toConnId=0x${this.toConnId.toString(16).padStart(8,'0')} word=0x${word.toString(16).padStart(4,'0')}`
      );
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  private stopIO() {
    if (this.ioInterval) {
      clearInterval(this.ioInterval);
      this.ioInterval = null;
    }
    try { this.udp?.close(); } catch { /* already closed */ }
    this.udp = null;
  }

  private resetState() {
    this.tcpRxBuf = Buffer.alloc(0);
    this.sessionHandle = 0;
    this.otConnId = 0;
    this.toConnId = 0;
    this.cipSeqCount = 0;
    this.encapSeqNum = 0;
    this.txBuffer.fill(0);
    this.isActive = false;
    this.fanucIp = '';
    this.onConnected = null;
    this.udpRxTotal = 0;
    this.udpRxIdMismatch = 0;
    this.udpTxTotal = 0;
  }

  private cleanup(): Promise<void> {
    return new Promise((resolve) => {
      this.stopIO();
      this.clientSocket?.destroy();
      this.clientSocket = null;

      if (this.tcpServer) {
        this.tcpServer.close(() => {
          this.tcpServer = null;
          this.resetState();
          adapterDiag.info('Adapter stopped and cleaned up');
          resolve();
        });
      } else {
        this.resetState();
        adapterDiag.info('Adapter stopped and cleaned up');
        resolve();
      }
    });
  }
}

export const adapterService = new PCAdapterService();
