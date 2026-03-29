import { motion } from 'framer-motion';
import { Wifi, WifiOff, AlertCircle, Loader2 } from 'lucide-react';
import type { ConnectionStatus } from '@shared/types';

type Props = { status: ConnectionStatus };

const cfg: Record<
  ConnectionStatus,
  { bg: string; border: string; color: string; label: string; Icon: React.ElementType }
> = {
  connected:    { bg: '#064e3b', border: '#059669', color: '#34d399', label: 'CONNECTED',    Icon: Wifi },
  connecting:   { bg: '#451a03', border: '#b45309', color: '#fbbf24', label: 'CONNECTING',   Icon: Loader2 },
  error:        { bg: '#450a0a', border: '#b91c1c', color: '#f87171', label: 'ERROR',        Icon: AlertCircle },
  disconnected: { bg: '#0d1b2a', border: '#1e3a52', color: '#4a7a9b', label: 'DISCONNECTED', Icon: WifiOff },
};

export const StatusBadge = ({ status }: Props) => {
  const c = cfg[status];
  const Icon = c.Icon;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-widest uppercase whitespace-nowrap"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}
    >
      {status === 'connecting' ? (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          style={{ display: 'inline-flex' }}
        >
          <Icon size={10} />
        </motion.span>
      ) : status === 'connected' ? (
        <motion.span
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ display: 'inline-flex' }}
        >
          <Icon size={10} />
        </motion.span>
      ) : (
        <Icon size={10} />
      )}
      {c.label}
    </span>
  );
};
