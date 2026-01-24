import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useChatStore, type Conversation} from '../store/chatStore';
import {useAuthStore} from '../store/authStore';
import {apiRequest} from '../services/apiClient';
import {websocketService} from '../services/websocket';
import {NewConversation} from './NewConversation';

interface ChatListProps {
  onSelectChat: (conversationId: number, isGroup: boolean) => void;
}

export function ChatList({onSelectChat}: ChatListProps) {
  const {user} = useAuthStore();
  const {conversations, setConversations} = useChatStore();
  const [isLoading, setIsLoading] = useState(true);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [userStatuses, setUserStatuses] = useState<Map<number, string>>(new Map());
  const [showNewConversation, setShowNewConversation] = useState(false);

  // Handle user status updates from WebSocket
  const handleUserStatus = useCallback((message: any) => {
    if (message.type === 'user_status') {
      const {userId, status} = message.payload;
      console.log('[ChatList] User status update:', userId, status);
      setUserStatuses(prev => {
        const newMap = new Map(prev);
        newMap.set(userId, status);
        return newMap;
      });
    }
  }, []);

  useEffect(() => {
    console.log('[ChatList] Component mounted, loading data...');
    loadConversations();
    loadUsers();

    // Subscribe to WebSocket messages for user status updates
    const unsubscribe = websocketService.addMessageHandler(handleUserStatus);
    return () => {
      unsubscribe();
    };
  }, [handleUserStatus]);

  const loadConversations = async () => {
    try {
      setIsLoading(true);
      console.log('[ChatList] Fetching conversations...');
      const data = await apiRequest('/api/conversations');
      console.log('[ChatList] Received conversations:', data?.length || 0);

      const formattedConversations: Conversation[] = (Array.isArray(data) ? data : [])
        .filter((conv: any) => conv && conv.id) // Filter out invalid items
        .map((conv: any) => {
          console.log('[ChatList] Mapping conversation:', conv.id, 'otherUserId:', conv.otherUserId, 'isGroup:', conv.isGroup);
          return {
            id: conv.id,
            name: conv.name || 'Unnamed Chat',
            isGroup: conv.isGroup || false,
            lastMessage: conv.lastMessage || '',
            lastMessageTime: conv.lastMessageTime || conv.updatedAt || '',
            unreadCount: conv.unreadCount || 0,
            members: conv.memberCount || 2,
            otherUserId: conv.otherUserId, // Include otherUserId for direct chats
          };
        })
        .sort((a, b) => {
          // Sort by most recent message time (newest first)
          const timeA = new Date(a.lastMessageTime || 0).getTime();
          const timeB = new Date(b.lastMessageTime || 0).getTime();
          return timeB - timeA;
        });

      console.log('[ChatList] Setting conversations:', formattedConversations.length);
      setConversations(formattedConversations);
    } catch (error) {
      console.error('[ChatList] Error loading conversations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const users = await apiRequest('/api/all-users');
      setAllUsers(users);

      // Initialize user statuses from API response
      const statusMap = new Map<number, string>();
      users.forEach((u: any) => {
        if (u.id && u.status) {
          statusMap.set(u.id, u.status);
        }
      });
      setUserStatuses(statusMap);
      console.log('[ChatList] Loaded user statuses:', statusMap.size);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const getConversationName = (conversation: Conversation): string => {
    if (!conversation || !conversation.name) {
      return 'Unknown';
    }

    if (conversation.isGroup) {
      return conversation.name;
    }

    if (conversation.name.startsWith('Direct Chat')) {
      const match = conversation.name.match(/Direct Chat (\d+)-(\d+)/);
      if (match && user) {
        const [_, id1, id2] = match;
        const partnerId =
          parseInt(id1) === user.id ? parseInt(id2) : parseInt(id1);
        const partner = allUsers.find((u) => u.id === partnerId);
        return partner?.callsign || partner?.fullName || conversation.name || 'Unknown User';
      }
    }

    return conversation.name || 'Unknown';
  };

  const formatTime = (timestamp: string): string => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    } catch {
      return '';
    }
  };

  const handleConversationCreated = (
    conversationId: number,
    isGroup: boolean
  ) => {
    loadConversations();
    onSelectChat(conversationId, isGroup);
  };

  // Get online status for a conversation (for direct chats, check the other user's status)
  const getOnlineStatus = (conversation: Conversation): boolean => {
    if (conversation.isGroup) {
      return false; // Don't show online indicator for groups
    }

    // For direct chats, check the otherUserId's status
    if (conversation.otherUserId) {
      const status = userStatuses.get(conversation.otherUserId);
      return status === 'online';
    }

    // Fallback: try to extract from conversation name
    if (conversation.name?.startsWith('Direct Chat')) {
      const match = conversation.name.match(/Direct Chat (\d+)-(\d+)/);
      if (match && user) {
        const [_, id1, id2] = match;
        const partnerId = parseInt(id1) === user.id ? parseInt(id2) : parseInt(id1);
        const status = userStatuses.get(partnerId);
        return status === 'online';
      }
    }

    return false;
  };

  const renderChatItem = ({item}: {item: Conversation}) => {
    try {
      if (!item || !item.id) {
        console.warn('[ChatList] Invalid item in renderChatItem:', item);
        return null;
      }

      const displayName = String(getConversationName(item) || 'Unknown');
      const lastMessage = String(item.lastMessage || 'NO MESSAGES');
      const timestamp = String(formatTime(item.lastMessageTime || '') || '');
      const unreadCount = Number(item.unreadCount || 0);
      const isOnline = getOnlineStatus(item);

      return (
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => onSelectChat(item.id, item.isGroup)}>
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, item.isGroup ? styles.groupAvatar : styles.directAvatar]}>
              <Text style={styles.avatarText}>
                {displayName.substring(0, 2).toUpperCase()}
              </Text>
            </View>
            {!item.isGroup && (
              <View style={[styles.onlineIndicator, isOnline ? styles.onlineIndicatorActive : styles.onlineIndicatorInactive]} />
            )}
          </View>

          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <View style={styles.chatTitleContainer}>
                <Text style={styles.chatName} numberOfLines={1}>
                  {displayName.toUpperCase()}
                </Text>
                {item.isGroup && (
                  <View style={styles.groupBadge}>
                    <Text style={styles.groupBadgeText}>GROUP</Text>
                  </View>
                )}
              </View>
              {timestamp && (
                <Text style={styles.timestamp}>{timestamp}</Text>
              )}
            </View>

            <View style={styles.chatFooter}>
              <Text style={styles.lastMessage} numberOfLines={1}>
                {lastMessage}
              </Text>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    } catch (error) {
      console.error('[ChatList] Error rendering chat item:', error, item);
      return null;
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#a6c455" />
        <Text style={styles.loadingText}>LOADING COMMUNICATIONS...</Text>
      </View>
    );
  }

  if (conversations.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconBox}>
            <Text style={styles.emptyIcon}>📡</Text>
          </View>
          <Text style={styles.emptyTitle}>NO ACTIVE CHANNELS</Text>
          <Text style={styles.emptySubtitle}>
            INITIATE NEW SECURE COMMUNICATION
          </Text>
          <View style={styles.emptyDivider} />
          <Text style={styles.emptyHint}>
            TAP THE COMMUNICATION BUTTON BELOW
          </Text>
        </View>

        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowNewConversation(true)}>
          <MaterialCommunityIcons name="account-plus" size={28} color="#a6c455" />
        </TouchableOpacity>

        <NewConversation
          visible={showNewConversation}
          onClose={() => setShowNewConversation(false)}
          onConversationCreated={handleConversationCreated}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SECURE CHANNELS</Text>
        <View style={styles.headerDivider} />
      </View>

      <FlatList
        data={conversations || []}
        renderItem={renderChatItem}
        keyExtractor={(item) => (item?.id ? String(item.id) : Math.random().toString())}
        refreshing={isLoading}
        onRefresh={loadConversations}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={null}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowNewConversation(true)}>
        <MaterialCommunityIcons name="account-plus" size={28} color="#a6c455" />
      </TouchableOpacity>

      <NewConversation
        visible={showNewConversation}
        onClose={() => setShowNewConversation(false)}
        onConversationCreated={handleConversationCreated}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#666',
    fontSize: 11,
    marginTop: 16,
    letterSpacing: 1,
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 2,
    textAlign: 'center',
  },
  headerDivider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 60,
    alignSelf: 'center',
    marginTop: 8,
  },
  listContent: {
    paddingBottom: 100,
  },
  chatItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#1a1a1a',
  },
  onlineIndicatorActive: {
    backgroundColor: '#4ade80',
  },
  onlineIndicatorInactive: {
    backgroundColor: '#666',
  },
  groupAvatar: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
  },
  directAvatar: {
    backgroundColor: '#3a3a3a',
    borderColor: '#4d5d30',
  },
  avatarText: {
    color: '#a6c455',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chatTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  chatName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  groupBadge: {
    backgroundColor: '#4d5d30',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    marginLeft: 8,
  },
  groupBadgeText: {
    color: '#a6c455',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  timestamp: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  chatFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    color: '#888',
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  unreadBadge: {
    backgroundColor: '#a6c455',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    color: '#171717',
    fontSize: 10,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconBox: {
    width: 100,
    height: 100,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#4d5d30',
    marginBottom: 24,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 2,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 11,
    color: '#666',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyDivider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 60,
    marginBottom: 16,
  },
  emptyHint: {
    fontSize: 10,
    color: '#888',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 64,
    height: 64,
    backgroundColor: '#4d5d30',
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.5,
    shadowRadius: 8,
    borderWidth: 3,
    borderColor: '#5a6b38',
  },
});
