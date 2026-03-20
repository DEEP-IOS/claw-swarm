import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';

const NAV_ITEMS = [
  { path: '/',               icon: '◎', label: 'Overview' },
  { path: '/field',          icon: '◉', label: 'Signal Field' },
  { path: '/agents',         icon: '⬡', label: 'Agents' },
  { path: '/orchestration',  icon: '⬢', label: 'Orchestration' },
  { path: '/quality',        icon: '◈', label: 'Quality' },
  { path: '/communication',  icon: '◇', label: 'Communication' },
  { path: '/adaptation',     icon: '◆', label: 'Adaptation' },
  { path: '/system',         icon: '⚙', label: 'System' },
];

export function Sidebar() {
  return (
    <nav style={{
      width: 60,
      height: '100%',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--bg-border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 12,
      gap: 4,
      zIndex: 10,
    }}>
      <div style={{
        fontSize: 24,
        marginBottom: 16,
        filter: 'drop-shadow(0 0 6px rgba(0,255,170,0.4))',
      }}>🐝</div>

      {NAV_ITEMS.map((item) => (
        <NavLink key={item.path} to={item.path} end={item.path === '/'}>
          {({ isActive }) => (
            <motion.div
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              title={item.label}
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                background: isActive ? 'rgba(0,255,170,0.12)' : 'transparent',
                color: isActive ? 'var(--glow-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'var(--transition-fast)',
                textDecoration: 'none',
                boxShadow: isActive ? '0 0 12px rgba(0,255,170,0.15)' : 'none',
              }}
            >
              {item.icon}
            </motion.div>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
