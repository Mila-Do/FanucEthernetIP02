import { motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { Toaster } from 'sonner';
import { useAppStore } from './store/appStore';
import { useEipWebSocket } from './hooks/useEipWebSocket';
import { ConnectionPanel } from './components/ConnectionPanel';

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

const statusColor = (s: string) =>
  s === 'connected' ? '#34d399' :
  s === 'connecting' ? '#fbbf24' :
  s === 'error'      ? '#f87171' :
  '#4a7a9b';

export default function App() {
  useEipWebSocket();

  const wsStatus      = useAppStore((s) => s.wsStatus);
  const scannerStatus = useAppStore((s) => s.scanner.status);
  const adapterStatus = useAppStore((s) => s.adapter.status);
  const anyActive     = scannerStatus === 'connected' || adapterStatus === 'connected';

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
            transition={
              anyActive
                ? { duration: 8, repeat: Infinity, ease: 'linear' }
                : { duration: 0.5 }
            }
          >
            <Radio size={18} style={{ color: anyActive ? '#34d399' : '#4a7a9b' }} />
          </motion.div>
          <span className="text-xl font-semibold tracking-wide text-steel-100">
            FANUC EtherNet/IP
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* WebSocket connection status */}
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ background: wsStatus === 'open' ? '#34d399' : wsStatus === 'connecting' ? '#fbbf24' : '#f87171' }}
              animate={wsStatus !== 'closed' ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="hidden sm:block text-xs font-mono text-steel-400 tracking-wider">WS</span>
          </div>

          {/* Scanner mini indicator */}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: statusColor(scannerStatus) }} />
            <span className="hidden sm:block text-xs font-mono text-steel-400 tracking-wider">SCANNER</span>
          </div>

          {/* Adapter mini indicator */}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: statusColor(adapterStatus) }} />
            <span className="hidden sm:block text-xs font-mono text-steel-400 tracking-wider">ADAPTER</span>
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────── */}
      <main className="p-4 sm:p-6">
        <motion.div
          className="grid lg:grid-cols-2 gap-6 max-w-6xl mx-auto"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={itemVariants}>
            <ConnectionPanel mode="scanner" />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ConnectionPanel mode="adapter" />
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}
