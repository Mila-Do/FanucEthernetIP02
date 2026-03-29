# Plan Implementacji: EthernetIP Fanuc Connector

> **Wersja:** 1.2  
> **Data:** 2026-03-29  
> **Status:** In Progress — Faza 3 ✅  
> **Powiązane dokumenty:** `010-mvp.md`, `020-prd.md`, `030-tech-stack.md`, `050-protocol-reference.md`

---

## Przegląd

**UI-first approach** — zaczynamy od działającego dashboardu z mockami, żeby mieć natychmiastowy feedback wizualny podczas implementacji protokołu. Prawdziwe serwisy EtherNet/IP będą testowane przez gotowy interfejs.

```
Faza 0: Szkielet projektu ✅ DONE (2026-03-29)
    │
    ├── Faza 1: Mock Backend + WebSocket ✅ DONE (2026-03-29)
    │                    │
    │                    ▼
    ├── Faza 2: Frontend UI + Store (z mockami) ✅ DONE (2026-03-29) ← dashboard gotowy!
    │                    │
    │                    ▼
    ├── Faza 3: ScannerService (prawdziwy protokół) ✅ DONE (2026-03-29)
    │                    │
    ├── Faza 4: AdapterService (prawdziwy protokół) ← UI gotowe do testów!
    │                    │
    ├── Faza 5: Integracja (zamiana mock → prawdziwe serwisy)
    │                    │
    └── Faza 6: Testy z robotem FANUC
```

---

## Faza 0 — Szkielet projektu ✅ DONE (2026-03-29)

**Cel:** Gotowe środowisko deweloperskie z działającymi skryptami `dev`, `build`, `start`.

> **Uwaga implementacyjna:** Zamiast monorepo Bun workspaces zastosowano **płaską strukturę** (`src/server/` + `src/client/` w jednym `package.json`). Powód: Bun v1.1.36 na Windows nie dodaje `node_modules/.bin` do PATH przy wykonywaniu skryptów przez workspace `--filter`, co powoduje `command not found` dla wszystkich binarek (vite, tsc, concurrently). Wzorzec obejścia: `bun run <bin>` lub `Bun.spawn` w pliku `dev.ts`.

### Kroki ✅

- ✅ Inicjalizacja: `ethernetip-fanuc/` — płaska struktura, jeden `package.json` z wszystkimi zależnościami
- ✅ Konfiguracja TypeScript 5.x — `tsconfig.json` w root (strict mode, `@shared/*` → `src/server/*`)
- ✅ Konfiguracja Biome — `biome.json`: linting + formatting
- ✅ `src/server/`: Hono + `@hono/zod-validator` + Zod, `index.ts` z `Bun.serve` na porcie 3000, `routes/scanner.ts`, `routes/adapter.ts`, `ws/broadcast.ts`, placeholdery `ScannerService.ts` + `AdapterService.ts`
- ✅ `src/client/`: Vite + React 18 + Tailwind CSS v3 + Zustand + Framer Motion + Lucide React; `index.html` w root
- ✅ Typy wspólne w `src/server/types.ts`: `ConnectionStatus`, `IOWord`, `WsPayload`, `AppState`, schematy Zod
- ✅ Skrypty: `dev` (via `dev.ts` + `Bun.spawn`), `build` (`bun run vite build`), `start` (`bun src/server/index.ts`)
- ✅ Weryfikacja: `bun run dev` → Vite :5173 + Hono :3000 działają, `GET /api/state` → `200 OK`, walidacja Zod działa

### Definicje kluczowych typów

```typescript
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

type WsPayload = {
  mode: 'scanner' | 'adapter'
  status: ConnectionStatus
  errorMessage?: string
  input: number   // UINT16, 0–65535
  output: number  // UINT16, 0–65535
  timestamp: number
}
```

---

## Faza 1 — Mock Backend + WebSocket broadcast ✅ DONE (2026-03-29)

**Cel:** Działający backend z mockowanymi danymi EtherNet/IP — pozwala natychmiast przetestować UI i przepływ danych.

### Kroki ✅

**1.1 AppState z mockowanymi danymi** ✅
```typescript
// packages/server/src/state.ts
const AppState = {
  scanner: { 
    config: null, 
    status: 'disconnected', 
    errorMessage: null, 
    inputWord: 0,     // będzie mockowany
    outputWord: 0     // kontrolowany przez UI
  },
  adapter: { /* analogicznie */ }
}
```

**1.2 Mock API endpoints (Hono)** ✅
```typescript
app.post('/api/scanner/connect', async (c) => {
  const config = c.req.valid('json')
  
  // Symulacja: losowy sukces/błąd
  if (config.ip === '192.168.1.999') {
    AppState.scanner.status = 'error'
    AppState.scanner.errorMessage = 'Connection timed out'
  } else {
    AppState.scanner.status = 'connecting'
    setTimeout(() => {
      AppState.scanner.status = 'connected'
      AppState.scanner.config = config
    }, 1500) // Symulacja opóźnienia połączenia
  }
  
  return c.json({ status: AppState.scanner.status })
})
```

**1.3 Mock data generator** ✅
```typescript
// Symulowane dane wejściowe (co 100ms inne wartości)
setInterval(() => {
  if (AppState.scanner.status === 'connected') {
    AppState.scanner.inputWord = Math.floor(Math.random() * 65536)
  }
  if (AppState.adapter.status === 'connected') {
    AppState.adapter.inputWord = Math.floor(Math.random() * 65536)
  }
}, 100)
```

**1.4 WebSocket broadcast** ✅
- Bun WebSocket upgrade na `/ws`
- Broadcast co 100ms: 2 payloady (scanner + adapter) z aktualnym AppState
- Format identyczny jak docelowy: `WsPayload`

**1.5 Testowanie różnych scenariuszy** ✅
- `192.0.2.99` → timeout error (po 5s) — IANA TEST-NET-1
- `192.0.2.98` → connection refused natychmiast — IANA TEST-NET-1
- Inne IP → sukces z losowymi danymi I/O

---

## Faza 2 — Frontend: UI + Store + WebSocket integration

**Cel:** Kompletny, działający dashboard z obu panelami (Scanner + Adapter) podłączony do mock backendu.

**Zależność:** Faza 1 (mock backend musi broadcastować dane).

### Kroki

**2.1 Zustand store** (`src/store/appStore.ts`)
```typescript
type AppStore = {
  scanner: ConnectionState
  adapter: ConnectionState
  wsStatus: 'connecting' | 'open' | 'closed'
  updateFromPayload: (p: WsPayload) => void
  setScannerOutput: (word: number) => void
  setAdapterOutput: (word: number) => void
}

// Funkcje helper do konwersji word ↔ bits
const wordToBits = (word: number): boolean[] => {
  return Array(16).fill(0).map((_, i) => Boolean(word & (1 << i)))
}

const toggleBit = (word: number, bitIndex: number): number => {
  return word ^ (1 << bitIndex)
}
```

**2.2 WebSocket hook** (`src/hooks/useEipWebSocket.ts`)
```typescript
// Auto-connect, auto-reconnect, parsing WsPayload
const useEipWebSocket = () => {
  const updateStore = useAppStore(state => state.updateFromPayload)
  
  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host}/ws`)
    ws.onmessage = (e) => {
      const payload: WsPayload = JSON.parse(e.data)
      updateStore(payload)
    }
    // reconnect logic, cleanup...
  }, [])
}
```

**2.3 Layout aplikacji** (`App.tsx`)
```typescript
// Dark industrial theme, responsive grid
<div className="min-h-screen bg-gray-900 p-4">
  <header className="mb-8">
    <h1>EtherNet/IP FANUC Connector</h1>
    <div className="flex items-center gap-2">
      WebSocket: <WsStatusIndicator />
    </div>
  </header>
  
  <div className="grid lg:grid-cols-2 gap-6">
    <ConnectionPanel mode="scanner" />
    <ConnectionPanel mode="adapter" />
  </div>
</div>
```

**2.4 ConnectionPanel component**
- Formularz konfiguracji: IP, Port (shadcn Input + Label)
- Status badge z animacjami (Framer Motion): 🟢🟡⚪🔴
- Przycisk POŁĄCZ/ROZŁĄCZ z ikonami Lucide
- Toast notifications (Sonner) dla błędów
- `IoWordView` component gdy status = 'connected'

**2.5 IoWordView + BitCell components**
```typescript
// 16-kolumnowa tabela bitów
const IoWordView = ({ inputWord, outputWord, onBitToggle }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-16 gap-1">
      {/* Nagłówki: B15...B0 */}
      {Array(16).fill(0).map((_, i) => 
        <div key={i} className="text-xs text-center">B{15-i}</div>
      )}
    </div>
    
    <div className="grid grid-cols-16 gap-1">
      {/* Input row - readonly badges */}
      {wordToBits(inputWord).reverse().map((bit, i) => 
        <Badge key={i} variant={bit ? 'default' : 'secondary'}>
          {bit ? '1' : '0'}
        </Badge>
      )}
    </div>
    
    <div className="grid grid-cols-16 gap-1">
      {/* Output row - clickable bits */}
      {wordToBits(outputWord).reverse().map((bit, i) => 
        <BitCell 
          key={i} 
          value={bit} 
          bitIndex={15-i} 
          onToggle={() => onBitToggle(15-i)} 
        />
      )}
    </div>
  </div>
)
```

**2.6 API integration**
```typescript
// src/api/eipApi.ts - fetch calls do mock endpoints
const connectScanner = async (config: {ip: string, port: number}) => {
  const response = await fetch('/api/scanner/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  })
  return response.json()
}
```

**Rezultat:** Kompletny UI działający z mockami — można testować wszystkie interakcje, animacje, responsive design.

---

## Faza 3 — ScannerService (prawdziwy protokół EtherNet/IP) ✅ DONE (2026-03-29)

**Cel:** PC inicjuje połączenie EtherNet/IP z robotem FANUC R-30iB — zastępuje mockowane dane prawdziwym protokołem w trybie Scanner.

**Zależność:** Faza 2 (gotowe UI do testowania) + Dokumentacja protokołu §050.

**Zaleta:** Każdy postęp w implementacji protokołu jest natychmiast widoczny w dashboardzie!

### Kroki

**3.1 TCP Connect + RegisterSession**
```typescript
// packages/server/src/services/ScannerService.ts
class ScannerService {
  private tcpSocket: net.Socket | null = null
  private udpSocket: dgram.Socket | null = null
  private sessionHandle: number = 0
  
  async connect(config: {ip: string, port: number}) {
    AppState.scanner.status = 'connecting' // ← UI natychmiast zobaczy
    
    this.tcpSocket = net.connect(config.port, config.ip)
    this.tcpSocket.on('connect', () => this.sendRegisterSession())
    this.tcpSocket.on('error', (err) => {
      AppState.scanner.status = 'error'
      AppState.scanner.errorMessage = err.message // ← Toast w UI
    })
  }
}
```

**3.2 Forward Open z FANUC deviations**
```typescript
private buildForwardOpen(): Buffer {
  const pkt = Buffer.alloc(70) // 24B encap + 6B CIP + 36B FO data + 4B path
  
  // Connection Path: producing FIRST (152), consuming SECOND (102)
  pkt.writeUInt16LE(0x0420, 58) // Class Assembly
  pkt.writeUInt16LE(0x6424, 60) // Config 100
  pkt.writeUInt16LE(0x982C, 62) // 152 producing (T→O) ← FANUC order!
  pkt.writeUInt16LE(0x662C, 64) // 102 consuming (O→T)
  
  // Connection Sizes: O→T=8, T→O=4 (z CIP seq count!)
  pkt.writeUInt16LE(0x4008, 50) // O→T: P2P, Fixed, 8 bytes
  pkt.writeUInt16LE(0x4004, 54) // T→O: P2P, Fixed, 4 bytes
  
  return pkt
}
```

**3.3 Cykliczny I/O przez UDP**
```typescript
private startPeriodicIO() {
  this.udpSocket = dgram.createSocket('udp4')
  this.udpSocket.bind(2222) // Port dla Scanner mode
  
  // Odbiornik T→O
  this.udpSocket.on('message', (msg) => {
    const connId = msg.readUInt32LE(6)
    if (connId !== this.toConnId) return
    
    const inputWord = msg.readUInt16LE(20) // Dane na bajcie 20
    AppState.scanner.inputWord = inputWord // ← UI natychmiast aktualizuje tabele bitów!
  })
  
  // Nadajnik O→T co 50ms
  setInterval(() => this.sendOutputPacket(), 50)
}
```

**3.4 Integracja z istniejącym API**
```typescript
// packages/server/src/routes/scanner.ts - zamiana mock na prawdziwy serwis
app.post('/api/scanner/connect', zValidator('json', ConnectSchema), async (c) => {
  const config = c.req.valid('json')
  
  try {
    await scannerService.connect(config) // ← prawdziwy TCP connect
    return c.json({ status: 'connecting' })
  } catch (error) {
    AppState.scanner.status = 'error'
    AppState.scanner.errorMessage = error.message
    return c.json({ status: 'error', error: error.message })
  }
})
```

**Rezultat:** Prawdziwy Forward Open testowany przez gotowy UI — błędy `0x0117`, `0x0109` widoczne jako toasty.

---

## Faza 4 — AdapterService (prawdziwy protokół EtherNet/IP)

**Cel:** PC nasłuchuje jako Adapter — FANUC Scanner inicjuje połączenie. Drugi tryb działający przez gotowy UI.

**Zależność:** Faza 3 (ScannerService działa) + UI gotowe do testowania drugiego panelu.

### Kroki

**4.1 TCP Server + RegisterSession**
```typescript
// packages/server/src/services/AdapterService.ts
class AdapterService {
  private tcpServer: net.Server | null = null
  private clientSocket: net.Socket | null = null
  private udpSocket: dgram.Socket | null = null
  
  async start() {
    AppState.adapter.status = 'connecting' // ← UI natychmiast zobaczy
    
    this.tcpServer = net.createServer()
    this.tcpServer.listen(44818, '0.0.0.0')
    
    this.tcpServer.on('connection', (socket) => {
      this.clientSocket = socket
      socket.on('data', (data) => this.handleTcpData(data))
    })
  }
  
  private handleRegisterSession(data: Buffer) {
    const sessionHandle = Math.floor(Math.random() * 0xFFFFFFFF)
    // Budowanie odpowiedzi RegisterSession...
  }
}
```

**4.2 Parsowanie Forward Open od FANUC**
```typescript
private parseForwardOpen(data: Buffer) {
  // FANUC wysyła: producing (T→O) FIRST, consuming (O→T) SECOND
  const connectionPath = this.parseConnectionPath(data)
  
  // points[0] = T→O (150/0x96), points[1] = O→T (100/0x64)
  this.toConnPoint = connectionPath.points[0] // 150
  this.otConnPoint = connectionPath.points[1] // 100
  
  // Przydziel Connection IDs
  this.otConnId = Math.floor(Math.random() * 0xFFFFFFFF)
  this.toConnId = Math.floor(Math.random() * 0xFFFFFFFF)
  
  this.sendForwardOpenReply()
}
```

**4.3 Forward Open Reply + Sockaddr Info**
```typescript
private sendForwardOpenReply() {
  const reply = Buffer.alloc(48) // 24B encap + 18B CIP reply + 6B sockaddr
  
  // CIP Reply (0xD4)...
  
  // Sockaddr Info (0x8000) - ogłoś port UDP 2223
  reply.writeUInt16LE(0x8000, 40) // O→T Sockaddr Info
  reply.writeUInt16LE(4, 42)      // Length = 4
  reply.writeUInt16LE(0x02, 44)   // AF_INET
  reply.writeUInt16LE(2223, 46)   // Port 2223 ← FANUC wyśle O→T tutaj
  
  this.clientSocket.write(reply)
  
  AppState.adapter.status = 'connected' // ← UI zobaczy zielony status
  this.startPeriodicIO()
}
```

**4.4 Cykliczny I/O przez UDP**
```typescript
private startPeriodicIO() {
  this.udpSocket = dgram.createSocket('udp4')
  this.udpSocket.bind(2223) // Port 2223 dla Adapter mode
  
  // Odbiornik O→T (FANUC → PC)
  this.udpSocket.on('message', (msg) => {
    const connId = msg.readUInt32LE(6)
    if (connId !== this.otConnId) return
    
    // Dane na bajcie 24 (CPF + CIP seq + Run/Idle 4B)
    const inputWord = msg.readUInt16LE(24)
    AppState.adapter.inputWord = inputWord // ← UI tabela bitów aktualizuje
  })
  
  // Nadajnik T→O co 50ms (Modeless - bez Run/Idle)
  setInterval(() => this.sendInputPacket(), 50)
}
```

**4.5 Równoległa praca Scanner + Adapter**
```typescript
// packages/server/src/routes/adapter.ts
app.post('/api/adapter/start', async (c) => {
  if (scannerService.isActive && adapterService.isActive) {
    // Oba mogą działać jednocześnie na różnych portach UDP
    console.log('Both Scanner (2222) and Adapter (2223) active')
  }
  
  await adapterService.start()
  return c.json({ status: 'connecting' })
})
```

**Rezultat:** Oba tryby działają przez jeden UI — można testować FANUC jako Scanner i Adapter jednocześnie.

---

## Faza 5 — Integracja i finalizacja

**Cel:** Zamiana wszystkich mocków na prawdziwe serwisy + build pipeline + deployment gotowość.

### Kroki

**5.1 Czyszczenie mock kodu**
```typescript
// Usunięcie mock data generator z Fazy 1
// Zastąpienie mockowanych API endpoints prawdziwymi calls do ScannerService/AdapterService

// packages/server/src/routes/scanner.ts
app.post('/api/scanner/connect', async (c) => {
  // Usuń: mockowe if (config.ip === '192.168.1.999')
  // Dodaj: await scannerService.connect(config)
})
```

**5.2 Konfiguracja production build**
```typescript
// vite.config.ts - finalna konfiguracja
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true }
    }
  },
  build: {
    outDir: '../server/dist', // Backend serwuje build z tego folderu
    emptyOutDir: true
  }
})
```

**5.3 Error handling i edge cases**
```typescript
// Graceful degradation przy braku połączenia WebSocket
const useEipWebSocket = () => {
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const maxReconnectAttempts = 5
  
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  const reconnectDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), 16000)
}

// Timeout dla TCP connections
class ScannerService {
  async connect(config, timeoutMs = 10000) {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out')), timeoutMs)
    )
    
    return Promise.race([
      this.doConnect(config),
      timeoutPromise
    ])
  }
}
```

**5.4 Logging i monitoring**
```typescript
// packages/server/src/logger.ts
const logger = {
  info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta),
  error: (msg: string, error?: Error) => console.error(`[ERROR] ${msg}`, error),
  protocol: (direction: '→'|'←', bytes: Buffer) => {
    console.log(`[EIP${direction}] ${bytes.toString('hex')}`)
  }
}

// Użycie w ScannerService
this.tcpSocket.on('data', (data) => {
  logger.protocol('←', data)
  this.handleTcpData(data)
})
```

**5.5 Final testing checklist**
- [ ] `bun run dev` → hot reload działa
- [ ] `bun run build` → brak błędów TypeScript + Vite
- [ ] `bun start` → jeden proces, serwuje SPA + API + WebSocket
- [ ] Oба panele wyświetlają się poprawnie
- [ ] Mock data zastąpione prawdziwymi serwisami
- [ ] Error toasts działają dla realnych błędów TCP
- [ ] WebSocket auto-reconnect po zerwaniu połączenia

---

## Faza 6 — Testy z robotem FANUC R-30iB

**Cel:** Weryfikacja wszystkich kryteriów akceptacji z PRD §11 na fizycznym sprzęcie.

**Przewaga nowego porządku:** UI jest gotowe od Fazy 2 — każdy błąd protokołu jest natychmiast widoczny w dashboardzie!

### Plan testów

| # | Test | Procedura | Kryterium akceptacji |
|---|------|-----------|----------------------|
| **T1** | Scanner connect | PC → FANUC (robot jako Adapter, Slot 2) | Status 🟢, DI[17-32]/DO[17-32] widoczne w tabeli |
| **T2** | Adapter start | FANUC → PC (robot jako Scanner, Slot 1) | Status 🟢, DI[1-16]/DO[1-16] widoczne w tabeli |
| **T3** | Dual mode | T1 + T2 jednocześnie | Oba panele 🟢, brak konfliktów portów UDP 2222/2223 |
| **T4** | Scanner bit toggle | Kliknij bit w OUTPUT scanner → robot | FANUC widzi zmianę DI[17-32] w tym samym cyklu |
| **T5** | Adapter bit toggle | Kliknij bit w OUTPUT adapter → robot | FANUC widzi zmianę DI[1-16] |
| **T6** | IP timeout | Connect do `192.168.1.999` | Toast: `Connection timed out` po maks. 10 s |
| **T7** | IP refused | Connect do nieistniejącego portu | Toast: `Connection refused` natychmiast |
| **T8** | Stability test | Połączenie przez 5 minut | Sesja utrzymana, brak rozłączeń, dane real-time |
| **T9** | Tablet UI | Testowanie na tablecie 768px+ | Touch: wszystkie bity klikalne, brak overflow |
| **T10** | Time to connect | Od otwarcia przeglądarki do 🟢 | < 30 s łącznie (load page + TCP + Forward Open) |

### Debugging przez UI (korzyści UI-first approach)

**Błędy Forward Open widoczne natychmiast:**
- `0x0117` Invalid application path → Toast: "Connection path error (check FANUC configuration)"
- `0x0109` Invalid connection size → Toast: "Data size mismatch (expected 8/4 bytes)"  
- `0x0108` Invalid connection type → Toast: "Transport protocol error"

**Monitoring pakietów UDP:**
- Brak T→O przez 5+ sekund → Toast: "No data from robot (check network)"
- CIP Sequence count nie inkrementuje → Toast: "Robot stopped sending"

**Connection ID mismatch:**
- Pakiety UDP odrzucane → Status pozostaje 🟡 CONNECTING mimo Forward Open sukces

### Procedura testowania protokołu

**Opcjonalnie przed robotem — Wireshark validation:**
```bash
# Przechwytywanie pakietów TCP
tcpdump -i eth0 port 44818 -w fanuc_tcp.pcap

# Weryfikacja Forward Open w hex
# Connection Path: 20 04 24 64 2C 98 2C 66 (152→102, producing first!)
# Connection Sizes: O→T=0x4008 (8 bytes), T→O=0x4004 (4 bytes)
```

**Konfiguracja FANUC R-30iB:**
- Slot 1: Scanner mode (dla testów Adapter PC)
- Slot 2: Adapter mode (dla testów Scanner PC)  
- IP Address: 192.168.1.10
- EtherNet/IP enabled, CIP connections allowed

---

## Faza 7 — Testy z robotem FANUC R-30iB

**Cel:** Weryfikacja wszystkich kryteriów akceptacji z PRD §11 na fizycznym sprzęcie.

### Plan testów

| # | Test | Kryterium akceptacji |
|---|------|----------------------|
| T1 | Scanner connect do FANUC (robot jako Adapter, Slot 2) | Status 🟢, DI[17-32]/DO[17-32] widoczne |
| T2 | Adapter — FANUC inicjuje połączenie (robot jako Scanner, Slot 1) | Status 🟢, DI[1-16]/DO[1-16] widoczne |
| T3 | Oba tryby jednocześnie | Dwa panele 🟢, brak konfliktów portów UDP 2222/2223 |
| T4 | Toggle bitu Output w trybie Scanner | Robot widzi zmianę DI na tym samym cyklu UDP |
| T5 | Toggle bitu Output w trybie Adapter | Robot widzi zmianę DI[1-16] |
| T6 | Błędny IP (timeout) | Komunikat `Connection timed out` po maks. 5 s |
| T7 | Zły IP (refused) | Komunikat `Connection refused` natychmiast |
| T8 | Stabilność 5 min | Sesja utrzymana, brak rozłączeń, dane aktualne |
| T9 | Tablet (768px, touch) | Wszystkie bity klikalne, brak overflow UI |
| T10 | Czas do pierwszego połączenia | < 30 s od otwarcia przeglądarki |

### Procedura testowania protokołu (opcjonalnie przed robotem)

Jeśli dostępny jest mock FANUC (skrypt Node.js / Bun odpowiadający na RegisterSession + Forward Open):
- Weryfikacja pakietów Forward Open przez `tcpdump` / Wireshark
- Sprawdzenie Connection Path w hex: `20 04 24 64 2C 98 2C 66`
- Sprawdzenie Connection Size: O→T = 8, T→O = 4

---

## Zależności między fazami

```
Faza 0 (szkielet)
    │
    └──► Faza 1 (Mock Backend + WS) ──► Faza 2 (Frontend UI gotowe!)
                                              │
                                              ├──► Faza 3 (ScannerService + UI testing)
                                              │             │
                                              ├──► Faza 4 (AdapterService + UI testing)
                                              │             │
                                              └──────────────┼──► Faza 5 (Integracja)
                                                            │           │
                                                            └───────────► Faza 6 (Testy z robotem)
```

**Kluczowa zmiana:** UI gotowe w Fazie 2 umożliwia testowanie protokołu (Fazy 3-4) z natychmiastowym feedback wizualnym.

---

## Kamienie milowe

| Milestone | Zakończone gdy... |
|-----------|-------------------|
| **M0** — Środowisko gotowe ✅ | `bun run dev` uruchamia Vite + Hono bez błędów |
| **M1** — Mock Backend działa ✅ | WebSocket broadcast z fake danymi, API endpoints odpowiadają |
| **M2** — UI funkcjonalne ✅ | Dashboard z dwoma panelami, toggle bitów, animacje, responsive design |
| **M3** — Scanner Protocol ✅ | `ScannerService.connect()` kończy Forward Open bez błędów CIP, widoczne w UI |
| **M4** — Adapter Protocol | `AdapterService.start()` odbiera Forward Open od FANUC, widoczne w UI |
| **M5** — Integracja finalna | Wszystkie mocki zastąpione, `bun start` → production build |
| **M6** — Testy akceptacyjne | Wszystkie 10 testów z Fazy 6 zaliczone na fizycznym FANUC R-30iB ✅ |

---

## Krytyczne ryzyka techniczne

| Ryzyko | Mitigacja |
|--------|-----------|
| FANUC odrzuca Forward Open (`0x0117`) | Bezwzględna weryfikacja kolejności Connection Path: `152→102` (T→O FIRST) |
| FANUC odrzuca rozmiary (`0x0109`) | O→T = **8**, T→O = **4** — z wliczonym CIP Sequence Count |
| Brak danych UDP po Forward Open | Weryfikacja Connection ID: `otConnId` = FO Reply[4..7], `toConnId` = FO Reply[8..11] |
| Konflikt portów UDP przy jednoczesnej pracy | Scanner na **2222**, Adapter na **2223** — nigdy odwrotnie |
| Run/Idle = Idle → robot zeruje wyjścia | Każdy pakiet O→T musi mieć `0x00000001` w bajtach [20..23] |

---
---

## Podsumowanie nowego planu — 6 faz (UI-first)

| Faza | Co | Czas szacowany | Kluczowe rezultaty |
|---|---|---|---|
| **0** ✅ | Szkielet monorepo, typy, tooling | 1 dzień | `bun run dev` działa |
| **1** ✅ | Mock Backend + WebSocket broadcast | 1 dzień | Fake dane EtherNet/IP |
| **2** ✅ | Frontend UI: panele, tabele bitów | 2 dni | **Dashboard gotowy!** |
| **3** | `ScannerService` — Forward Open | 3 dni | Prawdziwy protokół z UI feedback |
| **4** | `AdapterService` — TCP server | 2 dni | Oba tryby działają |
| **5** | Integracja, production build | 1 dzień | `bun start` ready |
| **6** | Testy na FANUC R-30iB | 1-2 dni | MVP zaakceptowany ✅ |


