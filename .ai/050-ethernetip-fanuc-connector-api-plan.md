# REST API Plan — EthernetIP Fanuc Connector

> Stack: Bun · Hono · Zod · native WebSocket  
> State: in-memory only, no database  
> Base URL: `http://localhost:3000`

---

## 1. Resources

| Resource | Maps to | Description |
|----------|---------|-------------|
| `connection` | `AppState` | Aktywne połączenie EtherNet/IP — jeden tryb na raz (scanner XOR adapter) |
| `state`      | `AppState` | Full read-only snapshot stanu połączenia |

**Niezmiennik:** Tylko jeden tryb może być `connecting` lub `connected` w danej chwili. Próba `connect` gdy status ≠ `disconnected` zwraca HTTP 409.

---

## 2. Endpoints

### 2.1 State

#### `GET /api/state`

Returns the current in-memory snapshot of the active connection.

**Response 200**
```json
{
  "activeMode": "scanner",
  "status": "connected",
  "config": { "ip": "192.168.1.10", "port": 44818 },
  "errorMessage": null,
  "inputWord": 1025,
  "outputWord": 3
}
```

**Errors**

| Code | Reason |
|------|--------|
| 500  | Internal server error |

---

### 2.2 Connect

#### `POST /api/connect`

Initiates EtherNet/IP connection in the specified mode.

**Mode `scanner`:** TCP connect → RegisterSession → Forward Open → UDP I/O loop on port 2222.  
**Mode `adapter`:** TCP server listen:44818 → wait for FANUC Forward Open → UDP I/O loop on port 2222.

**Request body**
```json
{
  "mode": "scanner",
  "ip": "192.168.1.10",
  "port": 44818
}
```

| Field  | Type              | Validation          |
|--------|-------------------|---------------------|
| `mode` | `"scanner"\|"adapter"` | required         |
| `ip`   | string            | Valid IPv4 (required for scanner, optional for adapter) |
| `port` | number            | 1–65535             |

**Response 200**
```json
{ "status": "connecting" }
```

**Errors**

| Code | Message |
|------|---------|
| 400  | `"Invalid IP address"` / `"Port must be 1–65535"` / `"mode is required"` |
| 409  | `"Connection already active — disconnect first"` |

---

### 2.3 Disconnect

#### `POST /api/disconnect`

Closes the active connection and **releases all ports** (TCP + UDP).

**Sekwencja cleanup dla Scanner:**
1. Wyślij Forward Close (best-effort — ignoruje błąd jeśli TCP już zamknięte)
2. Zatrzymaj interwał I/O
3. `udpSocket.close()` → zwolnij port 2222
4. `tcpSocket.destroy()` → zwolnij port 44818
5. `AppState.status = "disconnected"`, reset `inputWord`/`outputWord` do 0

**Sekwencja cleanup dla Adapter:**
1. Zatrzymaj interwał I/O
2. `udpSocket.close()` → zwolnij port 2222
3. `clientSocket.destroy()` → zamknij połączenie klienta
4. `tcpServer.close()` → zwolnij port 44818
5. `AppState.status = "disconnected"`, reset `inputWord`/`outputWord` do 0

**Request body** — none

**Response 200**
```json
{ "status": "disconnected" }
```

**Errors**

| Code | Message |
|------|---------|
| 409  | `"No active connection"` |

> **Gwarancja:** Po otrzymaniu HTTP 200 porty są wolne. Frontend może natychmiast wywołać `POST /api/connect` ponownie bez błędu EADDRINUSE.

---

### 2.4 Write Output

#### `POST /api/write`

Updates the O→T output buffer (UINT16). The value is included in the next cyclic UDP I/O packet.

**Scanner mode:** wysyłany z `Run/Idle = 0x00000001` (RUN).  
**Adapter mode:** wysyłany jako Modeless (bez Run/Idle header).

**Request body**
```json
{ "word": 3 }
```

| Field  | Type   | Validation       |
|--------|--------|------------------|
| `word` | number | integer, 0–65535 |

**Response 200**
```json
{ "outputWord": 3 }
```

**Errors**

| Code | Message |
|------|---------|
| 400  | `"word must be integer 0–65535"` |
| 409  | `"Not connected"` |

---

### 2.5 WebSocket

#### `GET /ws` — WebSocket upgrade

Broadcast every **100 ms** to all connected clients.

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

The application runs locally (`localhost:3000`) on a technician's laptop in the same LAN as the robot. No multi-user access, no sensitive data persistence.

---

## 4. Validation and Business Logic

### Validation rules (Zod schemas)

```typescript
const ConnectSchema = z.object({
  mode: z.enum(['scanner', 'adapter']),
  ip:   z.string().ip({ version: 'v4' }).optional(),
  port: z.number().int().min(1).max(65535)
}).refine(
  data => data.mode === 'adapter' || data.ip != null,
  { message: 'ip is required for scanner mode' }
)

const WriteOutputSchema = z.object({
  word: z.number().int().min(0).max(65535)
})
```

### Business logic mapping

| PRD Feature | Endpoint | Backend behavior |
|-------------|----------|------------------|
| F1 Mode toggle | `POST /api/connect` (nowy tryb) | Jeśli aktywne połączenie: auto-disconnect → connect w nowym trybie |
| F3 Connect Scanner | `POST /api/connect` `{mode:"scanner"}` | TCP→44818, RegisterSession, Forward Open (producing T→O first, O→T connection size=8, T→O size=4), start UDP:2222 |
| F3 Connect Adapter | `POST /api/connect` `{mode:"adapter"}` | TCP listen:44818, parse Forward Open, reply + Sockaddr Info (UDP:2222), start T→O sender |
| F3 Disconnect | `POST /api/disconnect` | Forward Close (scanner) lub server.close() (adapter) + pełny cleanup TCP/UDP |
| F5 Write bit | `POST /api/write` | Update `outputWord` UINT16; included in next 50ms I/O packet |
| F4 I/O display | `GET /ws` | 100ms broadcast `inputWord` + `outputWord` |
| Initial load | `GET /api/state` | Snapshot read na starcie aplikacji |

### State transition rules

- `connect` rejected jeśli `status` is `"connecting"` lub `"connected"` → HTTP 409
- `write` rejected jeśli `status` is not `"connected"` → HTTP 409
- `disconnect` rejected jeśli `status` is `"disconnected"` → HTTP 409
- Na błąd EtherNet/IP (timeout, Forward Open rejection): cleanup portów → `status = "error"`, `errorMessage` set, broadcast via WebSocket
- **Reconnect jest manualny** (PRD §5 F3): użytkownik klika POŁĄCZ ponownie
- `inputWord` / `outputWord` resetowane do `0` przy każdym disconnect
- Input/Output sizes są **zablokowane na 2 bajty (1 word)** w MVP
