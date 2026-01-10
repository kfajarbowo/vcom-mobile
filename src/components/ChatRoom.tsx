import React, {useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Image,
  Linking,
  Modal,
  Alert,
} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useChatStore, type Message} from '../store/chatStore';
import {useAuthStore} from '../store/authStore';
import {apiRequest, getApiBaseUrl, downloadAndOpenPDF} from '../services/apiClient';
import {websocketService} from '../services/websocket';
import {webrtcService} from '../services/webrtcService';
import {useCallStore} from '../store/callStore';
import {openPermissionSettings} from '../utils/permissions';
import {VideoPlayerModal} from './VideoPlayerModal';

interface ChatRoomProps {
  conversationId: number;
  isGroup: boolean;
  conversationName: string;
  otherUserId?: number;
  onBack: () => void;
}

export function ChatRoom({
  conversationId,
  isGroup,
  conversationName,
  otherUserId,
  onBack,
}: ChatRoomProps) {
  const {user} = useAuthStore();
  const setMessages = useChatStore((state) => state.setMessages);

  // Subscribe to call state to check for active group calls
  const callState = useCallStore((state) => ({
    status: state.status,
    isGroupCall: state.isGroupCall,
    conversationId: state.conversationId,
  }));

  // Debug: Log call state to see if rejoin button should show
  console.log('[ChatRoom] Call State Check:', {
    isGroup,
    conversationId,
    callStatus: callState.status,
    callIsGroupCall: callState.isGroupCall,
    callConversationId: callState.conversationId,
    shouldShowRejoin: isGroup && callState.status === 'active' && callState.isGroupCall && callState.conversationId === conversationId
  });

  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<any>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [messageMenuVisible, setMessageMenuVisible] = useState<number | null>(null);
  const [forwardDialogVisible, setForwardDialogVisible] = useState(false);
  const [messageToForward, setMessageToForward] = useState<Message | null>(null);
  const [forwardConversations, setForwardConversations] = useState<any[]>([]);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
  const [conversationMembers, setConversationMembers] = useState<any[]>([]);
  const [displayName, setDisplayName] = useState<string>(conversationName);
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<{url: string; name: string} | null>(null);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<any | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const hasScrolledToInitialPosition = useRef(false);

  // Subscribe to messages for current conversation - this will trigger re-render when messages change!
  const messages = useChatStore((state) =>
    state.currentConversationId === conversationId
      ? state.messages.get(conversationId) || []
      : []
  );

  // Subscribe to pagination info for loading indicator
  const paginationInfo = useChatStore((state) =>
    state.pagination.get(conversationId)
  );

  // Load base URL for attachment display
  useEffect(() => {
    getApiBaseUrl().then((url) => {
      console.log('[ChatRoom] Base URL loaded:', url);
      setBaseUrl(url);
    });
  }, []);

  // Scroll to unread messages or bottom on initial load
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !hasScrolledToInitialPosition.current) {
      // Find first unread message that's not sent by current user
      const firstUnreadIndex = messages.findIndex(
        (msg) => !msg.isRead && Number(msg.senderId) !== Number(user?.id)
      );

      setTimeout(() => {
        if (firstUnreadIndex !== -1) {
          console.log('[ChatRoom] Scrolling to first unread message at index:', firstUnreadIndex);
          // Note: Since we're using grouped messages in FlatList, we scroll to end for now
          // A more sophisticated implementation would calculate the group index
          flatListRef.current?.scrollToEnd({animated: false});
        } else {
          console.log('[ChatRoom] No unread messages, scrolling to bottom');
          flatListRef.current?.scrollToEnd({animated: false});
        }
        hasScrolledToInitialPosition.current = true;
      }, 100);
    }
  }, [isLoading, messages.length, user?.id]);

  // Load conversation members (for determining call recipient and sender names)
  useEffect(() => {
    const loadMembers = async () => {
      try {
        console.log('[ChatRoom] Loading members for conversation:', conversationId);
        const members = await apiRequest(`/api/conversations/${conversationId}/members`);
        console.log('[ChatRoom] Raw members response:', JSON.stringify(members, null, 2));
        console.log('[ChatRoom] Is array?', Array.isArray(members));
        console.log('[ChatRoom] Members length:', members?.length);
        console.log('[ChatRoom] Current user ID:', user?.id);

        if (Array.isArray(members)) {
          console.log('[ChatRoom] ===== CONVERSATION MEMBERS =====');
          members.forEach((member: any, index: number) => {
            console.log(`[ChatRoom] Member ${index}:`, JSON.stringify(member, null, 2));
            console.log(`[ChatRoom] Member ${index} userId:`, member.userId);
            console.log(`[ChatRoom] Member ${index} callsign:`, member.callsign);
            console.log(`[ChatRoom] Member ${index} fullName:`, member.fullName);
          });
          console.log('[ChatRoom] =====================================');
          setConversationMembers(members);

          // For direct chats, set display name to other participant's name
          if (!isGroup && members.length === 2) {
            const otherMember = members.find((m: any) => m.userId !== user?.id);
            if (otherMember) {
              const otherName = otherMember.callsign || otherMember.fullName || 'Unknown User';
              console.log('[ChatRoom] Setting display name for direct chat:', otherName);
              setDisplayName(otherName);
            }
          }
        } else {
          console.error('[ChatRoom] Members is not an array:', typeof members);
          setConversationMembers([]);
        }
      } catch (error) {
        console.error('[ChatRoom] Error loading members:', error);
      }
    };
    loadMembers();
  }, [conversationId, isGroup, user?.id]);

  useEffect(() => {
    useChatStore.getState().setCurrentConversationId(conversationId);
    hasScrolledToInitialPosition.current = false; // Reset scroll flag for new conversation

    // Only load messages after conversationMembers are loaded
    if (conversationMembers && conversationMembers.length > 0) {
      loadMessages(true);
    }

    console.log('[ChatRoom] Setting up WebSocket handler for conversation:', conversationId);

    const removeHandler = websocketService.addMessageHandler((message) => {
      // Only log and process new_message types (ignore call/status messages - they're handled by CallManager)
      if (message.type === 'new_message') {
        console.log('[ChatRoom] WebSocket message received:', {
          type: message.type,
          payloadConversationId: message.payload?.conversationId,
          currentConversationId: conversationId,
          matches: message.payload?.conversationId === conversationId,
        });

        if (message.payload.conversationId === conversationId) {
          console.log('[ChatRoom] ✅ Message matches current conversation, reloading...');
          loadMessages(false);
        } else {
          console.log('[ChatRoom] ⚠️ Message for different conversation');
        }
      }
    });

    return () => {
      console.log('[ChatRoom] Removing WebSocket handler for conversation:', conversationId);
      removeHandler();
      useChatStore.getState().setCurrentConversationId(null);
    };
  }, [conversationId, conversationMembers]);

  const loadMessages = async (showLoading: boolean = false, loadMore: boolean = false) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }

      const paginationInfo = useChatStore.getState().getPaginationInfo(conversationId);

      // If already loading or no more messages, return
      if (loadMore && (paginationInfo?.isLoading || !paginationInfo?.hasMore)) {
        console.log('[ChatRoom] Skipping load - already loading or no more messages');
        return;
      }

      // Set loading state in pagination
      if (loadMore) {
        useChatStore.getState().setPaginationInfo(conversationId, {isLoading: true});
      }

      const limit = 15;
      let offset = loadMore ? (paginationInfo?.offset || 0) : 0;

      // For initial load, check if there are unread messages
      // If yes, we need to load from the last 15 read messages
      if (!loadMore && offset === 0) {
        console.log('[ChatRoom] Initial load - checking for unread messages...');

        // First, get total count and check for unread messages
        // We need to call without pagination to get all messages for checking
        const checkResponse = await apiRequest(
          `/api/conversations/${conversationId}/messages`
        );

        if (checkResponse) {
          const allMessages = checkResponse?.messages || checkResponse || [];
          const total = checkResponse?.total || allMessages.length || 0;

          // Find first unread message that's not sent by current user
          const firstUnreadIndex = allMessages.findIndex(
            (msg: any) => !msg.isRead && Number(msg.senderId) !== Number(user?.id)
          );

          console.log('[ChatRoom] Total messages:', total, 'First unread index:', firstUnreadIndex);

          if (firstUnreadIndex !== -1 && firstUnreadIndex >= limit) {
            // There are unread messages beyond the first 15
            // Calculate offset to load the last 15 read messages
            // If there are 50 messages total and first unread is at index 40,
            // we want to load messages from index 25-39 (15 read messages before the unread)
            const readMessagesCount = firstUnreadIndex;
            offset = Math.max(0, total - readMessagesCount - limit);

            console.log('[ChatRoom] Unread messages detected. Loading from offset:', offset);
            console.log('[ChatRoom] This will show last 15 read messages');
          } else {
            console.log('[ChatRoom] No unread messages or fewer than 15 read messages. Will load last 15.');
          }
        }
      }

      console.log('[ChatRoom] Loading messages for conversation:', conversationId, 'limit:', limit, 'offset:', offset, 'loadMore:', loadMore);

      // Now make the actual paginated request
      const response = await apiRequest(
        `/api/conversations/${conversationId}/messages?limit=${limit}&offset=${offset}`
      );

      console.log('[ChatRoom] Received response:', response);

      const data = response?.messages || response || [];
      const total = response?.total || 0;
      const hasMore = response?.hasMore || false;

      console.log('[ChatRoom] Received messages:', data?.length || 0, 'total:', total, 'hasMore:', hasMore);

      const formattedMessages: Message[] = (Array.isArray(data) ? data : []).map((msg: any, index: number) => {
        // Look up sender name from conversationMembers
        let senderName = 'Unknown';

        if (index === 0) {
          console.log('[ChatRoom] ===== SENDER LOOKUP DEBUG =====');
          console.log('[ChatRoom] conversationMembers available:', !!conversationMembers);
          console.log('[ChatRoom] conversationMembers length:', conversationMembers?.length);
          console.log('[ChatRoom] First message senderId:', msg.senderId, 'type:', typeof msg.senderId);
          console.log('[ChatRoom] conversationMembers:', JSON.stringify(conversationMembers, null, 2));
        }

        if (conversationMembers && Array.isArray(conversationMembers)) {
          const member = conversationMembers.find(m => m.userId === msg.senderId);
          if (index === 0) {
            console.log('[ChatRoom] Found member for senderId', msg.senderId, ':', !!member);
            if (member) {
              console.log('[ChatRoom] Member data:', JSON.stringify(member, null, 2));
            }
          }
          if (member) {
            senderName = member.callsign || member.fullName || 'Unknown';
          }
        }

        if (index === 0) {
          console.log('[ChatRoom] Final senderName:', senderName);
          console.log('[ChatRoom] ==============================');
        }

        return {
          id: msg.id,
          senderId: msg.senderId,
          senderName: senderName,
          content: msg.content,
          timestamp: msg.timestamp || msg.createdAt,
          isRead: msg.isRead || false,
          classification: msg.classification,
          hasAttachment: msg.hasAttachment,
          attachmentType: msg.attachmentType,
          attachmentUrl: msg.attachmentUrl,
          attachmentName: msg.attachmentName,
          attachmentSize: msg.attachmentSize,
          replyToId: msg.replyToId,
          forwardedFromId: msg.forwardedFromId,
          isDeleted: msg.isDeleted,
        };
      });

      console.log('[ChatRoom] Formatted', formattedMessages.length, 'messages');

      if (loadMore) {
        // Prepend older messages
        useChatStore.getState().prependMessages(conversationId, formattedMessages);
      } else {
        // Initial load - set messages
        setMessages(conversationId, formattedMessages);
      }

      // Update pagination info
      useChatStore.getState().setPaginationInfo(conversationId, {
        total,
        offset: offset + formattedMessages.length,
        hasMore,
        isLoading: false,
      });

      if (!loadMore) {
        await apiRequest(`/api/conversations/${conversationId}/mark-read`, {
          method: 'POST',
        }).catch(err => console.warn('[ChatRoom] Mark read failed:', err));

        // Reset unread count in local store
        useChatStore.getState().updateConversation(conversationId, {
          unreadCount: 0,
        });
        console.log('[ChatRoom] Reset unread count to 0 for conversation:', conversationId);

        // Scroll to end after initial load
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({animated: !showLoading});
        }, showLoading ? 300 : 100);
      }
    } catch (error) {
      console.error('[ChatRoom] Error loading messages:', error);
      useChatStore.getState().setPaginationInfo(conversationId, {isLoading: false});
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  const handleAttachment = () => {
    setAttachmentMenuVisible(true);
  };

  const handleImageVideoPicker = () => {
    setAttachmentMenuVisible(false);
    launchImageLibrary(
      {
        mediaType: 'mixed',
        quality: 0.8,
        selectionLimit: 1,
      },
      (response) => {
        if (response.didCancel) {
          console.log('[ChatRoom] User cancelled image picker');
        } else if (response.errorCode) {
          console.error('[ChatRoom] ImagePicker Error:', response.errorMessage);
        } else if (response.assets && response.assets[0]) {
          setSelectedAttachment(response.assets[0]);
          console.log('[ChatRoom] Attachment selected:', response.assets[0]);
        }
      }
    );
  };

  const handleDocumentPicker = async () => {
    setAttachmentMenuVisible(false);
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.pdf],
        copyTo: 'cachesDirectory',
      });

      if (result && result[0]) {
        const doc = result[0];
        console.log('[ChatRoom] Document selected:', doc);

        // Convert to the same format as image picker
        const attachment = {
          uri: doc.fileCopyUri || doc.uri,
          type: doc.type,
          fileName: doc.name,
          fileSize: doc.size,
        };

        setSelectedAttachment(attachment);
      }
    } catch (err) {
      if (DocumentPicker.isCancel(err)) {
        console.log('[ChatRoom] User cancelled document picker');
      } else {
        console.error('[ChatRoom] DocumentPicker Error:', err);
        Alert.alert('Error', 'Failed to pick document');
      }
    }
  };

  const uploadAttachment = async (file: any): Promise<any> => {
    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      type: file.type || 'application/octet-stream',
      name: file.fileName || 'attachment',
    } as any);

    const baseUrl = await getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/attachments/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to upload attachment');
    }

    return await response.json();
  };

  const sendMessage = async () => {
    if ((!messageText.trim() && !selectedAttachment) || !user || isSending) return;

    const content = messageText.trim() || (selectedAttachment ? '[Attachment]' : '');
    setMessageText('');
    setIsSending(true);

    console.log('[ChatRoom] Sending message from user:', user.id);

    try {
      let attachmentData = null;

      // Upload attachment if selected
      if (selectedAttachment) {
        console.log('[ChatRoom] Uploading attachment...');
        const uploadResponse = await uploadAttachment(selectedAttachment);
        console.log('[ChatRoom] Upload response:', uploadResponse);

        // Extract file data from response
        if (uploadResponse.success && uploadResponse.file) {
          attachmentData = uploadResponse.file;
        } else {
          throw new Error('Invalid upload response');
        }
        console.log('[ChatRoom] Attachment uploaded:', attachmentData);
      }

      const messagePayload: any = {
        conversationId,
        content,
        classification: 'UNCLASSIFIED',
      };

      if (attachmentData) {
        messagePayload.hasAttachment = true;
        messagePayload.attachmentType = attachmentData.type;
        messagePayload.attachmentUrl = attachmentData.url;
        messagePayload.attachmentName = attachmentData.name;
        messagePayload.attachmentSize = attachmentData.size;
      }

      if (replyToMessage) {
        messagePayload.replyToId = replyToMessage.id;
      }

      const response = await apiRequest('/api/messages', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(messagePayload),
      });

      console.log('[ChatRoom] Message sent successfully:', response);

      // Clear attachment and reply
      setSelectedAttachment(null);
      setReplyToMessage(null);

      // Reload messages immediately to show the new message (without showing loading spinner)
      await loadMessages(false);

    } catch (error) {
      console.error('[ChatRoom] Error sending message:', error);
      setMessageText(content);
    } finally {
      setIsSending(false);
    }
  };

  const handleForwardMessage = async (message: Message) => {
    setMessageToForward(message);
    setMessageMenuVisible(null);
    setForwardDialogVisible(true);

    // Load conversations for forwarding
    try {
      const data = await apiRequest('/api/conversations');
      // Filter out current conversation
      const otherConversations = (Array.isArray(data) ? data : [])
        .filter((conv: any) => conv.id !== conversationId);
      setForwardConversations(otherConversations);
    } catch (error) {
      console.error('[ChatRoom] Error loading conversations for forward:', error);
    }
  };

  const handleForwardToConversation = async (targetConversationId: number) => {
    if (!messageToForward) return;

    try {
      console.log('[ChatRoom] Forwarding message to conversation:', targetConversationId);
      await apiRequest(`/api/messages/${messageToForward.id}/forward`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversationId: targetConversationId }),
      });
      setForwardDialogVisible(false);
      setMessageToForward(null);
      console.log('[ChatRoom] Message forwarded successfully');
    } catch (error) {
      console.error('[ChatRoom] Error forwarding message:', error);
    }
  };

  const handleDeleteMessage = (message: Message) => {
    setMessageToDelete(message);
    setMessageMenuVisible(null);
    setDeleteDialogVisible(true);
  };

  const handleStartCall = async (callType: 'audio' | 'video') => {
    try {
      console.log('[ChatRoom] Starting call:', callType);
      console.log('[ChatRoom] conversationId:', conversationId);
      console.log('[ChatRoom] isGroup:', isGroup);
      console.log('[ChatRoom] conversationMembers:', conversationMembers);

      // Wait for WebSocket to be fully ready (connected and authenticated)
      console.log('[ChatRoom] Checking WebSocket connection...');
      const isReady = await websocketService.waitForReady(3000);
      if (!isReady) {
        console.error('[ChatRoom] WebSocket not ready for calls');
        Alert.alert(
          'Connection Not Ready',
          'Please wait a moment for the connection to establish, then try again.',
          [{text: 'OK', style: 'default'}]
        );
        return;
      }
      console.log('[ChatRoom] WebSocket ready, proceeding with call');

      // For group calls, use group call handling
      if (isGroup) {
        return handleStartGroupCall(callType);
      }

      // Find the other user ID from conversation members (same as web version)
      console.log('[ChatRoom] Current user?.id:', user?.id, typeof user?.id);
      console.log('[ChatRoom] conversationMembers:', conversationMembers);
      console.log('[ChatRoom] conversationMembers.length:', conversationMembers.length);

      conversationMembers.forEach((member: any, index: number) => {
        console.log(`[ChatRoom] Checking member ${index}:`, {
          userId: member.userId,
          userIdType: typeof member.userId,
          currentUserId: user?.id,
          currentUserIdType: typeof user?.id,
          matches: member.userId === user?.id,
          notMatches: member.userId !== user?.id
        });
      });

      const otherMember = conversationMembers.find((member: any) => {
        const isOther = member.userId !== user?.id;
        console.log(`[ChatRoom] Testing member ${member.userId}: isOther=${isOther}`);
        return isOther;
      });

      console.log('[ChatRoom] otherMember found:', otherMember);

      if (!otherMember) {
        console.error('[ChatRoom] Could not find other member in conversation');
        console.error('[ChatRoom] conversationMembers:', JSON.stringify(conversationMembers, null, 2));
        console.error('[ChatRoom] user?.id:', user?.id);
        Alert.alert(
          'Call Failed',
          `Unable to determine call recipient. Members: ${conversationMembers.length}, UserId: ${user?.id}`,
          [{text: 'OK', style: 'default'}]
        );
        return;
      }

      const recipientUserId = otherMember.userId;
      console.log('[ChatRoom] Found recipient userId:', recipientUserId);

      // Generate unique call ID
      const callId = `call_${Date.now()}_${user?.id}`;

      // Initialize call in store
      useCallStore.getState().startCall({
        callId,
        callType,
        receiverUserId: recipientUserId,
        receiverName: displayName,
        conversationId,
      });

      // Start WebRTC connection
      await webrtcService.startCall(callType);
    } catch (error: any) {
      console.error('[ChatRoom] Error starting call:', error);
      webrtcService.endCall();

      // Show user-friendly error message
      if (error.message?.includes('permissions')) {
        Alert.alert(
          'Permission Required',
          'VComm needs camera and microphone permissions to make calls. Please grant permissions in your device settings.',
          [
            {text: 'Cancel', style: 'cancel'},
            {
              text: 'Open Settings',
              onPress: () => openPermissionSettings(),
              style: 'default',
            },
          ]
        );
      } else {
        Alert.alert(
          'Call Failed',
          'Unable to start call. Please try again.',
          [{text: 'OK', style: 'default'}]
        );
      }
    }
  };

  const handleStartGroupCall = async (callType: 'audio' | 'video') => {
    try {
      console.log('[ChatRoom] Starting group call:', callType);

      // Wait for WebSocket to be fully ready (connected and authenticated)
      console.log('[ChatRoom] Checking WebSocket connection for group call...');
      const isReady = await websocketService.waitForReady(3000);
      if (!isReady) {
        console.error('[ChatRoom] WebSocket not ready for group calls');
        Alert.alert(
          'Connection Not Ready',
          'Please wait a moment for the connection to establish, then try again.',
          [{text: 'OK', style: 'default'}]
        );
        return;
      }
      console.log('[ChatRoom] WebSocket ready, proceeding with group call');

      // Get all participant IDs (excluding current user)
      const participantIds = conversationMembers
        .filter((member: any) => member.userId !== user?.id)
        .map((member: any) => member.userId);

      console.log('[ChatRoom] Group call participants:', participantIds);

      if (participantIds.length === 0) {
        Alert.alert(
          'No Participants',
          'Cannot start a group call with no other participants.',
          [{text: 'OK', style: 'default'}]
        );
        return;
      }

      // Generate unique call ID
      const callId = `group_call_${Date.now()}_${user?.id}`;

      // Initialize group call in store
      useCallStore.getState().startGroupCall({
        callId,
        callType,
        participantIds,
        conversationId,
        groupName: conversationName,
      });

      // Notify all participants via WebSocket
      websocketService.send({
        type: 'start_group_call',
        payload: {
          callId,
          groupId: conversationId,
          groupName: conversationName,
          callType,
          fromUserId: user?.id,
          fromUserName: user?.callsign || user?.username || 'Unknown'
        }
      });

      // Start WebRTC group call
      await webrtcService.startGroupCall(participantIds);

      console.log('[ChatRoom] Group call started successfully');
    } catch (error: any) {
      console.error('[ChatRoom] Error starting group call:', error);
      webrtcService.endGroupCall();

      // Show user-friendly error message
      if (error.message?.includes('permissions')) {
        Alert.alert(
          'Permission Required',
          'VComm needs camera and microphone permissions to make calls. Please grant permissions in your device settings.',
          [
            {text: 'Cancel', style: 'cancel'},
            {
              text: 'Open Settings',
              onPress: () => openPermissionSettings(),
              style: 'default',
            },
          ]
        );
      } else {
        Alert.alert(
          'Call Failed',
          'Unable to start group call. Please try again.',
          [{text: 'OK', style: 'default'}]
        );
      }
    }
  };

  const performDelete = async (deleteForEveryone: boolean) => {
    if (!messageToDelete) return;

    try {
      console.log('[ChatRoom] Deleting message:', messageToDelete.id, 'deleteForEveryone:', deleteForEveryone);
      await apiRequest(`/api/messages/${messageToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deleteForEveryone }),
      });
      // Reload messages after delete
      await loadMessages(false);
      setDeleteDialogVisible(false);
      setMessageToDelete(null);
      console.log('[ChatRoom] Message deleted successfully');
    } catch (error) {
      console.error('[ChatRoom] Error deleting message:', error);
    }
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

  const renderMessage = ({item}: {item: Message}): JSX.Element => {
    if (!item) return <View />;

    // Ensure both are numbers for comparison
    const isOwnMessage = Number(item.senderId) === Number(user?.id);
    const senderName = item.senderName || 'Unknown';
    const content = item.content || '';

    // Find replied-to message
    const repliedMessage = item.replyToId
      ? messages.find(m => m.id === item.replyToId)
      : null;

    // Get full attachment URL
    const getFullAttachmentUrl = (url: string | undefined) => {
      if (!url || !baseUrl) {
        console.log('[ChatRoom] getFullAttachmentUrl - missing url or baseUrl:', {url, baseUrl});
        return '';
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        console.log('[ChatRoom] getFullAttachmentUrl - already full URL:', url);
        return url;
      }
      // Use the baseUrl from state
      const fullUrl = `${baseUrl}${url.startsWith('/') ? url : '/' + url}`;
      console.log('[ChatRoom] getFullAttachmentUrl - constructed:', {url, baseUrl, fullUrl});
      return fullUrl;
    };

    return (
      <View
        style={[
          styles.messageRow,
          isOwnMessage ? styles.ownMessageRow : styles.otherMessageRow,
        ]}>
        <View
          style={[
            styles.messageBubble,
            isOwnMessage ? styles.ownMessage : styles.otherMessage,
          ]}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => setMessageMenuVisible(item.id)}
            activeOpacity={0.7}>
            <MaterialCommunityIcons name="dots-horizontal" size={16} color="#a6c455" />
          </TouchableOpacity>

          <Text style={styles.senderName}>
            {isOwnMessage ? 'YOU' : senderName.toUpperCase()}
          </Text>

          {repliedMessage && (
            <View style={styles.repliedMessageContainer}>
              <View style={styles.repliedMessageContent}>
                <Text style={styles.repliedMessageSender}>
                  {repliedMessage.senderName?.toUpperCase() || 'UNKNOWN'}
                </Text>
                <Text style={styles.repliedMessageText} numberOfLines={2}>
                  {repliedMessage.content}
                </Text>
              </View>
            </View>
          )}

          {item.hasAttachment && item.attachmentUrl && (
            <View style={styles.attachmentContainer}>
              {item.attachmentType === 'image' ? (
                <Image
                  source={{uri: getFullAttachmentUrl(item.attachmentUrl)}}
                  style={styles.attachmentImage}
                  resizeMode="cover"
                  onError={(error) => {
                    console.log('[ChatRoom] Image load error:', error.nativeEvent);
                    console.log('[ChatRoom] Failed URL:', getFullAttachmentUrl(item.attachmentUrl));
                  }}
                  onLoad={() => {
                    console.log('[ChatRoom] Image loaded successfully:', getFullAttachmentUrl(item.attachmentUrl));
                  }}
                />
              ) : item.attachmentType === 'video' ? (
                <TouchableOpacity
                  style={styles.videoAttachment}
                  onPress={() => {
                    const fullUrl = getFullAttachmentUrl(item.attachmentUrl);
                    if (fullUrl) {
                      setSelectedVideo({
                        url: fullUrl,
                        name: item.attachmentName || 'Video',
                      });
                      setVideoPlayerVisible(true);
                    }
                  }}>
                  <View style={styles.videoThumbnail}>
                    <MaterialCommunityIcons name="play-circle-outline" size={64} color="#a6c455" />
                  </View>
                  <Text style={styles.videoFileName} numberOfLines={1}>
                    {item.attachmentName || 'Video'}
                  </Text>
                </TouchableOpacity>
              ) : item.attachmentType === 'document' || item.attachmentName?.endsWith('.pdf') ? (
                <TouchableOpacity
                  style={styles.fileAttachment}
                  onPress={async () => {
                    const fullUrl = getFullAttachmentUrl(item.attachmentUrl);
                    if (fullUrl) {
                      try {
                        await downloadAndOpenPDF(fullUrl, item.attachmentName || 'document.pdf');
                      } catch (error) {
                        console.error('[ChatRoom] Failed to open PDF:', error);
                        Alert.alert('Error', 'Failed to download or open PDF file');
                      }
                    }
                  }}>
                  <MaterialCommunityIcons name="file-pdf-box" size={32} color="#d97070" />
                  <Text style={styles.fileName} numberOfLines={1}>
                    {item.attachmentName || 'PDF Document'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.fileAttachment}
                  onPress={() => {
                    const fullUrl = getFullAttachmentUrl(item.attachmentUrl);
                    if (fullUrl) Linking.openURL(fullUrl);
                  }}>
                  <Text style={styles.fileIcon}>📎</Text>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {item.attachmentName || 'File'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={styles.messageText}>{content}</Text>

          <View style={styles.messageFooter}>
            <Text style={styles.messageTime}>{formatTime(item.timestamp || '')}</Text>
            {isOwnMessage && (
              <Text style={styles.messageStatus}>
                {item.isRead ? 'READ' : item.id ? 'SENT' : 'PENDING'}
              </Text>
            )}
          </View>
        </View>

        {!isOwnMessage && (
          <TouchableOpacity
            style={styles.replyButton}
            onPress={() => setReplyToMessage(item)}
            activeOpacity={0.7}>
            <MaterialCommunityIcons name="reply" size={20} color="#a6c455" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderDateSeparator = (date: string) => (
    <View style={styles.dateSeparator}>
      <View style={styles.dateBadge}>
        <Text style={styles.dateText}>
          {new Date(date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }).toUpperCase()}
        </Text>
      </View>
    </View>
  );

  const groupMessagesByDate = (messages: Message[]) => {
    const grouped: {date: string; messages: Message[]}[] = [];
    let currentDate = '';

    messages.forEach((message) => {
      const messageDate = new Date(message.timestamp).toDateString();

      if (messageDate !== currentDate) {
        grouped.push({date: messageDate, messages: [message]});
        currentDate = messageDate;
      } else {
        grouped[grouped.length - 1].messages.push(message);
      }
    });

    return grouped;
  };

  const groupedMessages = groupMessagesByDate(messages);

  // Render loading indicator for pagination
  const renderLoadingIndicator = () => {
    if (!paginationInfo?.isLoading) return null;

    return (
      <View style={styles.loadingMoreContainer}>
        <ActivityIndicator size="small" color="#a6c455" />
        <Text style={styles.loadingMoreText}>LOADING MESSAGES...</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => setInfoModalVisible(true)}
          activeOpacity={0.7}>
          <View style={[styles.headerAvatar, isGroup ? styles.groupAvatar : styles.directAvatar]}>
            <Text style={styles.headerAvatarText}>
              {displayName.substring(0, 2).toUpperCase()}
            </Text>
          </View>

          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {displayName.toUpperCase()}
            </Text>
            <View style={styles.headerStatus}>
              <View style={styles.statusDot} />
              <Text style={styles.headerSubtitle}>
                {isGroup ? 'GROUP CHANNEL' : 'DIRECT CHAT'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Show Rejoin button if there's an active group call for this conversation */}
          {isGroup &&
           callState.status === 'active' &&
           callState.isGroupCall &&
           callState.conversationId === conversationId ? (
            <TouchableOpacity
              style={styles.rejoinButton}
              onPress={() => handleStartCall('video')}>
              <MaterialCommunityIcons
                name="phone-plus"
                size={18}
                color="#ffffff"
              />
              <Text style={styles.rejoinButtonText}>Rejoin</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.callButton}
                onPress={() => handleStartCall('video')}>
                <MaterialCommunityIcons
                  name="video"
                  size={18}
                  color="#a6c455"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.callButton}
                onPress={() => handleStartCall('audio')}>
                <MaterialCommunityIcons
                  name="phone"
                  size={18}
                  color="#a6c455"
                />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Messages */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#a6c455" />
          <Text style={styles.loadingText}>LOADING SECURE CHANNEL...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          renderItem={({item: group}) => (
            <View>
              {renderDateSeparator(group.date)}
              {group.messages.map((message: Message, index: number) => (
                <React.Fragment key={`${message.id}-${index}`}>
                  {renderMessage({item: message})}
                </React.Fragment>
              ))}
            </View>
          )}
          keyExtractor={(item) => item.date}
          contentContainerStyle={styles.messagesContent}
          ListHeaderComponent={renderLoadingIndicator}
          onContentSizeChange={() => {
            // Only auto-scroll to end if we've already done initial positioning
            // This prevents scrolling during initial load
            if (hasScrolledToInitialPosition.current) {
              flatListRef.current?.scrollToEnd({animated: true});
            }
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            // Check if user scrolled to top (within 100px threshold)
            if (contentOffset.y < 100) {
              const paginationInfo = useChatStore.getState().getPaginationInfo(conversationId);
              if (paginationInfo?.hasMore && !paginationInfo?.isLoading) {
                console.log('[ChatRoom] Near top, loading more messages...');
                loadMessages(false, true);
              }
            }
          }}
          scrollEventThrottle={400}
        />
      )}

      {messages.length === 0 && !isLoading && (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconBox}>
            <Text style={styles.emptyIcon}>🔐</Text>
          </View>
          <Text style={styles.emptyTitle}>SECURE CHANNEL ESTABLISHED</Text>
          <Text style={styles.emptySubtitle}>
            MILITARY-GRADE ENCRYPTION ACTIVE
          </Text>
          <View style={styles.emptyDivider} />
          <Text style={styles.emptyHint}>
            ALL TRANSMISSIONS ARE PROTECTED
          </Text>
        </View>
      )}

      {/* Input Area */}
      <View style={styles.inputContainer}>
        {/* Reply Preview */}
        {replyToMessage && (
          <View style={styles.replyPreview}>
            <View style={styles.replyPreviewContent}>
              <View style={styles.replyPreviewText}>
                <Text style={styles.replyPreviewLabel}>
                  REPLYING TO {replyToMessage.senderName?.toUpperCase() || 'UNKNOWN'}
                </Text>
                <Text style={styles.replyPreviewMessage} numberOfLines={1}>
                  {replyToMessage.content}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.removeReply}
                onPress={() => setReplyToMessage(null)}>
                <MaterialCommunityIcons name="close" size={18} color="#d97070" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Attachment Preview */}
        {selectedAttachment && (
          <View style={styles.attachmentPreview}>
            <View style={styles.attachmentPreviewContent}>
              {selectedAttachment.type?.startsWith('image/') ? (
                <Image
                  source={{uri: selectedAttachment.uri}}
                  style={styles.previewImage}
                />
              ) : selectedAttachment.type?.startsWith('video/') ? (
                <View style={styles.previewFile}>
                  <MaterialCommunityIcons name="video" size={24} color="#a6c455" />
                  <Text style={styles.previewFileName} numberOfLines={1}>
                    {selectedAttachment.fileName}
                  </Text>
                </View>
              ) : selectedAttachment.type === 'application/pdf' ? (
                <View style={styles.previewFile}>
                  <MaterialCommunityIcons name="file-pdf-box" size={24} color="#d97070" />
                  <Text style={styles.previewFileName} numberOfLines={1}>
                    {selectedAttachment.fileName}
                  </Text>
                </View>
              ) : (
                <View style={styles.previewFile}>
                  <Text style={styles.previewFileIcon}>📎</Text>
                  <Text style={styles.previewFileName} numberOfLines={1}>
                    {selectedAttachment.fileName}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.removeAttachment}
                onPress={() => setSelectedAttachment(null)}>
                <Text style={styles.removeIcon}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Attachment Menu */}
        {attachmentMenuVisible && (
          <View style={styles.attachmentMenu}>
            <TouchableOpacity
              style={styles.attachmentOption}
              onPress={handleImageVideoPicker}
              activeOpacity={0.7}>
              <View style={styles.attachmentOptionIcon}>
                <MaterialCommunityIcons name="image" size={24} color="#a6c455" />
              </View>
              <Text style={styles.attachmentOptionText}>Photos & Videos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachmentOption}
              onPress={handleDocumentPicker}
              activeOpacity={0.7}>
              <View style={styles.attachmentOptionIcon}>
                <MaterialCommunityIcons name="file-document" size={24} color="#7fa6d9" />
              </View>
              <Text style={styles.attachmentOptionText}>Documents</Text>
            </TouchableOpacity>
          </View>
        )}

        {attachmentMenuVisible && (
          <TouchableOpacity
            style={styles.attachmentMenuOverlay}
            activeOpacity={1}
            onPress={() => setAttachmentMenuVisible(false)}
          />
        )}

        <View style={styles.inputWrapper}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={handleAttachment}
            disabled={isSending}>
            <MaterialCommunityIcons
              name="paperclip"
              size={22}
              color={isSending ? '#3a3a3a' : '#a6c455'}
            />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="ENTER MESSAGE..."
            placeholderTextColor="#666"
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={1000}
          />

          <TouchableOpacity
            onPress={sendMessage}
            disabled={(!messageText.trim() && !selectedAttachment) || isSending}
            style={[
              styles.sendButton,
              ((!messageText.trim() && !selectedAttachment) || isSending) &&
                styles.sendButtonDisabled,
            ]}>
            {isSending ? (
              <ActivityIndicator size="small" color="#a6c455" />
            ) : (
              <MaterialCommunityIcons
                name="send"
                size={22}
                color="#a6c455"
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Message Menu Modal */}
      <Modal
        visible={messageMenuVisible !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMessageMenuVisible(null)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMessageMenuVisible(null)}>
          <View style={styles.messageMenu}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const message = messages.find(m => m.id === messageMenuVisible);
                if (message) {
                  setReplyToMessage(message);
                  setMessageMenuVisible(null);
                }
              }}>
              <MaterialCommunityIcons name="reply" size={20} color="#a6c455" />
              <Text style={styles.menuItemText}>REPLY</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const message = messages.find(m => m.id === messageMenuVisible);
                if (message) handleForwardMessage(message);
              }}>
              <MaterialCommunityIcons name="share" size={20} color="#a6c455" />
              <Text style={styles.menuItemText}>FORWARD</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const message = messages.find(m => m.id === messageMenuVisible);
                if (message) handleDeleteMessage(message);
              }}>
              <MaterialCommunityIcons name="delete" size={20} color="#ff4444" />
              <Text style={[styles.menuItemText, {color: '#ff4444'}]}>DELETE</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Forward Message Dialog */}
      <Modal
        visible={forwardDialogVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setForwardDialogVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.forwardDialog}>
            <View style={styles.forwardHeader}>
              <Text style={styles.forwardTitle}>FORWARD MESSAGE</Text>
              <TouchableOpacity onPress={() => setForwardDialogVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#a6c455" />
              </TouchableOpacity>
            </View>

            {/* Message Preview */}
            {messageToForward && (
              <View style={styles.forwardPreview}>
                <Text style={styles.forwardPreviewText} numberOfLines={3}>
                  {messageToForward.content}
                </Text>
                {messageToForward.hasAttachment && (
                  <Text style={styles.forwardAttachmentLabel}>
                    📎 {messageToForward.attachmentName}
                  </Text>
                )}
              </View>
            )}

            <Text style={styles.forwardSubtitle}>SELECT CONVERSATION</Text>

            {/* Conversations List */}
            <FlatList
              data={forwardConversations}
              keyExtractor={(item) => String(item.id)}
              renderItem={({item}) => (
                <TouchableOpacity
                  style={styles.conversationItem}
                  onPress={() => handleForwardToConversation(item.id)}>
                  <View style={[styles.conversationAvatar, item.isGroup ? styles.groupAvatar : styles.directAvatar]}>
                    <Text style={styles.conversationAvatarText}>
                      {item.name?.substring(0, 2).toUpperCase() || '??'}
                    </Text>
                  </View>
                  <Text style={styles.conversationName}>{item.name || 'Unnamed'}</Text>
                </TouchableOpacity>
              )}
              style={styles.conversationsList}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Loading conversations...</Text>
              }
            />

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setForwardDialogVisible(false)}>
              <Text style={styles.cancelButtonText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Delete Message Dialog */}
      <Modal
        visible={deleteDialogVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDeleteDialogVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.deleteDialog}>
            <View style={styles.deleteHeader}>
              <Text style={styles.deleteTitle}>DELETE MESSAGE</Text>
              <TouchableOpacity onPress={() => setDeleteDialogVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#a6c455" />
              </TouchableOpacity>
            </View>

            <Text style={styles.deleteSubtitle}>
              Choose how to delete this message. This action cannot be undone.
            </Text>

            {/* Message Preview */}
            {messageToDelete && (
              <View style={styles.deletePreview}>
                <Text style={styles.deletePreviewText} numberOfLines={3}>
                  {messageToDelete.content}
                </Text>
                {messageToDelete.hasAttachment && (
                  <Text style={styles.deleteAttachmentLabel}>
                    📎 {messageToDelete.attachmentName}
                  </Text>
                )}
              </View>
            )}

            {/* Delete Options */}
            <View style={styles.deleteOptions}>
              <TouchableOpacity
                style={styles.deleteOption}
                onPress={() => performDelete(false)}>
                <MaterialCommunityIcons name="delete-outline" size={20} color="#a6c455" />
                <View style={styles.deleteOptionText}>
                  <Text style={styles.deleteOptionTitle}>DELETE FOR ME</Text>
                  <Text style={styles.deleteOptionDesc}>
                    Message will be deleted only from your device
                  </Text>
                </View>
              </TouchableOpacity>

              {messageToDelete && Number(messageToDelete.senderId) === Number(user?.id) && (
                <TouchableOpacity
                  style={[styles.deleteOption, styles.deleteOptionDanger]}
                  onPress={() => performDelete(true)}>
                  <MaterialCommunityIcons name="delete" size={20} color="#ff4444" />
                  <View style={styles.deleteOptionText}>
                    <Text style={[styles.deleteOptionTitle, {color: '#ff4444'}]}>
                      DELETE FOR EVERYONE
                    </Text>
                    <Text style={styles.deleteOptionDesc}>
                      Message will be deleted for everyone in this chat
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setDeleteDialogVisible(false)}>
              <Text style={styles.cancelButtonText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Video Player Modal */}
      <VideoPlayerModal
        visible={videoPlayerVisible}
        videoUrl={selectedVideo?.url || ''}
        videoName={selectedVideo?.name}
        onClose={() => {
          setVideoPlayerVisible(false);
          setSelectedVideo(null);
        }}
      />

      {/* Info Modal - Group Members or User Profile */}
      <Modal
        visible={infoModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setInfoModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.infoDialog}>
            {/* Header */}
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>
                {isGroup ? (selectedMemberProfile ? 'MEMBER PROFILE' : 'GROUP MEMBERS') : 'USER PROFILE'}
              </Text>
              <TouchableOpacity onPress={() => {
                setInfoModalVisible(false);
                setSelectedMemberProfile(null);
              }}>
                <MaterialCommunityIcons name="close" size={24} color="#a6c455" />
              </TouchableOpacity>
            </View>

            {/* Content */}
            {isGroup ? (
              selectedMemberProfile ? (
                /* Member Profile View */
                <View style={styles.infoContent}>
                  <TouchableOpacity
                    style={styles.backToListButton}
                    onPress={() => setSelectedMemberProfile(null)}>
                    <MaterialCommunityIcons name="arrow-left" size={20} color="#a6c455" />
                    <Text style={styles.backToListText}>BACK TO MEMBERS</Text>
                  </TouchableOpacity>

                  <View style={styles.profileContainer}>
                    <View style={[styles.profileAvatar, styles.directAvatar]}>
                      <Text style={styles.profileAvatarText}>
                        {(selectedMemberProfile.callsign || selectedMemberProfile.fullName || 'U').substring(0, 2).toUpperCase()}
                      </Text>
                    </View>

                    <View style={styles.profileInfo}>
                      <View style={styles.infoItem}>
                        <MaterialCommunityIcons name="account" size={20} color="#a6c455" />
                        <Text style={styles.infoLabel}>CALLSIGN</Text>
                      </View>
                      <Text style={styles.infoValue}>
                        {selectedMemberProfile.callsign || 'Not set'}
                      </Text>

                      <View style={styles.infoItem}>
                        <MaterialCommunityIcons name="card-account-details" size={20} color="#a6c455" />
                        <Text style={styles.infoLabel}>FULL NAME</Text>
                      </View>
                      <Text style={styles.infoValue}>
                        {selectedMemberProfile.fullName || 'Not set'}
                      </Text>

                      <View style={styles.infoItem}>
                        <MaterialCommunityIcons name="shield-star" size={20} color="#a6c455" />
                        <Text style={styles.infoLabel}>RANK</Text>
                      </View>
                      <Text style={styles.infoValue}>
                        {selectedMemberProfile.rank || 'Not set'}
                      </Text>

                      <View style={styles.infoItem}>
                        <MaterialCommunityIcons name="army" size={20} color="#a6c455" />
                        <Text style={styles.infoLabel}>BRANCH</Text>
                      </View>
                      <Text style={styles.infoValue}>
                        {selectedMemberProfile.branch || 'Not set'}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : (
                /* Group Members List */
                <View style={styles.infoContent}>
                  <View style={styles.infoItem}>
                    <MaterialCommunityIcons name="account-group" size={20} color="#a6c455" />
                    <Text style={styles.infoLabel}>
                      {conversationMembers.length} MEMBERS
                    </Text>
                  </View>

                  <FlatList
                    data={conversationMembers}
                    keyExtractor={(item) => String(item.userId)}
                    renderItem={({item}) => (
                      <TouchableOpacity
                        style={styles.memberItem}
                        onPress={() => setSelectedMemberProfile(item)}
                        activeOpacity={0.7}>
                        <View style={[styles.memberAvatar, styles.directAvatar]}>
                          <Text style={styles.memberAvatarText}>
                            {(item.callsign || item.fullName || 'U').substring(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>
                            {item.callsign || item.fullName || 'Unknown User'}
                            {item.userId === user?.id && ' (YOU)'}
                          </Text>
                          <Text style={styles.memberUsername}>
                            {item.rank || 'No Rank'} • {item.branch || 'No Branch'}
                          </Text>
                        </View>
                        <MaterialCommunityIcons name="chevron-right" size={20} color="#666" />
                      </TouchableOpacity>
                    )}
                    style={styles.membersList}
                  />
                </View>
              )
            ) : (
              /* User Profile for Direct Chat */
              <View style={styles.infoContent}>
                {conversationMembers
                  .filter((member: any) => member.userId !== user?.id)
                  .map((otherUser: any) => (
                    <View key={otherUser.userId} style={styles.profileContainer}>
                      <View style={[styles.profileAvatar, styles.directAvatar]}>
                        <Text style={styles.profileAvatarText}>
                          {(otherUser.callsign || otherUser.fullName || 'U').substring(0, 2).toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.profileInfo}>
                        <View style={styles.infoItem}>
                          <MaterialCommunityIcons name="account" size={20} color="#a6c455" />
                          <Text style={styles.infoLabel}>CALLSIGN</Text>
                        </View>
                        <Text style={styles.infoValue}>
                          {otherUser.callsign || 'Not set'}
                        </Text>

                        <View style={styles.infoItem}>
                          <MaterialCommunityIcons name="card-account-details" size={20} color="#a6c455" />
                          <Text style={styles.infoLabel}>FULL NAME</Text>
                        </View>
                        <Text style={styles.infoValue}>
                          {otherUser.fullName || 'Not set'}
                        </Text>

                        <View style={styles.infoItem}>
                          <MaterialCommunityIcons name="shield-star" size={20} color="#a6c455" />
                          <Text style={styles.infoLabel}>RANK</Text>
                        </View>
                        <Text style={styles.infoValue}>
                          {otherUser.rank || 'Not set'}
                        </Text>

                        <View style={styles.infoItem}>
                          <MaterialCommunityIcons name="army" size={20} color="#a6c455" />
                          <Text style={styles.infoLabel}>BRANCH</Text>
                        </View>
                        <Text style={styles.infoValue}>
                          {otherUser.branch || 'Not set'}
                        </Text>
                      </View>
                    </View>
                  ))}
              </View>
            )}

            {/* Close Button */}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setInfoModalVisible(false);
                setSelectedMemberProfile(null);
              }}>
              <Text style={styles.cancelButtonText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
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
  loadingMoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#4d5d30',
  },
  loadingMoreText: {
    color: '#a6c455',
    fontSize: 10,
    marginLeft: 8,
    letterSpacing: 1,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  backIcon: {
    color: '#a6c455',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
  },
  groupAvatar: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
  },
  directAvatar: {
    backgroundColor: '#3a3a3a',
    borderColor: '#4d5d30',
  },
  headerAvatarText: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  headerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#a6c455',
    marginRight: 6,
  },
  headerSubtitle: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  callButton: {
    width: 36,
    height: 36,
    backgroundColor: '#2a2a2a',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4d5d30',
  },
  rejoinButton: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#a6c455',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  rejoinButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  dateSeparator: {
    alignItems: 'center',
    marginVertical: 16,
  },
  dateBadge: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
  },
  dateText: {
    color: '#888',
    fontSize: 10,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  messageRow: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ownMessageRow: {
    justifyContent: 'flex-end',
  },
  otherMessageRow: {
    justifyContent: 'flex-start',
  },
  replyButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    padding: 4,
    zIndex: 10,
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    position: 'relative',
  },
  ownMessage: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
    borderTopRightRadius: 0,
  },
  otherMessage: {
    backgroundColor: '#2a2a2a',
    borderColor: '#3a3a3a',
    borderTopLeftRadius: 0,
  },
  senderName: {
    color: '#a6c455',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  messageText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  messageTime: {
    color: '#888',
    fontSize: 9,
    letterSpacing: 0.3,
  },
  messageStatus: {
    color: '#a6c455',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginLeft: 4,
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
    marginBottom: 16,
    fontWeight: '600',
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
  inputContainer: {
    backgroundColor: '#1a1a1a',
    borderTopWidth: 2,
    borderTopColor: '#4d5d30',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  replyPreview: {
    marginBottom: 8,
  },
  replyPreviewContent: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#a6c455',
    padding: 8,
    alignItems: 'center',
  },
  replyPreviewText: {
    flex: 1,
  },
  replyPreviewLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  replyPreviewMessage: {
    fontSize: 12,
    color: '#888',
  },
  removeReply: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#4d2020',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  attachmentPreview: {
    marginBottom: 8,
  },
  attachmentPreviewContent: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
    padding: 8,
    alignItems: 'center',
  },
  previewImage: {
    width: 60,
    height: 60,
    borderRadius: 4,
  },
  previewFile: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  previewFileIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  previewFileName: {
    color: '#ffffff',
    fontSize: 12,
    flex: 1,
  },
  removeAttachment: {
    width: 28,
    height: 28,
    backgroundColor: '#4d2020',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  removeIcon: {
    color: '#d97070',
    fontSize: 16,
    fontWeight: 'bold',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  attachButton: {
    width: 44,
    height: 44,
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#4d5d30',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    backgroundColor: '#4d5d30',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#5a6b38',
  },
  sendButtonDisabled: {
    backgroundColor: '#2a2a2a',
    borderColor: '#3a3a3a',
  },
  attachmentContainer: {
    marginBottom: 8,
  },
  attachmentImage: {
    width: 200,
    height: 200,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
  },
  videoAttachment: {
    maxWidth: 260,
    width: '100%',
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
    overflow: 'hidden',
  },
  videoThumbnail: {
    width: '100%',
    height: 180,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoFileName: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    padding: 12,
    textAlign: 'center',
  },
  fileAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
    padding: 12,
  },
  fileIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  fileName: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    flex: 1,
  },
  attachmentMenuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  attachmentMenu: {
    position: 'absolute',
    bottom: 70,
    left: 8,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  attachmentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 4,
    backgroundColor: '#1a1a1a',
    gap: 12,
    minWidth: 200,
  },
  attachmentOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentOptionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  repliedMessageContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderLeftWidth: 3,
    borderLeftColor: '#a6c455',
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
    alignSelf: 'stretch',
  },
  repliedMessageContent: {
    flexShrink: 1,
  },
  repliedMessageSender: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  repliedMessageText: {
    fontSize: 11,
    color: '#aaa',
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageMenu: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 8,
    minWidth: 200,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  menuItemText: {
    color: '#a6c455',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  forwardDialog: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 16,
    width: '90%',
    maxHeight: '80%',
  },
  forwardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  forwardTitle: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  forwardPreview: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 4,
    marginBottom: 16,
    maxHeight: 100,
  },
  forwardPreviewText: {
    color: '#fff',
    fontSize: 13,
  },
  forwardAttachmentLabel: {
    color: '#a6c455',
    fontSize: 11,
    marginTop: 6,
  },
  forwardSubtitle: {
    color: '#666',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 12,
  },
  conversationsList: {
    maxHeight: 300,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  conversationAvatar: {
    width: 40,
    height: 40,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
  },
  conversationAvatarText: {
    color: '#a6c455',
    fontSize: 14,
    fontWeight: 'bold',
  },
  conversationName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
  },
  cancelButton: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 4,
    marginTop: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#a6c455',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  deleteDialog: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 16,
    width: '90%',
    maxHeight: '80%',
  },
  deleteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  deleteTitle: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  deleteSubtitle: {
    color: '#666',
    fontSize: 12,
    marginBottom: 16,
    lineHeight: 18,
  },
  deletePreview: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 4,
    marginBottom: 16,
    maxHeight: 100,
  },
  deletePreviewText: {
    color: '#fff',
    fontSize: 13,
  },
  deleteAttachmentLabel: {
    color: '#a6c455',
    fontSize: 11,
    marginTop: 6,
  },
  deleteOptions: {
    marginBottom: 16,
  },
  deleteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    marginBottom: 12,
  },
  deleteOptionDanger: {
    borderColor: '#ff4444',
  },
  deleteOptionText: {
    marginLeft: 12,
    flex: 1,
  },
  deleteOptionTitle: {
    color: '#a6c455',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  deleteOptionDesc: {
    color: '#888',
    fontSize: 11,
    lineHeight: 16,
  },
  infoDialog: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 16,
    width: '90%',
    maxHeight: '80%',
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  infoTitle: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  infoContent: {
    marginBottom: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  infoLabel: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 14,
    marginBottom: 16,
    marginLeft: 28,
  },
  membersList: {
    maxHeight: 400,
    marginTop: 8,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
  },
  memberAvatarText: {
    color: '#a6c455',
    fontSize: 14,
    fontWeight: 'bold',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  memberUsername: {
    color: '#888',
    fontSize: 12,
  },
  profileContainer: {
    alignItems: 'center',
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3,
  },
  profileAvatarText: {
    color: '#a6c455',
    fontSize: 32,
    fontWeight: 'bold',
  },
  profileInfo: {
    width: '100%',
  },
  backToListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingVertical: 8,
  },
  backToListText: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
