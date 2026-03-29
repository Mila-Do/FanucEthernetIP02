import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { Wifi, WifiOff, Antenna, AlertCircle } from 'lucide-react';
import type { ConnectionStatus } from '@shared/types';
import { EIP_PORT } from '@shared/types';
import { useAppStore } from '../store/appStore';
import { eipApi } from '../api/eipApi';
import { StatusBadge } from './StatusBadge';
import { IoWordView } from './IoWordView';

type Props = { mode: 'scanner' | 'adapter' };

export const ConnectionPanel = ({ mode }: Props) => {
  const panelState = useAppStore((s) => s[mode]);
  const toggleScannerBit = useAppStore((s) => s.toggleScannerBit);
  const toggleAdapterBit = useAppStore((s) => s.toggleAdapterBit);

  const [ip, setIp] = useState('192.168.1.10');
  const [busy, setBusy] = useState(false);


  const isScanner = mode === 'scanner';
  const toggleBitFn = isScanner ? toggleScannerBit : toggleAdapterBit;
  const isActive = panelState.status === 'connecting' || panelState.status === 'connected';
  const isConnected = panelState.status === 'connected';

  // Shake animation — triggers once when status transitions to 'error'
  const controls = useAnimation();
  const prevStatusRef = useRef<ConnectionStatus>(panelState.status);

  useEffect(() => {
    if (panelState.status === 'error' && prevStatusRef.current !== 'error') {
      void controls.start({
        x: [-6, 6, -4, 4, -2, 2, 0],
        transition: { duration: 0.4 },
      });
    }
    prevStatusRef.current = panelState.status;
  }, [panelState.status, controls]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      if (isScanner) {
        await eipApi.scanner.connect({ ip, port: EIP_PORT });
      } else {
        await eipApi.adapter.start({ port: EIP_PORT });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      if (isScanner) {
        await eipApi.scanner.disconnect();
      } else {
        await eipApi.adapter.stop();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBitToggle = async (bitIndex: number) => {
    // Read latest value directly from store to avoid stale closure
    const currentWord = useAppStore.getState()[mode].outputWord;
    const newWord = currentWord ^ (1 << bitIndex);
    toggleBitFn(bitIndex); // optimistic update
    try {
      if (isScanner) {
        await eipApi.scanner.write({ word: newWord });
      } else {
        await eipApi.adapter.write({ word: newWord });
      }
    } catch {
      toggleBitFn(bitIndex); // rollback
    }
  };

  const borderColor =
    panelState.status === 'connected' ? '#059669' :
    panelState.status === 'error'     ? '#b91c1c' :
    '#1e3a52';

  const boxShadow =
    panelState.status === 'connected'
      ? '0 4px 24px 0 rgba(7,13,20,0.7), 0 0 12px 2px rgba(52,211,153,0.15)'
      : panelState.status === 'error'
      ? '0 4px 24px 0 rgba(7,13,20,0.7), 0 0 12px 2px rgba(248,113,113,0.2)'
      : '0 4px 24px 0 rgba(7,13,20,0.7), 0 1px 0 0 rgba(30,58,82,0.5)';

  const inputClass =
    'w-full px-3 py-2 rounded-lg text-sm font-mono text-steel-100 bg-steel-600 border border-steel-700 ' +
    'placeholder-steel-400/50 transition-all duration-150 focus:outline-none ' +
    'focus:border-sky-700 focus:ring-1 focus:ring-sky-700/30 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <motion.div
      animate={controls}
      className="rounded-xl p-5 space-y-4"
      style={{
        background: '#0d1b2a',
        border: `1px solid ${borderColor}`,
        boxShadow,
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isScanner
            ? <Wifi size={15} className="text-steel-300" />
            : <Antenna size={15} className="text-steel-300" />
          }
          <span className="text-sm font-medium tracking-wider text-steel-300 uppercase">
            {isScanner ? 'FANUC Scanner' : 'FANUC Adapter'}
          </span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={panelState.status}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
          >
            <StatusBadge status={panelState.status} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="border-t border-steel-700" />

      {/* ── Config Form ────────────────────────────────── */}
      <div className="space-y-3">
        {isScanner && (
          <div className="space-y-1">
            <label className="block text-xs font-medium tracking-wide text-steel-400 uppercase">
              Robot IP
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              disabled={isActive}
              placeholder="192.168.1.10"
              className={inputClass}
            />
          </div>
        )}
      </div>

      {/* ── Action Buttons ─────────────────────────────── */}
      <div className="flex gap-3">
        <motion.button
          type="button"
          disabled={isActive || busy}
          onClick={handleConnect}
          whileHover={!isActive && !busy ? { filter: 'brightness(1.12)', y: -1 } : {}}
          whileTap={!isActive && !busy ? { scale: 0.97 } : {}}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide text-steel-100 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
          style={{
            background: isActive
              ? 'linear-gradient(135deg, #1e3a52, #243d54)'
              : 'linear-gradient(135deg, #0369a1, #0ea5e9)',
          }}
        >
          <Wifi size={14} />
          {isScanner ? 'CONNECT' : 'START'}
        </motion.button>

        <motion.button
          type="button"
          disabled={!isActive || busy}
          onClick={handleDisconnect}
          whileHover={isActive && !busy ? { filter: 'brightness(1.1)', y: -1 } : {}}
          whileTap={isActive && !busy ? { scale: 0.97 } : {}}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide text-steel-300 bg-steel-700 border border-steel-600 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
        >
          <WifiOff size={14} />
          {isScanner ? 'DISCONNECT' : 'STOP'}
        </motion.button>
      </div>

      {/* ── Error Message ──────────────────────────────── */}
      <AnimatePresence>
        {panelState.status === 'error' && panelState.errorMessage && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="flex items-start gap-2 px-3 py-2 rounded-md"
            style={{ background: 'rgba(69,10,10,0.6)', border: '1px solid #b91c1c' }}
          >
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0 text-red-400" />
            <span className="font-mono text-xs text-red-400">
              {panelState.errorMessage}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── I/O Words (visible only when connected) ───── */}
      <AnimatePresence>
        {isConnected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            <div className="border-t border-steel-700 pt-4 space-y-5">
              <IoWordView
                label="INPUT  (FANUC → PC)"
                word={panelState.inputWord}
                type="input"
              />
              <IoWordView
                label="OUTPUT (PC → FANUC)"
                word={panelState.outputWord}
                type="output"
                onBitToggle={handleBitToggle}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
