/**
 * Background WebSocket client for React Native (iOS/Non-native fallback)
 * Used when app is active to receive real-time notifications
 */

// Define a generic message type matching our WebSocket protocol
export interface WebSocketMessage {
  type: string;
  payload?: any;
}

type MessageCallback = (message: WebSocketMessage) => void;

class BackgroundWebSocketClient {
  private static instance: BackgroundWebSocketClient;
  private websocket: WebSocket | null = null;
  private serviceUrl: string = '';
  private clientUserId: string = '';
  private onMessage: MessageCallback | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  private constructor() { }

  static getInstance(): BackgroundWebSocketClient {
    if (!BackgroundWebSocketClient.instance) {
      BackgroundWebSocketClient.instance = new BackgroundWebSocketClient();
    }
    return BackgroundWebSocketClient.instance;
  }

  /**
   * Connect to WebSocket stream
   */
  connect(url: string, userId: string, onMessage: MessageCallback): void {
    this.serviceUrl = url;
    this.clientUserId = userId;
    this.onMessage = onMessage;

    this.establishConnection();
  }

  /**
   * Establish WebSocket connection
   */
  private establishConnection(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    const wsUrl = this.serviceUrl;
    console.log('[BackgroundWebSocketClient] Connecting to:', wsUrl);

    try {
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('[BackgroundWebSocketClient] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startPingInterval();

        // Send auth
        const userIdInt = parseInt(this.clientUserId, 10);
        if (!isNaN(userIdInt)) {
          const authMsg = {
            type: 'auth',
            payload: { userId: userIdInt },
          };
          this.websocket?.send(JSON.stringify(authMsg));
          console.log('[BackgroundWebSocketClient] Auth sent for userId:', userIdInt);
        }
      };

      this.websocket.onmessage = (event) => {
        try {
          // React Native WebSocket event.data is string
          const dataString = typeof event.data === 'string' ? event.data : '';
          if (!dataString) {return;}

          const message: WebSocketMessage = JSON.parse(dataString);
          if (!message) {return;}
          console.log('[BackgroundWebSocketClient] Message received:', message.type);
          this.onMessage?.(message);
        } catch (error) {
          console.error('[BackgroundWebSocketClient] Parse error:', error);
        }
      };

      this.websocket.onerror = (error) => {
        console.error('[BackgroundWebSocketClient] WebSocket error:', error);
      };

      this.websocket.onclose = (event) => {
        console.log('[BackgroundWebSocketClient] WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.stopPingInterval();
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('[BackgroundWebSocketClient] Connection error:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.websocket?.readyState === WebSocket.OPEN) {
        try {
          const pingMsg = JSON.stringify({ type: 'ping' });
          this.websocket.send(pingMsg);
          console.log('[BackgroundWebSocketClient] Ping sent');
        } catch (error) {
          console.error('[BackgroundWebSocketClient] Ping error:', error);
        }
      }
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[BackgroundWebSocketClient] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    console.log(`[BackgroundWebSocketClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.serviceUrl && this.clientUserId) {
        this.establishConnection();
      }
    }, delay);
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    console.log('[BackgroundWebSocketClient] Disconnecting');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPingInterval();

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.onMessage = null;
    this.serviceUrl = '';
    this.clientUserId = '';
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected && this.websocket?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const backgroundWebSocketClient = BackgroundWebSocketClient.getInstance();
