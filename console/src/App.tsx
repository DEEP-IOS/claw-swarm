import { useEffect } from 'react';
import { Shell } from './components/layout/Shell';
import { wsBridge } from './api/ws-bridge';
import { onAgentEvent } from './stores/world-store';
import type { BridgeNotificationPayload } from './stores/operator-feed-store';
import { useWorldStore } from './stores/world-store';
import { usePheromoneStore } from './stores/pheromone-store';
import { useFieldStore } from './stores/field-store';
import { useOperatorFeedStore } from './stores/operator-feed-store';

const RUNTIME_OPERATOR_TOPICS = [
  'workflow.phase.changed',
  'spawn.advised',
  'contract.cfp.issued',
  'contract.awarded',
  'channel.message',
  'pheromone.deposited',
  'stigmergy.updated',
  'reputation.updated',
  'quality.audit.completed',
  'auto.quality.gate',
  'shapley.computed',
  'auto.shapley.credit',
  'memory.episode.recorded',
  'replan.strategy.selected',
  'budget.warning',
  'budget.exceeded',
  'quality.breaker.tripped',
  'quality.anomaly.detected',
  'quality.pipeline.broken',
  'quality.compliance.violation',
  'quality.compliance.terminated',
] as const;

function resolveBridgeUrl() {
  const explicitUrl = new URLSearchParams(window.location.search).get('ws');
  if (explicitUrl) {
    return explicitUrl;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || '127.0.0.1';
  return `${protocol}://${host}:19101`;
}

export function App() {
  useEffect(() => {
    // Grab store actions directly — these are stable references from Zustand
    const { updateSnapshot, setConnected } = useWorldStore.getState();
    const { updateFromSnapshot: updatePheromones } = usePheromoneStore.getState();
    const { updateVector: updateFieldVector } = useFieldStore.getState();
    const { ingestBridgeNotification, ingestAgentEvent, ingestRuntimeEvent } = useOperatorFeedStore.getState();

    // Connect WebSocket to ConsoleDataBridge
    wsBridge.connect(resolveBridgeUrl(), (connected) => {
      useWorldStore.getState().setConnected(connected);
    });

    // Receive world snapshots at configured Hz
    wsBridge.onSnapshot((snap) => {
      useWorldStore.getState().updateSnapshot(snap);
      usePheromoneStore.getState().updateFromSnapshot(snap.pheromones ?? []);
      useFieldStore.getState().updateVector(snap.field ?? {});
    });

    // Subscribe to all events
    wsBridge.subscribe(['*']);

    const unsubscribeUserNotifications = wsBridge.onEvent('user.notification', (data, topic) => {
      useOperatorFeedStore.getState().ingestBridgeNotification((data ?? {}) as BridgeNotificationPayload, topic);
    });

    const unsubscribeRuntimeEvents = RUNTIME_OPERATOR_TOPICS.map((topic) => (
      wsBridge.onEvent(topic, (data, eventTopic) => {
        useOperatorFeedStore.getState().ingestRuntimeEvent(eventTopic, data);
      })
    ));

    const unsubscribeAgentEvents = onAgentEvent((event) => {
      useOperatorFeedStore.getState().ingestAgentEvent(event);
    });

    // Request 5Hz snapshots with core fields
    wsBridge.configure(5, ['agents', 'pheromones', 'channels', 'field', 'tasks', 'system', 'mode', 'health', 'budget', 'breakers', 'metrics', 'adaptation']);

    return () => {
      unsubscribeUserNotifications();
      unsubscribeRuntimeEvents.forEach((unsubscribe) => unsubscribe());
      unsubscribeAgentEvents();
      wsBridge.disconnect();
    };
  }, []); // Mount once — store.getState() ensures fresh references

  return <Shell />;
}
