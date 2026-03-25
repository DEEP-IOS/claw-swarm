import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';

function getToastDuration(type: string) {
  if (type === 'choice' || type === 'blocked' || type === 'alert') {
    return 9000;
  }
  if (type === 'runtime') {
    return 6500;
  }
  return 5000;
}

// Stable selector: extract only the IDs of visible items to avoid new array reference on every render
const selectVisibleIds = (state: { items: Array<{ id: string; toastVisible: boolean }> }) =>
  state.items.filter((item) => item.toastVisible).map((item) => item.id).join(',');

export function NotificationStack() {
  // Use stable string key to avoid new reference on every render
  const visibleIdStr = useOperatorFeedStore(selectVisibleIds);
  const allItems = useOperatorFeedStore((s) => s.items);
  const hideToast = useOperatorFeedStore((s) => s.hideToast);
  const setView = useViewStore((s) => s.setView);

  // Derive notifications from stable inputs
  const notifications = useMemo(() => {
    if (!visibleIdStr) return [];
    const ids = new Set(visibleIdStr.split(','));
    return allItems.filter((item) => ids.has(item.id)).reverse();
  }, [visibleIdStr, allItems]);

  // Track which notification IDs already have active timers
  const activeTimers = useRef<Map<string, number>>(new Map());

  // Stable callback ref for hideToast
  const hideToastRef = useRef(hideToast);
  hideToastRef.current = hideToast;

  useEffect(() => {
    const currentIds = new Set(notifications.map((n) => n.id));

    // Clear timers for notifications that are no longer visible
    for (const [id, timer] of activeTimers.current) {
      if (!currentIds.has(id)) {
        window.clearTimeout(timer);
        activeTimers.current.delete(id);
      }
    }

    // Set timers only for new notifications
    for (const notification of notifications) {
      if (!activeTimers.current.has(notification.id)) {
        const timer = window.setTimeout(() => {
          activeTimers.current.delete(notification.id);
          hideToastRef.current(notification.id);
        }, getToastDuration(notification.type));
        activeTimers.current.set(notification.id, timer);
      }
    }
  }, [notifications]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of activeTimers.current.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="console-notification-stack">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`console-toast${notification.sticky ? ' is-sticky' : ''}`}
          style={{ ['--toast-accent' as string]: notification.color } as CSSProperties}
        >
          <div className="console-toast__label">
            <span className="console-toast__dot" />
            {notification.label}
          </div>

          <div className="console-toast__title">{notification.title}</div>
          <div className="console-toast__body">{notification.body}</div>

          {notification.choices.length > 0 ? (
            <div className="console-toast__chips">
              {notification.choices.map((choice) => (
                <span key={`${notification.id}-${choice.value}`} className="console-toast__chip">
                  {choice.label}
                </span>
              ))}
            </div>
          ) : null}

          {notification.targetView ? (
            <div className="console-toast__actions">
              <button
                type="button"
                className="console-toast__action"
                onClick={() => setView(notification.targetView!)}
              >
                Open {notification.targetView}
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
