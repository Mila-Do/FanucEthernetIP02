# MVP Specification: EthernetIP Fanuc Connector

---

## 1. Problem Summary

Brak prostego, gotowego interfejsu webowego który pozwala technikowi / inżynierowi nawiązać połączenie z robotem Fanuc przez EthernetIP z komputera lub tabletu — bez instalacji oprogramowania, bez konfiguracji PLC, w dwóch trybach: **Scanner** (PC jako master) lub **Adapter** (PC jako slave, robot jako master).

---

## 2. Target Users

Inżynierowie automatyki i technicy robotyki którzy pracują z laptopem lub tabletem w hali produkcyjnej
Ui ma też służyć ko podstawa interfejsu z końcowym użytkownikiem aplikacji zrobotyzowanej 

---

## 3. Core Value Proposition

Utworzenie i przetestowanie połączenia na fanuc oraz webApp (ustawienei adresów, slotow, konfiguracja robota) - wykonana tylko raz. Możliwość konfiguracji scanner i/lub adapter na raz. 
Następnie Jeden URL w przeglądarce → widzisz dane I/O. Zero instalacji, działa na każdym urządzeniu z przeglądarką w tej samej sieci co robot.

---

## 4. Essential Features (tylko 5)

| # | Feature | Opis |
|---|---------|------|
| 1 | **Wybór trybu** | Dwa przyciski na starcie: `Scanner` / `Adapter` |
| 2 | **Formularz konfiguracji** | IP robota, port (domyślnie 44818), rozmiar danych wejściowych/wyjściowych  |
| 3 | **Connect / Disconnect** | Jeden przycisk, jasny wskaźnik stanu (Connected / Disconnected / Error) |
| 4 | **Podgląd danych I/O** | Tabela bajtów (Input  / Output ) odświeżana co 100ms |
| 5 | **Edycja PC Output / Fanuc input ** | Kliknięcie bitu w tabeli  → zmiana wartości → wyślij do robota |

---

## 5. User Flow

```
Otwórz przeglądarkę → http://[adres-serwera]:3000
         │
         ▼
┌─────────────────────────┐
│  Wybierz tryb:          │
│  [ SCANNER ] i/ lub [ADAPTER] │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Konfiguracja połączenia  po obu stronach│
│  Robot IP:    [192.168.1.10      ]      │
│  Port:        [44818             ]      │
│  Input size:  [32  ] bajtów             │
│  Output size: [32  ] bajtów             │
│                                         │
│           [ POŁĄCZ ]                    │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  ● POŁĄCZONY  [ROZŁĄCZ]                 │
│                                         │
│  INPUT  (z robota)                      │
│  Byte 0: 0x00  Byte 1: 0xFF  ...        │
│                                         │
│  OUTPUT (do robota) ← edytowalne        │
│  Byte 0: [0x00] Byte 1: [0x01] ...      │
└─────────────────────────────────────────┘
```

**Tryb Adapter:** PC nasłuchuje, robot Scanner się łączy 

---

## 6. Data Requirements

**Brak persystencji w MVP** — wszystko in-memory.

| Dane | Gdzie | Typ |
|------|-------|-----|
| Parametry połączenia | Stan React (frontend) | `{ ip, port, inputSize, outputSize, mode }` |
| Stan połączenia | Serwer (in-memory) | `"disconnected" \| "connecting" \| "connected" \| "error"` |
| Bufor Input Assembly | Serwer (in-memory) | `Buffer` (max 512 bajtów) |
| Bufor Output Assembly | Serwer (in-memory) | `Buffer` (max 512 bajtów) |



---

## 8. Success Metrics

| Metryka | Cel MVP |
|---------|---------|
| Czas do pierwszego połączenia | < 30 sekund od otwarcia strony |
| Działa na tablecie (touch) | Tak — responsywny UI |
| Stabilność połączenia Scanner | Utrzymuje sesję EthernetIP przez > 5 min bez rozłączenia |
| Widoczność błędu | Komunikat błędu (timeout, wrong IP, refused) czytelny w UI |
| Zero instalacji po stronie klienta | Tylko przeglądarka |

---

## 9. Co NIE wchodzi do MVP (backlog)

- Logowanie historii danych
- Eksport CSV / PDF
- Autoryzacja użytkowników
- Mapowanie symboliczne tagów (nazwy zamiast bajtów)
- Alarmy / powiadomienia
- Konfiguracja zaawansowanych opcji CIP (RPI, forward open params)

---

