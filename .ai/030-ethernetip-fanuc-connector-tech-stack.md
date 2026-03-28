# Tech Stack: EthernetIP Fanuc Connector

> **Wersja:** 1.0  
> **Data:** 2026-03-28  
> **Status:** Approved  
> **Powiązane dokumenty:** `010-ethernetip-fanuc-connector-mvp.md`, `020-ethernetip-fanuc-connector-prd.md`

---

## Założenia projektowe


| Pytanie                    | Decyzja                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Istniejący kod EtherNet/IP | Brak — implementacja od zera                                                                             |
| Uruchomienie               | `bun start` — jeden terminal, zero instalatorów                                                          |
| Architektura               | Backend + Frontend w jednym monorepo, jeden proces Bun                                                   |
| Przyszłość                 | Frontend może zostać przeniesiony na tablet (przeglądarka mobilna łączy się z backendem po LAN lub wifi) |
| Skalowalność               | Lokalne narzędzie diagnostyczne / proste HMI — brak potrzeby chmury ani multi-user                       |


---

## Architektura całościowa

```
┌─────────────────────────────────────────────────────────────┐
│  Laptop (Windows 10/11)                                     │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Bun Process — port 3000                              │  │
│  │                                                       │  │
│  │  Hono HTTP Router                                     │  │
│  │    POST /api/scanner/connect                          │  │
│  │    POST /api/scanner/disconnect                       │  │
│  │    POST /api/scanner/write                            │  │
│  │    POST /api/adapter/start                            │  │
│  │    POST /api/adapter/stop                             │  │
│  │    POST /api/adapter/write                            │  │
│  │    GET  /api/state                                    │  │
│  │    GET  /ws  ← Bun WebSocket upgrade                  │  │
│  │    GET  /*   ← serwuje React SPA (dist/)              │  │
│  │                                                       │  │
│  │  ScannerService                                       │  │
│  │    TCP net.Socket  → FANUC:44818                      │  │
│  │    UDP dgram.Socket ← port 2222                       │  │
│  │                                                       │  │
│  │  AdapterService                                       │  │
│  │    TCP net.Server  ← port 44818                       │  │
│  │    UDP dgram.Socket ← port 2223                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│              WebSocket ws://localhost:3000/ws                │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │  React SPA (Vite build, serwowany z dist/)            │  │
│  │  Działa w przeglądarce na tym samym PC lub tablecie   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │ TCP :44818 / UDP :2222 / :2223
                           ▼
                   Robot FANUC R-30iB
```

---

## Technology Stack

### Backend

#### Runtime: **Bun**

- Natywna obsługa TypeScript bez konfiguracji (brak `ts-node`, `tsc --watch`)
- Wbudowany WebSocket server — brak dodatkowej biblioteki `ws`
- Szybki start procesu, niskie zużycie pamięci
- Kompatybilny z Node.js API: `net` (TCP) + `dgram` (UDP) — wymagane do implementacji EtherNet/IP
- Jeden plik wykonywalny — `bun compile` może stworzyć standalone `.exe` w przyszłości

```bash
bun run dev    # dev: hot reload backend + vite dev server
bun run build  # build: tsc check + vite build → dist/
bun start      # prod: jeden proces serwuje API + statyczne pliki React
```

#### HTTP Framework: **Hono**

- Minimalistyczny framework (< 15 kB), TypeScript-first, zero zależności zewnętrznych
- Natywna obsługa Bun (dedykowany adapter `hono/bun`)
- Czytelny routing REST bez boilerplate
- Walidacja parametrów przez Zod middleware

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

const app = new Hono()

app.post('/api/scanner/connect',
  zValidator('json', ConnectSchema),
  async (c) => {
    const config = c.req.valid('json')
    await scannerService.connect(config)
    return c.json({ status: 'connecting' })
  }
)
```

**Alternatywa odrzucona: Express** — starszy API, brak natywnego TypeScript, wolniejszy na Bun.  
**Alternatywa odrzucona: Next.js API Routes** — model request/response nie obsługuje długożyciowych gniazd TCP/UDP; wymaga `custom server`, co niweluje zalety frameworka.

#### WebSocket: **Bun built-in WebSocket**

Bun ma wbudowany, wydajny WebSocket server. Broadcast do wszystkich podłączonych klientów co 100 ms:

```typescript
Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (req.url.endsWith('/ws')) {
      server.upgrade(req)
      return
    }
    return app.fetch(req)  // Hono obsługuje resztę
  },
  websocket: {
    message(ws, msg) { /* komendy z UI */ },
    open(ws) { clients.add(ws) },
    close(ws) { clients.delete(ws) }
  }
})
```

#### Protokół EtherNet/IP: **Node.js `net` + `dgram` (built-in)**

Brak zewnętrznych bibliotek do EtherNet/IP — pełna implementacja od zera na podstawie `050 EthernetIP-Byte-Level-Protocol-Reference.md`. Uzasadnienie:

- Dostępne biblioteki npm (np. `ethernet-ip`, `node-red-contrib-cip`) nie obsługują FANUC-specyficznych odchyleń od standardu CIP (odwrócona kolejność Connection Points, wliczanie CIP Sequence Count do Connection Size)
- Wymagana pełna kontrola nad budowaniem pakietów `Buffer` — szczególnie krytyczne sekcje:
  - Forward Open z kolejnością `producing (T→O) FIRST` (§3.6 dokumentu)
  - O→T Connection Size = **8** (nie 6) — CIP seq 2B + Run/Idle 4B + dane 2B
  - T→O Connection Size = **4** (nie 2) — CIP seq 2B + dane 2B
  - Run/Idle Header = `0x00000001` w każdym pakiecie O→T
- Dwa niezależne serwisy (`ScannerService`, `AdapterService`) działające jednocześnie na różnych portach UDP (2222 / 2223)

#### Walidacja: **Zod**

- Walidacja parametrów API (`ip`, `port`, rozmiary)
- Typy inferowane bezpośrednio ze schematów (jeden source of truth)
- Integracja z Hono przez `@hono/zod-validator`

#### Język: **TypeScript 5.x**

- Typy zdefiniowane w PRD (§3.2, §8) bezpośrednio przekładają się na kod:

```typescript
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

type IOWord = {
  raw: number       // UINT16, 0–65535
  bits: boolean[]   // [0..15], bit 0 = LSB
}

type WsPayload = {
  mode: 'scanner' | 'adapter'
  status: ConnectionStatus
  errorMessage?: string
  input: number
  output: number
  timestamp: number
}
```

---

### Frontend

#### Framework: **Vite + React 18**

- Vite: błyskawiczny dev server (HMR < 50 ms), buduje statyczne pliki do `dist/`
- React 18: komponentowy UI, hooks dla stanu lokalnego
- Po `bun run build` folder `dist/` jest serwowany przez Hono jako statyczne pliki
- Tablet/mobilna przeglądarka łączy się do `http://[IP_LAPTOPA]:3000` — bez zmian w kodzie

**Alternatywa odrzucona: Next.js 14** — SSR/RSC nie są potrzebne (wszystkie dane pochodzą z WebSocket); komplikuje architekturę przez konieczność obsługi `custom server` dla TCP/UDP; wolniejsze cold start.

#### Stan aplikacji: **Zustand**

- Globalny store dla stanu połączenia, I/O wordów i konfiguracji
- Zero boilerplate względem Redux
- Bezpośrednia integracja z WebSocket: jeden `useEffect` subskrybuje WS i aktualizuje store

```typescript
type AppStore = {
  scanner: ConnectionState
  adapter: ConnectionState
  wsStatus: 'connecting' | 'open' | 'closed'
  setScannerState: (s: Partial<ConnectionState>) => void
  setAdapterState: (s: Partial<ConnectionState>) => void
}
```

#### Stylowanie: **Tailwind CSS v3**

- Responsywny grid (tablet 768px+, laptop 1024px+)
- Touch-friendly tap targets (min. 44×44 px na elementach bitów)
- Dark industrial theme — paleta zdefiniowana jako CSS variables w `tailwind.config.ts`
- Szczegóły wizualne: dokument `035-ethernetip-fanuc-connector-ui-design.md`

#### Komponenty UI: **shadcn/ui**

- Zbudowany na Radix UI (dostępność, keyboard nav) + Tailwind CSS
- Komponenty **żyją w repo** (`src/components/ui/`) — pełna kontrola nad wyglądem
- Używane elementy: `Card`, `Button`, `Badge`, `Input`, `Label`, `Separator`, `Tooltip`, `Sonner` (toasty błędów)
- Zero vendor lock-in — kopiujemy tylko to, czego potrzebujemy

```bash
bunx shadcn@latest init
bunx shadcn@latest add card button badge input label separator tooltip sonner
```

#### Animacje: **Framer Motion**

- Płynne przejścia stanu połączenia (`DISCONNECTED → CONNECTING → CONNECTED`)
- Pulsujący wskaźnik aktywnego połączenia (animate pulse na Badge)
- Micro-animacja togla bitu (scale 0.9 → 1.0 przy kliknięciu)
- Shake effect na panelu przy błędzie połączenia
- Staggered reveal komponentów przy pierwszym renderze

```typescript
// przykład: animowany badge stanu
<motion.div
  animate={{ scale: status === 'connected' ? [1, 1.05, 1] : 1 }}
  transition={{ repeat: Infinity, duration: 2 }}
>
  <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
</motion.div>
```

#### Ikony: **Lucide React**

- Included w shadcn/ui — zero dodatkowej instalacji
- Używane: `Wifi`, `WifiOff`, `AlertCircle`, `Radio`, `Antenna`, `ToggleLeft`, `ToggleRight`, `RefreshCw`

#### HTTP Client: **Fetch API (natywny)**

- Wywołania REST do backendu: `POST /api/scanner/connect` itp.
- Brak potrzeby axios/react-query — prosta komunikacja request/response dla 6 endpoints

#### WebSocket Client: **natywny `WebSocket` API przeglądarki**

```typescript
// hook useEipWebSocket.ts
const ws = new WebSocket(`ws://${location.host}/ws`)
ws.onmessage = (e) => {
  const payload: WsPayload = JSON.parse(e.data)
  store.getState().updateFromPayload(payload)
}
```

---

### Tooling i DevOps

#### Menedżer pakietów i runtime: **Bun workspaces**

Struktura monorepo:

```
ethernetip-fanuc/
├── package.json          # root workspace
├── packages/
│   ├── server/           # Bun backend
│   │   ├── src/
│   │   │   ├── index.ts           # Bun.serve entry point
│   │   │   ├── services/
│   │   │   │   ├── ScannerService.ts
│   │   │   │   └── AdapterService.ts
│   │   │   ├── routes/
│   │   │   │   ├── scanner.ts
│   │   │   │   └── adapter.ts
│   │   │   ├── ws/
│   │   │   │   └── broadcast.ts
│   │   │   └── types.ts
│   │   └── package.json
│   └── client/           # Vite React SPA
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ConnectionPanel.tsx   # Scanner lub Adapter
│       │   │   ├── IoWordView.tsx        # 16-bitowa tabela
│       │   │   └── BitCell.tsx           # pojedynczy klikalny bit
│       │   ├── store/
│       │   │   └── appStore.ts
│       │   └── hooks/
│       │       └── useEipWebSocket.ts
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
└── bun.lockb
```

Root `package.json` scripts:

```json
{
  "scripts": {
    "dev": "bun run --filter packages/client dev & bun run --filter packages/server dev",
    "build": "bun run --filter packages/client build",
    "start": "bun run --filter packages/server start"
  }
}
```

#### Linting / Formatting


| Narzędzie | Rola                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| **Biome** | Linting + formatting w jednym narzędziu, szybszy od ESLint+Prettier, natywna obsługa Bun |


**Alternatywa odrzucona: ESLint + Prettier** — dwa narzędzia, wolniejsze, wymaga konfiguracji `eslint.config.mjs` + `.prettierrc`.

#### Współdzielone typy

Pakiet `packages/shared` (lub `packages/server/src/types.ts` reeksportowany) zawiera:

- `WsPayload`
- `ConnectionStatus`
- `IOWord`
- Schematy Zod (`ConnectSchema`, `WriteOutputSchema`)

Importowane przez klienta przez path alias `@shared/types`.

---

## Mapa technologii → wymagania


| Wymaganie (PRD)                            | Technologia                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Zero instalacji po stronie klienta         | React SPA serwowany przez Hono z `dist/`                                         |
| Latencja WebSocket < 200 ms                | Bun WebSocket + 100 ms interval broadcast                                        |
| Dwa tryby jednocześnie (Scanner + Adapter) | Dwa niezależne serwisy, rozdzielone UDP 2222/2223                                |
| FANUC CIP deviations (§050)                | Ręczna implementacja `Buffer`, brak bibliotek EtherNet/IP                        |
| Tablet touch (768px+)                      | Tailwind responsive grid, tap targets ≥ 44px                                     |
| Brak bazy danych                           | Stan in-memory w Zustand (frontend) + zmienne serwisu (backend)                  |
| TypeScript end-to-end                      | Bun + Hono + React + Zod, wspólne typy w monorepo                                |
| Proste uruchomienie                        | `bun start` — jeden terminal, jeden port (3000)                                  |
| Tablet jako oddzielne urządzenie           | Hono serwuje `0.0.0.0:3000`; frontend używa `window.location.host` jako adres WS |


---

## Decyzje odrzucone (ADR)


| Opcja                          | Powód odrzucenia                                                                |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Next.js 14                     | Custom server wymagany dla TCP/UDP; SSR niepotrzebny; skomplikowany deploy      |
| Express                        | Starszy, wolniejszy, gorszy TypeScript DX niż Hono                              |
| Socket.IO                      | Overhead dla tak prostego przypadku; Bun native WS wystarczy                    |
| tRPC                           | Overkill dla 6 prostych endpoint'ów; utrudnia dostęp z curl podczas debugowania |
| Biblioteka `ethernet-ip` (npm) | Nie obsługuje FANUC-specyficznych odchyleń od CIP; brak kontroli nad Buffer     |
| Electron                       | Zbyt ciężki; przeglądarka jest wystarczającym "hostem"                          |
| SQLite / Prisma                | Brak potrzeby persystencji w MVP i planowanym zakresie                          |


---

## Wersje pakietów (docelowe)

```json
{
  "server": {
    "hono": "^4.x",
    "@hono/zod-validator": "^0.x",
    "zod": "^3.x"
  },
  "client": {
    "react": "^18.x",
    "react-dom": "^18.x",
    "zustand": "^4.x",
    "tailwindcss": "^3.x",
    "vite": "^5.x",
    "@vitejs/plugin-react": "^4.x",
    "framer-motion": "^11.x",
    "lucide-react": "^0.x",
    "class-variance-authority": "^0.x",
    "clsx": "^2.x",
    "tailwind-merge": "^2.x",
    "@radix-ui/react-tooltip": "^1.x",
    "@radix-ui/react-separator": "^1.x",
    "sonner": "^1.x"
  },
  "root": {
    "biome": "^1.x",
    "typescript": "^5.x"
  }
}
```

---

## Następne kroki

1. `030` → ten dokument (tech stack) ✅
2. `035` → UI Design Guidelines: paleta, komponenty, animacje ✅
3. `040` → Szkielet projektu: `bun create` + struktura folderów + konfiguracja Biome/TypeScript
4. `050` → Implementacja `ScannerService` (TCP + UDP, Forward Open, cykliczny I/O)
5. `060` → Implementacja `AdapterService` (nasłuch TCP:44818, UDP:2223)
6. `070` → REST API + WebSocket broadcast
7. `080` → React UI: `ConnectionPanel`, `IoWordView`, `BitCell`
8. `090` → Testy integracyjne z robotem FANUC R-30iB

