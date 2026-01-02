import {create} from 'zustand';

export interface Message {
  id: number;
  senderId: number;
  senderName: string;
  content: string;
  timestamp: string;
  isRead: boolean;
  classification?: string;
  hasAttachment?: boolean;
  attachmentType?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  replyToId?: number;
  forwardedFromId?: number;
  isDeleted?: boolean;
  isPending?: boolean; // For optimistic updates
}

export interface Conversation {
  id: number;
  name: string;
  isGroup: boolean;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  members: number;
  otherUserId?: number;
}

export interface PaginationInfo {
  total: number;
  offset: number;
  hasMore: boolean;
  isLoading: boolean;
}

interface ChatState {
  conversations: Conversation[];
  messages: Map<number, Message[]>;
  pagination: Map<number, PaginationInfo>;
  currentConversationId: number | null;
  isConnected: boolean;
  typingUsers: Map<number, Set<number>>;

  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: number, updates: Partial<Conversation>) => void;

  setMessages: (conversationId: number, messages: Message[]) => void;
  prependMessages: (conversationId: number, messages: Message[]) => void;
  addMessage: (conversationId: number, message: Message) => void;
  updateMessage: (conversationId: number, messageId: number, updates: Partial<Message>) => void;

  setPaginationInfo: (conversationId: number, info: Partial<PaginationInfo>) => void;
  getPaginationInfo: (conversationId: number) => PaginationInfo | undefined;

  setCurrentConversationId: (id: number | null) => void;
  getCurrentMessages: () => Message[];

  setConnected: (connected: boolean) => void;

  addTypingUser: (conversationId: number, userId: number) => void;
  removeTypingUser: (conversationId: number, userId: number) => void;
  getTypingUsers: (conversationId: number) => number[];

  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  messages: new Map(),
  pagination: new Map(),
  currentConversationId: null,
  isConnected: false,
  typingUsers: new Map(),

  setConversations: (conversations) => set({conversations}),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  updateConversation: (id, updates) =>
    set((state) => {
      const updatedConversations = state.conversations.map((conv) =>
        conv.id === id ? {...conv, ...updates} : conv
      );
      // Sort by most recent message time (newest first)
      return {
        conversations: updatedConversations.sort((a, b) => {
          const timeA = new Date(a.lastMessageTime || 0).getTime();
          const timeB = new Date(b.lastMessageTime || 0).getTime();
          return timeB - timeA;
        }),
      };
    }),

  setMessages: (conversationId, messages) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.set(conversationId, messages);
      return {messages: newMessages};
    }),

  prependMessages: (conversationId, messages) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const existingMessages = newMessages.get(conversationId) || [];
      // Prepend older messages to the beginning
      newMessages.set(conversationId, [...messages, ...existingMessages]);
      return {messages: newMessages};
    }),

  addMessage: (conversationId, message) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const conversationMessages = newMessages.get(conversationId) || [];

      // Check if message already exists (prevent duplicates)
      const messageExists = conversationMessages.some(msg => msg.id === message.id);
      if (messageExists) {
        console.log('[ChatStore] Message already exists, skipping:', message.id);
        return state; // Don't update if message already exists
      }

      newMessages.set(conversationId, [...conversationMessages, message]);
      return {messages: newMessages};
    }),

  updateMessage: (conversationId, messageId, updates) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const conversationMessages = newMessages.get(conversationId) || [];
      newMessages.set(
        conversationId,
        conversationMessages.map((msg) =>
          msg.id === messageId ? {...msg, ...updates} : msg
        )
      );
      return {messages: newMessages};
    }),

  setPaginationInfo: (conversationId, info) =>
    set((state) => {
      const newPagination = new Map(state.pagination);
      const current = newPagination.get(conversationId) || {
        total: 0,
        offset: 0,
        hasMore: false,
        isLoading: false,
      };
      newPagination.set(conversationId, {...current, ...info});
      return {pagination: newPagination};
    }),

  getPaginationInfo: (conversationId) => {
    const state = get();
    return state.pagination.get(conversationId);
  },

  setCurrentConversationId: (id) => set({currentConversationId: id}),

  getCurrentMessages: () => {
    const state = get();
    if (!state.currentConversationId) return [];
    return state.messages.get(state.currentConversationId) || [];
  },

  setConnected: (connected) => set({isConnected: connected}),

  addTypingUser: (conversationId, userId) =>
    set((state) => {
      const newTypingUsers = new Map(state.typingUsers);
      const users = newTypingUsers.get(conversationId) || new Set();
      users.add(userId);
      newTypingUsers.set(conversationId, users);
      return {typingUsers: newTypingUsers};
    }),

  removeTypingUser: (conversationId, userId) =>
    set((state) => {
      const newTypingUsers = new Map(state.typingUsers);
      const users = newTypingUsers.get(conversationId);
      if (users) {
        users.delete(userId);
        if (users.size === 0) {
          newTypingUsers.delete(conversationId);
        } else {
          newTypingUsers.set(conversationId, users);
        }
      }
      return {typingUsers: newTypingUsers};
    }),

  getTypingUsers: (conversationId) => {
    const state = get();
    const users = state.typingUsers.get(conversationId);
    return users ? Array.from(users) : [];
  },

  clearChat: () =>
    set({
      conversations: [],
      messages: new Map(),
      pagination: new Map(),
      currentConversationId: null,
      typingUsers: new Map(),
    }),
}));
