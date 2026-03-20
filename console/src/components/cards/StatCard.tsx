import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  color?: string;
  subtext?: string;
}

export function StatCard({ label, value, icon, color = 'var(--glow-primary)', subtext }: StatCardProps) {
  return (
    <motion.div
      whileHover={{ scale: 1.02, boxShadow: `0 0 24px ${color}22` }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 180,
        boxShadow: `0 0 16px ${color}08`,
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
        <span>{label}</span>
      </div>

      <motion.div
        key={String(value)}
        initial={{ opacity: 0.5, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: '-0.02em' }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </motion.div>

      {subtext && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtext}</div>
      )}
    </motion.div>
  );
}
