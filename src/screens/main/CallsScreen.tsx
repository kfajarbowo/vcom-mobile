import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {apiRequest} from '../../services/apiClient';
import {useAuthStore} from '../../store/authStore';
import {useCallStore} from '../../store/callStore';
import {webrtcService} from '../../services/webrtcService';
import {websocketService} from '../../services/websocket';
import {Skeleton} from '../../components/ui/Skeleton';

interface CallHistoryItem {
  id: number;
  callId: string;
  callType: string;
  fromUserId: number;
  fromUserName: string;
  toUserId: number;
  toUserName: string;
  contactName: string;
  isOutgoing: boolean;
  status: string;
  duration: number;
  timestamp: string;
  startTime?: string;
  conversationId?: number;
  participants?: string[];
  participantNames?: string[];
}

type FilterType = 'all' | 'audio' | 'video' | 'group';

export function CallsScreen() {
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const user = useAuthStore((state) => state.user);

  const fetchCallHistory = useCallback(async () => {
    if (!user) {return;}

    try {
      console.log('[CallsScreen] Fetching call history...');
      const data = await apiRequest<CallHistoryItem[]>('/api/call-history');
      console.log('[CallsScreen] Call history received:', data?.length || 0, 'calls');
      setCallHistory(data || []);
    } catch (error) {
      console.error('[CallsScreen] Failed to fetch call history:', error);
      setCallHistory([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCallHistory();
  }, [fetchCallHistory]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchCallHistory();
  }, [fetchCallHistory]);

  const getCallIcon = (callType: string, status: string) => {
    const iconSize = 24;
    let iconName = 'phone';
    let iconColor = '#a6c455';

    if (callType?.includes('video')) {
      iconName = 'video';
      iconColor = '#6b9cc4';
    } else if (callType?.startsWith('group_')) {
      iconName = 'account-group';
      iconColor = '#c4a66b';
    }

    if (status === 'missed') {
      iconColor = '#c45555';
    }

    return (
      <MaterialCommunityIcons name={iconName} size={iconSize} color={iconColor} />
    );
  };

  const getCallStatusIcon = (status: string, isOutgoing: boolean) => {
    if (status === 'missed') {
      return (
        <MaterialCommunityIcons
          name="phone-missed"
          size={16}
          color="#c45555"
          style={styles.statusIcon}
        />
      );
    }
    if (isOutgoing) {
      return (
        <MaterialCommunityIcons
          name="phone-outgoing"
          size={16}
          color="#6b9cc4"
          style={styles.statusIcon}
        />
      );
    }
    return (
      <MaterialCommunityIcons
        name="phone-incoming"
        size={16}
        color="#a6c455"
        style={styles.statusIcon}
      />
    );
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds === 0) {return '';}
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {return 'Invalid time';}

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      // Less than 1 hour
      if (diffMins < 60) {
        return diffMins === 0 ? 'Just now' : `${diffMins}m ago`;
      }
      // Less than 24 hours
      if (diffHours < 24) {
        return `${diffHours}h ago`;
      }
      // Less than 7 days
      if (diffDays < 7) {
        return `${diffDays}d ago`;
      }

      // Format as DD/MM/YYYY
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (error) {
      return 'Invalid time';
    }
  };

  const getStatusText = (status: string, isOutgoing: boolean) => {
    if (status === 'missed') {return 'Missed call';}
    if (status === 'accepted') {return isOutgoing ? 'Outgoing' : 'Incoming';}
    if (status === 'initiated') {return 'Outgoing';}
    return status;
  };

  const filteredHistory = callHistory.filter((call) => {
    if (filter === 'all') {return true;}
    if (filter === 'audio') {return call.callType === 'audio';}
    if (filter === 'video') {return call.callType === 'video';}
    if (filter === 'group') {return call.callType?.startsWith('group_');}
    return true;
  });

  const renderFilterButton = (
    type: FilterType,
    label: string,
    icon?: string,
  ) => {
    const isActive = filter === type;
    return (
      <TouchableOpacity
        style={[styles.filterButton, isActive && styles.filterButtonActive]}
        onPress={() => setFilter(type)}>
        {icon && (
          <MaterialCommunityIcons
            name={icon}
            size={16}
            color={isActive ? '#a6c455' : '#666'}
            style={styles.filterIcon}
          />
        )}
        <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const handleCallback = async (call: CallHistoryItem) => {
    try {
      const callType = call.callType?.includes('video') ? 'video' : 'audio';

      if (call.callType?.startsWith('group_')) {
        // Group call callback — must use the GROUP protocol (start_group_call + startGroupCall),
        // not the 1:1 startCall. The 1:1 path sends initiate_call/webrtc_offer with a null target
        // (no receiverUserId), which the server broadcasts to everyone and no member ever rings.
        const conversationId = call.conversationId;
        if (!conversationId) {
          Alert.alert('Error', 'Conversation not found for this group call.');
          return;
        }

        // Group callIds must carry the 'group_call_' prefix so the server routes hangups etc. as
        // group calls (the server keys group behaviour off this prefix).
        const groupCallId = `group_call_${Date.now()}_${user?.id}`;
        const participantIds = call.participants
          ?.map(id => parseInt(id, 10))
          .filter(id => !isNaN(id) && id !== user?.id) || [];

        console.log('[CallsScreen] Starting group callback:', {
          groupCallId,
          callType,
          conversationId,
          groupName: call.contactName,
          participantIds,
        });

        useCallStore.getState().startGroupCall({
          callId: groupCallId,
          callType: callType as 'audio' | 'video',
          participantIds,
          conversationId,
          groupName: call.contactName,
        });

        websocketService.send({
          type: 'start_group_call',
          payload: {
            callId: groupCallId,
            groupId: conversationId,
            groupName: call.contactName,
            callType,
            fromUserId: user?.id,
            fromUserName: user?.callsign || user?.username || 'Unknown',
          },
        });

        await webrtcService.startGroupCall(participantIds);
        return;
      }

      const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 1:1 call callback
      const targetUserId = call.isOutgoing ? call.toUserId : call.fromUserId;
      const targetName = call.contactName;

      // Look up the direct conversation for this user
      let conversationId: number | undefined;
      try {
        const conversations = await apiRequest<any[]>('/api/direct-chats');
        const directConv = conversations?.find((c: any) =>
          c.members?.some((m: any) => m.userId === targetUserId)
        );
        conversationId = directConv?.id;
      } catch (e) {
        console.warn('[CallsScreen] Could not look up direct conversation:', e);
      }

      console.log('[CallsScreen] Starting callback:', {
        callId,
        callType,
        targetUserId,
        targetName,
        conversationId,
      });

      useCallStore.getState().startCall({
        callId,
        callType: callType as 'audio' | 'video',
        receiverUserId: targetUserId,
        receiverName: targetName,
        // Pass the real conversation id or null — do NOT substitute the peer's USER id, which the
        // server would persist as the conversationId (a user id in a conversation-id field breaks
        // history enrichment and rejoin lookups). The field is nullable server-side.
        conversationId: (conversationId ?? null) as any,
      });

      await webrtcService.startCall(callType as 'audio' | 'video');
    } catch (error: any) {
      console.error('[CallsScreen] Error during callback:', error);
      Alert.alert(
        'Call Failed',
        error.message || 'Failed to initiate call. Please try again.',
        [{text: 'OK'}]
      );
    }
  };

  const renderCallItem = ({item}: {item: CallHistoryItem}) => (
    <View style={styles.callItem}>
      <View style={styles.callIconContainer}>
        {getCallIcon(item.callType, item.status)}
      </View>

      <View style={styles.callInfo}>
        <View style={styles.callHeader}>
          <Text style={styles.contactName} numberOfLines={1}>
            {item.contactName || 'Unknown'}
          </Text>
          {item.callType?.startsWith('group_') && (
            <View style={styles.groupBadge}>
              <Text style={styles.groupBadgeText}>GROUP</Text>
            </View>
          )}
        </View>

        {item.callType?.startsWith('group_') && item.participantNames && item.participantNames.length > 0 && (
          <Text style={styles.participantNames} numberOfLines={1}>
            {item.participantNames.join(', ')}
          </Text>
        )}

        <View style={styles.callDetails}>
          {getCallStatusIcon(item.status, item.isOutgoing)}
          <Text style={styles.callStatus}>
            {getStatusText(item.status, item.isOutgoing)}
          </Text>
          {item.duration > 0 && (
            <>
              <Text style={styles.separator}>•</Text>
              <MaterialCommunityIcons
                name="clock-outline"
                size={14}
                color="#666"
                style={styles.durationIcon}
              />
              <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
            </>
          )}
        </View>

        <View style={styles.timestampContainer}>
          <MaterialCommunityIcons
            name="calendar-outline"
            size={12}
            color="#555"
          />
          <Text style={styles.timestamp}>
            {formatTimestamp(item.timestamp || item.startTime || '')}
          </Text>
        </View>
      </View>

      {/* Callback Button */}
      <TouchableOpacity
        style={styles.callbackButton}
        onPress={() => handleCallback(item)}>
        <MaterialCommunityIcons
          name={item.callType?.includes('video') ? 'video' : 'phone'}
          size={22}
          color="#a6c455"
        />
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconBox}>
        <Text style={styles.emptyIcon}>📞</Text>
      </View>
      <Text style={styles.emptyTitle}>NO CALL RECORDS</Text>
      <Text style={styles.emptySubtitle}>
        {filter === 'all'
          ? 'VOICE TRANSMISSION HISTORY EMPTY'
          : `NO ${filter.toUpperCase()} CALLS FOUND`}
      </Text>
      <View style={styles.emptyDivider} />
      <Text style={styles.emptyHint}>CALL LOGS WILL APPEAR HERE</Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>CALL LOGS</Text>
          <View style={styles.headerDivider} />
        </View>

        {/* Filter Buttons Skeleton */}
        <View style={styles.filterContainer}>
          {[1, 2, 3, 4].map((key) => (
            <Skeleton key={key} width={70} height={32} borderRadius={6} />
          ))}
        </View>

        {/* List Skeleton */}
        <View style={styles.list}>
          {[1, 2, 3, 4, 5, 6].map((key) => (
            <View key={key} style={styles.callItem}>
              <View style={[styles.callIconContainer, { borderWidth: 0 }]}>
                <Skeleton width={48} height={48} borderRadius={24} />
              </View>
              <View style={styles.callInfo}>
                <Skeleton width="50%" height={15} style={{ marginBottom: 8 }} />
                <Skeleton width="35%" height={13} style={{ marginBottom: 6 }} />
                <Skeleton width="20%" height={11} />
              </View>
              <View style={[styles.callbackButton, { borderWidth: 0 }]}>
                <Skeleton width={44} height={44} borderRadius={22} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CALL LOGS</Text>
        <View style={styles.headerDivider} />
      </View>

      {/* Filter Buttons */}
      <View style={styles.filterContainer}>
        {renderFilterButton('all', 'ALL')}
        {renderFilterButton('audio', 'AUDIO', 'phone')}
        {renderFilterButton('video', 'VIDEO', 'video')}
        {renderFilterButton('group', 'GROUP', 'account-group')}
      </View>

      {/* Call History List */}
      <FlatList
        data={filteredHistory}
        renderItem={renderCallItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={
          filteredHistory.length === 0 ? styles.emptyList : styles.list
        }
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={['#a6c455']}
            tintColor="#a6c455"
            progressBackgroundColor="#1a1a1a"
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
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
  filterContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    gap: 8,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  filterButtonActive: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
  },
  filterIcon: {
    marginRight: 4,
  },
  filterText: {
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#666',
  },
  filterTextActive: {
    color: '#a6c455',
  },
  list: {
    paddingBottom: 20,
  },
  emptyList: {
    flexGrow: 1,
  },
  callItem: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    alignItems: 'center',
  },
  callIconContainer: {
    width: 48,
    height: 48,
    backgroundColor: '#2a2a2a',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#3a3a3a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  callInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  callHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
  },
  groupBadge: {
    backgroundColor: '#4d5d30',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  groupBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 1,
  },
  participantNames: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  callDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusIcon: {
    marginRight: 4,
  },
  callStatus: {
    fontSize: 13,
    color: '#888',
  },
  separator: {
    marginHorizontal: 8,
    color: '#555',
  },
  durationIcon: {
    marginRight: 4,
  },
  duration: {
    fontSize: 13,
    color: '#888',
  },
  timestampContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timestamp: {
    fontSize: 11,
    color: '#666',
    marginLeft: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 12,
    color: '#666',
    letterSpacing: 1,
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
  callbackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2a2a2a',
    borderWidth: 2,
    borderColor: '#4d5d30',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
});
