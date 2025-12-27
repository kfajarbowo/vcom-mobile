import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {apiRequest} from '../services/apiClient';
import {useAuthStore} from '../store/authStore';

interface User {
  id: number;
  callsign: string;
  fullName?: string;
  rank?: string;
  branch?: string;
}

interface NewConversationProps {
  visible: boolean;
  onClose: () => void;
  onConversationCreated: (conversationId: number, isGroup: boolean) => void;
}

export function NewConversation({
  visible,
  onClose,
  onConversationCreated,
}: NewConversationProps) {
  const {user} = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [showGroupNameInput, setShowGroupNameInput] = useState(false);

  useEffect(() => {
    if (visible) {
      loadUsers();
      setSelectedUsers([]);
      setSearchQuery('');
      setGroupName('');
      setShowGroupNameInput(false);
    }
  }, [visible]);

  // Show group name input automatically when 2+ users selected
  useEffect(() => {
    if (selectedUsers.length > 1) {
      setShowGroupNameInput(true);
    } else {
      setShowGroupNameInput(false);
      setGroupName('');
    }
  }, [selectedUsers.length]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredUsers(users);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredUsers(
        users.filter(
          (u) =>
            u.callsign?.toLowerCase().includes(query) ||
            u.fullName?.toLowerCase().includes(query) ||
            u.rank?.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, users]);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const allUsers = await apiRequest('/api/all-users');
      const filteredUsers = allUsers.filter((u: User) => u.id !== user?.id);
      setUsers(filteredUsers);
      setFilteredUsers(filteredUsers);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleUserSelection = (userId: number) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleCreateConversation = async () => {
    if (selectedUsers.length === 0) return;

    // For group chats, require group name
    if (selectedUsers.length > 1 && !groupName.trim()) {
      console.log('[NewConversation] Group name required');
      return;
    }

    setIsCreating(true);

    try {
      if (selectedUsers.length === 1) {
        console.log('[NewConversation] Creating direct chat');
        const response = await apiRequest('/api/direct-chats', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            otherUserId: selectedUsers[0],
          }),
        });

        onConversationCreated(response.id, false);
      } else {
        console.log('[NewConversation] Creating group chat:', groupName);
        console.log('[NewConversation] Request body:', {
          name: groupName.trim(),
          isGroup: true,
          members: selectedUsers,
          classification: 'UNCLASSIFIED',
        });

        const response = await apiRequest('/api/conversations', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            name: groupName.trim(),
            isGroup: true,
            members: selectedUsers,
            classification: 'UNCLASSIFIED',
          }),
        });

        console.log('[NewConversation] Group created, response:', response);
        onConversationCreated(response.id, true);
      }

      onClose();
    } catch (error: any) {
      console.error('[NewConversation] Error creating conversation:', error);
      console.error('[NewConversation] Error details:', {
        message: error?.message,
        status: error?.status,
        response: error?.response,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const renderUserItem = ({item}: {item: User}) => {
    const isSelected = selectedUsers.includes(item.id);

    return (
      <TouchableOpacity
        style={styles.userItem}
        onPress={() => toggleUserSelection(item.id)}>
        <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
          <Text style={styles.avatarText}>
            {item.callsign.substring(0, 2).toUpperCase()}
          </Text>
        </View>

        <View style={styles.userInfo}>
          <Text style={styles.callsign}>{item.callsign.toUpperCase()}</Text>
          {item.fullName && (
            <Text style={styles.fullName}>{item.fullName}</Text>
          )}
          {item.rank && item.branch && (
            <Text style={styles.rankBranch}>
              {item.rank} • {item.branch}
            </Text>
          )}
        </View>

        {isSelected && (
          <View style={styles.checkmark}>
            <Text style={styles.checkmarkText}>✓</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Text style={styles.cancelText}>CANCEL</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>NEW CHANNEL</Text>
            <View style={styles.headerDivider} />
          </View>

          <TouchableOpacity
            onPress={handleCreateConversation}
            disabled={
              selectedUsers.length === 0 ||
              isCreating ||
              (selectedUsers.length > 1 && !groupName.trim())
            }
            style={styles.headerButton}>
            <Text
              style={[
                styles.createText,
                (selectedUsers.length === 0 ||
                  isCreating ||
                  (selectedUsers.length > 1 && !groupName.trim())) &&
                  styles.disabledText,
              ]}>
              {isCreating ? 'WAIT...' : 'CREATE'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="SEARCH PERSONNEL..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Selection info */}
        {selectedUsers.length > 0 && (
          <View style={styles.selectionInfo}>
            <Text style={styles.selectionText}>
              {selectedUsers.length} PERSONNEL SELECTED
            </Text>
            <View style={styles.selectionBadge}>
              <Text style={styles.selectionBadgeText}>
                {selectedUsers.length === 1 ? 'DIRECT' : 'GROUP'}
              </Text>
            </View>
          </View>
        )}

        {/* Group name input */}
        {showGroupNameInput && (
          <View style={[styles.groupNameContainer, !groupName.trim() && styles.groupNameRequired]}>
            <Text style={styles.groupNameLabel}>GROUP NAME (REQUIRED)</Text>
            <TextInput
              style={styles.groupNameInput}
              placeholder="ENTER GROUP NAME..."
              placeholderTextColor="#666"
              value={groupName}
              onChangeText={setGroupName}
              autoFocus
            />
            {!groupName.trim() && (
              <Text style={styles.requiredHint}>
                ⚠ GROUP NAME IS REQUIRED TO CREATE CHANNEL
              </Text>
            )}
          </View>
        )}

        {/* User list */}
        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#a6c455" />
            <Text style={styles.loadingText}>LOADING PERSONNEL...</Text>
          </View>
        ) : filteredUsers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBox}>
              <Text style={styles.emptyIcon}>👥</Text>
            </View>
            <Text style={styles.emptyTitle}>NO PERSONNEL FOUND</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery
                ? 'ADJUST SEARCH CRITERIA'
                : 'NO AVAILABLE PERSONNEL'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            renderItem={renderUserItem}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
          />
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            SELECT 1 FOR DIRECT • 2+ FOR GROUP
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
  },
  headerButton: {
    minWidth: 70,
  },
  cancelText: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 2,
  },
  headerDivider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 50,
    marginTop: 6,
  },
  createText: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    textAlign: 'right',
  },
  disabledText: {
    color: '#4a4a4a',
  },
  searchContainer: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  searchInput: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#4d5d30',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  selectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#4d5d30',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#5a6b38',
  },
  selectionText: {
    color: '#a6c455',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  selectionBadge: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#5a6b38',
  },
  selectionBadgeText: {
    color: '#a6c455',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  groupNameContainer: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  groupNameRequired: {
    backgroundColor: '#2a1a1a',
    borderBottomWidth: 2,
    borderBottomColor: '#8d6449',
  },
  groupNameLabel: {
    color: '#888',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
  },
  groupNameInput: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#4d5d30',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  requiredHint: {
    color: '#d9a066',
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 8,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#666',
    fontSize: 11,
    marginTop: 16,
    letterSpacing: 1,
    fontWeight: '600',
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
    fontSize: 16,
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
  },
  listContent: {
    paddingBottom: 16,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 4,
    backgroundColor: '#3a3a3a',
    borderWidth: 2,
    borderColor: '#4d5d30',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarSelected: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
  },
  avatarText: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  userInfo: {
    flex: 1,
  },
  callsign: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fullName: {
    color: '#888',
    fontSize: 12,
    marginBottom: 2,
  },
  rankBranch: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  checkmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#4d5d30',
    borderWidth: 2,
    borderColor: '#5a6b38',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  checkmarkText: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 2,
    borderTopColor: '#4d5d30',
  },
  footerText: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
    fontWeight: '600',
  },
});
