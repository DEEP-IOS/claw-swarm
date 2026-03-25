import { Suspense, lazy, useEffect, useState } from 'react';
import { SwarmScene } from '../../engine/SwarmScene';
import { useInteractionStore } from '../../stores/interaction-store';
import { NotificationStack } from '../panels/NotificationStack';
import { Header } from './Header';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { StatusBar } from './StatusBar';

const CommandPalette = lazy(async () => {
  const module = await import('../panels/CommandPalette');
  return { default: module.CommandPalette };
});

const DeepDiveOverlay = lazy(async () => {
  const module = await import('../panels/DeepDiveOverlay');
  return { default: module.DeepDiveOverlay };
});

export function Shell() {
  const [commandOpen, setCommandOpen] = useState(false);
  const uiDepth = useInteractionStore((state) => state.uiDepth);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
        return;
      }

      event.preventDefault();
      setCommandOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="console-shell">
      <SwarmScene />
      <Header />
      <LeftSidebar />
      <RightSidebar />
      <StatusBar />
      <Suspense fallback={null}>
        {uiDepth === 3 ? <DeepDiveOverlay /> : null}
        {commandOpen ? <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} /> : null}
      </Suspense>
      <NotificationStack />
    </div>
  );
}
