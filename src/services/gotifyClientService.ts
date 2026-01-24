/**
 * Gotify WebSocket client for React Native (iOS)
 * Used when app is active to receive real-time notifications
 */

import { GotifyMessage } from '../types/native';

type MessageCallback = (message: GotifyMessage) => void;

class GotifyClientService {
  private static instance: GotifyClientService;
  private websocket: WebSocket | null = null;
  private gotifyUrl: string = '';
  private clientToken: string = '';
  private onMessage: MessageCallback | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): GotifyClientService {
    if (!GotifyClientService.instance) {
      GotifyClientService.instance = new GotifyClientService();
    }
    return GotifyClientService.instance;
  }

  /**
   * Connect to Gotify WebSocket stream
   */
  connect(gotifyUrl: string, clientToken: string, onMessage: MessageCallback): void {
    this.gotifyUrl = gotifyUrl;
    this.clientToken = clientToken;
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

    // Convert HTTP URL to WebSocket URL
    const wsUrl = this.gotifyUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://')
      .replace(/\/$/, '') + `/stream?token=${this.clientToken}`;

    console.log('[GotifyClientService] Connecting to:', wsUrl);

    try {
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('[GotifyClientService] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startPingInterval();
      };

      this.websocket.onmessage = (event) => {
        try {
          const message: GotifyMessage = JSON.parse(event.data);
          console.log('[GotifyClientService] Message received:', message.title);
          this.onMessage?.(message);
        } catch (error) {
          console.error('[GotifyClientService] Parse error:', error);
        }
      };

      this.websocket.onerror = (error) => {
        console.error('[GotifyClientService] WebSocket error:', error);
      };

      this.websocket.onclose = (event) => {
        console.log('[GotifyClientService] WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.stopPingInterval();
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('[GotifyClientService] Connection error:', error);
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
        // Send a ping frame (empty message)
        try {
          // WebSocket API doesn't directly support ping, so we rely on the server
          // Most WebSocket servers handle this automatically
        } catch (error) {
          console.error('[GotifyClientService] Ping error:', error);
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
      console.log('[GotifyClientService] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    console.log(`[GotifyClientService] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.gotifyUrl && this.clientToken) {
        this.establishConnection();
      }
    }, delay);
  }

  /**
   * Disconnect from Gotify
   */
  disconnect(): void {
    console.log('[GotifyClientService] Disconnecting');

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
    this.gotifyUrl = '';
    this.clientToken = '';
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected && this.websocket?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const gotifyClientService = GotifyClientService.getInstance();
