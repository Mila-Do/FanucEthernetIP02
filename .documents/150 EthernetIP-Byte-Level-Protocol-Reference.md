# 050 — EtherNet/IP: Byte-Level Protocol Reference (FANUC R-30iB)

> Dokument opisuje krok po kroku nawiązywanie połączenia EtherNet/IP
> i cykliczną wymianę danych I/O między PC a kontrolerem FANUC R-30iB.
>
> Struktura dokumentu odpowiada **chronologii komunikacji**: TCP → RegisterSession → Forward Open → UDP I/O.
>
> Wszystkie wartości wielobajtowe to **Little-Endian** (LE), chyba że zaznaczono inaczej.

---

## Dwa tryby pracy


| Tryb                    | Plik źródłowy    | Rola PC          | Rola FANUC       | Kto inicjuje połączenie |
| ----------------------- | ---------------- | ---------------- | ---------------- | ----------------------- |
| **A — PC jako Adapter** | `eip-adapter.js` | Adapter (serwer) | Scanner (klient) | FANUC                   |
| **B — PC jako Scanner** | `eip-scanner.js` | Scanner (klient) | Adapter (serwer) | PC                      |


W obu trybach warstwa protokołu jest identyczna — różni się tylko kto jest stroną inicjującą (Scanner) a kto odpowiadającą (Adapter).

---

## ⚠ Specyfiki FANUC — kluczowe odstępstwa od standardu CIP

Zanim przejdziemy do opisu protokołu, oto kompletna lista zachowań FANUC R-30iB, które **odbiegają od standardowej specyfikacji CIP** . Każde z nich jest szczegółowo opisane w odpowiedniej sekcji poniżej.

### 1. Kolejność Connection Points w ścieżce (Forward Open)

**Standard CIP** (Vol 1, §3-5.4.1.10): *consuming (O→T) first, producing (T→O) second.*

**FANUC**: wymaga odwrotnej kolejności — **producing (T→O) PIERWSZY, consuming (O→T) DRUGI**.

> **Dotyczy tylko Trybu B** (PC = Scanner), gdzie to PC buduje Forward Open.
> W Trybie A (FANUC = Scanner) to FANUC sam konstruuje ścieżkę — PC Adapter ją tylko parsuje.
> Obserwujemy jednak, że FANUC jako Scanner również stosuje tę samą konwencję (producing first),
> co potwierdza, że to konsekwentne zachowanie kontrolera w obu rolach.

Próba wysłania standardowej kolejności (102→152) daje **zawsze** błąd `0x0117` niezależnie od pozostałych parametrów. Poprawna kolejność (152→102) przechodzi walidację ścieżki.

### 2. Connection Size zawiera CIP Sequence Count

**Standard CIP**: Connection Size w Network Connection Parameters = rozmiar danych aplikacyjnych (bez warstwy transportowej).

**FANUC**: interpretuje Connection Size jako **łączny rozmiar Data Item (0x00B1) w pakiecie UDP**, czyli CIP Sequence Count (2B) + ewentualny Run/Idle Header (4B) + dane użytkownika.

Dla konfiguracji 1 word (2 bajty danych):


| Kierunek         | Składniki                             | Suma | Connection Size |
| ---------------- | ------------------------------------- | ---- | --------------- |
| O→T (z Run/Idle) | CIP seq (2) + Run/Idle (4) + dane (2) | 8 B  | **8**           |
| T→O (Modeless)   | CIP seq (2) + dane (2)                | 4 B  | **4**           |


### 3. Run/Idle Header w O→T, Modeless w T→O

O→T (Scanner → Adapter) zawsze zawiera 4-bajtowy **Run/Idle Header** po CIP Sequence Count.

T→O (Adapter → Scanner) jest **Modeless** — bezpośrednio po CIP Sequence Count idą dane, bez żadnego nagłówka.

### 4. Transport Class / Trigger

Musi być `**0x01`** — Client + Cyclic + Class 1. Każda inna wartość (np. `0x40`) powoduje `0x0108`.

### 5. Oba kierunki Point-to-Point

O→T i T→O muszą mieć typ połączenia **Point-to-Point** (bity 14–13 = `10`). Multicast (bity 14–13 = `01`) na T→O daje `0x0108`.

---

## Krok 1 — Połączenie TCP

Scanner nawiązuje połączenie TCP z Adapterem na porcie **44818** (standardowy port EtherNet/IP).


| Tryb             | Kto łączy        | Cel                              |
| ---------------- | ---------------- | -------------------------------- |
| A (PC = Adapter) | FANUC → PC:44818 | PC nasłuchuje na porcie 44818    |
| B (PC = Scanner) | PC → FANUC:44818 | FANUC nasłuchuje na porcie 44818 |


---

## Krok 1.5 — ListServices (TCP, cmd `0x0004`) ⚠ Wymagane w Trybie A

> **Odkrycie empiryczne** — brakujący element nieudokumentowany w typowych implementacjach.

### Problem

FANUC R-30iB jako Scanner **przed** wysłaniem `RegisterSession` wysyła `ListServices` (cmd `0x0004`).
Jest to standardowe EtherNet/IP discovery — Scanner sprawdza, czy docelowe urządzenie jest
prawidłowym węzłem EIP i jakie usługi obsługuje.

Jeśli Adapter **nie odpowie** na `ListServices`, FANUC natychmiast rozłącza TCP i **nigdy nie wysyła
`RegisterSession`**. Efekt widoczny w logach:

```
TCP rx: cmd=0x0004 — ignored
FANUC TCP disconnected
```

### Żądanie (Scanner → Adapter): 24 B

Sam nagłówek enkapsulacji, payload length = 0.

```
Offset  Hex    Pole
──────  ─────  ──────────────────────────────
 0– 1   04 00  Command = 0x0004 (ListServices)
 2– 3   00 00  Length = 0
 4–23   00 …   Session=0, Status=0, Context=?, Options=0
```

### Odpowiedź (Adapter → Scanner)

Encapsulation header (24B) + payload 26B = **50 B łącznie**.

```
Offset  Hex          Pole
──────  ───────────  ──────────────────────────────────────────
 0– 1   04 00        Command = 0x0004
 2– 3   1A 00        Length = 26
 4– 7   00 00 00 00  Session Handle = 0
 8–11   00 00 00 00  Status = 0
12–19   (echo)       Sender Context — skopiowany z żądania
20–23   00 00 00 00  Options = 0
────── Payload (26 B) ─────────────────────────────────────────
24–25   01 00        Item Count = 1
26–27   00 01        TypeId = 0x0100 (Communications)
28–29   14 00        Length = 20
30–31   01 00        Protocol Version = 1
32–33   20 01        Capability Flags = 0x0120
34–49   43 6F 6D …   Service Name = "Communications\0\0" (16B, null-padded)
```

### Capability Flags (16 bit)

| Bit | Wartość | Znaczenie                                 |
| --- | ------- | ----------------------------------------- |
| 5   | `0x0020` | Obsługuje CIP transport Class 0/1 (UDP)  |
| 8   | `0x0100` | Obsługuje UCMM (Class 3, TCP)            |

Dla PC Adapter obsługującego implicit I/O i Forward Open: **`0x0120`** (oba bity).

### Kolejność kroków — Tryb A (pełna sekwencja)

```
FANUC → PC   TCP connect (port 44818)
FANUC → PC   ListServices (0x0004)       ← WYMAGANE, często pomijane w dokumentacji
PC    → FANUC ListServices reply
FANUC → PC   RegisterSession (0x0065)
PC    → FANUC RegisterSession reply (Session Handle)
FANUC → PC   Forward Open (0x006F / CIP 0x54)
PC    → FANUC Forward Open Reply (Connection IDs + Sockaddr Info 0x8000)
             ← od tej chwili: cykliczna wymiana UDP co RPI
```

---

## Krok 2 — RegisterSession (TCP)

Pierwszy pakiet po nawiązaniu TCP. Scanner prosi o sesję, Adapter przydziela Session Handle.

### Nagłówek EtherNet/IP Encapsulation (24 B)

Każdy pakiet TCP zaczyna się od tego samego nagłówka:


| Offset | Rozmiar | Pole           | Opis                                           |
| ------ | ------- | -------------- | ---------------------------------------------- |
| 0      | 2       | Command        | `0x0065` RegisterSession, `0x006F` SendRRData  |
| 2      | 2       | Length         | Długość payloadu (bajty po offsecie 23)        |
| 4      | 4       | Session Handle | 0 w żądaniu, nadany przez Adapter w odpowiedzi |
| 8      | 4       | Status         | 0 = OK                                         |
| 12     | 8       | Sender Context | Kopiowany z żądania do odpowiedzi              |
| 20     | 4       | Options        | 0                                              |


### Żądanie (Scanner → Adapter): 28 B

```
Offset  Hex          Pole
──────  ───────────  ──────────────────────
 0– 1   65 00        Command = 0x0065 (RegisterSession)
 2– 3   04 00        Length = 4
 4–23   00 … 00      Session=0, Status=0, Context=0, Options=0
24–25   01 00        Protocol Version = 1
26–27   00 00        Option Flags = 0
```

### Odpowiedź (Adapter → Scanner): 28 B

Identyczna struktura. Adapter wpisuje przydzielony **Session Handle** w bajtach [4..7].

---

## Krok 3 — Forward Open (TCP, CIP Service 0x54)

Najważniejszy krok — ustanawia połączenie implicit I/O (Class 1). Wysyłany wewnątrz SendRRData (cmd `0x006F`) jako wiadomość UCMM (typ `0x00B2`).

### 3.1 Opakowanie CPF (Common Packet Format)

```
[interfaceHandle 4B = 0] [timeout 2B = 0] [itemCount 2B = 2]
  Item 0: typeId=0x0000 (Null Addr)  len=0
  Item 1: typeId=0x00B2 (UCMM)      len=N  → dane CIP poniżej
```

### 3.2 CIP Message Router Request (6 B)


| Offset | Wartość | Pole                                        |
| ------ | ------- | ------------------------------------------- |
| 0      | `0x54`  | Service = Forward Open                      |
| 1      | `0x02`  | Request Path Size = 2 words                 |
| 2–3    | `20 06` | Class segment: Connection Manager (class 6) |
| 4–5    | `24 01` | Instance segment: Instance 1                |


### 3.3 Forward Open Service Data (36 B + ścieżka)


| Offset | Rozmiar | Pole                                  | Wartość / Uwagi                    |
| ------ | ------- | ------------------------------------- | ---------------------------------- |
| 0      | 1       | Priority / Time Tick                  | `0x07`                             |
| 1      | 1       | Timeout Ticks                         | `0xE8`                             |
| 2–5    | 4       | O→T Network Connection ID             | Proponowany przez Scanner (losowy) |
| 6–9    | 4       | T→O Network Connection ID             | Proponowany przez Scanner (losowy) |
| 10–11  | 2       | Connection Serial Number              | Losowy                             |
| 12–13  | 2       | Originator Vendor ID                  | `0x0001`                           |
| 14–17  | 4       | Originator Serial Number              | Losowy                             |
| 18     | 1       | Connection Timeout Multiplier         | `0x00` (×4)                        |
| 19–21  | 3       | Reserved                              | `00 00 00`                         |
| 22–25  | 4       | O→T RPI (µs)                          | np. `50C30000` = 50 000 µs = 50 ms |
| 26–27  | 2       | **O→T Network Connection Parameters** | patrz §3.4                         |
| 28–31  | 4       | T→O RPI (µs)                          | np. `50C30000` = 50 000 µs         |
| 32–33  | 2       | **T→O Network Connection Parameters** | patrz §3.4                         |
| 34     | 1       | **Transport Class / Trigger**         | patrz §3.5                         |
| 35     | 1       | Connection Path Size (words)          | `0x04` = 4 words = 8 bajtów        |
| 36+    | 8       | **Connection Path**                   | patrz §3.6                         |


### 3.4 Network Connection Parameters (16 bit)

```
Bit 15       Owner        0 = Exclusive
Bits 14–13   Conn Type    10 = Point-to-Point    ← FANUC wymaga P2P w obu kierunkach
Bit 12       Reserved     0
Bits 11–10   Priority     00 = Low
Bit 9        Size Type    0 = Fixed              ← FANUC wymaga Fixed
Bits 8–0     Size         ROZMIAR W BAJTACH      ← FANUC: łącznie z CIP Sequence Count!
```

**Wartości dla konfiguracji 1 word (Slot 2):**


| Parametr | Hex      | Binarnie              | Opis                                |
| -------- | -------- | --------------------- | ----------------------------------- |
| O→T      | `0x4008` | `0100 0000 0000 1000` | Exclusive, P2P, Fixed, **8 bajtów** |
| T→O      | `0x4004` | `0100 0000 0000 0100` | Exclusive, P2P, Fixed, **4 bajty**  |


> **Dlaczego 8 i 4 a nie 6 i 2?** Ponieważ FANUC wlicza 2-bajtowy CIP Sequence Count
> do Connection Size. Standard CIP tego nie robi. To odkrycie zostało potwierdzone
> empirycznie — każda inna kombinacja rozmiarów dawała błąd `0x0109`.

Tabela przetestowanych kombinacji:


| OT    | TO    | Path        | Wynik FANUC                                 |
| ----- | ----- | ----------- | ------------------------------------------- |
| 2     | 2     | 152→102     | `0x0109` Invalid connection size            |
| 4     | 4     | 152→102     | `0x0109` Invalid connection size            |
| 6     | 2     | 152→102     | `0x0109` Invalid connection size            |
| **8** | **4** | **152→102** | **SUCCESS**                                 |
| *     | *     | 102→152     | `0x0117` — zawsze, niezależnie od rozmiarów |


### 3.5 Transport Class / Trigger (1 bajt)

```
Bit 7       Direction    0 = Client (Scanner)    1 = Server (Adapter)
Bits 6–4    Trigger      000 = Cyclic
Bits 3–0    Class        0001 = Class 1
```

Wymagana wartość: `**0x01**` = Client + Cyclic + Class 1.

FANUC odrzuca inne wartości (np. `0x40` → błąd `0x0108`).

### 3.6 Connection Path — kolejność segmentów

#### ⚠ FANUC: producing FIRST, consuming SECOND

To najważniejsze odstępstwo. Standard CIP mówi: *consuming first, producing second*.
FANUC wymaga dokładnie odwrotnej kolejności.

#### Tryb B — PC = Scanner → FANUC = Adapter (eip-scanner.js, Slot 2)

```
Bajty       Segment                  Opis
──────────  ───────────────────────  ──────────────────────────
20 04       Class segment            Assembly (class 0x04)
24 64       Instance segment         Config assembly 100 (0x64)
2C 98       Connection Point         152 (0x98) — producing (T→O)  ← PIERWSZY
2C 66       Connection Point         102 (0x66) — consuming (O→T)  ← DRUGI
```

Assembly instances FANUC Adapter — **zależne od slotu** (B-82854EN/02 Table 3.2.2(b)):


| Slot  | Config  | Input — O→T (adapter consumes) | Output — T→O (adapter produces) |
| ----- | ------- | ------------------------------ | ------------------------------- |
| 1     | 100     | 101                            | 151                             |
| **2** | **100** | **102**                        | **152**                         |


#### Tryb A — FANUC = Scanner → PC = Adapter (eip-adapter.js)

FANUC jako Scanner wysyła Forward Open z identyczną konwencją — producing first:

```
Bajty       Segment                  Opis
──────────  ───────────────────────  ──────────────────────────
20 04       Class segment            Assembly (class 0x04)
24 01       Instance segment         Config assembly 1 (0x01)
2C 96       Connection Point         150 (0x96) — producing (T→O)  ← PIERWSZY
2C 64       Connection Point         100 (0x64) — consuming (O→T)  ← DRUGI
```

Assembly instances PC Adapter:


| Assembly                   | Instancja | Rozmiar | Kierunek   |
| -------------------------- | --------- | ------- | ---------- |
| Config                     | 1         | 0 B     | —          |
| Input (T→O) — PC produces  | 100       | 2 B     | PC → FANUC |
| Output (O→T) — PC consumes | 150       | 2 B     | FANUC → PC |


PC Adapter w `parseConnPath()` zbiera Connection Points w kolejności `points[0]`, `points[1]`.
Ponieważ FANUC wysyła producing first, `points[0]` odpowiada T→O (OT z perspektywy scannera), a `points[1]` odpowiada O→T.

---

## Krok 4 — Forward Open Reply (TCP, Adapter → Scanner)

Odpowiedź CIP (service reply `0xD4` = `0x54 | 0x80`):


| Offset | Rozmiar | Pole                                         |
| ------ | ------- | -------------------------------------------- |
| 0      | 1       | Service Reply: `0xD4`                        |
| 1      | 1       | Reserved: `0x00`                             |
| 2      | 1       | General Status: `0x00` = sukces              |
| 3      | 1       | Ext Status Size: `0x00`                      |
| 4–7    | 4       | **O→T Connection ID** — nadany przez Adapter |
| 8–11   | 4       | **T→O Connection ID** — echo/nadany          |
| 12–13  | 2       | Connection Serial Number (echo)              |
| 14–15  | 2       | Originator Vendor ID (echo)                  |
| 16–19  | 4       | Originator Serial Number (echo)              |
| 20–23  | 4       | O→T Actual Packet Interval (µs)              |
| 24–27  | 4       | T→O Actual Packet Interval (µs)              |
| 28     | 1       | Application Reply Size (words): 0            |
| 29     | 1       | Reserved: 0                                  |


### Użycie Connection ID w dalszej komunikacji UDP

To kluczowe — pomylenie ID powoduje, że pakiety UDP są odrzucane bez żadnego komunikatu o błędzie:


| Pole z FO Reply               | W którym pakiecie UDP   | Kto wstawia | Kto weryfikuje |
| ----------------------------- | ----------------------- | ----------- | -------------- |
| **O→T Connection ID** [4..7]  | O→T (Scanner → Adapter) | Scanner     | Adapter        |
| **T→O Connection ID** [8..11] | T→O (Adapter → Scanner) | Adapter     | Scanner        |


W kodzie (eip-scanner.js):

```javascript
this.otConnId = d.readUInt32LE(0);  // O→T ConnID — PC wstawia w pakiety O→T
this.toConnId = d.readUInt32LE(4);  // T→O ConnID — FANUC wstawia w pakiety T→O, PC filtruje
```

### Sockaddr Info (opcjonalnie w CPF reply)

Odpowiedź FO Reply może zawierać dodatkowe elementy CPF:


| TypeId   | Nazwa             | Kiedy              | Zawartość                       |
| -------- | ----------------- | ------------------ | ------------------------------- |
| `0x8000` | O→T Sockaddr Info | O→T jest P2P       | IP:port Adaptera do odbioru O→T |
| `0x8001` | T→O Sockaddr Info | T→O jest Multicast | Adres multicastowy              |


W naszym przypadku (oba P2P) pojawia się `0x8000` z adresem UDP Adaptera.

---

## Krok 5 — Cykliczna wymiana danych UDP (Implicit I/O, Class 1)

Po udanym Forward Open oba urządzenia wymieniają pakiety UDP co RPI (np. 50 ms).

### 5.1 Wspólna struktura CPF każdego pakietu UDP

Każdy pakiet UDP I/O (w obie strony) ma identyczny nagłówek CPF (18 bajtów):


| Offset | Rozmiar | Pole                          | Wartość                             |
| ------ | ------- | ----------------------------- | ----------------------------------- |
| 0–1    | 2       | Item Count                    | `0x0002`                            |
| 2–3    | 2       | Sequenced Address Type        | `0x8002`                            |
| 4–5    | 2       | Address Item Length           | `0x0008` (8 B)                      |
| 6–9    | 4       | **Connection ID**             | Zależny od kierunku (patrz §Krok 4) |
| 10–13  | 4       | Encapsulation Sequence Number | Inkrementowany co pakiet (32-bit)   |
| 14–15  | 2       | Connected Data Type           | `0x00B1`                            |
| 16–17  | 2       | **Data Item Length**          | Długość danych po tym polu          |


### 5.2 O→T: Scanner → Adapter (z Run/Idle Header)

Pełny pakiet: **26 bajtów** (18B nagłówek CPF + 8B Data Item).

```
Offset  Hex (przykład)         Pole
──────  ─────────────────────  ──────────────────────────────────────────
 0– 1   02 00                  Item Count = 2
 2– 3   02 80                  Sequenced Address Type = 0x8002
 4– 5   08 00                  Address Length = 8
 6– 9   xx xx xx xx            O→T Connection ID (z FO Reply [4..7])
10–13   nn nn nn nn            Encap Sequence Number (++co RPI)
14–15   B1 00                  Connected Data Type = 0x00B1
16–17   08 00                  Data Item Length = 8
────── Data Item (8 bajtów) ──────────────────────────────────────────
18–19   cc cc                  CIP Sequence Count (16-bit, ++co pakiet)
20–23   01 00 00 00            Run/Idle Header: 0x00000001 = RUN
24–25   dd dd                  UINT16 LE — dane użytkownika (16 bitów)
```

**Run/Idle Header** — 4 bajty, UINT32 LE:


| Wartość      | Znaczenie | Efekt na adapterze                      |
| ------------ | --------- | --------------------------------------- |
| `0x00000001` | **Run**   | Adapter akceptuje dane, wyjścia aktywne |
| `0x00000000` | **Idle**  | Adapter zeruje swoje wyjścia            |


> Exclusive-Owner O→T **zawsze** zawiera Run/Idle Header. Jeśli go pominiemy,
> FANUC interpretuje pierwsze 4 bajty danych jako header i dane będą przesunięte.

### 5.3 T→O: Adapter → Scanner (Modeless, bez Run/Idle)

Pełny pakiet: **22 bajty** (18B nagłówek CPF + 4B Data Item).

```
Offset  Hex (przykład)         Pole
──────  ─────────────────────  ──────────────────────────────────────────
 0– 1   02 00                  Item Count = 2
 2– 3   02 80                  Sequenced Address Type = 0x8002
 4– 5   08 00                  Address Length = 8
 6– 9   xx xx xx xx            T→O Connection ID (z FO Reply [8..11])
10–13   nn nn nn nn            Encap Sequence Number
14–15   B1 00                  Connected Data Type = 0x00B1
16–17   04 00                  Data Item Length = 4
────── Data Item (4 bajty) ──────────────────────────────────────────
18–19   cc cc                  CIP Sequence Count (16-bit)
20–21   dd dd                  UINT16 LE — dane użytkownika (16 bitów)
```

> T→O jest **Modeless** — po CIP Sequence Count od razu idą dane.
> Nie ma Run/Idle Header.

### 5.4 Podsumowanie obu kierunków — jak odczytać dane


| Kierunek              | Pełny rozmiar pakietu | Data Item Length | Offset danych użytkownika               | Uwagi                   |
| --------------------- | --------------------- | ---------------- | --------------------------------------- | ----------------------- |
| O→T (Scanner→Adapter) | 26 B                  | 8 B              | bajt **24** (= 18 + 2 CIP + 4 Run/Idle) | Run/Idle Header obecny  |
| T→O (Adapter→Scanner) | 22 B                  | 4 B              | bajt **20** (= 18 + 2 CIP)              | Modeless, brak Run/Idle |


### 5.5 Budowanie pakietów w kodzie — Tryb B (PC = Scanner)

**Wysyłanie O→T** (eip-scanner.js → FANUC):

```javascript
const pkt = Buffer.alloc(26);                     // 18 CPF header + 8 Data Item
let p = 0;
pkt.writeUInt16LE(2,      p); p += 2;             // itemCount
pkt.writeUInt16LE(0x8002, p); p += 2;             // sequenced addr type
pkt.writeUInt16LE(8,      p); p += 2;             // addr item len
pkt.writeUInt32LE(this.otConnId, p); p += 4;      // O→T Connection ID
pkt.writeUInt32LE(this.seqNum,   p); p += 4;      // encap sequence number
pkt.writeUInt16LE(0x00b1, p); p += 2;             // connected data type
pkt.writeUInt16LE(8,      p); p += 2;             // Data Item Length = 8
pkt.writeUInt16LE(this.cipCount, p); p += 2;      // CIP Sequence Count
pkt.writeUInt32LE(0x00000001,    p); p += 4;      // Run/Idle = Run
this.txBuffer.copy(pkt, p);                       // 2 bajty danych (UINT16)
```

**Odbieranie T→O** (FANUC → eip-scanner.js):

```javascript
const connId = msg.readUInt32LE(6);
if (connId !== this.toConnId) return;              // filtruj po T→O ConnID
const dataWord = msg.readUInt16LE(20);             // dane zaczynają się na bajcie 20
```

### 5.6 Budowanie pakietów w kodzie — Tryb A (PC = Adapter)

**Odbieranie O→T** (FANUC Scanner → eip-adapter.js):

```javascript
const connId = msg.readUInt32LE(6);
if (connId !== this.conn.otConnId) return;         // filtruj po O→T ConnID
const payloadOff = 18 + 2 + 4;                    // = 24 (CPF + CIP seq + Run/Idle)
msg.copy(this.rxBuffer, 0, payloadOff, payloadOff + BYTES);  // 2 bajty danych
```

**Wysyłanie T→O** (eip-adapter.js → FANUC Scanner):

```javascript
const pkt = Buffer.alloc(18 + 2 + BYTES);         // 18 + 2 + 2 = 22
let p = 0;
pkt.writeUInt16LE(2,      p); p += 2;             // itemCount
pkt.writeUInt16LE(0x8002, p); p += 2;             // sequenced addr type
pkt.writeUInt16LE(8,      p); p += 2;             // addr item len
pkt.writeUInt32LE(this.conn.toConnId, p); p += 4; // T→O Connection ID
pkt.writeUInt32LE(this.conn.toSeqNum, p); p += 4; // encap sequence number
pkt.writeUInt16LE(0x00b1, p); p += 2;             // connected data type
pkt.writeUInt16LE(2 + BYTES, p); p += 2;          // Data Item Length = 4
pkt.writeUInt16LE(this.conn.cipCount, p); p += 2;  // CIP Sequence Count
this.txBuffer.copy(pkt, p);                       // 2 bajty danych (UINT16)
```

---

## Krok 6 — Mapowanie bitów: UINT16 ↔ sygnały DI/DO

Jedno słowo (2 bajty, UINT16 LE) przenosi 16 sygnałów cyfrowych. Bit 0 = LSB.

### Tryb B — Slot 2, sygnały DI[17]–DI[32] / DO[17]–DO[32]


| Bit | O→T (PC → FANUC) | T→O (FANUC → PC) |
| --- | ---------------- | ---------------- |
| 0   | DI[17]           | DO[17]           |
| 1   | DI[18]           | DO[18]           |
| …   | …                | …                |
| 15  | DI[32]           | DO[32]           |


Konwersja w kodzie (IO_OFF = 17, obiekt `{ "17": bool, "18": bool, ... }`):

```javascript
function objToWord(pcOut) {
  let word = 0;
  for (let i = 0; i < 16; i++) {
    if (pcOut[i + 17]) word |= (1 << i);
  }
  return word;
}

function wordToObj(word) {
  const out = {};
  for (let i = 0; i < 16; i++) {
    out[i + 17] = Boolean(word & (1 << i));
  }
  return out;
}
```

### Tryb A — Slot 1, sygnały DI[1]–DI[16] / DO[1]–DO[16]


| Bit | O→T (FANUC → PC) | T→O (PC → FANUC) |
| --- | ---------------- | ---------------- |
| 0   | DO[1]            | DI[1]            |
| 1   | DO[2]            | DI[2]            |
| …   | …                | …                |
| 15  | DO[16]           | DI[16]           |


Konwersja w kodzie (tablica booleanów, indeks 0-based):

```javascript
// Array[16] booleanów → UINT16
let w = 0;
for (let i = 0; i < 16; i++) if (pcOut[i]) w |= 1 << i;
txBuffer.writeUInt16LE(w >>> 0, 0);

// UINT16 → Array[16] booleanów
const w = rxBuffer.readUInt16LE(0);
const bits = [];
for (let i = 0; i < 16; i++) bits.push(!!((w >> i) & 1));
```

---

## Porównanie obu trybów


| Aspekt                   | Tryb A (PC = Adapter)               | Tryb B (PC = Scanner)            |
| ------------------------ | ----------------------------------- | -------------------------------- |
| TCP inicjator            | FANUC                               | PC                               |
| Forward Open wysyła      | FANUC                               | PC                               |
| Transport byte           | `0x01`                              | `0x01`                           |
| Connection Path          | FANUC wysyła: producing → consuming | PC wysyła: producing → consuming |
| Config Assembly          | 1 (0x01)                            | 100 (0x64)                       |
| Consuming Assembly (O→T) | 100 (0x64)                          | 102 (0x66)                       |
| Producing Assembly (T→O) | 150 (0x96)                          | 152 (0x98)                       |
| O→T Connection Size      | 8 (CIP 2 + Run/Idle 4 + dane 2)     | 8 (CIP 2 + Run/Idle 4 + dane 2)  |
| T→O Connection Size      | 4 (CIP 2 + dane 2)                  | 4 (CIP 2 + dane 2)               |
| O→T ma Run/Idle?         | Tak                                 | Tak                              |
| T→O ma Run/Idle?         | Nie (Modeless)                      | Nie (Modeless)                   |
| Port TCP                 | 44818 (PC nasłuchuje)               | 44818 (FANUC nasłuchuje)         |
| Port UDP                 | **2222**                            | **2222**                         |
| Sygnały DI/DO            | DI[1–16] / DO[1–16]                 | DI[17–32] / DO[17–32]            |
| HTTP bridge              | :3001                               | :3002                            |

### Uwaga: port UDP przy jednoczesnej pracy obu trybów

Oba tryby używają standardowego portu EtherNet/IP UDP **2222**. Jeśli oba skrypty mają działać
na tym samym PC jednocześnie (do tego samego robota, na różnych slotach), port UDP będzie
współdzielony — upewnij się, że implementacja pozwala na multipleksowanie (np. jeden socket UDP
nasłuchujący na 2222, demultipleksujący ruch po adresie źródłowym lub ID połączenia).

| Skrypt | Port UDP | Uwaga |
|--------|----------|-------|
| `eip-adapter.js` (Tryb A) | **2222** | Standardowy port EtherNet/IP — FANUC Scanner wyśle O→T na wskazany port w **Sockaddr Info (0x8000)** z Forward Open Reply |
| `eip-scanner.js` (Tryb B) | **2222** | FANUC Adapter domyślnie wysyła T→O na standardowy port 2222 |

---

## Najczęstsze błędy i rozwiązania


| Kod      | Nazwa                               | Przyczyna                                                 | Rozwiązanie                                                                                     |
| -------- | ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `0x0108` | Invalid connection type             | Zły Transport byte (np. `0x40`) lub Multicast zamiast P2P | Transport = `0x01`, oba kierunki P2P (bity 14–13 = `10`)                                        |
| `0x0109` | Invalid connection size             | Rozmiar bez CIP seq (np. 6/2 zamiast 8/4)                 | O→T = **8**, T→O = **4** (z CIP seq count!)                                                     |
| `0x0117` | Invalid application path            | Odwrócona kolejność Connection Points (102→152)           | Producing (T→O) **PRZED** consuming (O→T): 152→102                                              |
| —        | Brak danych T→O po połączeniu       | Connection ID zamienione w kodzie                         | O→T ConnID = FO Reply[4..7], T→O ConnID = FO Reply[8..11]                                       |
| —        | Sygnały resetują się do 0 po chwili | Periodic TX nadpisuje `txBuffer` zerami                   | UI musi aktualizować globalny stan (Node-RED `/api/write2`), nie pisać bezpośrednio do scannera |
| —        | Run/Idle = Idle (0x00000000)        | Scanner wysyła Idle zamiast Run                           | Upewnić się, że Run/Idle = `0x00000001` w każdym pakiecie O→T                                   |


