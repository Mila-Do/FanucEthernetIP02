import { motion } from 'framer-motion';

type Props = {
  value: boolean;
  bitIndex: number;
  type: 'input' | 'output';
  onToggle?: () => void;
};

export const BitCell = ({ value, bitIndex, type, onToggle }: Props) => {
  const label = value ? '1' : '0';

  if (type === 'input') {
    return (
      <div
        title={`B${bitIndex} = ${label}`}
        className="flex items-center justify-center h-8 rounded-sm text-xs font-mono select-none transition-all duration-150"
        style={
          value
            ? { background: '#0f4c2a', border: '1px solid #059669', color: '#6ee7b7', fontWeight: 600 }
            : { background: '#0d1b2a', border: '1px solid #1e3a52', color: '#2a4a60' }
        }
      >
        {label}
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      title={`B${bitIndex} = ${label} (tap to toggle)`}
      aria-label={`Bit ${bitIndex}: ${label}`}
      aria-pressed={value}
      whileTap={{ scale: 0.85 }}
      whileHover={{ scale: 1.08 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      onClick={onToggle}
      className="flex items-center justify-center min-h-[44px] h-8 rounded-sm text-xs font-mono cursor-pointer select-none transition-colors duration-150"
      style={
        value
          ? {
              background: '#0c2d4a',
              border: '1px solid #0369a1',
              color: '#38bdf8',
              fontWeight: 700,
              boxShadow: '0 0 8px 1px rgba(56,189,248,0.3)',
            }
          : { background: '#0d1b2a', border: '1px solid #1e3a52', color: '#2a4a60' }
      }
    >
      {label}
    </motion.button>
  );
};
