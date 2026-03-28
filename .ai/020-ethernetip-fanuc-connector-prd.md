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

### 3.3 Reprezentacja w buforze

```typescript
// 1 word = 2 bajty = 16 bitów
type IOWord = {
  raw: Uint16Array;   // 1 element = 1 word = 16 bitów
  bits: boolean[];    // [0..15] — bit 0 = LSB
};

type ConnectionState = {
  mode: "scanner" | "adapter";
  input: IOWord;    // dane przychodzące z robota
  output: IOWord;   // dane wysyłane do robota
};
```

---

## 4. Tryby Działania — Jednoczesny Scanner + Adapter

### 4.1 Decyzja

**Oba tryby mogą być aktywne jednocześnie** — na potrzeby testów i developmentu.

Każdy tryb to niezależna instancja:
- oddzielny stan połączenia
- oddzielne bufory I/O
- oddzielny kanał WebSocket (lub jeden broadcast z rozróżnieniem `mode` w payloadzie)

### 4.2 Diagram architektury

```
Przeglądarka (UI)
    │
    │  WebSocket ws://localhost:3000/ws
    │  (payload: { mode: "scanner"|"adapter", input: word, output: word })
    │
    ▼
Backend Server (port 3000)
    ├── API Router
    │     ├── scanner.connect(config)
    │     ├── scanner.disconnect()
    │     ├── scanner.writeOutput(word)
    │     ├── adapter.start(config)
    │     ├── adapter.stop()
    │     └── adapter.writeOutput(word)
    │
    ├── ScannerService
    │     └── połączenie TCP 44818 → Fanuc Adapter
    │           I/O UDP 2222 ↔ Fanuc
    │
    └── AdapterService
          └── nasłuch TCP 44818 ← Fanuc Scanner
                I/O UDP 2222 ↔ Fanuc
```

---

## 5. Funkcjonalności MVP

### F1 — Panel wyboru trybu

- Dwa niezależne panele: **Fanuc Scanner** i **Fanuc Adapter**
- Każdy panel można uruchomić osobno lub jednocześnie
- Stan wizualny każdego panelu: `DISCONNECTED` / `CONNECTING` / `CONNECTED` / `ERROR`

### F2 — Formularz konfiguracji (per tryb)

| Pole | Typ | Domyślna wartość | Walidacja |
|------|-----|-----------------|-----------|
| Robot IP | `string` | `192.168.1.10` | valid IPv4 |
| Port | `number` | `44818` | 1–65535 |
| Input size | `number` | `2` (1 word) | fixed na MVP |
| Output size | `number` | `2` (1 word) | fixed na MVP |

Pola Input/Output size są **zablokowane na 2 bajty (1 word)** w MVP — konfiguracja słów jest stała zgodnie z mapowaniem sekcji 4.

### F3 — Connect / Disconnect (per tryb)

- Przycisk `POŁĄCZ` → wywołuje `scanner.connect()` lub `adapter.start()`
- Wskaźnik stanu z kolorowym badge: 🟢 Connected / 🔴 Error / ⚪ Disconnected
- Komunikat błędu czytelny w UI: `timeout`, `connection refused`, `wrong IP`
- **Reconnect: manualny** — użytkownik klika POŁĄCZ ponownie

### F4 — Podgląd danych I/O (16 bitów per tryb)

- Wyświetlenie 1 słowa wejściowego (16 bitów od robota)
- Wyświetlenie 1 słowa wyjściowego (16 bitów do robota)
- Odświeżanie co **100 ms** przez WebSocket push
- Widok: tabela 16 kolumn (Bit 15 → Bit 0) z wartością `0` / `1`
- Nagłówki kolumn: `B15` … `B0`
- Etykiety wierszy zgodne z nazwami z sekcji 4.2 (np. `FANUC_SCAN_IN[1..16]`)

### F5 — Edycja wyjść (Output Word)

- Kliknięcie pojedynczego bitu w wierszu Output **toggleuje** jego wartość (0 → 1 lub 1 → 0)
- Zmiana natychmiast wysyłana do serwera przez `writeOutput(word)`
- Serwer aktualizuje bufor i wysyła słowo do robota przy najbliższym cyklu I/O
- Wizualne potwierdzenie: bit zmienia kolor po odebraniu przez serwer

---

## 6. User Flow

```
Otwórz http://localhost:3000
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Panel: FANUC SCANNER          Panel: FANUC ADAPTER │
│                                                     │
│  IP: [192.168.1.10]            IP: [192.168.1.10]  │
│  Port: [44818]                 Port: [44818]        │
│                                                     │
│  [ POŁĄCZ ]   ⚪ DISCONNECTED  [ START ]  ⚪ IDLE   │
└─────────────────────────────────────────────────────┘
         │
         ▼ (po kliknięciu POŁĄCZ w Scanner)
┌─────────────────────────────────────────────────────┐
│  🟢 SCANNER CONNECTED          ⚪ ADAPTER IDLE      │
│                                                     │
│  FANUC_SCAN_IN  [1..16]:                           │
│  B15 B14 B13 B12 B11 B10 B9 B8 B7 B6 B5 B4 B3 B2 B1 B0 │
│   0   0   0   0   0   1  0  0  1  0  0  0  1  0  0  1  │
│                                                     │
│  FANUC_SCAN_OUT [1..16]:  ← klikalne                │
│  B15 B14 ... B1 B0                                  │
│   0   0  ...  0  [1] ← toggle                       │
└─────────────────────────────────────────────────────┘
```

---

## 7. API Specification

```
// scanner
scanner.connect({ ip: string, port: number }) → { status: ConnectionStatus }
scanner.disconnect() → void
scanner.writeOutput({ word: number }) → void  // number 0–65535

// adapter
adapter.start({ port: number }) → { status: ConnectionStatus }
adapter.stop() → void
adapter.writeOutput({ word: number }) → void

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

```
AppState {
  scanner: {
    config: { ip, port } | null
    status: ConnectionStatus
    errorMessage: string | null
    inputWord: number    // 0–65535
    outputWord: number   // 0–65535
  }
  adapter: {
    config: { port } | null
    status: ConnectionStatus
    errorMessage: string | null
    inputWord: number
    outputWord: number
  }
}
```

Stan zeruje się przy restarcie serwera — bez persystencji w MVP.

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

- [ ] Scanner łączy się z Fanuc (robot jako Adapter) i wyświetla 16 bitów I/O w czasie rzeczywistym
- [ ] Adapter startuje i odbiera połączenie od Fanuc (robot jako Scanner) — 16 bitów I/O
- [ ] Oba tryby aktywne jednocześnie bez błędów
- [ ] Toggle pojedynczego bitu w Output → robot widzi zmianę
- [ ] Błąd połączenia (zły IP, timeout) wyświetlony czytelnie w UI
- [ ] Działa na tablecie (touch) w tej samej sieci co robot
- [ ] Zero instalacji po stronie klienta poza przeglądarką

---
