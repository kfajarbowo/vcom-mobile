import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {ChatList} from '../../components/ChatList';
import {ChatRoom} from '../../components/ChatRoom';
import {useChatStore} from '../../store/chatStore';

export function ChatsScreen() {
  const navigation = useNavigation();
  const [selectedConversation, setSelectedConversation] = useState<{
    id: number;
    isGroup: boolean;
    name: string;
    otherUserId?: number;
  } | null>(null);

  const conversations = useChatStore((state) => state.conversations);

  // Hide/show tab bar based on conversation selection
  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: selectedConversation
        ? {display: 'none'}
        : {
            backgroundColor: '#1a1a1a',
            borderTopWidth: 2,
            borderTopColor: '#4d5d30',
            height: 70,
            paddingBottom: 8,
            paddingTop: 8,
          },
    });
  }, [selectedConversation, navigation]);

  console.log('[ChatsScreen] Render - selectedConversation:', selectedConversation?.id);

  const handleSelectChat = (conversationId: number, isGroup: boolean, displayName?: string) => {
    const conversation = conversations.find((c) => c.id === conversationId);
    if (conversation) {
      console.log('[ChatsScreen] Selected conversation:', conversation);
      console.log('[ChatsScreen] otherUserId:', conversation.otherUserId);
      setSelectedConversation({
        id: conversationId,
        isGroup,
        name: displayName || conversation.name,
        otherUserId: conversation.otherUserId,
      });
    }
  };

  const handleBack = () => {
    setSelectedConversation(null);
  };

  if (selectedConversation) {
    return (
      <View className="flex-1">
        <ChatRoom
          conversationId={selectedConversation.id}
          isGroup={selectedConversation.isGroup}
          conversationName={selectedConversation.name}
          otherUserId={selectedConversation.otherUserId}
          onBack={handleBack}
        />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <ChatList onSelectChat={handleSelectChat} />
    </View>
  );
}
