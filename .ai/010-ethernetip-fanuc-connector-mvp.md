# MVP Specification: EthernetIP Fanuc Connector

---

## 1. Problem Summary

Brak prostego, gotowego interfejsu webowego który pozwala technikowi / inżynierowi nawiązać połączenie z robotem Fanuc przez EthernetIP z komputera lub tabletu — bez instalacji oprogramowania, bez konfiguracji PLC, w dwóch trybach: **Scanner** (PC jako master) lub **Adapter** (PC jako slave, robot jako master).

**Ograniczenie trybu:** Oba tryby nigdy nie działają jednocześnie — użytkownik wybiera jeden tryb przełącznikiem. Przed zmianą trybu połączenie jest rozłączane a porty zwalniane.

---

## 2. Target Users

Inżynierowie automatyki i technicy robotyki którzy pracują z laptopem lub tabletem w hali produkcyjnej
Ui ma też służyć ko podstawa interfejsu z końcowym użytkownikiem aplikacji zrobotyzowanej 

---

## 3. Core Value Proposition

Utworzenie i przetestowanie połączenia na fanuc oraz webApp (ustawienie adresów, slotów, konfiguracja robota) — wykonane tylko raz. Jeden URL w przeglądarce → widzisz dane I/O. Przełącznik trybu (Scanner / Adapter) pozwala testować oba scenariusze bez restartu aplikacji. Zero instalacji, działa na każdym urządzeniu z przeglądarką w tej samej sieci co robot.

---

## 4. Essential Features (tylko 5)

| # | Feature | Opis |
|---|---------|------|
| 1 | **Wybór trybu** | Przełącznik (toggle) z dwoma pozycjami: `SCANNER` / `ADAPTER` — nigdy jednocześnie |
| 2 | **Formularz konfiguracji** | IP robota, port (domyślnie 44818) — wspólne dla obu trybów |
| 3 | **Connect / Disconnect** | Przycisk POŁĄCZ uruchamia wybrany tryb; ROZŁĄCZ zawsze zwalnia porty TCP i UDP |
| 4 | **Podgląd danych I/O** | Tabela bitów (Input / Output) odświeżana co 100ms — wspólna dla obu trybów |
| 5 | **Edycja PC Output / Fanuc input** | Kliknięcie bitu w tabeli Output → toggleuje wartość → wysyła do robota |

---

## 5. User Flow

```
Otwórz przeglądarkę → http://[adres-serwera]:3000
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Wybierz tryb:  [ SCANNER ●──────○ ADAPTER ]        │
│                  (przełącznik — tylko jeden aktywny) │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Tryb: SCANNER                                      │
│  Robot IP:    [192.168.1.10      ]                  │
│  Port:        [44818             ]                  │
│                                                     │
│           [ POŁĄCZ ]                                │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  ● POŁĄCZONY  [ ROZŁĄCZ ]  ← zwalnia porty TCP/UDP  │
│                                                     │
│  INPUT  (z robota do PC)                            │
│  B15 B14 … B1 B0                                    │
│   0   0  …  1  1                                    │
│                                                     │
│  OUTPUT (z PC do robota) ← edytowalne               │
│  B15 B14 … B1 B0                                    │
│   0   0  … [0] [1] ← toggle bitu                   │
└─────────────────────────────────────────────────────┘
```

**Zmiana trybu w trakcie połączenia:** Próba przełączenia trybu gdy status = `connected` → automatyczny disconnect (Forward Close + zamknięcie portów), następnie zmiana trybu.

**Tryb Adapter:** PC nasłuchuje, robot Scanner się łączy.

---

## 6. Data Requirements

**Brak persystencji w MVP** — wszystko in-memory.

| Dane | Gdzie | Typ |
|------|-------|-----|
| Aktywny tryb | Serwer (in-memory) | `"scanner" \| "adapter"` |
| Parametry połączenia | Stan React (frontend) | `{ ip, port, mode }` |
| Stan połączenia | Serwer (in-memory) | `"disconnected" \| "connecting" \| "connected" \| "error"` |
| Bufor Input Assembly | Serwer (in-memory) | `number` (UINT16, 0–65535) |
| Bufor Output Assembly | Serwer (in-memory) | `number` (UINT16, 0–65535) |



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

