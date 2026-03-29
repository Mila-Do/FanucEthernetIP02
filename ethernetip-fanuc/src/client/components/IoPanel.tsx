import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/appStore';
import { eipApi } from '../api/eipApi';
import { IoWordView } from './IoWordView';

type Props = { mode: 'scanner' | 'adapter' };

const MODE_META = {
  scanner: { bitOffset: 17 },
  adapter: { bitOffset: 1 },
} as const;

export const IoPanel = ({ mode }: Props) => {
  const panelState       = useAppStore((s) => s[mode]);
  const toggleScannerBit = useAppStore((s) => s.toggleScannerBit);
  const toggleAdapterBit = useAppStore((s) => s.toggleAdapterBit);

  const isConnected = panelState.status === 'connected';
  const { bitOffset } = MODE_META[mode];
  const toggleBitFn = mode === 'scanner' ? toggleScannerBit : toggleAdapterBit;

  const handleBitToggle = async (bitIndex: number) => {
    const currentWord = useAppStore.getState()[mode].outputWord;
    const newWord = currentWord ^ (1 << bitIndex);
    toggleBitFn(bitIndex);
    try {
      if (mode === 'scanner') await eipApi.scanner.write({ word: newWord });
      else                    await eipApi.adapter.write({ word: newWord });
    } catch {
      toggleBitFn(bitIndex); // rollback on error
    }
  };

  return (
    <AnimatePresence>
      {isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="rounded-xl p-5 space-y-5"
          style={{
            background: '#0d1b2a',
            border: '1px solid #0f3d28',
            boxShadow: '0 4px 24px 0 rgba(7,13,20,0.7), 0 0 16px 2px rgba(52,211,153,0.08)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ background: '#34d399' }}
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-xs font-semibold tracking-widest text-steel-400 uppercase">
              I/O — Live
            </span>
          </div>

          <div className="border-t border-steel-700" />

          {/* FANUC INPUT — what PC sends to FANUC (PC's outputWord) */}
          <IoWordView
            label="FANUC INPUT"
            word={panelState.outputWord}
            type="output"
            bitOffset={bitOffset}
            onBitToggle={handleBitToggle}
          />

          <div className="border-t border-steel-700/50" />

          {/* FANUC OUTPUT — what FANUC sends to PC (PC's inputWord) */}
          <IoWordView
            label="FANUC OUTPUT"
            word={panelState.inputWord}
            type="input"
            bitOffset={bitOffset}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
