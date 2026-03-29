import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { Wifi, WifiOff, Antenna, AlertCircle, FlaskConical, Square } from 'lucide-react';
import type { ConnectionStatus } from '@shared/types';
import { EIP_PORT } from '@shared/types';
import { useAppStore } from '../store/appStore';
import { eipApi } from '../api/eipApi';
import { StatusBadge } from './StatusBadge';
import { IoWordView } from './IoWordView';

type Props = { mode: 'scanner' | 'adapter' };

const PANEL_META = {
  scanner: {
    title: 'PC as Scanner',
    subtitle: 'PC = Scanner  ·  FANUC = Adapter  ·  Tryb B',
    implemented: true,
    bitOffset: 17,   // FANUC DI17–32 / DO17–32
  },
  adapter: {
    title: 'PC as Adapter',
    subtitle: 'FANUC = Scanner  ·  PC = Adapter  ·  Tryb A',
    implemented: false,
    bitOffset: 1,    // FANUC DI1–16 / DO1–16
  },
} as const;

export const ConnectionPanel = ({ mode }: Props) => {
  const panelState    = useAppStore((s) => s[mode]);
  const toggleScannerBit = useAppStore((s) => s.toggleScannerBit);
  const toggleAdapterBit = useAppStore((s) => s.toggleAdapterBit);
  const setStatus     = useAppStore((s) => s.setStatus);
  const setInputWord  = useAppStore((s) => s.setInputWord);

  const [ip, setIp]     = useState('192.168.1.181');
  const [busy, setBusy] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const mockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const meta       = PANEL_META[mode];
  const isScanner  = mode === 'scanner';
  const toggleBitFn = isScanner ? toggleScannerBit : toggleAdapterBit;
  const isRealActive = panelState.status === 'connecting' || panelState.status === 'connected';
  const isConnected  = panelState.status === 'connected';

  // ── Mock mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isMock) {
      setStatus(mode, 'connected');
      mockIntervalRef.current = setInterval(() => {
        setInputWord(mode, Math.floor(Math.random() * 65536));
      }, 200);
    } else {
      if (mockIntervalRef.current) {
        clearInterval(mockIntervalRef.current);
        mockIntervalRef.current = null;
      }
      setStatus(mode, 'disconnected');
      setInputWord(mode, 0);
    }
    return () => {
      if (mockIntervalRef.current) clearInterval(mockIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMock]);

  // ── Shake on error ─────────────────────────────────────────────────────────
  const controls = useAnimation();
  const prevStatusRef = useRef<ConnectionStatus>(panelState.status);
  useEffect(() => {
    if (panelState.status === 'error' && prevStatusRef.current !== 'error') {
      void controls.start({ x: [-6, 6, -4, 4, -2, 2, 0], transition: { duration: 0.4 } });
    }
    prevStatusRef.current = panelState.status;
  }, [panelState.status, controls]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setBusy(true);
    try {
      if (isScanner) await eipApi.scanner.connect({ ip, port: EIP_PORT });
      else           await eipApi.adapter.start({ port: EIP_PORT });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      if (isScanner) await eipApi.scanner.disconnect();
      else           await eipApi.adapter.stop();
    } finally {
      setBusy(false);
    }
  };

  const handleBitToggle = async (bitIndex: number) => {
    const currentWord = useAppStore.getState()[mode].outputWord;
    const newWord = currentWord ^ (1 << bitIndex);
    toggleBitFn(bitIndex);
    if (isMock) return;
    try {
      if (isScanner) await eipApi.scanner.write({ word: newWord });
      else           await eipApi.adapter.write({ word: newWord });
    } catch {
      toggleBitFn(bitIndex); // rollback
    }
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const borderColor =
    isMock                          ? '#b45309' :
    panelState.status === 'connected' ? '#059669' :
    panelState.status === 'error'     ? '#b91c1c' :
    '#1e3a52';

  const boxShadow =
    isMock
      ? '0 4px 24px 0 rgba(7,13,20,0.7), 0 0 12px 2px rgba(245,158,11,0.2)'
      : panelState.status === 'connected'
        ? '0 4px 24px 0 rgba(7,13,20,0.7), 0 0 12px 2px rgba(52,211,153,0.15)'
        : panelState.status === 'error'
          ? '0 4px 24px 0 rgba(7,13,20,0.7), 0 0 12px 2px rgba(248,113,113,0.2)'
          : '0 4px 24px 0 rgba(7,13,20,0.7), 0 1px 0 0 rgba(30,58,82,0.5)';

  const inputClass =
    'w-full px-3 py-2 rounded-lg text-sm font-mono text-steel-100 bg-steel-600 border border-steel-700 ' +
    'placeholder-steel-400/50 transition-all duration-150 focus:outline-none ' +
    'focus:border-sky-700 focus:ring-1 focus:ring-sky-700/30 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed';

  const realConnectDisabled = isRealActive || busy || isMock || !meta.implemented;
  const realDisconnectDisabled = !isRealActive || busy || isMock;
  const mockBtnDisabled = isRealActive && !isMock;

  return (
    <motion.div
      animate={controls}
      className="rounded-xl p-5 space-y-4"
      style={{ background: '#0d1b2a', border: `1px solid ${borderColor}`, boxShadow, transition: 'border-color 0.3s ease, box-shadow 0.3s ease' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            {isScanner
              ? <Wifi size={15} className="text-steel-300" />
              : <Antenna size={15} className="text-steel-300" />
            }
            <span className="text-sm font-semibold tracking-wider text-steel-100 uppercase">
              {meta.title}
            </span>
            {!meta.implemented && (
              <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 border border-yellow-700/50 uppercase">
                WIP
              </span>
            )}
            {isMock && (
              <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-600/50 uppercase animate-pulse">
                MOCK
              </span>
            )}
          </div>
          <p className="text-[11px] font-mono text-steel-500">{meta.subtitle}</p>
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

      {/* ── Config Form ────────────────────────────────────────────────── */}
      {isScanner && (
        <div className="space-y-1">
          <label className="block text-xs font-medium tracking-wide text-steel-400 uppercase">
            Robot IP
          </label>
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            disabled={isRealActive || isMock}
            placeholder="192.168.1.10"
            className={inputClass}
          />
        </div>
      )}

      {/* ── Real Connection Buttons ─────────────────────────────────────── */}
      <div className="flex gap-3">
        <motion.button
          type="button"
          disabled={realConnectDisabled}
          onClick={handleConnect}
          whileHover={!realConnectDisabled ? { filter: 'brightness(1.12)', y: -1 } : {}}
          whileTap={!realConnectDisabled ? { scale: 0.97 } : {}}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide text-steel-100 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
          style={{
            background: (isRealActive && !isMock)
              ? 'linear-gradient(135deg, #1e3a52, #243d54)'
              : 'linear-gradient(135deg, #0369a1, #0ea5e9)',
          }}
        >
          <Wifi size={14} />
          {isScanner ? 'CONNECT' : 'START'}
        </motion.button>

        <motion.button
          type="button"
          disabled={realDisconnectDisabled}
          onClick={handleDisconnect}
          whileHover={!realDisconnectDisabled ? { filter: 'brightness(1.1)', y: -1 } : {}}
          whileTap={!realDisconnectDisabled ? { scale: 0.97 } : {}}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide text-steel-300 bg-steel-700 border border-steel-600 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
        >
          <WifiOff size={14} />
          {isScanner ? 'DISCONNECT' : 'STOP'}
        </motion.button>
      </div>

      {/* Note for unimplemented panel */}
      {!meta.implemented && (
        <p className="text-center text-[11px] font-mono text-steel-600">
          real connection not implemented yet — use Mock Mode below
        </p>
      )}

      {/* ── Mock Mode Button ────────────────────────────────────────────── */}
      <motion.button
        type="button"
        disabled={mockBtnDisabled}
        onClick={() => setIsMock((v) => !v)}
        whileHover={!mockBtnDisabled ? { filter: 'brightness(1.1)', y: -1 } : {}}
        whileTap={!mockBtnDisabled ? { scale: 0.97 } : {}}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold tracking-wider min-h-[36px] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
        style={{
          background: isMock ? 'linear-gradient(135deg, #78350f, #b45309)' : 'rgba(30,58,82,0.4)',
          border: isMock ? '1px solid #b45309' : '1px dashed #1e3a52',
          color: isMock ? '#fde68a' : '#4a7a9b',
        }}
      >
        {isMock
          ? <><Square size={11} /> STOP MOCK</>
          : <><FlaskConical size={11} /> MOCK MODE — simulate I/O data</>
        }
      </motion.button>

      {/* ── Error Message ───────────────────────────────────────────────── */}
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
            <span className="font-mono text-xs text-red-400">{panelState.errorMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── I/O Words (visible when connected — real or mock) ───────────── */}
      <AnimatePresence>
        {isConnected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="border-t border-steel-700 pt-4 space-y-5">
              <IoWordView
                label="FANUC INPUT"
                word={panelState.outputWord}
                type="output"
                bitOffset={meta.bitOffset}
                onBitToggle={handleBitToggle}
              />
              <IoWordView
                label="FANUC OUTPUT"
                word={panelState.inputWord}
                type="input"
                bitOffset={meta.bitOffset}
              />            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
