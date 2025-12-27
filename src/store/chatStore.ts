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

interface ChatState {
  conversations: Conversation[];
  messages: Map<number, Message[]>;
  currentConversationId: number | null;
  isConnected: boolean;
  typingUsers: Map<number, Set<number>>;

  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: number, updates: Partial<Conversation>) => void;

  setMessages: (conversationId: number, messages: Message[]) => void;
  addMessage: (conversationId: number, message: Message) => void;
  updateMessage: (conversationId: number, messageId: number, updates: Partial<Message>) => void;

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
  currentConversationId: null,
  isConnected: false,
  typingUsers: new Map(),

  setConversations: (conversations) => set({conversations}),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  updateConversation: (id, updates) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === id ? {...conv, ...updates} : conv
      ),
    })),

  setMessages: (conversationId, messages) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.set(conversationId, messages);
      return {messages: newMessages};
    }),

  addMessage: (conversationId, message) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const conversationMessages = newMessages.get(conversationId) || [];
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
      currentConversationId: null,
      typingUsers: new Map(),
    }),
}));
