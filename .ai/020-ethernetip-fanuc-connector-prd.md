# PRD: EthernetIP Fanuc Connector — Web Dashboard

> **Wersja:** 1.0  
> **Data:** 2026-03-28  
> **Status:** Draft  
> **Powiązany dokument:** `010-ethernetip-fanuc-connector-mvp.md`

---

## 1. Problem Statement

Technik lub inżynier automatyki pracujący z robotem Fanuc na hali produkcyjnej nie ma prostego, przeglądarkowego narzędzia do nawiązania połączenia EthernetIP i podglądu/edycji danych I/O w czasie rzeczywistym — bez instalacji oprogramowania, bez konfiguracji PLC, działającego na laptopie w tej samej sieci co robot.

**Docelowe środowisko:** laptop Windows podłączony do routera, do którego wpięty jest robot Fanuc.

---

## 2. Target Users

**Inżynier / technik automatyki** podczas uruchomień lub diagnostyki:
- pracuje na laptopie lub tablecie
- potrzebuje szybkiego narzędzia do weryfikacji komunikacji EthernetIP z Fanuc
- nie chce instalować dodatkowego oprogramowania na maszynie

UI ma też służyć jako podstawa interfejsu z końcowym użytkownikiem aplikacji zrobotyzowanej.

---

## 3. Definicja Danych I/O — Model Słów (Words)

### 3.1 Format transmisji

Dane przesyłane są po **1 słowie = 16 bitów (2 bajty)** w obu kierunkach, w każdym trybie.

### 3.2 Mapowanie I/O na UI

| Tryb | Kierunek | Bity Fanuc | Nazwa w UI | Opis |
|------|----------|------------|------------|------|
| **Fanuc Scanner** | Wejście do PC (od robota) | DI 1–16 | `FANUC_SCAN_IN[1..16]` | Robot → PC |
| **Fanuc Scanner** | Wyjście z PC (do robota) | DO 1–16 | `FANUC_SCAN_OUT[1..16]` | PC → Robot |
| **Fanuc Adapter** | Wejście do PC (od robota) | DI 17–32 | `FANUC_ADPT_IN[17..32]` | Robot → PC |
| **Fanuc Adapter** | Wyjście z PC (do robota) | DO 17–32 | `FANUC_ADPT_OUT[17..32]` | PC → Robot |

Etykiety wierszy I/O zmieniają się automatycznie wraz ze zmianą trybu.

### 3.3 Reprezentacja w buforze

```typescript
// 1 word = 2 bajty = 16 bitów
type IOWord = {
  raw: Uint16Array;   // 1 element = 1 word = 16 bitów
  bits: boolean[];    // [0..15] — bit 0 = LSB
};

type ConnectionState = {
  mode: "scanner" | "adapter";
  status: ConnectionStatus;
  config: { ip: string; port: number } | null;
  errorMessage: string | null;
  inputWord: number;   // UINT16 — dane przychodzące z robota
  outputWord: number;  // UINT16 — dane wysyłane do robota
};
```

---

## 4. Tryb Działania — Scanner XOR Adapter

### 4.1 Decyzja

**Tylko jeden tryb może być aktywny w danej chwili.** Przełącznik trybu (`SCANNER` / `ADAPTER`) jest widoczny zawsze — w top barze aplikacji.

Reguły:
- Zmiana trybu gdy status = `connected` → automatyczny disconnect (Forward Close + zamknięcie TCP/UDP) → zmiana trybu
- Zmiana trybu gdy status = `connecting` → anulowanie próby połączenia → zmiana trybu
- Zmiana trybu gdy status = `disconnected` / `error` → natychmiastowa
- **Przycisk ROZŁĄCZ** jest zawsze widoczny gdy status ≠ `disconnected` — gwarantuje zwolnienie portów

### 4.2 Diagram architektury

```
Przeglądarka (UI)
    │
    │  WebSocket ws://localhost:3000/ws
    │  (payload: { mode: "scanner"|"adapter", status, input, output })
    │
    ▼
Backend Server (port 3000)
    ├── API Router
    │     ├── POST /api/connect    { mode, ip, port }
    │     ├── POST /api/disconnect
    │     └── POST /api/write      { word }
    │
    ├── ScannerService (aktywny gdy mode = "scanner")
    │     └── TCP→44818, UDP:2222
    │           Forward Open → I/O loop → Forward Close + socket.destroy()
    │
    └── AdapterService (aktywny gdy mode = "adapter")
          └── TCP listen:44818, UDP:2222
                Forward Open Reply → I/O loop → server.close() + socket.destroy()
```

### 4.3 Zarządzanie portami — wymagania bezwzględne

| Zdarzenie | Akcja backendu |
|-----------|----------------|
| `disconnect` (przycisk) | Forward Close → `tcpSocket.destroy()` → `udpSocket.close()` |
| Zmiana trybu gdy connected | Jak wyżej + zmiana `activeMode` |
| Błąd TCP/UDP | Cleanup socket + status = `error` + porty wolne |
| Timeout połączenia | Cleanup + status = `error` |
| Zamknięcie serwera (SIGTERM) | Cleanup wszystkich socketów |

---

## 5. Funkcjonalności MVP

### F1 — Przełącznik trybu (Mode Toggle)

- Przełącznik w top barze aplikacji: `[ SCANNER ●──────○ ADAPTER ]`
- Zmiana trybu gdy połączony → automatyczny disconnect przed zmianą
- Tryb zablokowany podczas łączenia (`connecting`) — przycisk toggle nieaktywny
- Stan trybu persystowany w URL params (opcjonalnie) lub w pamięci

### F2 — Formularz konfiguracji (wspólny)

| Pole | Typ | Domyślna wartość | Walidacja |
|------|-----|-----------------|-----------|
| Robot IP | `string` | `192.168.1.181` | valid IPv4 |
| Port | `number` | `44818` | 1–65535 |

Pola są **zablokowane gdy status ≠ `disconnected`** — nie można zmieniać IP w trakcie połączenia.

### F3 — Connect / Disconnect

- Przycisk `POŁĄCZ` → wywołuje `POST /api/connect` z aktywnym trybem
- Przycisk `ROZŁĄCZ` → wywołuje `POST /api/disconnect` → **gwarantuje zamknięcie TCP i UDP**
- `ROZŁĄCZ` widoczny zawsze gdy status ≠ `disconnected`
- Wskaźnik stanu z kolorowym badge: 🟢 Connected / 🟡 Connecting / 🔴 Error / ⚪ Disconnected
- Komunikat błędu czytelny w UI: `timeout`, `connection refused`, `wrong IP`
- **Reconnect: manualny** — użytkownik klika POŁĄCZ ponownie

### F4 — Podgląd danych I/O (16 bitów)

- Wyświetlenie 1 słowa wejściowego (16 bitów od robota)
- Wyświetlenie 1 słowa wyjściowego (16 bitów do robota)
- Odświeżanie co **100 ms** przez WebSocket push
- Widok: tabela 16 kolumn (Bit 15 → Bit 0) z wartością `0` / `1`
- Nagłówki kolumn: `B15` … `B0`
- Etykiety wierszy zmieniają się ze zmianą trybu (np. `FANUC_SCAN_IN[1..16]` vs `FANUC_ADPT_IN[17..32]`)

### F5 — Edycja wyjść (Output Word)

- Kliknięcie pojedynczego bitu w wierszu Output **toggleuje** jego wartość (0 → 1 lub 1 → 0)
- Zmiana natychmiast wysyłana do serwera przez `POST /api/write`
- Serwer aktualizuje bufor i wysyła słowo do robota przy najbliższym cyklu I/O
- Wizualne potwierdzenie: bit zmienia kolor po odebraniu przez serwer

---

## 6. User Flow

```
Otwórz http://localhost:3000
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  ◉ FANUC EtherNet/IP    [ SCANNER ●──────○ ADAPTER ]     │  ← Top bar
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  Tryb: FANUC SCANNER                   ⚪ DISCONNECTED   │
│                                                          │
│  Robot IP:  [192.168.1.10        ]                       │
│  Port:      [44818               ]                       │
│                                                          │
│  [ POŁĄCZ ]                                              │
└──────────────────────────────────────────────────────────┘
         │
         ▼ (po kliknięciu POŁĄCZ)
┌──────────────────────────────────────────────────────────┐
│  Tryb: FANUC SCANNER                   🟢 CONNECTED      │
│                                                          │
│  Robot IP:  [192.168.1.10  ] ← zablokowane              │
│  Port:      [44818         ] ← zablokowane              │
│                                                          │
│  [ ROZŁĄCZ ]  ← zawsze widoczny gdy nie disconnected     │
│                                                          │
│  FANUC_SCAN_IN [1..16]:                                  │
│  B15 B14 B13 B12 B11 B10 B9 B8 B7 B6 B5 B4 B3 B2 B1 B0 │
│   0   0   0   0   0   1  0  0  1  0  0  0  1  0  0  1   │
│                                                          │
│  FANUC_SCAN_OUT [1..16]:  ← klikalne                     │
│  B15 B14 ... B1 B0                                       │
│   0   0  ...  0  [1] ← toggle                           │
└──────────────────────────────────────────────────────────┘
         │
         ▼ (przełączenie toggle SCANNER → ADAPTER gdy connected)
         Auto-disconnect → zamknięcie portów → zmiana trybu → DISCONNECTED
```

---

## 7. API Specification

```
// Unified connection API
POST /api/connect    { mode: "scanner"|"adapter", ip: string, port: number }
POST /api/disconnect
POST /api/write      { word: number }  // 0–65535

// WebSocket broadcast payload
{
  mode: "scanner" | "adapter"
  status: "disconnected" | "connecting" | "connected" | "error"
  errorMessage?: string
  input: number    // raw 16-bit word (0–65535)
  output: number   // raw 16-bit word (0–65535)
  timestamp: number
}
```

---

## 8. Stan aplikacji (in-memory, brak bazy danych)

```typescript
type AppState = {
  activeMode: "scanner" | "adapter"
  status: ConnectionStatus           // wspólny dla aktywnego trybu
  config: { ip: string; port: number } | null
  errorMessage: string | null
  inputWord: number                  // UINT16 — dane z robota
  outputWord: number                 // UINT16 — dane do robota
}
```

Stan zeruje się przy restarcie serwera — bez persystencji w MVP.

**Niezmienniki stanu:**
- Tylko jeden tryb może być `connected` lub `connecting` w danej chwili
- `inputWord` / `outputWord` resetowane do `0` przy każdym disconnect
- `config` zachowywany po rozłączeniu — ułatwia ponowne połączenie

---

## 9. Wymagania niefunkcjonalne

| Wymaganie | Cel |
|-----------|-----|
| Czas do pierwszego połączenia | < 30 s od otwarcia strony |
| Latencja WebSocket → UI | < 200 ms end-to-end |
| Responsywność | działa na ekranie tabletu (min. 768px szerokości) |
| Obsługa dotykowa | przyciski i bity klikalne na touch |
| Środowisko | Windows 10/11, laptop, uruchamiany lokalnie |
| Brak instalacji po stronie klienta | tylko przeglądarka |
| Stabilność Scanner | sesja EthernetIP utrzymana > 5 min bez rozłączenia |

---

## 10. Poza zakresem MVP (backlog)

- Konfiguracja więcej niż 1 słowa (rozszerzenie do N bajtów)
- Logowanie historii danych
- Eksport CSV
- Autoryzacja użytkowników
- Mapowanie symboliczne (nazwy bitów zamiast indeksów)
- Alarmy i powiadomienia
- Auto-reconnect z backoff
- Deployment jako usługa systemowa
- Zaawansowane parametry CIP (RPI, Forward Open params)

---

## 11. Kryteria Akceptacji MVP

- [ ] Przełącznik trybu (Scanner/Adapter) zmienia tryb gdy disconnected
- [ ] Przełącznik trybu gdy connected → auto-disconnect → zmiana trybu → disconnected
- [ ] Scanner łączy się z Fanuc (robot jako Adapter) i wyświetla 16 bitów I/O w czasie rzeczywistym
- [ ] Adapter startuje i odbiera połączenie od Fanuc (robot jako Scanner) — 16 bitów I/O
- [ ] Toggle pojedynczego bitu w Output → robot widzi zmianę
- [ ] Przycisk ROZŁĄCZ zamyka TCP i UDP, zwalnia porty, status → disconnected
- [ ] Błąd połączenia (zły IP, timeout) wyświetlony czytelnie w UI
- [ ] Po błędzie: porty są wolne (można natychmiast ponownie kliknąć POŁĄCZ)
- [ ] Działa na tablecie (touch) w tej samej sieci co robot
- [ ] Zero instalacji po stronie klienta poza przeglądarką

---
