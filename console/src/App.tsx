import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import { Shell } from './components/layout/Shell';
import { Overview } from './views/Overview';
import { FieldView } from './views/FieldView';
import { AgentsView } from './views/AgentsView';
import { OrchestrationView } from './views/OrchestrationView';
import { QualityView } from './views/QualityView';
import { CommunicationView } from './views/CommunicationView';
import { AdaptationView } from './views/AdaptationView';
import { SystemView } from './views/SystemView';
import { sseManager } from './api/sse-manager';
import { useSSEStore } from './stores/sse-store';

export function App() {
  const setConnected = useSSEStore((s) => s.setConnected);
  const increment = useSSEStore((s) => s.increment);

  useEffect(() => {
    // Connect to SSE on mount
    sseManager.connect('/api/v9/events', (connected) => {
      setConnected(connected);
    });

    // Count all events
    const unsub = sseManager.subscribe('*', () => {
      increment();
    });

    return () => {
      unsub();
      sseManager.disconnect();
    };
  }, [setConnected, increment]);

  return (
    <BrowserRouter basename="/v9/console">
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="field" element={<FieldView />} />
          <Route path="agents" element={<AgentsView />} />
          <Route path="orchestration" element={<OrchestrationView />} />
          <Route path="quality" element={<QualityView />} />
          <Route path="communication" element={<CommunicationView />} />
          <Route path="adaptation" element={<AdaptationView />} />
          <Route path="system" element={<SystemView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
