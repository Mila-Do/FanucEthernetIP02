import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Wifi, Antenna } from 'lucide-react';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { useAppStore } from './store/appStore';
import { useEipWebSocket } from './hooks/useEipWebSocket';
import { ConnectionPanel } from './components/ConnectionPanel';
import { IoPanel } from './components/IoPanel';

const statusColor = (s: string) =>
  s === 'connected' ? '#34d399' :
  s === 'connecting' ? '#fbbf24' :
  s === 'error'      ? '#f87171' :
  '#2a4a60';

export default function App() {
  useEipWebSocket();

  const [activeMode, setActiveMode] = useState<'scanner' | 'adapter'>('scanner');

  const wsStatus      = useAppStore((s) => s.wsStatus);
  const scannerStatus = useAppStore((s) => s.scanner.status);
  const adapterStatus = useAppStore((s) => s.adapter.status);

  const anyActive =
    scannerStatus === 'connecting' || scannerStatus === 'connected' ||
    adapterStatus === 'connecting' || adapterStatus === 'connected';

  const toggleDisabled = anyActive;

  return (
    <div className="min-h-screen bg-app-gradient">
      <Toaster position="top-right" theme="dark" richColors />

      {/* ── Top Bar ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 h-14 flex items-center justify-between px-4 sm:px-6"
        style={{
          background: 'rgba(13,27,42,0.9)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid #1e3a52',
        }}
      >
        <div className="flex items-center gap-3">
          <motion.div
            animate={anyActive ? { rotate: 360 } : { rotate: 0 }}
            transition={anyActive
              ? { duration: 8, repeat: Infinity, ease: 'linear' }
              : { duration: 0.5 }}
          >
            <Radio size={18} style={{ color: anyActive ? '#34d399' : '#4a7a9b' }} />
          </motion.div>
          <span className="text-xl font-semibold tracking-wide text-steel-100">
            FANUC EtherNet/IP
          </span>
        </div>

        {/* WS indicator */}
        <div className="flex items-center gap-1.5">
          <motion.div
            className="w-2 h-2 rounded-full"
            style={{ background: wsStatus === 'open' ? '#34d399' : wsStatus === 'connecting' ? '#fbbf24' : '#f87171' }}
            animate={wsStatus !== 'closed' ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="hidden sm:block text-xs font-mono text-steel-400 tracking-wider">WS</span>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────── */}
      <main className="p-4 sm:p-6">
        <div className="max-w-xl mx-auto space-y-5">

          {/* ── Mode Toggle ─────────────────────────────── */}
          <div
            className="flex rounded-xl p-1 gap-1"
            style={{ background: '#0a1520', border: '1px solid #1e3a52' }}
          >
            {(['scanner', 'adapter'] as const).map((m) => {
              const isActive = activeMode === m;
              const modeStatus = m === 'scanner' ? scannerStatus : adapterStatus;
              const dot = statusColor(modeStatus);

              return (
                <motion.button
                  key={m}
                  type="button"
                  disabled={toggleDisabled && activeMode !== m}
                  onClick={() => setActiveMode(m)}
                  whileHover={!isActive && !toggleDisabled ? { filter: 'brightness(1.15)' } : {}}
                  whileTap={!isActive && !toggleDisabled ? { scale: 0.98 } : {}}
                  className="flex-1 flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg text-sm font-semibold tracking-wide transition-all duration-200 disabled:cursor-not-allowed"
                  style={{
                    background: isActive
                      ? 'linear-gradient(135deg, #0f2d45, #163a54)'
                      : 'transparent',
                    color: isActive ? '#e2eaf0' : '#4a7a9b',
                    border: isActive ? '1px solid #1e5a7a' : '1px solid transparent',
                    opacity: (!isActive && toggleDisabled) ? 0.4 : 1,
                  }}
                >
                  {m === 'scanner'
                    ? <Wifi size={14} />
                    : <Antenna size={14} />
                  }
                  <span>{m === 'scanner' ? 'PC SCANNER' : 'PC ADAPTER'}</span>
                  {/* Status dot */}
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full ml-auto"
                    style={{ background: dot }}
                    animate={
                      modeStatus === 'connecting'
                        ? { opacity: [1, 0.2, 1] }
                        : modeStatus === 'connected'
                          ? { scale: [1, 1.3, 1] }
                          : { opacity: 1 }
                    }
                    transition={{ duration: 1.4, repeat: Infinity }}
                  />
                </motion.button>
              );
            })}
          </div>

          {/* ── Connection Panel ─────────────────────────── */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeMode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <ConnectionPanel mode={activeMode} />
            </motion.div>
          </AnimatePresence>

          {/* ── I/O Panel ────────────────────────────────── */}
          <IoPanel mode={activeMode} />
        </div>
      </main>
    </div>
  );
}
