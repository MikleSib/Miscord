type Listener = (payload: any) => void;

interface PendingRequest {
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MediaRpcClient {
  private socket: WebSocket | null = null;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  async connect(url: string, ticket: string): Promise<any> {
    this.close();
    const socket = new WebSocket(url);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Media WebSocket connection timed out')), 10_000);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Media WebSocket connection failed'));
      };
    });
    socket.onmessage = (event) => this.receive(event.data);
    socket.onclose = (event) => this.failAll(new Error(event.reason || 'Media connection closed'));
    const identified = await this.request('identify', { ticket });
    this.heartbeatTimer = setInterval(() => {
      void this.request('ping', {}, 5_000).catch(() => this.close());
    }, 20_000);
    return identified;
  }

  request(type: string, data: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Media WebSocket is not connected'));
    }
    const requestId = `${Date.now().toString(36)}-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${type} request timed out`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ type, request_id: requestId, ...data }));
    });
  }

  on(type: string, listener: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.socket?.close(1000, 'Client leaving voice');
    this.socket = null;
    this.failAll(new Error('Media client closed'));
    this.listeners.clear();
  }

  private receive(raw: string): void {
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const requestId = payload.request_id;
    if (requestId && this.pending.has(requestId)) {
      const pending = this.pending.get(requestId)!;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      if (payload.type === 'error') pending.reject(new Error(payload.message || 'Media request failed'));
      else pending.resolve(payload);
      return;
    }
    for (const listener of this.listeners.get(payload.type) ?? []) listener(payload);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners.get('connection_failed') ?? []) listener({ message: error.message });
  }
}
