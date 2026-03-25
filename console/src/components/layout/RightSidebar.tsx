import { useEffect, useRef } from 'react';
import { panelOvershoot } from '../../engine/DisneyAnimator';
import { useInteractionStore } from '../../stores/interaction-store';
import { EventFeed } from '../cards/EventFeed';
import { ViewGuideCard } from '../cards/ViewGuideCard';
import { InspectorPanel } from '../panels/InspectorPanel';

export function RightSidebar() {
  const panelRef = useRef<HTMLElement>(null);
  const uiDepth = useInteractionStore((state) => state.uiDepth);
  const selectedAgentId = useInteractionStore((state) => state.selectedAgentId);
  const closeInspector = useInteractionStore((state) => state.closeInspector);

  useEffect(() => {
    if (!panelRef.current) {
      return;
    }

    panelOvershoot(panelRef.current);
  }, []);

  useEffect(() => {
    if (!panelRef.current || !selectedAgentId) {
      return;
    }

    panelOvershoot(panelRef.current);
  }, [selectedAgentId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedAgentId && uiDepth !== 3) {
        closeInspector();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeInspector, selectedAgentId, uiDepth]);

  return (
    <aside ref={panelRef} className="console-sidebar console-sidebar--right">
      <div className="console-inspector__header">
        <div className="console-inspector__title">
          <span className="console-inspector__subtitle">
            {selectedAgentId ? 'Agent Context' : 'Console Context'}
          </span>
          <strong>{selectedAgentId ? 'Selected Agent' : 'Guide + Timeline + Wiretap'}</strong>
        </div>

        {selectedAgentId ? (
          <button
            type="button"
            className="console-icon-button"
            onClick={closeInspector}
            aria-label="Close inspector"
          >
            X
          </button>
        ) : null}
      </div>

      <div className="console-inspector__content">
        {selectedAgentId ? (
          <InspectorPanel agentId={selectedAgentId} />
        ) : (
          <div className="console-right-rail">
            <ViewGuideCard />
            <div className="console-right-rail__feed">
              <EventFeed maxItems={18} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
