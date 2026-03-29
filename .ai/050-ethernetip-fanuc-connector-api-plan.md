# REST API Plan — EthernetIP Fanuc Connector

> Stack: Bun · Hono · Zod · native WebSocket  
> State: in-memory only, no database  
> Base URL: `http://localhost:3000`

---

## 1. Resources

| Resource | Maps to | Description |
|----------|---------|-------------|
| `scanner` | `AppState.scanner` | PC-as-Scanner connection to FANUC Adapter (TCP→44818, UDP:2222) |
| `adapter` | `AppState.adapter` | PC-as-Adapter listening for FANUC Scanner (TCP:44818, UDP:2223) |
| `state`   | `AppState`          | Full read-only snapshot of both resources |

---

## 2. Endpoints

### 2.1 State

#### `GET /api/state`

Returns the current in-memory snapshot of both scanner and adapter.

**Response 200**
```json
{
  "scanner": {
    "config": { "ip": "192.168.1.10", "port": 44818 },
    "status": "connected",
    "errorMessage": null,
    "inputWord": 1025,
    "outputWord": 3
  },
  "adapter": {
    "config": { "port": 44818 },
    "status": "disconnected",
    "errorMessage": null,
    "inputWord": 0,
    "outputWord": 0
  }
}
```

**Errors**

| Code | Reason |
|------|--------|
| 500  | Internal server error |

---

### 2.2 Scanner

#### `POST /api/scanner/connect`

Initiates EtherNet/IP Scanner session: TCP connect → RegisterSession → Forward Open → UDP I/O loop on port 2222.

**Request body**
```json
{
  "ip": "192.168.1.10",
  "port": 44818
}
```

| Field | Type   | Validation |
|-------|--------|------------|
| `ip`  | string | Valid IPv4 |
| `port`| number | 1–65535    |

**Response 200**
```json
{ "status": "connecting" }
```

**Errors**

| Code | Message |
|------|---------|
| 400  | `"Invalid IP address"` / `"Port must be 1–65535"` |
| 409  | `"Scanner already connected or connecting"` |

---

#### `POST /api/scanner/disconnect`

Sends Forward Close (if possible), closes TCP and UDP sockets, resets scanner state.

**Request body** — none

**Response 200**
```json
{ "status": "disconnected" }
```

**Errors**

| Code | Message |
|------|---------|
| 409  | `"Scanner is not connected"` |

---

#### `POST /api/scanner/write`

Updates the scanner's O→T output buffer (UINT16). The value is included in the next cyclic UDP I/O packet with Run/Idle = RUN.

**Request body**
```json
{ "word": 3 }
```

| Field  | Type   | Validation      |
|--------|--------|-----------------|
| `word` | number | integer, 0–65535 |

**Response 200**
```json
{ "outputWord": 3 }
```

**Errors**

| Code | Message |
|------|---------|
| 400  | `"word must be integer 0–65535"` |
| 409  | `"Scanner is not connected"` |

---

### 2.3 Adapter

#### `POST /api/adapter/start`

Starts TCP server on port 44818, waits for FANUC Scanner to connect and send Forward Open. UDP I/O runs on port 2223.

**Request body**
```json
{ "port": 44818 }
```

| Field  | Type   | Validation |
|--------|--------|------------|
| `port` | number | 1–65535    |

**Response 200**
```json
{ "status": "connecting" }
```

**Errors**

| Code | Message |
|------|---------|
| 400  | `"Port must be 1–65535"` |
| 409  | `"Adapter already running"` |

---

#### `POST /api/adapter/stop`

Closes TCP server and UDP socket, resets adapter state.

**Request body** — none

**Response 200**
```json
{ "status": "disconnected" }
```

**Errors**

| Code | Message |
|------|---------|
| 409  | `"Adapter is not running"` |

---

#### `POST /api/adapter/write`

Updates the adapter's T→O output buffer (UINT16). Sent to FANUC Scanner in the next cyclic UDP packet (Modeless, no Run/Idle header).

**Request body**
```json
{ "word": 7 }
```

| Field  | Type   | Validation       |
|--------|--------|------------------|
| `word` | number | integer, 0–65535 |

**Response 200**
```json
{ "outputWord": 7 }
```

**Errors**

| Code | Message |
|------|---------|
| 400  | `"word must be integer 0–65535"` |
| 409  | `"Adapter is not connected"` |

---

### 2.4 WebSocket

#### `GET /ws` — WebSocket upgrade

Broadcast every **100 ms** to all connected clients. One message per active mode.

**Payload**
```typescript
type WsPayload = {
  mode: "scanner" | "adapter"
  status: "disconnected" | "connecting" | "connected" | "error"
  errorMessage?: string
  input: number    // UINT16, 0–65535 — data received FROM robot
  output: number   // UINT16, 0–65535 — data sent TO robot
  timestamp: number
}
```

**Example**
```json
{
  "mode": "scanner",
  "status": "connected",
  "input": 1025,
  "output": 3,
  "timestamp": 1743200000000
}
```

WebSocket is one-way (server → client). All control commands use REST endpoints above.

---

## 3. Authentication and Authorization

**None in MVP.**

The application runs locally (`localhost:3000`) on a technician's laptop in the same LAN as the robot. No multi-user access, no sensitive data persistence. Authentication is explicitly deferred to backlog (PRD §10).

If the server is bound to `0.0.0.0` for tablet access, network-level isolation (dedicated LAN/VLAN) is the intended security boundary.

---

## 4. Validation and Business Logic

### Validation rules (Zod schemas)

```typescript
const ConnectScannerSchema = z.object({
  ip:   z.string().ip({ version: 'v4' }),
  port: z.number().int().min(1).max(65535)
})

const StartAdapterSchema = z.object({
  port: z.number().int().min(1).max(65535)
})

const WriteOutputSchema = z.object({
  word: z.number().int().min(0).max(65535)
})
```

### Business logic mapping

| PRD Feature | Endpoint | Backend behavior |
|-------------|----------|------------------|
| F3 Scanner connect | `POST /api/scanner/connect` | TCP→44818, RegisterSession, Forward Open (producing T→O first, O→T connection size=8, T→O size=4, transport=0x01), start UDP :2222 |
| F3 Scanner disconnect | `POST /api/scanner/disconnect` | Forward Close + TCP/UDP teardown |
| F5 Scanner write bit | `POST /api/scanner/write` | Update `txBuffer` UINT16; included in next 50 ms O→T UDP packet with Run/Idle=0x00000001 |
| F3 Adapter start | `POST /api/adapter/start` | TCP listen :44818, parse incoming Forward Open (producing-first path), respond with Forward Open Reply + Sockaddr Info (UDP :2223), start T→O UDP sender |
| F3 Adapter stop | `POST /api/adapter/stop` | TCP server close + UDP socket close |
| F5 Adapter write bit | `POST /api/adapter/write` | Update `txBuffer` UINT16; included in next T→O Modeless UDP packet (no Run/Idle header) |
| F4 I/O display | `GET /ws` | 100 ms broadcast of `inputWord` + `outputWord` for each active mode |
| F1 Status display | `GET /api/state` | Snapshot read — used on initial page load |

### State transition rules

- `scanner.connect` rejected if `status` is `"connecting"` or `"connected"` → HTTP 409
- `scanner.write` rejected if `status` is not `"connected"` → HTTP 409
- Same rules apply symmetrically to adapter
- On EtherNet/IP error (timeout, Forward Open rejection), status → `"error"`, `errorMessage` set, broadcast via WebSocket
- Reconnect is **manual only** (PRD §5 F3): user must call `connect` / `start` again
- Input/Output sizes are **fixed at 2 bytes (1 word)** in MVP (PRD §5 F2)
