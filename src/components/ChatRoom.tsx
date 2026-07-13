import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Image,
  Linking,
  Modal,
  Alert,
  BackHandler,
  InteractionManager,
  Dimensions,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useChatStore, type Message } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { apiRequest, getApiBaseUrl, downloadAndOpenPDF, downloadAndOpenDocument, getSessionToken } from '../services/apiClient';
import { websocketService } from '../services/websocket';
import { webrtcService } from '../services/webrtcService';
import { useCallStore } from '../store/callStore';
import { openPermissionSettings, requestCameraPermission, requestCameraAndVideoPermissions } from '../utils/permissions';
import { VideoPlayerModal } from './VideoPlayerModal';
import { ImageViewerModal } from './ImageViewerModal';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFetchBlob from 'rn-fetch-blob';
import { Skeleton } from './ui/Skeleton';

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
  const { user } = useAuthStore();
  const setMessages = useChatStore((state) => state.setMessages);
  const addMessage = useChatStore((state) => state.addMessage);

  // Subscribe to call state to check for active group calls
  const callState = useCallStore((state) => ({
    status: state.status,
    isGroupCall: state.isGroupCall,
    conversationId: state.conversationId,
  }));

  // Server-side active group call state for rejoin feature
  const [activeGroupCall, setActiveGroupCall] = useState<{ callId: string, participants: number[] } | null>(null);

  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<any>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [messageMenuVisible, setMessageMenuVisible] = useState<boolean>(false);
  const [selectedMenuMessage, setSelectedMenuMessage] = useState<Message | null>(null);
  const [forwardDialogVisible, setForwardDialogVisible] = useState(false);
  const [messageToForward, setMessageToForward] = useState<Message | null>(null);
  const [forwardConversations, setForwardConversations] = useState<any[]>([]);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
  const [conversationMembers, setConversationMembers] = useState<any[]>([]);
  const [displayName, setDisplayName] = useState<string>(conversationName);
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<{ url: string; name: string } | null>(null);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; name: string } | null>(null);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<any | null>(null);
  const [otherUserOnline, setOtherUserOnline] = useState<boolean>(false);
  const [viewingRepliedMessage, setViewingRepliedMessage] = useState<Message | null>(null);
  const [addMemberModalVisible, setAddMemberModalVisible] = useState(false);
  const [availableUsersToAdd, setAvailableUsersToAdd] = useState<any[]>([]);
  const [selectedUsersToAdd, setSelectedUsersToAdd] = useState<number[]>([]);
  const [isLoadingUsersToAdd, setIsLoadingUsersToAdd] = useState(false);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [addMemberSearchQuery, setAddMemberSearchQuery] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [failedAttachment, setFailedAttachment] = useState<any>(null);
  const [sendingAttachmentType, setSendingAttachmentType] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
  const [audioProgress, setAudioProgress] = useState<string>('00:00');
  const [audioDuration, setAudioDuration] = useState<string>('00:00');
  const [audioProgressPercent, setAudioProgressPercent] = useState(0);
  const audioPlayerRef = useRef(new AudioRecorderPlayer());
  const baseUrlRef = useRef('');
  const sessionTokenRef = useRef<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const hasScrolledToInitialPosition = useRef(false);
  const isJumpingToMessage = useRef(false);
  const isNearBottom = useRef(true); // Track if user is scrolled near bottom
  const messageRefsMap = useRef<Map<number, View>>(new Map()); // messageId -> View ref

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

  // Load base URL and session token for attachment display
  useEffect(() => {
    getApiBaseUrl().then((url) => {
      console.log('[ChatRoom] Base URL loaded:', url);
      setBaseUrl(url);
      baseUrlRef.current = url;
    });
    getSessionToken().then((token) => {
      setSessionToken(token);
      sessionTokenRef.current = token;
    });
  }, []);

  // Query server for active group call on this conversation (rejoin feature)
  // Re-checks when callState.status changes (e.g. user leaves call → status goes to 'idle')
  useEffect(() => {
    if (!isGroup) return;

    const checkActiveCall = async () => {
      try {
        const result = await apiRequest<{ callId: string, participants: number[] } | null>(
          `/api/conversations/${conversationId}/active-call`
        );
        setActiveGroupCall(result || null);
      } catch (e) {
        console.warn('[ChatRoom] Error checking active call:', e);
      }
    };

    checkActiveCall();

    // Listen for group call events to update the active call state
    const removeHandler = websocketService.addMessageHandler((message) => {
      if (
        message.type === 'group_call_participants_update' ||
        message.type === 'group_call_ended' ||
        message.type === 'group_call_initiated' ||
        message.type === 'group_call_user_left' ||
        message.type === 'incoming_group_call' ||
        message.type === 'participant_left' ||
        message.type === 'participant_joined'
      ) {
        checkActiveCall();
      }
    });

    return removeHandler;
  }, [isGroup, conversationId, callState.status]);

  // Handle hardware back button on Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true; // Prevent default behavior (going to home)
    });

    return () => backHandler.remove();
  }, [onBack]);

  // Track other user's online status for direct chats
  useEffect(() => {
    if (isGroup) return;

    // Get the other member from conversationMembers (includes status)
    if (conversationMembers.length >= 2) {
      const otherMember = conversationMembers.find((m: any) => m.userId !== user?.id);
      if (otherMember) {
        console.log('[ChatRoom] Other member found:', otherMember.callsign, 'status:', otherMember.status);
        setOtherUserOnline(otherMember.status === 'online');
      }
    }
  }, [isGroup, conversationMembers, user?.id]);

  // Subscribe to real-time status updates
  useEffect(() => {
    if (isGroup) return;

    // Get the other user's ID
    let targetUserId = otherUserId;
    if (!targetUserId && conversationMembers.length >= 2) {
      const otherMember = conversationMembers.find((m: any) => m.userId !== user?.id);
      targetUserId = otherMember?.userId;
    }

    if (!targetUserId) return;

    console.log('[ChatRoom] Subscribing to status updates for userId:', targetUserId);

    const unsubscribe = websocketService.addMessageHandler((message) => {
      // Convert to numbers for consistent comparison
      if (message.type === 'user_status' && Number(message.payload.userId) === Number(targetUserId)) {
        setOtherUserOnline(message.payload.status === 'online');
      }
    });

    return () => unsubscribe();
  }, [isGroup, otherUserId, conversationMembers, user?.id]);

  // Fetch initial mute status from conversations list data
  useEffect(() => {
    const fetchMuteStatus = async () => {
      try {
        const conversations = await apiRequest('/api/conversations');
        const conv = conversations?.find?.((c: any) => Number(c.id) === Number(conversationId));
        if (conv) {
          setIsMuted(!!conv.isMuted);
        }
      } catch (err) {
        console.warn('[ChatRoom] Failed to fetch mute status:', err);
      }
    };
    fetchMuteStatus();
  }, [conversationId]);

  const handleToggleMute = async () => {
    try {
      const newMuted = !isMuted;
      setIsMuted(newMuted); // Optimistic UI
      await apiRequest(`/api/conversations/${conversationId}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: newMuted }),
      });
    } catch (error) {
      console.error('[ChatRoom] Failed to toggle mute:', error);
      setIsMuted(!isMuted); // Revert on error
    }
  };

  // Audio playback helpers
  const handlePlayAudio = async (messageId: number, audioUrl: string) => {
    try {
      const player = audioPlayerRef.current;

      // If already playing this message, stop
      if (playingAudioId === messageId) {
        await player.stopPlayer();
        player.removePlayBackListener();
        setPlayingAudioId(null);
        setAudioProgress('00:00');
        setAudioProgressPercent(0);
        return;
      }

      // Stop any currently playing audio
      if (playingAudioId !== null) {
        await player.stopPlayer();
        player.removePlayBackListener();
      }

      setPlayingAudioId(messageId);
      setAudioProgress('00:00');
      setAudioDuration('00:00');
      setAudioProgressPercent(0);

      // Download with auth then play local file
      const token = sessionToken || await getSessionToken();
      const res = await RNFetchBlob.config({ fileCache: true, appendExt: 'm4a' })
        .fetch('GET', audioUrl, { 'X-Session-Token': token || '' });
      const localPath = Platform.OS === 'android' ? `file://${res.path()}` : res.path();

      await player.startPlayer(localPath);
      player.addPlayBackListener((e: any) => {
        const current = e.currentPosition;
        const duration = e.duration;
        if (duration > 0) {
          setAudioProgressPercent(current / duration);
        }
        setAudioProgress(player.mmssss(Math.floor(current)).substring(0, 5));
        setAudioDuration(player.mmssss(Math.floor(duration)).substring(0, 5));

        if (current >= duration - 100 && duration > 0) {
          player.stopPlayer();
          player.removePlayBackListener();
          setPlayingAudioId(null);
          setAudioProgress('00:00');
          setAudioProgressPercent(0);
          // Clean up temp file
          RNFetchBlob.fs.unlink(res.path()).catch(() => { });
        }
      });
    } catch (error) {
      console.error('[ChatRoom] Audio playback error:', error);
      setPlayingAudioId(null);
    }
  };

  // Clean up audio player on unmount
  useEffect(() => {
    return () => {
      audioPlayerRef.current.stopPlayer().catch(() => { });
      audioPlayerRef.current.removePlayBackListener();
    };
  }, []);

  // Scroll to bottom on initial load — use InteractionManager for reliable timing
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !hasScrolledToInitialPosition.current) {
      // Use InteractionManager to wait for layout, then scroll
      const task = InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          console.log('[ChatRoom] Scrolling to bottom on initial load');
          flatListRef.current?.scrollToEnd({ animated: false });
          hasScrolledToInitialPosition.current = true;
        }, 150);
      });
      return () => task.cancel();
    }
  }, [isLoading, messages.length]);

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
        // Convert to numbers for consistent comparison (WebSocket may send strings)
        const payloadConvId = Number(message.payload?.conversationId);
        const currentConvId = Number(conversationId);
        const payloadSenderId = Number(message.payload?.senderId);
        const currentUserId = Number(user?.id);

        if (payloadConvId === currentConvId) {
          // Skip reload for own messages - the send handler already refreshes
          if (payloadSenderId === currentUserId) {
            console.log('[ChatRoom] ⏭️ Skipping reload for own sent message');
            return;
          }
          console.log('[ChatRoom] ✅ Message from other user, reloading...');
          loadMessages(false).then(() => {
            // Only scroll to bottom if user was already near the bottom
            if (isNearBottom.current) {
              setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: false });
              }, 100);
            }
          });
        }
      }

      // Handle real-time message deletion (delete for everyone)
      if (message.type === 'message_deleted') {
        const payloadConvId = Number(message.payload?.conversationId);
        const currentConvId = Number(conversationId);

        if (payloadConvId === currentConvId) {
          console.log('[ChatRoom] ✅ Message deleted by other user, reloading...');
          loadMessages(false);
        }
      }
    });

    return () => {
      console.log('[ChatRoom] Removing WebSocket handler for conversation:', conversationId);
      removeHandler();
      useChatStore.getState().setCurrentConversationId(null);
    };
  }, [conversationId, conversationMembers, user?.id]);

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
        useChatStore.getState().setPaginationInfo(conversationId, { isLoading: true });
      }

      const limit = 10;
      let offset = loadMore ? (paginationInfo?.offset || 0) : 0;

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
        // Convert IDs to numbers for type consistency
        const msgId = Number(msg.id);
        const msgSenderId = Number(msg.senderId);

        // Look up sender name from conversationMembers
        let senderName = 'Unknown';

        if (index === 0) {
          console.log('[ChatRoom] ===== SENDER LOOKUP DEBUG =====');
          console.log('[ChatRoom] conversationMembers available:', !!conversationMembers);
          console.log('[ChatRoom] conversationMembers length:', conversationMembers?.length);
          console.log('[ChatRoom] First message senderId:', msgSenderId, 'type:', typeof msgSenderId);
          console.log('[ChatRoom] conversationMembers:', JSON.stringify(conversationMembers, null, 2));
        }

        if (conversationMembers && Array.isArray(conversationMembers)) {
          // Use Number() for comparison to ensure type consistency
          const member = conversationMembers.find(m => Number(m.userId) === msgSenderId);
          if (index === 0) {
            console.log('[ChatRoom] Found member for senderId', msgSenderId, ':', !!member);
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
          id: msgId,
          senderId: msgSenderId,
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
          attachmentThumbnailUrl: msg.attachmentThumbnailUrl,
          replyToId: msg.replyToId ? Number(msg.replyToId) : undefined,
          forwardedFromId: msg.forwardedFromId ? Number(msg.forwardedFromId) : undefined,
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

        // Scroll to end after load — no animation to avoid Android touch responder lock
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: false });
        }, 200);
      }
    } catch (error) {
      console.error('[ChatRoom] Error loading messages:', error);
      useChatStore.getState().setPaginationInfo(conversationId, { isLoading: false });
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  // Helper function to get document icon and color based on file type
  // Infer MIME type from file extension when the picker doesn't provide one
  const getMimeTypeFromName = (fileName: string | undefined): string | null => {
    if (!fileName) return null;
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext) return null;
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/plain',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
    };
    return mimeMap[ext] || null;
  };

  const getDocumentIcon = (fileName: string | undefined, mimeType: string | undefined): { icon: string; color: string } => {
    const name = (fileName || '').toLowerCase();
    const type = (mimeType || '').toLowerCase();

    // PDF
    if (name.endsWith('.pdf') || type.includes('pdf')) {
      return { icon: 'file-pdf-box', color: '#d97070' };
    }
    // Word documents
    if (name.endsWith('.doc') || name.endsWith('.docx') || type.includes('msword') || type.includes('wordprocessingml')) {
      return { icon: 'file-word', color: '#2b579a' };
    }
    // Excel spreadsheets
    if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv') || type.includes('excel') || type.includes('spreadsheetml') || type.includes('csv')) {
      return { icon: 'file-excel', color: '#217346' };
    }
    // PowerPoint presentations
    if (name.endsWith('.ppt') || name.endsWith('.pptx') || type.includes('powerpoint') || type.includes('presentationml')) {
      return { icon: 'file-powerpoint', color: '#d24726' };
    }
    // Text files
    if (name.endsWith('.txt') || type.includes('text/plain')) {
      return { icon: 'file-document-outline', color: '#888888' };
    }
    // Default document icon
    return { icon: 'file-document', color: '#7fa6d9' };
  };

  const handleAttachment = () => {
    setAttachmentMenuVisible(!attachmentMenuVisible);
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

  const handleCameraPicker = async () => {
    setAttachmentMenuVisible(false);

    // Request camera permission first
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert(
        'Permission Required',
        'VComm needs camera permissions to take photos. Please grant permissions in your device settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => openPermissionSettings(),
            style: 'default',
          },
        ]
      );
      return;
    }

    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.8,
        saveToPhotos: true,
      },
      (response) => {
        if (response.didCancel) {
          console.log('[ChatRoom] User cancelled camera');
        } else if (response.errorCode) {
          console.error('[ChatRoom] Camera Error:', response.errorMessage);
          if (response.errorCode === 'camera_unavailable') {
            Alert.alert('Camera Unavailable', 'Camera is not available on this device');
          } else if (response.errorCode === 'permission') {
            Alert.alert(
              'Permission Required',
              'VComm needs camera permissions to take photos. Please grant permissions in your device settings.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => openPermissionSettings(),
                  style: 'default',
                },
              ]
            );
          }
        } else if (response.assets && response.assets[0]) {
          setSelectedAttachment(response.assets[0]);
          console.log('[ChatRoom] Photo capture selected:', response.assets[0]);
        }
      }
    );
  };

  const handleVideoCameraPicker = async () => {
    setAttachmentMenuVisible(false);

    // Request camera and microphone permissions first (needed for video recording)
    const hasPermission = await requestCameraAndVideoPermissions();
    if (!hasPermission) {
      Alert.alert(
        'Permission Required',
        'VComm needs camera and microphone permissions to record videos. Please grant permissions in your device settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => openPermissionSettings(),
            style: 'default',
          },
        ]
      );
      return;
    }

    launchCamera(
      {
        mediaType: 'video',
        videoQuality: 'high',
        durationLimit: 60,
        saveToPhotos: true,
        cameraType: 'back',
      },
      (response) => {
        if (response.didCancel) {
          console.log('[ChatRoom] User cancelled video recording');
        } else if (response.errorCode) {
          console.error('[ChatRoom] Video Camera Error:', response.errorMessage);
          if (response.errorCode === 'camera_unavailable') {
            Alert.alert('Camera Unavailable', 'Camera is not available on this device');
          } else if (response.errorCode === 'permission') {
            Alert.alert(
              'Permission Required',
              'VComm needs camera and microphone permissions to record videos. Please grant permissions in your device settings.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => openPermissionSettings(),
                  style: 'default',
                },
              ]
            );
          }
        } else if (response.assets && response.assets[0]) {
          setSelectedAttachment(response.assets[0]);
          console.log('[ChatRoom] Video capture selected:', response.assets[0]);
        }
      }
    );
  };

  const handleDocumentPicker = async () => {
    setAttachmentMenuVisible(false);
    try {
      const result = await DocumentPicker.pick({
        type: [
          DocumentPicker.types.pdf,
          DocumentPicker.types.doc,
          DocumentPicker.types.docx,
          DocumentPicker.types.xls,
          DocumentPicker.types.xlsx,
          DocumentPicker.types.ppt,
          DocumentPicker.types.pptx,
          DocumentPicker.types.plainText,
          DocumentPicker.types.csv,
        ],
        copyTo: 'cachesDirectory',
      });

      if (result && result[0]) {
        const doc = result[0];
        console.log('[ChatRoom] Document selected:', doc);
        console.log('[ChatRoom] fileCopyUri:', doc.fileCopyUri, 'uri:', doc.uri);

        let uploadUri = doc.fileCopyUri;

        // If copyTo didn't produce a fileCopyUri (happens with cloud providers
        // or scoped storage), manually copy the content:// URI to a local cache
        // file so RNFetchBlob.wrap() can read it. Without this the upload
        // sends empty data and the file is corrupted.
        if (!uploadUri && doc.uri && Platform.OS === 'android') {
          try {
            const ext = doc.name?.split('.').pop() || '';
            const cachePath = `${RNFetchBlob.fs.dirs.CacheDir}/upload_${Date.now()}.${ext}`;
            console.log('[ChatRoom] Copying content URI to cache:', doc.uri, '->', cachePath);
            await RNFetchBlob.fs.cp(doc.uri, cachePath);
            uploadUri = cachePath;
            console.log('[ChatRoom] Copy succeeded, new path:', cachePath);
          } catch (cpErr) {
            console.error('[ChatRoom] Failed to copy content URI to cache:', cpErr);
          }
        }

        // Convert to the same format as image picker
        const attachment = {
          uri: uploadUri || doc.uri,
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
    const uploadUrl = `${await getApiBaseUrl()}/api/attachments/upload`;
    const sessionToken = await getSessionToken();

    try {
      // Normalize file URI for RNFetchBlob — wrap() requires a raw filesystem path.
      // fileCopyUri from react-native-document-picker is a URI with URL-encoded
      // special characters (spaces → %20, accents, etc.). The filesystem uses
      // the real characters, so we must decode before passing to wrap()/stat().
      let fileUri = file.uri;
      if (Platform.OS === 'android') {
        if (fileUri.startsWith('file://')) {
          fileUri = fileUri.replace('file://', '');
        } else if (fileUri.startsWith('content://')) {
          // Last-resort fallback: copy content URI to a cache file so wrap() can read it
          const ext = (file.fileName || '').split('.').pop() || '';
          const cachePath = `${RNFetchBlob.fs.dirs.CacheDir}/upload_fallback_${Date.now()}.${ext}`;
          console.log('[ChatRoom] Fallback: copying content URI to cache:', fileUri, '->', cachePath);
          await RNFetchBlob.fs.cp(fileUri, cachePath);
          fileUri = cachePath;
        }
        // Decode URL-encoded characters. Wrapped in try-catch because a path
        // with literal % signs (e.g., "100%.pdf") would throw.
        try {
          fileUri = decodeURIComponent(fileUri);
        } catch {
          // Path is already plain or has literal % signs
        }
      }

      // Verify file exists and has content before uploading
      try {
        const stat = await RNFetchBlob.fs.stat(fileUri);
        if (stat.size === 0) {
          throw new Error('Selected file is empty (0 bytes)');
        }
        console.log('[ChatRoom] File stat: size=' + stat.size + ', path=' + fileUri);
      } catch (statErr: any) {
        console.error('[ChatRoom] File stat check failed:', statErr.message);
        throw new Error('Cannot access selected file. Please try again.');
      }

      console.log('[ChatRoom] Uploading via RNFetchBlob:', uploadUrl);

      const res = await RNFetchBlob.fetch(
        'POST',
        uploadUrl,
        {
          'X-Session-Token': sessionToken || '',
          'Content-Type': 'multipart/form-data',
        },
        [
          {
            name: 'file',
            filename: file.fileName || 'attachment',
            type: file.type || getMimeTypeFromName(file.fileName) || 'application/octet-stream',
            data: RNFetchBlob.wrap(fileUri),
          },
        ],
      ).uploadProgress({ interval: 100 }, (written, total) => {
        if (total > 0) {
          const pct = Math.round((written / total) * 100);
          setUploadProgress(pct);
        }
      });

      setUploadProgress(null);

      const status = res.info().status;
      if (status >= 200 && status < 300) {
        try {
          return JSON.parse(res.data);
        } catch {
          throw new Error('Invalid upload response');
        }
      } else {
        let errorMsg = `Upload failed (${status})`;
        try {
          const body = JSON.parse(res.data);
          if (body.message) errorMsg = body.message;
        } catch { }
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      setUploadProgress(null);
      console.error('[ChatRoom] Upload error details:', err.message, err);
      throw err;
    }
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
        setSendingAttachmentType(selectedAttachment.type?.split('/')[0] || 'file');
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
        if (attachmentData.thumbnailUrl) {
          messagePayload.attachmentThumbnailUrl = attachmentData.thumbnailUrl;
        }
      }

      if (replyToMessage) {
        messagePayload.replyToId = replyToMessage.id;
      }

      const response = await apiRequest('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload),
      });

      console.log('[ChatRoom] Message sent successfully:', response);

      // For text-only messages, add immediately for instant feedback
      // For attachment messages, skip addMessage and let loadMessages bring them
      // from the server - this prevents stale FlatList closure issues
      if (response?.id && !attachmentData) {
        const senderName = user?.callsign || user?.fullName || 'Me';
        const sentMessage: Message = {
          id: Number(response.id),
          senderId: Number(user?.id),
          senderName,
          content: response.content || content,
          timestamp: response.createdAt || new Date().toISOString(),
          isRead: true,
          classification: response.classification || 'UNCLASSIFIED',
          hasAttachment: false,
          replyToId: replyToMessage?.id,
        };
        addMessage(conversationId, sentMessage);
      }

      // Clear attachment and reply
      setSelectedAttachment(null);
      setReplyToMessage(null);

      // Sync with server to get the full message list
      // For attachment messages this is the only way they appear in the list
      await new Promise(resolve => setTimeout(resolve, attachmentData ? 1500 : 500));
      await loadMessages(false);

      // Scroll to bottom after server sync — no animation to avoid locking touch responder
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 100);

    } catch (error: any) {
      console.error('[ChatRoom] Error sending message:', error);
      setMessageText(content);

      // Keep failed attachment for retry
      if (selectedAttachment) {
        setFailedAttachment(selectedAttachment);
      }

      // Show user-friendly error message
      const errorMessage = error?.message || 'Failed to send message';
      if (errorMessage.includes('Network') || errorMessage.includes('network')) {
        Alert.alert(
          'Network Error',
          'Unable to connect to the server. Please check your connection.',
          [
            { text: 'OK' },
            selectedAttachment ? { text: 'Retry', onPress: () => sendMessage() } : null,
          ].filter(Boolean) as any
        );
      } else {
        Alert.alert(
          'Error',
          errorMessage,
          [
            { text: 'OK' },
            selectedAttachment ? { text: 'Retry', onPress: () => sendMessage() } : null,
          ].filter(Boolean) as any
        );
      }
    } finally {
      setIsSending(false);
      setSendingAttachmentType(null);
    }
  };

  const handleSendVoiceNote = async (fileUri: string, duration: number) => {
    setIsRecordingVoice(false);
    setIsSending(true);
    setSendingAttachmentType('audio');
    try {
      const file = {
        uri: fileUri,
        type: 'audio/mp4',
        fileName: `voice_note_${Date.now()}.m4a`,
      };
      const uploadResponse = await uploadAttachment(file);
      if (!uploadResponse.success || !uploadResponse.file) {
        throw new Error('Voice note upload failed');
      }
      const attachmentData = uploadResponse.file;
      const messagePayload: any = {
        conversationId,
        content: `Voice note (${duration}s)`,
        classification: 'UNCLASSIFIED',
        hasAttachment: true,
        attachmentType: attachmentData.type,
        attachmentUrl: attachmentData.url,
        attachmentName: attachmentData.name,
        attachmentSize: attachmentData.size,
      };
      const response = await apiRequest('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload),
      });

      // Don't add attachment messages locally - let loadMessages bring them
      // from the server to avoid stale FlatList closure issues
      await new Promise(resolve => setTimeout(resolve, 1500));
      await loadMessages(false);

      // Scroll to bottom after server sync — no animation to avoid locking touch responder
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 100);
    } catch (error: any) {
      console.error('[ChatRoom] Error sending voice note:', error);
      Alert.alert('Error', 'Failed to send voice note. Please try again.');
    } finally {
      setIsSending(false);
      setSendingAttachmentType(null);
    }
  };

  const handleForwardMessage = async (message: Message) => {
    setMessageToForward(message);
    setMessageMenuVisible(false);
    setForwardDialogVisible(true);

    // Load conversations and users for forwarding
    try {
      const [conversationsData, usersData] = await Promise.all([
        apiRequest('/api/conversations'),
        apiRequest('/api/all-users'),
      ]);

      // Filter out current conversation and map proper display names
      const otherConversations = (Array.isArray(conversationsData) ? conversationsData : [])
        .filter((conv: any) => conv.id !== conversationId)
        .map((conv: any) => {
          // For direct chats, find the other user's name
          if (!conv.isGroup && conv.name?.startsWith('Direct Chat')) {
            const match = conv.name.match(/Direct Chat (\d+)-(\d+)/);
            if (match && user) {
              const [_, id1, id2] = match;
              const partnerId = parseInt(id1) === user.id ? parseInt(id2) : parseInt(id1);
              const partner = usersData.find((u: any) => u.id === partnerId);
              if (partner) {
                return {
                  ...conv,
                  displayName: partner.callsign || partner.fullName || conv.name,
                };
              }
            }
          }
          return {
            ...conv,
            displayName: conv.name || 'Unnamed',
          };
        });

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
        body: JSON.stringify({ targetConversationIds: [targetConversationId] }),
      });
      setForwardDialogVisible(false);
      setMessageToForward(null);
      Alert.alert('Success', 'Message forwarded successfully');
      console.log('[ChatRoom] Message forwarded successfully');
    } catch (error) {
      console.error('[ChatRoom] Error forwarding message:', error);
      Alert.alert('Error', 'Failed to forward message');
    }
  };

  const handleDeleteMessage = (message: Message) => {
    setMessageToDelete(message);
    setMessageMenuVisible(false);
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
          [{ text: 'OK', style: 'default' }]
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
          [{ text: 'OK', style: 'default' }]
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
            { text: 'Cancel', style: 'cancel' },
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
          [{ text: 'OK', style: 'default' }]
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
          [{ text: 'OK', style: 'default' }]
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
          [{ text: 'OK', style: 'default' }]
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
            { text: 'Cancel', style: 'cancel' },
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
          [{ text: 'OK', style: 'default' }]
        );
      }
    }
  };

  const handleRemoveMember = async (memberId: number, memberName: string) => {
    // Check if current user is admin
    const currentMember = conversationMembers.find(m => m.userId === user?.id);
    const isAdmin = currentMember?.role === 'admin';

    if (!isAdmin) {
      Alert.alert('Permission Denied', 'Only group admins can remove members.');
      return;
    }

    if (memberId === user?.id) {
      Alert.alert('Cannot Remove Yourself', 'You cannot remove yourself from the group.');
      return;
    }

    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${memberName} from this group? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiRequest(`/api/groups/${conversationId}/members/${memberId}`, {
                method: 'DELETE'
              });

              // Refresh member list
              const members = await apiRequest(`/api/conversations/${conversationId}/members`);
              if (Array.isArray(members)) {
                setConversationMembers(members);
              }

              Alert.alert('Success', 'Member removed successfully.');
            } catch (error: any) {
              console.error('[ChatRoom] Error removing member:', error);
              Alert.alert('Error', error.message || 'Failed to remove member.');
            }
          }
        }
      ]
    );
  };

  // Load available users that can be added to the group
  const loadAvailableUsersToAdd = async () => {
    try {
      setIsLoadingUsersToAdd(true);
      // Get all users
      const allUsers = await apiRequest('/api/all-users');

      // Filter out users already in the group
      const existingMemberIds = conversationMembers.map((m: any) => m.userId);
      const available = allUsers.filter((u: any) => !existingMemberIds.includes(u.id));

      setAvailableUsersToAdd(available);
      setSelectedUsersToAdd([]);
      setAddMemberSearchQuery('');
    } catch (error) {
      console.error('[ChatRoom] Error loading users to add:', error);
      Alert.alert('Error', 'Failed to load users.');
    } finally {
      setIsLoadingUsersToAdd(false);
    }
  };

  // Handle opening add member modal
  const handleOpenAddMemberModal = () => {
    loadAvailableUsersToAdd();
    setAddMemberModalVisible(true);
  };

  // Toggle user selection for adding
  const toggleUserToAdd = (userId: number) => {
    setSelectedUsersToAdd((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  // Handle adding selected members to the group
  const handleAddMembers = async () => {
    if (selectedUsersToAdd.length === 0) {
      Alert.alert('No Selection', 'Please select at least one user to add.');
      return;
    }

    setIsAddingMembers(true);
    try {
      await apiRequest(`/api/groups/${conversationId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selectedUsersToAdd }),
      });

      // Refresh member list
      const members = await apiRequest(`/api/conversations/${conversationId}/members`);
      if (Array.isArray(members)) {
        setConversationMembers(members);
      }

      setAddMemberModalVisible(false);
      setSelectedUsersToAdd([]);
      Alert.alert('Success', `${selectedUsersToAdd.length} member(s) added successfully.`);
    } catch (error: any) {
      console.error('[ChatRoom] Error adding members:', error);
      Alert.alert('Error', error.message || 'Failed to add members.');
    } finally {
      setIsAddingMembers(false);
    }
  };

  // Get filtered users based on search query
  const getFilteredUsersToAdd = () => {
    if (!addMemberSearchQuery.trim()) {
      return availableUsersToAdd;
    }
    const query = addMemberSearchQuery.toLowerCase();
    return availableUsersToAdd.filter(
      (u) =>
        u.callsign?.toLowerCase().includes(query) ||
        u.fullName?.toLowerCase().includes(query) ||
        u.rank?.toLowerCase().includes(query)
    );
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
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const renderMessage = ({ item }: { item: Message }): JSX.Element => {
    if (!item) return <View />;

    // Ensure both are numbers for comparison
    const isOwnMessage = Number(item.senderId) === Number(user?.id);
    const senderName = item.senderName || 'Unknown';
    const content = item.content || '';

    // Find replied-to message
    const repliedMessage = item.replyToId
      ? messages.find(m => m.id === item.replyToId)
      : null;

    // Get full attachment URL - use ref as fallback to prevent stale closure issues
    const getFullAttachmentUrl = (url: string | undefined) => {
      if (!url) {
        return '';
      }
      const currentBaseUrl = baseUrl || baseUrlRef.current;
      if (!currentBaseUrl) {
        console.log('[ChatRoom] getFullAttachmentUrl - baseUrl not loaded yet');
        return '';
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      const fullUrl = `${currentBaseUrl}${url.startsWith('/') ? url : '/' + url}`;
      return fullUrl;
    };

    // Build an Image source with auth headers for authenticated /uploads endpoint
    const getAuthImageSource = (url: string | undefined) => {
      const fullUrl = getFullAttachmentUrl(url);
      if (!fullUrl) return { uri: '' };
      const token = sessionToken || sessionTokenRef.current;
      return {
        uri: fullUrl,
        headers: token ? { 'X-Session-Token': token } : undefined,
      };
    };

    return (
      <View
        ref={(ref) => {
          if (ref) {
            messageRefsMap.current.set(item.id, ref);
          }
        }}
        style={[
          styles.messageRow,
          isOwnMessage ? styles.ownMessageRow : styles.otherMessageRow,
        ]}>
        <View
          style={[
            styles.messageBubble,
            isOwnMessage ? styles.ownMessage : styles.otherMessage,
            highlightedMessageId === item.id && styles.highlightedMessage,
          ]}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => {
              setSelectedMenuMessage(item);
              setMessageMenuVisible(true);
            }}
            activeOpacity={0.7}>
            <MaterialCommunityIcons name="dots-horizontal" size={16} color="#a6c455" />
          </TouchableOpacity>

          <Text style={styles.senderName}>
            {isOwnMessage ? 'YOU' : senderName.toUpperCase()}
          </Text>

          {repliedMessage && (
            <TouchableOpacity
              style={styles.repliedMessageContainer}
              onPress={() => handleViewRepliedMessage(repliedMessage)}
              activeOpacity={0.7}>
              <View style={styles.repliedMessageContent}>
                <Text style={styles.repliedMessageSender}>
                  {repliedMessage.senderName?.toUpperCase() || 'UNKNOWN'}
                </Text>
                <Text style={styles.repliedMessageText} numberOfLines={1}>
                  {repliedMessage.content}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {item.hasAttachment && item.attachmentUrl && (
            <View style={styles.attachmentContainer}>
              {item.attachmentType === 'image' ? (
                baseUrl ? (
                  <TouchableOpacity
                    onPress={() => {
                      const fullUrl = getFullAttachmentUrl(item.attachmentUrl);
                      if (fullUrl) {
                        setSelectedImage({
                          url: fullUrl,
                          name: item.attachmentName || 'Image',
                        });
                        setImageViewerVisible(true);
                      }
                    }}
                    activeOpacity={0.8}
                    style={styles.imageClickable}
                    disabled={false}>
                    <Image
                      source={getAuthImageSource(item.attachmentUrl)}
                      style={styles.attachmentImage}
                      resizeMode="cover"
                      pointerEvents="none"
                      onError={(error) => {
                        console.log('[ChatRoom] Image load error:', error.nativeEvent);
                      }}
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.attachmentImage}>
                    <ActivityIndicator size="small" color="#a6c455" />
                  </View>
                )
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
                    {item.attachmentThumbnailUrl && baseUrl ? (
                      <Image
                        source={getAuthImageSource(item.attachmentThumbnailUrl)}
                        style={styles.videoThumbnailImage}
                        resizeMode="cover"
                      />
                    ) : null}
                    <View style={styles.playOverlay}>
                      <MaterialCommunityIcons name="play-circle-outline" size={48} color="#fff" />
                    </View>
                  </View>
                  <Text style={styles.videoFileName} numberOfLines={1}>
                    {item.attachmentName || 'Video'}
                  </Text>
                </TouchableOpacity>
              ) : item.attachmentType === 'audio' ? (
                <View style={styles.audioAttachment}>
                  <TouchableOpacity
                    style={styles.audioPlayButton}
                    onPress={() => {
                      const fullUrl = getFullAttachmentUrl(item.attachmentUrl);
                      if (fullUrl) {
                        handlePlayAudio(item.id, fullUrl);
                      }
                    }}>
                    <MaterialCommunityIcons
                      name={playingAudioId === item.id ? 'stop-circle' : 'play-circle'}
                      size={36}
                      color="#a6c455"
                    />
                  </TouchableOpacity>
                  <View style={styles.audioInfo}>
                    <View style={styles.audioWaveform}>
                      <View style={[
                        styles.audioProgressBar,
                        { width: playingAudioId === item.id ? `${audioProgressPercent * 100}%` : '0%' },
                      ]} />
                    </View>
                    <Text style={styles.audioTime}>
                      {playingAudioId === item.id ? `${audioProgress} / ${audioDuration}` : (item.attachmentName || 'Voice note')}
                    </Text>
                  </View>
                </View>
              ) : (
                (() => {
                  const docIcon = getDocumentIcon(item.attachmentName, item.attachmentType);
                  return (
                    <TouchableOpacity
                      style={styles.fileAttachment}
                      onPress={async () => {
                        const fullUrl = getFullAttachmentUrl(item.attachmentUrl);
                        if (fullUrl) {
                          try {
                            await downloadAndOpenDocument(fullUrl, item.attachmentName || 'document');
                          } catch (error: any) {
                            console.error('[ChatRoom] Failed to open document:', error);
                            Alert.alert('Error', error.message || 'Failed to download or open document');
                          }
                        }
                      }}>
                      <MaterialCommunityIcons name={docIcon.icon} size={32} color={docIcon.color} />
                      <Text style={styles.fileName} numberOfLines={1}>
                        {item.attachmentName || 'Document'}
                      </Text>
                    </TouchableOpacity>
                  );
                })()
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

  // Flatten messages with date separators as individual items for FlatList
  // This prevents the inner .map() re-render problem that breaks Android touch handlers
  type FlatItem = { type: 'date'; date: string; key: string } | { type: 'message'; message: Message; key: string };

  const flatItems: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [];
    let currentDate = '';

    messages.forEach((message) => {
      const messageDate = new Date(message.timestamp).toDateString();
      if (messageDate !== currentDate) {
        items.push({ type: 'date', date: messageDate, key: `date-${messageDate}` });
        currentDate = messageDate;
      }
      items.push({ type: 'message', message, key: `msg-${message.id}` });
    });

    return items;
  }, [messages]);

  // Show replied message in a popup instead of scrolling (more reliable)
  const handleViewRepliedMessage = useCallback((repliedMessage: Message) => {
    console.log('[ChatRoom] Viewing replied message:', repliedMessage.id);
    setViewingRepliedMessage(repliedMessage);
  }, []);

  // Jump to a specific message in the chat - uses measured positions for accuracy
  const handleJumpToMessage = useCallback((messageId: number) => {
    console.log('[ChatRoom] Jumping to message:', messageId);

    // Set flag to prevent onContentSizeChange from interfering
    // Keep it true for the entire highlight duration
    isJumpingToMessage.current = true;

    // Close the modal first
    setViewingRepliedMessage(null);

    // Small delay to let modal close first
    setTimeout(() => {
      // Get the View ref for this message
      const messageRef = messageRefsMap.current.get(messageId);
      const flatList = flatListRef.current;

      if (messageRef && flatList) {
        // Measure the message position relative to the FlatList
        messageRef.measureLayout(
          flatList.getNativeScrollRef(),
          (x, y, width, height) => {
            console.log('[ChatRoom] Message measured position:', { x, y, width, height });

            // Scroll to the message position, offset by ~150px to show it in upper-middle of screen
            const scrollOffset = Math.max(0, y - 150);

            console.log('[ChatRoom] Scrolling to offset:', scrollOffset);

            flatList.scrollToOffset({
              offset: scrollOffset,
              animated: false,
            });
          },
          (error) => {
            console.log('[ChatRoom] measureLayout failed:', error);
          }
        );
      } else {
        console.log('[ChatRoom] Message ref or FlatList not found');
      }

      // Highlight the message so user can easily find it
      setHighlightedMessageId(messageId);

      // Clear highlight and jumping flag after 3 seconds
      setTimeout(() => {
        setHighlightedMessageId(null);
        isJumpingToMessage.current = false;
      }, 3000);
    }, 200);
  }, []);

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
            {displayName.startsWith('Direct Chat') ? (
              <Skeleton width={40} height={40} borderRadius={4} />
            ) : (
              <Text style={styles.headerAvatarText}>
                {displayName.substring(0, 2).toUpperCase()}
              </Text>
            )}
          </View>

          <View style={styles.headerInfo}>
            {displayName.startsWith('Direct Chat') ? (
              <Skeleton width={120} height={18} style={{ marginBottom: 4 }} />
            ) : (
              <Text style={styles.headerTitle} numberOfLines={1}>
                {displayName.toUpperCase()}
              </Text>
            )}
            <View style={styles.headerStatus}>
              <View style={[styles.statusDot, isGroup ? styles.statusDotGroup : (otherUserOnline ? styles.statusDotOnline : styles.statusDotOffline)]} />
              <Text style={[styles.headerSubtitle, !isGroup && (otherUserOnline ? styles.statusTextOnline : styles.statusTextOffline)]}>
                {isGroup ? 'GROUP CHANNEL' : (otherUserOnline ? 'ONLINE' : 'OFFLINE')}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Show Rejoin button if server reports an active group call AND user is NOT already in it */}
          {isGroup && activeGroupCall && callState.conversationId !== conversationId ? (
            <TouchableOpacity
              style={styles.rejoinButton}
              onPress={() => handleStartCall('video')}>
              <MaterialCommunityIcons
                name="phone-plus"
                size={18}
                color="#ffffff"
              />
              <Text style={styles.rejoinButtonText}>
                Rejoin ({activeGroupCall.participants.length})
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.callButton}
                onPress={async () => {
                  await handleStartCall('video');
                  // Video button: enable camera after call setup completes
                  const store = useCallStore.getState();
                  if (store.localStream) {
                    store.localStream.getVideoTracks().forEach((t: any) => { t.enabled = true; });
                    useCallStore.setState({ isVideoEnabled: true });
                  }
                }}>
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
          <TouchableOpacity
            style={styles.callButton}
            onPress={handleToggleMute}>
            <MaterialCommunityIcons
              name={isMuted ? 'bell-off' : 'bell'}
              size={18}
              color={isMuted ? '#888' : '#a6c455'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Call in Progress Banner */}
      {isGroup && activeGroupCall && callState.conversationId !== conversationId && (
        <View style={styles.callInProgressBanner}>
          <MaterialCommunityIcons name="phone-in-talk" size={16} color="#a6c455" />
          <Text style={styles.callInProgressText}>
            CALL IN PROGRESS ({activeGroupCall.participants.length} ACTIVE)
          </Text>
        </View>
      )}

      {/* Messages */}
      {isLoading ? (
        <View style={styles.messagesContent}>
          {[1, 2, 3, 4, 5].map((key) => {
            const isMe = key % 2 === 0;
            return (
              <View
                key={key}
                style={[
                  styles.messageRow,
                  isMe ? styles.ownMessageRow : styles.otherMessageRow,
                  { opacity: 0.7 }
                ]}>
                <View
                  style={[
                    styles.messageBubble,
                    isMe ? styles.ownMessage : styles.otherMessage,
                    { minWidth: 150, minHeight: 60, padding: 12, backgroundColor: '#2a2a2a', borderWidth: 0 }
                  ]}>
                  <Skeleton width="80%" height={12} style={{ marginBottom: 8 }} />
                  <Skeleton width="50%" height={12} style={{ marginBottom: 12 }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <Skeleton width={40} height={10} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={flatItems}
          extraData={`${messages.length}-${baseUrl}-${sessionToken}-${highlightedMessageId}-${playingAudioId}`}
          removeClippedSubviews={false}
          keyboardShouldPersistTaps="handled"
          windowSize={10}
          maxToRenderPerBatch={10}
          initialNumToRender={10}
          renderItem={({ item }) => {
            if (item.type === 'date') {
              return renderDateSeparator(item.date);
            }
            return renderMessage({ item: item.message });
          }}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.messagesContent}
          ListHeaderComponent={renderLoadingIndicator}
          ListFooterComponent={sendingAttachmentType ? (
            <View style={styles.sendingAttachmentIndicator}>
              <View style={styles.sendingAttachmentBubble}>
                <ActivityIndicator size="small" color="#a6c455" />
                <Text style={styles.sendingAttachmentText}>
                  {uploadProgress !== null
                    ? `UPLOADING ${sendingAttachmentType.toUpperCase()}... ${uploadProgress}%`
                    : `PROCESSING ${sendingAttachmentType.toUpperCase()}...`}
                </Text>
              </View>
            </View>
          ) : null}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            // Track whether user is near the bottom (within 150px)
            const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
            isNearBottom.current = distanceFromBottom < 150;

            // Check if user scrolled to top (within 100px threshold) for pagination
            if (contentOffset.y < 100) {
              const paginationInfo = useChatStore.getState().getPaginationInfo(conversationId);
              if (paginationInfo?.hasMore && !paginationInfo?.isLoading) {
                console.log('[ChatRoom] Near top, loading more messages...');
                loadMessages(false, true);
              }
            }
          }}
          scrollEventThrottle={400}
          onScrollToIndexFailed={(info) => {
            // Scroll to approximate position - don't retry scrollToIndex to avoid issues
            console.log('[ChatRoom] scrollToIndexFailed, using offset fallback');
            flatListRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          }}
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
                  source={{ uri: selectedAttachment.uri }}
                  style={styles.previewImage}
                />
              ) : selectedAttachment.type?.startsWith('video/') ? (
                <View style={styles.previewFile}>
                  <MaterialCommunityIcons name="video" size={24} color="#a6c455" />
                  <Text style={styles.previewFileName} numberOfLines={1}>
                    {selectedAttachment.fileName}
                  </Text>
                </View>
              ) : (
                (() => {
                  const docIcon = getDocumentIcon(selectedAttachment.fileName, selectedAttachment.type);
                  return (
                    <View style={styles.previewFile}>
                      <MaterialCommunityIcons name={docIcon.icon} size={24} color={docIcon.color} />
                      <Text style={styles.previewFileName} numberOfLines={1}>
                        {selectedAttachment.fileName}
                      </Text>
                    </View>
                  );
                })()
              )}
              <TouchableOpacity
                style={styles.removeAttachment}
                onPress={() => setSelectedAttachment(null)}>
                <Text style={styles.removeIcon}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Attachment Menu Overlay */}
        {attachmentMenuVisible && (
          <TouchableOpacity
            style={styles.attachmentMenuOverlay}
            activeOpacity={1}
            onPress={() => setAttachmentMenuVisible(false)}
          />
        )}

        {/* Attachment Menu */}
        {attachmentMenuVisible && (
          <View style={styles.attachmentMenu}>
            <TouchableOpacity
              style={styles.attachmentOption}
              onPress={handleCameraPicker}
              activeOpacity={0.7}>
              <View style={styles.attachmentOptionIcon}>
                <MaterialCommunityIcons name="camera" size={24} color="#d9a870" />
              </View>
              <Text style={styles.attachmentOptionText}>Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachmentOption}
              onPress={handleVideoCameraPicker}
              activeOpacity={0.7}>
              <View style={styles.attachmentOptionIcon}>
                <MaterialCommunityIcons name="video" size={24} color="#e57373" />
              </View>
              <Text style={styles.attachmentOptionText}>Video</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachmentOption}
              onPress={handleImageVideoPicker}
              activeOpacity={0.7}>
              <View style={styles.attachmentOptionIcon}>
                <MaterialCommunityIcons name="image" size={24} color="#a6c455" />
              </View>
              <Text style={styles.attachmentOptionText}>Gallery</Text>
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

        {/* Upload progress bar (#14) */}
        {uploadProgress !== null && (
          <View style={styles.uploadProgressContainer}>
            <View style={[styles.uploadProgressBar, { width: `${uploadProgress}%` }]} />
            <Text style={styles.uploadProgressText}>{uploadProgress}%</Text>
          </View>
        )}

        {/* Retry failed attachment */}
        {failedAttachment && !selectedAttachment && (
          <TouchableOpacity
            style={styles.retryBanner}
            onPress={() => {
              setSelectedAttachment(failedAttachment);
              setFailedAttachment(null);
            }}>
            <MaterialCommunityIcons name="refresh" size={16} color="#ff9800" />
            <Text style={styles.retryText}>Upload failed. Tap to retry.</Text>
          </TouchableOpacity>
        )}

        <View style={styles.inputWrapper}>
          {isRecordingVoice ? (
            <VoiceNoteRecorder
              onSend={handleSendVoiceNote}
              onCancel={() => setIsRecordingVoice(false)}
            />
          ) : (
            <>
              <TouchableOpacity
                style={styles.attachButton}
                onPress={handleAttachment}
                disabled={isSending}>
                <MaterialCommunityIcons
                  name={attachmentMenuVisible ? "close" : "paperclip"}
                  size={22}
                  color={isSending ? '#3a3a3a' : attachmentMenuVisible ? '#ff4444' : '#a6c455'}
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

              {messageText.trim() || selectedAttachment ? (
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
              ) : (
                <TouchableOpacity
                  onPress={() => setIsRecordingVoice(true)}
                  disabled={isSending}
                  style={styles.sendButton}>
                  <MaterialCommunityIcons
                    name="microphone"
                    size={22}
                    color={isSending ? '#3a3a3a' : '#a6c455'}
                  />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>

      {/* Message Menu Modal */}
      <Modal
        visible={messageMenuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setMessageMenuVisible(false);
          setSelectedMenuMessage(null);
        }}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setMessageMenuVisible(false);
            setSelectedMenuMessage(null);
          }}>
          <View style={styles.messageMenu}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                if (selectedMenuMessage) {
                  setReplyToMessage(selectedMenuMessage);
                }
                setMessageMenuVisible(false);
                setSelectedMenuMessage(null);
              }}>
              <MaterialCommunityIcons name="reply" size={20} color="#a6c455" />
              <Text style={styles.menuItemText}>REPLY</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                if (selectedMenuMessage) {
                  handleForwardMessage(selectedMenuMessage);
                }
                setSelectedMenuMessage(null);
              }}>
              <MaterialCommunityIcons name="share" size={20} color="#a6c455" />
              <Text style={styles.menuItemText}>FORWARD</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                if (selectedMenuMessage) {
                  handleDeleteMessage(selectedMenuMessage);
                }
                setSelectedMenuMessage(null);
              }}>
              <MaterialCommunityIcons name="delete" size={20} color="#ff4444" />
              <Text style={[styles.menuItemText, { color: '#ff4444' }]}>DELETE</Text>
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
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.conversationItem}
                  onPress={() => handleForwardToConversation(item.id)}>
                  <View style={[styles.conversationAvatar, item.isGroup ? styles.groupAvatar : styles.directAvatar]}>
                    <Text style={styles.conversationAvatarText}>
                      {(item.displayName || item.name)?.substring(0, 2).toUpperCase() || '??'}
                    </Text>
                  </View>
                  <Text style={styles.conversationName}>{item.displayName || item.name || 'Unnamed'}</Text>
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
                    <Text style={[styles.deleteOptionTitle, { color: '#ff4444' }]}>
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

      {/* View Replied Message Modal */}
      <Modal
        visible={viewingRepliedMessage !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setViewingRepliedMessage(null)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setViewingRepliedMessage(null)}>
          <Pressable
            style={styles.repliedMessageModal}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.repliedMessageModalHeader}>
              <Text style={styles.repliedMessageModalTitle}>ORIGINAL MESSAGE</Text>
              <TouchableOpacity onPress={() => setViewingRepliedMessage(null)}>
                <MaterialCommunityIcons name="close" size={24} color="#a6c455" />
              </TouchableOpacity>
            </View>

            {viewingRepliedMessage && (
              <>
                <View style={styles.repliedMessageModalContent}>
                  <Text style={styles.repliedMessageModalSender}>
                    {viewingRepliedMessage.senderName?.toUpperCase() || 'UNKNOWN'}
                  </Text>
                  <Text style={styles.repliedMessageModalText}>
                    {viewingRepliedMessage.content}
                  </Text>
                  {viewingRepliedMessage.timestamp && (
                    <Text style={styles.repliedMessageModalTime}>
                      {new Date(viewingRepliedMessage.timestamp).toLocaleString()}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.jumpToMessageButton}
                  onPress={() => handleJumpToMessage(viewingRepliedMessage.id)}
                  activeOpacity={0.7}>
                  <MaterialCommunityIcons name="arrow-down-circle" size={20} color="#a6c455" />
                  <Text style={styles.jumpToMessageText}>JUMP TO MESSAGE</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
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

      {/* Image Viewer Modal */}
      <ImageViewerModal
        visible={imageViewerVisible}
        imageUrl={selectedImage?.url || ''}
        imageName={selectedImage?.name}
        onClose={() => {
          setImageViewerVisible(false);
          setSelectedImage(null);
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
                        <MaterialCommunityIcons name="badge-account" size={20} color="#a6c455" />
                        <Text style={styles.infoLabel}>NRP</Text>
                      </View>
                      <Text style={styles.infoValue}>
                        {selectedMemberProfile.nrp || 'Not set'}
                      </Text>

                      <View style={styles.infoItem}>
                        <MaterialCommunityIcons name="shield-star" size={20} color="#a6c455" />
                        <Text style={styles.infoLabel}>RANK</Text>
                      </View>
                      <Text style={styles.infoValue}>
                        {selectedMemberProfile.rank || 'Not set'}
                      </Text>

                      <View style={styles.infoItem}>
                        <MaterialCommunityIcons name="shield-account" size={20} color="#a6c455" />
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
                  <View style={styles.memberHeaderRow}>
                    <View style={styles.infoItem}>
                      <MaterialCommunityIcons name="account-group" size={20} color="#a6c455" />
                      <Text style={styles.infoLabel}>
                        {conversationMembers.length} MEMBERS
                      </Text>
                    </View>
                    {/* Add Member Button - Only for Admins */}
                    {conversationMembers.find(m => m.userId === user?.id)?.role === 'admin' && (
                      <TouchableOpacity
                        style={styles.addMemberButton}
                        onPress={handleOpenAddMemberModal}
                        activeOpacity={0.7}>
                        <MaterialCommunityIcons name="account-plus" size={18} color="#a6c455" />
                        <Text style={styles.addMemberButtonText}>ADD</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <FlatList
                    data={conversationMembers}
                    keyExtractor={(item) => String(item.userId)}
                    renderItem={({ item }) => {
                      const currentMember = conversationMembers.find(m => m.userId === user?.id);
                      const isCurrentUserAdmin = currentMember?.role === 'admin';
                      const isMemberAdmin = item.role === 'admin';
                      const canRemove = isCurrentUserAdmin && item.userId !== user?.id;

                      return (
                        <View style={styles.memberItem}>
                          <TouchableOpacity
                            style={styles.memberTouchable}
                            onPress={() => setSelectedMemberProfile(item)}
                            activeOpacity={0.7}>
                            <View style={[styles.memberAvatar, styles.directAvatar]}>
                              <Text style={styles.memberAvatarText}>
                                {(item.callsign || item.fullName || 'U').substring(0, 2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.memberInfo}>
                              <View style={styles.memberNameRow}>
                                <Text style={styles.memberName}>
                                  {item.callsign || item.fullName || 'Unknown User'}
                                  {item.userId === user?.id && ' (YOU)'}
                                </Text>
                                {isMemberAdmin && (
                                  <View style={styles.adminBadge}>
                                    <MaterialCommunityIcons name="shield-crown" size={12} color="#FFD700" />
                                    <Text style={styles.adminBadgeText}>ADMIN</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.memberUsername}>
                                {item.rank || 'No Rank'} • {item.branch || 'No Branch'}
                              </Text>
                            </View>
                            <MaterialCommunityIcons name="chevron-right" size={20} color="#666" />
                          </TouchableOpacity>
                          {canRemove && (
                            <TouchableOpacity
                              style={styles.removeMemberButton}
                              onPress={() => handleRemoveMember(item.userId, item.callsign || item.fullName || 'Unknown User')}
                              activeOpacity={0.7}>
                              <MaterialCommunityIcons name="account-remove" size={20} color="#ff4444" />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    }}
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
                          <MaterialCommunityIcons name="badge-account" size={20} color="#a6c455" />
                          <Text style={styles.infoLabel}>NRP</Text>
                        </View>
                        <Text style={styles.infoValue}>
                          {otherUser.nrp || 'Not set'}
                        </Text>

                        <View style={styles.infoItem}>
                          <MaterialCommunityIcons name="shield-star" size={20} color="#a6c455" />
                          <Text style={styles.infoLabel}>RANK</Text>
                        </View>
                        <Text style={styles.infoValue}>
                          {otherUser.rank || 'Not set'}
                        </Text>

                        <View style={styles.infoItem}>
                          <MaterialCommunityIcons name="shield-account" size={20} color="#a6c455" />
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

      {/* Add Member Modal */}
      <Modal
        visible={addMemberModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setAddMemberModalVisible(false);
          setSelectedUsersToAdd([]);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.addMemberDialog}>
            {/* Header */}
            <View style={styles.addMemberHeader}>
              <Text style={styles.addMemberTitle}>ADD MEMBERS</Text>
              <TouchableOpacity
                onPress={() => {
                  setAddMemberModalVisible(false);
                  setSelectedUsersToAdd([]);
                }}>
                <MaterialCommunityIcons name="close" size={24} color="#a6c455" />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.addMemberSearchContainer}>
              <TextInput
                style={styles.addMemberSearchInput}
                placeholder="SEARCH PERSONNEL..."
                placeholderTextColor="#666"
                value={addMemberSearchQuery}
                onChangeText={setAddMemberSearchQuery}
              />
            </View>

            {/* Selection Info */}
            {selectedUsersToAdd.length > 0 && (
              <View style={styles.addMemberSelectionInfo}>
                <Text style={styles.addMemberSelectionText}>
                  {selectedUsersToAdd.length} PERSONNEL SELECTED
                </Text>
              </View>
            )}

            {/* Users List */}
            {isLoadingUsersToAdd ? (
              <View style={styles.addMemberLoadingContainer}>
                <ActivityIndicator size="large" color="#a6c455" />
                <Text style={styles.addMemberLoadingText}>LOADING PERSONNEL...</Text>
              </View>
            ) : getFilteredUsersToAdd().length === 0 ? (
              <View style={styles.addMemberEmptyContainer}>
                <MaterialCommunityIcons name="account-search" size={48} color="#666" />
                <Text style={styles.addMemberEmptyText}>
                  {addMemberSearchQuery ? 'NO MATCHING PERSONNEL' : 'NO AVAILABLE PERSONNEL TO ADD'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={getFilteredUsersToAdd()}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => {
                  const isSelected = selectedUsersToAdd.includes(item.id);
                  return (
                    <TouchableOpacity
                      style={styles.addMemberUserItem}
                      onPress={() => toggleUserToAdd(item.id)}
                      activeOpacity={0.7}>
                      <View style={[styles.addMemberAvatar, isSelected && styles.addMemberAvatarSelected]}>
                        <Text style={styles.addMemberAvatarText}>
                          {(item.callsign || item.fullName || 'U').substring(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.addMemberUserInfo}>
                        <Text style={styles.addMemberUserName}>
                          {item.callsign || item.fullName || 'Unknown User'}
                        </Text>
                        <Text style={styles.addMemberUserDetails}>
                          {item.rank || 'No Rank'} • {item.branch || 'No Branch'}
                        </Text>
                      </View>
                      {isSelected && (
                        <View style={styles.addMemberCheckmark}>
                          <MaterialCommunityIcons name="check" size={18} color="#a6c455" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                style={styles.addMemberUsersList}
              />
            )}

            {/* Action Buttons */}
            <View style={styles.addMemberButtonRow}>
              <TouchableOpacity
                style={[
                  styles.addMemberConfirmButton,
                  (selectedUsersToAdd.length === 0 || isAddingMembers) && styles.addMemberConfirmButtonDisabled,
                ]}
                onPress={handleAddMembers}
                disabled={selectedUsersToAdd.length === 0 || isAddingMembers}
                activeOpacity={0.7}>
                {isAddingMembers ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="account-multiple-plus" size={18} color="#ffffff" />
                    <Text style={styles.addMemberConfirmText}>
                      ADD {selectedUsersToAdd.length > 0 ? `(${selectedUsersToAdd.length})` : ''}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.addMemberCancelButton}
                onPress={() => {
                  setAddMemberModalVisible(false);
                  setSelectedUsersToAdd([]);
                }}
                activeOpacity={0.7}>
                <Text style={styles.addMemberCancelText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
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
    marginRight: 6,
  },
  statusDotGroup: {
    backgroundColor: '#a6c455',
  },
  statusDotOnline: {
    backgroundColor: '#4ade80',
  },
  statusDotOffline: {
    backgroundColor: '#666',
  },
  headerSubtitle: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  statusTextOnline: {
    color: '#4ade80',
  },
  statusTextOffline: {
    color: '#666',
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
  callInProgressBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a3a1a',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#4d5d30',
  },
  callInProgressText: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
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
  highlightedMessage: {
    borderColor: '#a6c455',
    borderWidth: 2,
    backgroundColor: '#3d4d25',
  },
  senderName: {
    color: '#a6c455',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 4,
    paddingRight: 24,
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
  sendingAttachmentIndicator: {
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  sendingAttachmentBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a3a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: '#4d5d30',
    borderStyle: 'dashed',
  },
  sendingAttachmentText: {
    color: '#a6c455',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  imageClickable: {
    borderRadius: 4,
  },
  attachmentImage: {
    width: 200,
    height: 200,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
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
    position: 'relative',
  },
  videoThumbnailImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  playOverlay: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 30,
    width: 60,
    height: 60,
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
    gap: 8,
    width: '100%',
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
    flexShrink: 1,
  },
  audioAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
    padding: 8,
    minWidth: 200,
  },
  audioPlayButton: {
    marginRight: 8,
  },
  audioInfo: {
    flex: 1,
  },
  audioWaveform: {
    height: 4,
    backgroundColor: '#1a1a1a',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  audioProgressBar: {
    height: '100%',
    backgroundColor: '#a6c455',
    borderRadius: 2,
  },
  audioTime: {
    color: '#888',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  attachmentMenuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 999,
    elevation: 5,
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
    elevation: 10,
    zIndex: 1000,
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
  repliedMessageModal: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 16,
    width: '85%',
    maxHeight: '60%',
  },
  repliedMessageModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#4d5d30',
    paddingBottom: 12,
  },
  repliedMessageModalTitle: {
    color: '#a6c455',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  repliedMessageModalContent: {
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#a6c455',
  },
  repliedMessageModalSender: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  repliedMessageModalText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  repliedMessageModalTime: {
    color: '#666',
    fontSize: 10,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  jumpToMessageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
    padding: 12,
    marginTop: 16,
    gap: 8,
  },
  jumpToMessageText: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  messageMenu: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 8,
    minWidth: 200,
    maxHeight: SCREEN_HEIGHT * 0.5,
    maxWidth: SCREEN_WIDTH * 0.8,
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
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  memberTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    padding: 12,
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
  },
  memberUsername: {
    color: '#888',
    fontSize: 12,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  adminBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 2,
  },
  removeMemberButton: {
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addMemberButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#4d5d30',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#5a6b38',
  },
  addMemberButtonText: {
    color: '#a6c455',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  addMemberDialog: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    width: '90%',
    maxHeight: '80%',
    borderWidth: 2,
    borderColor: '#4d5d30',
  },
  addMemberHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
  },
  addMemberTitle: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  addMemberSearchContainer: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  addMemberSearchInput: {
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
  addMemberSelectionInfo: {
    backgroundColor: '#4d5d30',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#5a6b38',
  },
  addMemberSelectionText: {
    color: '#a6c455',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },
  addMemberLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    minHeight: 200,
  },
  addMemberLoadingText: {
    color: '#666',
    fontSize: 11,
    marginTop: 16,
    letterSpacing: 1,
    fontWeight: '600',
  },
  addMemberEmptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    minHeight: 200,
  },
  addMemberEmptyText: {
    color: '#666',
    fontSize: 11,
    marginTop: 16,
    letterSpacing: 1,
    fontWeight: '600',
    textAlign: 'center',
  },
  addMemberUsersList: {
    maxHeight: 300,
  },
  addMemberUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  addMemberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#3a3a3a',
    borderWidth: 2,
    borderColor: '#4d5d30',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addMemberAvatarSelected: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
  },
  addMemberAvatarText: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
  },
  addMemberUserInfo: {
    flex: 1,
  },
  addMemberUserName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  addMemberUserDetails: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  addMemberCheckmark: {
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
  addMemberButtonRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  addMemberConfirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4d5d30',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#5a6b38',
    gap: 8,
  },
  addMemberConfirmButtonDisabled: {
    backgroundColor: '#333',
    borderColor: '#444',
  },
  addMemberConfirmText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  addMemberCancelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#2a2a2a',
  },
  addMemberCancelText: {
    color: '#999',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
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
  uploadProgressContainer: {
    height: 20,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    marginHorizontal: 12,
    marginBottom: 4,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  uploadProgressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#4d5d30',
    borderRadius: 4,
  },
  uploadProgressText: {
    color: '#a6c455',
    fontSize: 10,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  retryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a1a00',
    paddingVertical: 6,
    gap: 6,
  },
  retryText: {
    color: '#ff9800',
    fontSize: 12,
  },
});
