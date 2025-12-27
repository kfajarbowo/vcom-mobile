# VCommMobile Chat Testing Guide

## How to Test the Chat Feature

### 1. Check the Console Logs

Open your React Native debugger and look for these logs:

```
[ChatsScreen] Mounting, connecting WebSocket...
[ChatList] Component mounted, loading data...
[ChatList] Fetching conversations...
[ChatList] Received conversations: X
[ChatList] Setting conversations: X
[ChatList] Render - isLoading: false conversations: X
```

### 2. Expected Screens

#### **Empty State (No Conversations)**
You should see:
- 💬 emoji icon
- "No Conversations Yet" heading
- "Tap the + button below to start a new conversation" message
- **Green circular + button** in bottom-right corner

#### **With Conversations**
You should see:
- List of conversations with avatars
- Last message preview
- Timestamps
- Unread count badges (if any)
- **Green circular + button** in bottom-right corner

### 3. Creating a New Conversation

1. **Tap the green + button**
2. You should see a modal with:
   - Search bar at top
   - List of all users (excluding yourself)
   - Each user shows: Callsign, Full Name, Rank, Branch

3. **For Direct Chat:**
   - Tap ONE user (avatar turns green, checkmark appears)
   - Tap "Create" in top-right
   - Chat opens automatically

4. **For Group Chat:**
   - Tap TWO or MORE users
   - "X users selected (Group Chat)" appears
   - "Group Name:" input field appears
   - Enter a group name
   - Tap "Create"
   - Group chat opens automatically

### 4. Troubleshooting

#### Nothing Shows Up
Check console for errors:
```javascript
[ChatList] Error loading conversations: [error details]
```

Common issues:
- Not logged in → Check session token
- API server down → Check `apiClient.ts` server URL
- Network error → Check device network connection

#### Can't See Users in New Conversation Modal
Check:
```javascript
[NewConversation] Loading users...
[NewConversation] Loaded X users
```

#### Can't Send Messages
Check:
```javascript
[ChatRoom] Error sending message: [error details]
```

### 5. API Endpoints Being Used

```
GET  /api/conversations        - Load conversation list
GET  /api/all-users           - Load users for selection
POST /api/direct-chats        - Create 1-on-1 chat
POST /api/rooms               - Create group chat
GET  /api/conversations/:id/messages - Load messages
POST /api/messages            - Send message
POST /api/conversations/:id/mark-read - Mark as read
```

### 6. WebSocket Connection

The app connects to WebSocket at: `ws://31.97.50.227:5000/ws`

Check for:
```
[WebSocket] Connecting to: ws://...
[WebSocket] Connected successfully
```

### 7. Manual Testing Checklist

- [ ] App loads without crashing
- [ ] Chats tab shows properly
- [ ] Empty state displays correctly
- [ ] + button is visible and clickable
- [ ] New conversation modal opens
- [ ] User list loads
- [ ] Search filters users
- [ ] Can select single user
- [ ] Can create direct chat
- [ ] Can select multiple users
- [ ] Group name input appears for 2+ users
- [ ] Can create group chat
- [ ] Chat room opens
- [ ] Can send message
- [ ] Can receive message (test with another device/user)
- [ ] Back button returns to chat list
- [ ] WebSocket reconnects if disconnected

### 8. Current Server Configuration

**API Server:** `http://31.97.50.227:5000`
**WebSocket:** `ws://31.97.50.227:5000/ws`

To change server, edit:
`VCommMobile/src/services/apiClient.ts`

```typescript
const host = '31.97.50.227';  // Change this
const port = '5000';          // Change this
```

### 9. Known Limitations (To Be Implemented)

- ❌ File attachments
- ❌ Voice messages
- ❌ Image sharing
- ❌ Reply to messages
- ❌ Forward messages
- ❌ Delete messages
- ❌ Edit group name/members
- ❌ Typing indicators (infrastructure exists, UI pending)
- ❌ Read receipts (infrastructure exists, UI pending)

### 10. Quick Debug Commands

Run these in your terminal:

```bash
# Check TypeScript errors
cd VCommMobile && npx tsc --noEmit

# Clear cache and restart
cd VCommMobile && npx react-native start --reset-cache

# Rebuild app
cd VCommMobile && npx react-native run-android
# or
cd VCommMobile && npx react-native run-ios
```

## Architecture Overview

```
ChatsScreen
├── ChatList (shows conversations)
│   ├── FlatList (conversation items)
│   └── NewConversation Modal
│       └── User selection
└── ChatRoom (when conversation selected)
    ├── Message list
    └── Message input
```

## State Management

- **chatStore.ts** - Zustand store for conversations & messages
- **authStore.ts** - User authentication state
- **websocket.ts** - Real-time messaging service

All state is reactive and updates automatically via WebSocket events.
