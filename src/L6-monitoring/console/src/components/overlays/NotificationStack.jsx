/**
 * Notification Stack
 */
import React, { useEffect } from 'react';
import useStore from '../../store.js';
import { hexToRgba, shortId } from '../../bridge/colors.js';

const TYPE_CONFIG = {
  success:   { color: '#10B981', icon: 'OK',   label: 'Success',   zh: '成功' },
  warning:   { color: '#F5A623', icon: 'WARN', label: 'Warning',   zh: '警告' },
  error:     { color: '#EF4444', icon: 'ERR',  label: 'Error',     zh: '错误' },
  info:      { color: '#3B82F6', icon: 'INFO', label: 'Info',      zh: '信息' },
  evolution: { color: '#8B5CF6', icon: 'EVO',  label: 'Evolution', zh: '进化' },
};

const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 5000;

function NotificationItem({ notification, onDismiss }) {
  const normalizedType = notification.type === 'warn' ? 'warning' : notification.type;
  const config = TYPE_CONFIG[normalizedType] || TYPE_CONFIG.info;
  const rawBody = notification.message || notification.body || '';
  const body = typeof rawBody === 'object' ? JSON.stringify(rawBody) : String(rawBody);
  const age = Date.now() - (notification.ts || 0);
  const isNew = age < 500;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 12px', marginBottom: 4,
      background: hexToRgba(config.color, 0.08),
      border: `1px solid ${hexToRgba(config.color, 0.25)}`,
      borderRadius: 8,
      backdropFilter: 'blur(8px)',
      animation: isNew ? 'slideInRight 200ms ease-out' : 'none',
      transition: 'opacity 200ms, transform 200ms',
      maxWidth: 320, minWidth: 240,
      pointerEvents: 'auto',
    }}>
      <span style={{
        fontSize: 10, color: config.color, flexShrink: 0,
        width: 28, textAlign: 'center', marginTop: 2, fontWeight: 700,
      }}>
        {config.icon}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: config.color }}>
            {typeof notification.title === 'object' ? JSON.stringify(notification.title) : (notification.title || config.label)}
          </span>
          <span style={{ fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>
            {typeof notification.titleZh === 'object' ? JSON.stringify(notification.titleZh) : (notification.titleZh || config.zh)}
          </span>
        </div>

        {body && (
          <div style={{
            fontSize: 10, color: '#D1D5DB', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {body}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 8, color: '#6B7280' }}>
          {notification.agentId && (
            <span>Agent: <span style={{ color: '#06B6D4', fontFamily: 'var(--font-mono)' }}>{shortId(notification.agentId)}</span></span>
          )}
          {notification.taskId && (
            <span>Task: <span style={{ color: '#3B82F6', fontFamily: 'var(--font-mono)' }}>{shortId(notification.taskId)}</span></span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
        style={{
          background: 'none', border: 'none', color: '#4B5563',
          cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1,
          flexShrink: 0,
        }}
      >
        x
      </button>
    </div>
  );
}

export default function NotificationStack() {
  const notifications = useStore((s) => s.notifications);
  const dismissNotification = useStore((s) => s.dismissNotification);

  const visible = (notifications || []).slice(0, MAX_VISIBLE);
  if (visible.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 60, right: 12, zIndex: 900,
      display: 'flex', flexDirection: 'column',
      pointerEvents: 'none',
    }}>
      {visible.map((n) => (
        <NotificationItem
          key={n.id}
          notification={n}
          onDismiss={dismissNotification}
        />
      ))}

      {notifications.length > MAX_VISIBLE && (
        <div style={{
          textAlign: 'center', fontSize: 9, color: '#4B5563',
          padding: '2px 0',
        }}>
          +{notifications.length - MAX_VISIBLE} more
        </div>
      )}
    </div>
  );
}
