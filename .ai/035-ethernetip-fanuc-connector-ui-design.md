# UI Design Guidelines: EthernetIP Fanuc Connector

> **Wersja:** 1.0  
> **Data:** 2026-03-28  
> **Status:** Draft  
> **Powiązany dokument:** `030-ethernetip-fanuc-connector-tech-stack.md`

---

## Koncepcja wizualna

**"Steel Interface"** — interfejs inspirowany stalą i elektroniką przemysłową.  
Ciemne tło jak ekran oscyloskopu, świecące akcenty jak wskaźniki LED na panelu sterowniczym.  
Paleta oparta wyłącznie na odcieniach **niebiesko-stalowych**, **szmaragdowych**, **bursztynowych** i **czerwonych** — wszystkie harmonijnie powiązane przez wspólne nasycenie i luminancję.

Cel: technik otwiera stronę na tablecie w hali i **natychmiast widzi**, co się dzieje — bez szukania, bez rozpraszania.

---

## Paleta kolorów

### Zasada budowania palety

Wszystkie kolory wywodzą się z **jednej rodziny chłodnych niebiesko-stalowych** odcieni tła, do których dodawane są **monochromatyczne kolory stanu** (zieleń, bursztyn, czerwień). Każda z tych rodzin zmienia się **płynnie w odcieniach** — od ciemnego do jasnego — bez przeskakiwania do innych barw.

### Tło — rodzina Steel Blue

```
--bg-base:       #070d14   ← prawie czarny, lekki odcień granatu
--bg-surface:    #0d1b2a   ← powierzchnia kart i paneli
--bg-elevated:   #132639   ← elementy wyniesione (hover, aktywne)
--bg-border:     #1e3a52   ← obramowania, separatory
--bg-subtle:     #243d54   ← subtelne tło inputów, tooltipów
```

Gradient tła strony: `linear-gradient(160deg, #070d14 0%, #0a1628 100%)`

### Tekst — rodzina Steel White/Blue

```
--text-primary:  #e8f4fd   ← główny tekst (prawie biały z odcieniem błękitu)
--text-secondary:#93c5e0   ← nagłówki sekcji, etykiety
--text-muted:    #4a7a9b   ← nieaktywne, pomocnicze
--text-disabled: #2a4a60   ← niedostępne elementy
```

### Stan: CONNECTED — rodzina Emerald

```
--connected-dim:    #064e3b   ← tło badge'a
--connected-mid:    #059669   ← border, ikona
--connected-bright: #10b981   ← główny kolor badge'a
--connected-glow:   #34d399   ← świecące podkreślenie, pulsacja
```

### Stan: CONNECTING — rodzina Amber

```
--connecting-dim:    #451a03   ← tło badge'a
--connecting-mid:    #b45309   ← border, ikona
--connecting-bright: #f59e0b   ← główny kolor badge'a
--connecting-glow:   #fbbf24   ← animowany spinner
```

### Stan: ERROR — rodzina Red

```
--error-dim:    #450a0a   ← tło badge'a
--error-mid:    #b91c1c   ← border, ikona
--error-bright: #ef4444   ← główny kolor badge'a
--error-glow:   #f87171   ← shake effect border
```

### Stan: DISCONNECTED — rodzina Steel (z palety tła)

```
--idle-dim:    #0d1b2a   ← tło badge'a (= --bg-surface)
--idle-mid:    #1e3a52   ← border (= --bg-border)
--idle-bright: #4a7a9b   ← tekst badge'a (= --text-muted)
```

### Bit OUTPUT aktywny (1) — rodzina Sky Blue

```
--bit-on-bg:     #0c2d4a   ← tło komórki
--bit-on-border: #0369a1   ← obramowanie komórki
--bit-on-text:   #38bdf8   ← cyfra "1" (jasny sky)
--bit-on-glow:   #7dd3fc   ← bardzo jasny — hover/focus ring
```

### Bit OUTPUT nieaktywny (0) i INPUT

```
--bit-off-bg:     #0d1b2a   ← = --bg-surface
--bit-off-border: #1e3a52   ← = --bg-border
--bit-off-text:   #2a4a60   ← cyfra "0" (ledwo widoczna)

--bit-input-on:   #0f4c2a   ← tło bitu INPUT gdy =1 (emerald ciemny)
--bit-input-text: #6ee7b7   ← cyfra "1" dla INPUT (emerald jasny)
```

---

## Konfiguracja Tailwind

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        steel: {
          950: '#070d14',
          900: '#0d1b2a',
          800: '#132639',
          700: '#1e3a52',
          600: '#243d54',
          400: '#4a7a9b',
          300: '#93c5e0',
          100: '#e8f4fd',
        },
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'app-gradient': 'linear-gradient(160deg, #070d14 0%, #0a1628 100%)',
      },
      boxShadow: {
        'panel': '0 4px 24px 0 rgba(7,13,20,0.7), 0 1px 0 0 rgba(30,58,82,0.5)',
        'bit-on': '0 0 8px 1px rgba(56,189,248,0.3)',
        'connected': '0 0 12px 2px rgba(52,211,153,0.2)',
        'error': '0 0 12px 2px rgba(248,113,113,0.25)',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow': 'spin 1.5s linear infinite',
      },
    },
  },
  plugins: [],
}

export default config
```

---

## Typografia

### Fonty

| Rola | Font | Źródło |
|------|------|--------|
| Interfejs (przyciski, etykiety, tekst) | **Inter Variable** | Google Fonts |
| Wartości numeryczne, adresy IP, dane I/O | **JetBrains Mono** | Google Fonts |

Uzasadnienie: Inter jest czytelny na ekranach dotykowych przy małych rozmiarach. JetBrains Mono jest wyraźnie odróżnialny od Sans — technik od razu wie, że patrzy na dane, nie na UI.

### Skala typograficzna

```
Tytuł aplikacji:     text-xl    font-semibold   tracking-wide    text-steel-100
Nagłówek panelu:     text-sm    font-medium     tracking-wider   text-steel-300   uppercase
Etykieta pola:       text-xs    font-medium     tracking-wide    text-steel-400
Wartości I/O:        text-sm    font-mono       tabular-nums     text-steel-100
Komunikat błędu:     text-xs    font-mono                        text-red-400
Status badge:        text-xs    font-semibold   tracking-widest  uppercase
```

---

## Układ strony

### Desktop (≥ 1024px)

```
┌──────────────────────────────────────────────────────────────┐
│  ◉ FANUC EtherNet/IP      [ SCANNER ●──────○ ADAPTER ]       │  ← Top bar (h-14)
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Panel: FANUC SCANNER (lub ADAPTER — zależy od toggle)      │  ← Jeden panel, pełna szerokość
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  Config Form (IP, Port)     ● Status Badge           │   │
│   │                                                      │   │
│   │  [ POŁĄCZ ]   lub   [ ROZŁĄCZ ]                      │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│   INPUT  (z robota do PC)                                    │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  IoWordView (readonly)                               │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│   OUTPUT (z PC do robota)                                    │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  IoWordView (editable)                               │   │
│   └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Tablet (768px – 1023px)

Identyczny layout — panel zajmuje pełną szerokość. Przyciski mają `min-h-[48px]` dla wygody dotykowej.

---

## Komponenty

### `ConnectionPanel`

Karta (`Card` z shadcn) z następującymi sekcjami. Jest **jeden** panel — tytuł i etykiety I/O zmieniają się automatycznie ze zmianą trybu.

```
┌──────────────────────────────────────────────────────┐
│  [Wifi]  FANUC SCANNER (lub ADAPTER)    🟢 CONNECTED  │   ← header: ikona + tryb + badge
├──────────────────────────────────────────────────────┤
│  Robot IP   [192.168.1.10              ]             │   ← Input (font-mono, zablokowane gdy connected)
│  Port        [44818                   ]             │
├──────────────────────────────────────────────────────┤
│    [ POŁĄCZ ]          [ ROZŁĄCZ ]                   │   ← ROZŁĄCZ widoczny gdy ≠ disconnected
└──────────────────────────────────────────────────────┘
```

**ROZŁĄCZ — zachowanie:**
- Zawsze widoczny gdy status ≠ `disconnected`
- Wywołuje `POST /api/disconnect` → backend zamyka TCP socket + UDP socket → status → `disconnected`
- Disabled podczas wykonywania requestu (loading spinner)

**Toggle trybu w Top Barze — zachowanie:**
- Gdy disconnected → natychmiastowa zmiana
- Gdy connected → pokazuje toast: `"Rozłączanie przed zmianą trybu..."` → auto-disconnect → zmiana trybu
- Gdy connecting → toggle zablokowany (disabled)

**Style karty:**
```css
background: var(--bg-surface);         /* #0d1b2a */
border: 1px solid var(--bg-border);   /* #1e3a52 */
border-radius: 12px;
box-shadow: var(--shadow-panel);
```

**Przycisk POŁĄCZ:**
```css
background: linear-gradient(135deg, #0369a1, #0ea5e9);
color: #e8f4fd;
border: none;
border-radius: 8px;
font-weight: 600;
letter-spacing: 0.05em;
```

Hover: `brightness(1.1)` + `translateY(-1px)` (Framer Motion)  
Active: `scale(0.97)` (Framer Motion)

### `StatusBadge`

Używa `Badge` z shadcn z nadpisanymi variantami:

| Status | Tło | Obramowanie | Tekst | Animacja |
|--------|-----|-------------|-------|----------|
| `connected` | `#064e3b` | `#059669` | `#34d399` | pulse glow co 2s |
| `connecting` | `#451a03` | `#b45309` | `#fbbf24` | spinner rotate |
| `error` | `#450a0a` | `#b91c1c` | `#f87171` | — |
| `disconnected` | `#0d1b2a` | `#1e3a52` | `#4a7a9b` | — |

### `IoWordView`

Siatka 16 komórek w jednym wierszu (`grid grid-cols-16`), poprzedzona etykietą wiersza.

```
FANUC_SCAN_IN [1..16]
B15  B14  B13  B12  B11  B10  B9   B8   B7   B6   B5   B4   B3   B2   B1   B0
 0    0    0    1    0    0    1    0    0    0    0    1    0    0    0    1
```

**Komórka `BitCell` (INPUT, niemodyfikowalna):**
```css
/* bit = 0 */
background: #0d1b2a;  border: 1px solid #1e3a52;  color: #2a4a60;

/* bit = 1 */
background: #0f4c2a;  border: 1px solid #059669;  color: #6ee7b7;
font-weight: 600;
```

Przejście między 0 a 1: `transition: background 150ms, color 150ms, border-color 150ms`

**Komórka `BitCell` (OUTPUT, modyfikowalna):**
```css
/* bit = 0 */
background: #0d1b2a;  border: 1px solid #1e3a52;  color: #2a4a60;
cursor: pointer;

/* bit = 0, hover */
background: #132639;  border: 1px solid #0369a1;  color: #93c5e0;

/* bit = 1 */
background: #0c2d4a;  border: 1px solid #0369a1;  color: #38bdf8;
font-weight: 700;
box-shadow: 0 0 8px 1px rgba(56,189,248,0.3);
```

Kliknięcie: Framer Motion `scale: [1, 0.88, 1]` w 120ms — wyraźny feedback dotykowy.

### `ErrorMessage`

Pojawia się pod przyciskami gdy `status === 'error'`:

```
┌────────────────────────────────────┐
│ ⚠  connection refused: 192.168.1.10:44818  │
└────────────────────────────────────┘
```

```css
background: rgba(69,10,10,0.6);
border: 1px solid #b91c1c;
border-radius: 6px;
color: #f87171;
font-family: JetBrains Mono;
font-size: 12px;
padding: 8px 12px;
```

Animacja wejścia: Framer Motion `x: [-8, 0]` + `opacity: [0, 1]` w 200ms.

### Top Bar

```
┌────────────────────────────────────────────────────────────────────┐
│  ◉  FANUC EtherNet/IP Dashboard    [ SCANNER ●──────○ ADAPTER ]    │
└────────────────────────────────────────────────────────────────────┘
```

**Toggle trybu — styl:**
```css
/* Kontener przełącznika */
background: var(--bg-surface);        /* #0d1b2a */
border: 1px solid var(--bg-border);   /* #1e3a52 */
border-radius: 999px;
padding: 3px;

/* Aktywna pozycja (pill) */
background: linear-gradient(135deg, #0369a1, #0ea5e9);
border-radius: 999px;
transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);

/* Etykiety */
font-size: 11px;
font-weight: 700;
letter-spacing: 0.08em;
text-transform: uppercase;
```

Logo `◉` to animowana ikona `Radio` (Lucide) — powoli obraca się gdy połączenie jest aktywne (`status === "connected"`).

---

## Animacje — szczegóły Framer Motion

### Wejście paneli (staggered reveal)

```typescript
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12 }
  }
}

const panelVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } }
}
```

### Zmiana stanu połączenia

```typescript
// AnimatePresence + key zmienia animację przy każdej zmianie statusu
<AnimatePresence mode="wait">
  <motion.div
    key={status}
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.95 }}
    transition={{ duration: 0.15 }}
  >
    <StatusBadge status={status} />
  </motion.div>
</AnimatePresence>
```

### Pulsacja CONNECTED

```typescript
<motion.div
  animate={{ boxShadow: [
    '0 0 0px 0px rgba(52,211,153,0)',
    '0 0 10px 3px rgba(52,211,153,0.3)',
    '0 0 0px 0px rgba(52,211,153,0)',
  ]}}
  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
/>
```

### Shake na ERROR

```typescript
<motion.div
  animate={status === 'error' ? { x: [-6, 6, -4, 4, -2, 2, 0] } : {}}
  transition={{ duration: 0.4 }}
/>
```

### Toggle bitu OUTPUT

```typescript
<motion.button
  whileTap={{ scale: 0.85 }}
  whileHover={{ scale: 1.08 }}
  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
/>
```

---

## Import fontów (`index.html`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
```

---

## Podsumowanie — reguły projektowe

| Reguła | Wartość |
|--------|---------|
| Tło bazowe | `#070d14` — zawsze ciemne |
| Karta / panel | `#0d1b2a` z border `#1e3a52` |
| Brak białych ani jasnych powierzchni | tak — interfejs jest w 100% dark |
| Brak fioletów | tak — paleta opiera się na steel-blue → emerald → amber → red |
| Tekst danych (adresy IP, bajty) | zawsze `font-mono` (`JetBrains Mono`) |
| Minimalne touch target | `min-h-[44px] min-w-[44px]` |
| Przejścia kolorów | `transition-all duration-150` na każdym interaktywnym elemencie |
| Spacing | wielokrotności 4px (Tailwind default scale) |
| Zaokrąglenia | karty `rounded-xl`, przyciski `rounded-lg`, bity `rounded-sm` |
