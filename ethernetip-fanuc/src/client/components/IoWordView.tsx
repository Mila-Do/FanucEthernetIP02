import { wordToBits } from '@shared/types';
import { BitCell } from './BitCell';

type Props = {
  label: string;
  word: number;
  type: 'input' | 'output';
  onBitToggle?: (bitIndex: number) => void;
};

export const IoWordView = ({ label, word, type, onBitToggle }: Props) => {
  // wordToBits: [0] = LSB (B0), [15] = MSB (B15)
  const bits = wordToBits(word);
  // Display MSB-first: B15 on the left, B0 on the right
  const displayBits = [...bits].reverse();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium tracking-wide uppercase text-steel-400">
          {label}
        </span>
        <span className="text-xs font-mono tabular-nums text-steel-400">
          {String(word).padStart(5, '\u2007')}
          {' / '}
          0x{word.toString(16).toUpperCase().padStart(4, '0')}
        </span>
      </div>

      {/* Bit index headers: 15 … 0 */}
      <div className="grid grid-cols-16 gap-0.5">
        {displayBits.map((_, i) => (
          <div key={i} className="text-center text-[9px] font-mono" style={{ color: '#2a4a60' }}>
            {15 - i}
          </div>
        ))}
      </div>

      {/* Bit cells */}
      <div className="grid grid-cols-16 gap-0.5">
        {displayBits.map((bit, i) => {
          const bitIdx = 15 - i;
          return (
            <BitCell
              key={bitIdx}
              value={bit}
              bitIndex={bitIdx}
              type={type}
              onToggle={type === 'output' ? () => onBitToggle?.(bitIdx) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
};
