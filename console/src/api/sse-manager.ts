/**
 * SSE Manager — EventSource connection with auto-reconnect and wildcard dispatch.
 * Subscribes once, dispatches to all matching handlers.
 */

type Handler = (data: unknown, topic: string) => void;

class SSEManager {
  private source: EventSource | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private url = '';
  private _connected = false;
  private _eventCount = 0;
  private _lastEventAt = 0;
  private _onStatusChange?: (connected: boolean) => void;

  get connected() { return this._connected; }
  get eventCount() { return this._eventCount; }
  get lastEventAt() { return this._lastEventAt; }

  connect(url = '/api/v9/events', onStatusChange?: (c: boolean) => void) {
    this.url = url;
    this._onStatusChange = onStatusChange;
    this._connect();
  }

  private _connect() {
    if (this.source) {
      try { this.source.close(); } catch { /* */ }
    }

    this.source = new EventSource(this.url);

    this.source.onopen = () => {
      this._connected = true;
      this.reconnectDelay = 1000;
      this._onStatusChange?.(true);
    };

    this.source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const topic = parsed.topic || parsed.type || 'unknown';
        const data = parsed.data || parsed.payload || parsed;
        this._eventCount++;
        this._lastEventAt = Date.now();
        this.dispatch(topic, data);
      } catch { /* malformed SSE data */ }
    };

    this.source.onerror = () => {
      this._connected = false;
      this._onStatusChange?.(false);
      this.source?.close();
      setTimeout(() => this._connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    };
  }

  subscribe(pattern: string, handler: Handler): () => void {
    if (!this.handlers.has(pattern)) this.handlers.set(pattern, new Set());
    this.handlers.get(pattern)!.add(handler);
    return () => { this.handlers.get(pattern)?.delete(handler); };
  }

  private dispatch(topic: string, data: unknown) {
    for (const [pattern, handlers] of this.handlers) {
      if (this.matches(topic, pattern)) {
        for (const h of handlers) {
          try { h(data, topic); } catch { /* handler error */ }
        }
      }
    }
  }

  private matches(topic: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === topic) return true;
    if (pattern.endsWith('.*')) {
      return topic.startsWith(pattern.slice(0, -1));
    }
    return false;
  }

  disconnect() {
    this.source?.close();
    this.source = null;
    this._connected = false;
    this._onStatusChange?.(false);
  }
}

export const sseManager = new SSEManager();
