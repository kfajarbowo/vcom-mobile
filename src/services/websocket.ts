import {getApiBaseUrl, getSessionToken} from './apiClient';
import {useChatStore} from '../store/chatStore';


export type WebSocketMessage = {
  type:
    | 'new_message'
    | 'user_status'
    | 'typing'
    | 'read_receipt'
    | 'incoming_call'
    | 'webrtc_offer'
    | 'webrtc_answer'
    | 'webrtc_ice_candidate'
    | 'group_webrtc_offer'
    | 'group_webrtc_answer'
    | 'group_webrtc_ice_candidate'
    | 'start_group_call'
    | 'join_group_call'
    | 'initiate_call'
    | 'initiate_group_webrtc'
    | 'end_call'
    | 'call_accepted'
    | 'call_ended'
    | 'call_missed'
    | 'incoming_group_call'
    | 'group_call_participants_update'
    | 'group_call_ended'
    | 'leave_group_call'
    | 'participant_joined'
    | 'participant_left'
    | 'group_update';
  payload: any;
};

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 999; // Keep trying to reconnect
  private reconnectDelay = 3000; // 3 seconds between attempts
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnecting = false;
  private isAuthenticated = false;

  async connect(userId?: number): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      console.log('[WebSocket] Already connected or connecting');
      return;
    }

    this.isConnecting = true;

    try {
      const baseUrl = await getApiBaseUrl();
      const wsUrl = baseUrl.replace('http', 'ws') + '/ws';
      const sessionToken = await getSessionToken();

      console.log('[WebSocket] Connecting to:', wsUrl);
      console.log('[WebSocket] Has session token:', !!sessionToken);
      console.log('[WebSocket] User ID provided:', userId);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        console.log('[WebSocket] ✅ Connected successfully');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        useChatStore.getState().setConnected(true);

        // Use provided userId or get from auth store
        let authUserId = userId;
        if (!authUserId) {
          const {useAuthStore} = await import('../store/authStore');
          authUserId = useAuthStore.getState().user?.id;
        }

        if (authUserId) {
          console.log('[WebSocket] ✅ Sending authentication with userId:', authUserId);
          this.send({
            type: 'auth',
            payload: {userId: authUserId},
          });
          // Give server time to process auth (500ms should be enough)
          setTimeout(() => {
            this.isAuthenticated = true;
            console.log('[WebSocket] ✅ Authentication complete');
          }, 500);
        } else {
          console.warn('[WebSocket] ⚠️ No user ID available for authentication');
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('[WebSocket] 📨 Message received:', message.type);

          // Log full message for call-related types
          if (message.type === 'webrtc_answer' || message.type === 'webrtc_offer') {
            console.log('[WebSocket] Full call message:', JSON.stringify(message, null, 2));
          }

          this.handleMessage(message);
        } catch (error) {
          console.error('[WebSocket] ❌ Error parsing message:', error);
          console.error('[WebSocket] Raw data:', event.data);
        }
      };

      this.ws.onerror = (error: any) => {
        // Reduce noise - only log once
        if (this.reconnectAttempts === 0) {
          console.warn('[WebSocket] ⚠️ Connection failed - app will work without real-time updates');
        }
        this.isConnecting = false;
      };

      this.ws.onclose = (event: any) => {
        console.log('[WebSocket] 🔌 Connection closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        this.isConnecting = false;
        this.isAuthenticated = false;
        useChatStore.getState().setConnected(false);
        this.ws = null;

        // Don't auto-reconnect if it was a clean close
        if (!event.wasClean) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('[WebSocket] ❌ Connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (
      this.reconnectAttempts >= this.maxReconnectAttempts ||
      this.reconnectTimeout
    ) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.log('[WebSocket] Max reconnection attempts reached. App will continue without real-time updates.');
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay;

    // Only log first reconnect attempt
    if (this.reconnectAttempts === 1) {
      console.log('[WebSocket] Will retry connection...');
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isAuthenticated = false;
    useChatStore.getState().setConnected(false);
    this.reconnectAttempts = 0;
  }

  send(message: any): void {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const messageStr = JSON.stringify(message);
        console.log('[WebSocket] ✅ Sent', message.type);
        this.ws.send(messageStr);
      } else {
        console.error('[WebSocket] ❌ Cannot send - not connected. Message type:', message.type, 'Ready state:', this.ws?.readyState);
      }
    } catch (error) {
      console.error('[WebSocket] ❌ Error sending message:', error);
    }
  }

  private async handleMessage(message: WebSocketMessage): Promise<void> {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('[WebSocket] Error in message handler:', error);
      }
    });

    const chatStore = useChatStore.getState();

    switch (message.type) {
      case 'new_message': {
        const {conversationId, ...messageData} = message.payload;
        if (conversationId) {
          // Get current user ID
          const {useAuthStore} = await import('../store/authStore');
          const currentUserId = useAuthStore.getState().user?.id;

          // Check if message is from another user
          const isOwnMessage = messageData.senderId === currentUserId;

          // Check if user is currently viewing this conversation
          const isViewingConversation = chatStore.currentConversationId === conversationId;

          console.log('[WebSocket] New message:', {
            conversationId,
            senderId: messageData.senderId,
            currentUserId,
            isOwnMessage,
            isViewingConversation
          });

          // Check if conversation exists in the store
          const existingConversation = chatStore.conversations.find(
            (conv) => conv.id === conversationId
          );

          // If conversation doesn't exist, fetch it from the API and add to store
          if (!existingConversation) {
            console.log('[WebSocket] New conversation detected, fetching details...');
            try {
              const {apiRequest} = await import('./apiClient');
              const conversationData = await apiRequest(`/api/conversations/${conversationId}`);

              if (conversationData) {
                chatStore.addConversation({
                  id: conversationData.id,
                  name: conversationData.name || 'Unnamed Chat',
                  isGroup: conversationData.isGroup || false,
                  lastMessage: messageData.content,
                  lastMessageTime: messageData.timestamp || new Date().toISOString(),
                  unreadCount: isOwnMessage ? 0 : 1,
                  members: conversationData.memberCount || 2,
                  otherUserId: conversationData.otherUserId,
                });
                console.log('[WebSocket] ✅ New conversation added to store');
              }
            } catch (error) {
              console.error('[WebSocket] ❌ Error fetching conversation details:', error);
            }
          } else {
            // Conversation exists, update it
            const currentUnreadCount = existingConversation.unreadCount || 0;

            // Increment unread count if:
            // - Message is not from current user
            // - User is not currently viewing this conversation
            const shouldIncrementUnread = !isOwnMessage && !isViewingConversation;
            const newUnreadCount = shouldIncrementUnread ? currentUnreadCount + 1 : currentUnreadCount;

            console.log('[WebSocket] Updating conversation unread count:', {
              current: currentUnreadCount,
              new: newUnreadCount,
              shouldIncrement: shouldIncrementUnread
            });

            chatStore.updateConversation(conversationId, {
              lastMessage: messageData.content,
              lastMessageTime: messageData.timestamp || new Date().toISOString(),
              unreadCount: newUnreadCount,
            });
          }

          // Add the message to the conversation
          chatStore.addMessage(conversationId, {
            id: messageData.id,
            senderId: messageData.senderId,
            senderName: messageData.senderName || 'Unknown',
            content: messageData.content,
            timestamp: messageData.timestamp || new Date().toISOString(),
            isRead: messageData.isRead || false,
            classification: messageData.classification,
            hasAttachment: messageData.hasAttachment,
            attachmentType: messageData.attachmentType,
            attachmentUrl: messageData.attachmentUrl,
            attachmentName: messageData.attachmentName,
            attachmentSize: messageData.attachmentSize,
            replyToId: messageData.replyToId,
          });
        }
        break;
      }

      case 'typing': {
        const {conversationId, userId, isTyping} = message.payload;
        if (isTyping) {
          chatStore.addTypingUser(conversationId, userId);
        } else {
          chatStore.removeTypingUser(conversationId, userId);
        }
        break;
      }

      case 'read_receipt': {
        const {conversationId, messageId} = message.payload;
        if (conversationId && messageId) {
          chatStore.updateMessage(conversationId, messageId, {isRead: true});
        }
        break;
      }

      case 'group_update': {
        const {groupId, updateType, data} = message.payload;
        if (updateType === 'name_updated') {
          chatStore.updateConversation(groupId, {name: data.name});
        }
        break;
      }

      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice_candidate':
      case 'call_accepted':
      case 'end_call': {
        // WebRTC messages are handled by call-specific message handlers
        // These are registered separately and don't need handling here
        break;
      }
    }
  }

  addMessageHandler(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isReady(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  async waitForReady(timeoutMs: number = 3000): Promise<boolean> {
    const startTime = Date.now();
    while (!this.isReady()) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn('[WebSocket] Timeout waiting for ready state');
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  }
}

export const websocketService = new WebSocketService();
