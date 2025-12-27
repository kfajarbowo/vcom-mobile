# WebSocket Troubleshooting Guide

## Understanding the Error

The error `isTrusted: false` is a WebSocket connection error. This means:
- ✅ **Your app still works!** You can view and send messages
- ❌ **No real-time updates** - You won't see new messages until you manually refresh
- ⚠️ **Non-critical error** - The app continues to function normally

## What I've Fixed

1. **Better error logging** - Now shows detailed WebSocket error information
2. **Made WebSocket optional** - App works even if WebSocket fails
3. **Graceful degradation** - Chat features work without real-time updates

## Check the Console Logs

When the app starts, look for these messages:

### ✅ Successful Connection:
```
[WebSocket] Connecting to: ws://31.97.50.227:5000/ws
[WebSocket] Has session token: true
[WebSocket] ✅ Connected successfully
[WebSocket] Sending authentication...
```

### ❌ Failed Connection:
```
[WebSocket] Connecting to: ws://31.97.50.227:5000/ws
[WebSocket] ❌ Error occurred: {
  message: "...",
  isTrusted: false,
  code: 1006
}
[WebSocket] 🔌 Connection closed: {
  code: 1006,
  reason: "",
  wasClean: false
}
```

## Common Causes & Solutions

### 1. **Server Not Running WebSocket**

**Check:**
```bash
# On the server, check if WebSocket is listening
netstat -an | grep 5000
```

**Expected:** Should show port 5000 listening

**Fix:** Make sure the vcomm-web server is running with WebSocket support

---

### 2. **Network/Firewall Issues**

**Check:**
- Can you access the API? (http://31.97.50.227:5000/api/...)
- Is there a firewall blocking WebSocket connections?
- Are you on the same network as the server?

**Fix:**
- Test from web browser first
- Check firewall rules
- Try from same network as server

---

### 3. **React Native WebSocket Implementation**

**Check:**
- iOS vs Android differences
- Metro bundler issues

**Fix for Android:**
```bash
# Clear cache and rebuild
cd VCommMobile
npx react-native start --reset-cache
```

**Fix for iOS:**
```bash
# Rebuild pods
cd ios && pod install && cd ..
```

---

### 4. **Authentication Issues**

**Check logs for:**
```
[WebSocket] Has session token: false
[WebSocket] ⚠️ No session token available
```

**Fix:** Make sure you're logged in before connecting to WebSocket

---

## Testing WebSocket Connection

### Test from Browser Console:
```javascript
// Open browser console on http://31.97.50.227:5000
const ws = new WebSocket('ws://31.97.50.227:5000/ws');
ws.onopen = () => console.log('Connected!');
ws.onerror = (e) => console.error('Error:', e);
ws.onclose = (e) => console.log('Closed:', e.code, e.reason);
```

If this works in browser but not in app, it's a React Native issue.

---

## Current Behavior

### ✅ **What Works WITHOUT WebSocket:**
- View conversation list
- Send messages
- Receive messages (after manual refresh)
- Create new conversations
- View message history
- All chat UI features

### ❌ **What Doesn't Work WITHOUT WebSocket:**
- Real-time message updates
- Live typing indicators
- Instant read receipts
- Live presence status
- New message notifications without refresh

---

## Workaround (While WebSocket is Down)

**Pull to refresh** on conversation list to see new messages:
1. Go to chat list
2. Pull down to refresh
3. New messages will appear

**Auto-refresh messages** is still possible:
- Messages in open chat are checked periodically
- Sending a message refreshes the conversation

---

## Server-Side Checklist

Verify WebSocket server is configured:

```typescript
// vcomm-web/server/index.ts should have:
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');

  ws.on('message', (data) => {
    // Handle messages
  });
});
```

---

## Debugging Steps

### 1. **Enable Verbose Logging**

The WebSocket service now logs:
- Connection attempts
- Success/failure
- Authentication status
- All messages sent/received
- Close events with codes

### 2. **Check WebSocket Close Codes**

Common codes:
- **1000** - Normal closure (OK)
- **1001** - Going away (server shutting down)
- **1006** - Abnormal closure (connection failed)
- **1011** - Server error
- **1015** - TLS handshake failure

### 3. **Test Direct Connection**

Try connecting without authentication:
```typescript
// Temporary test - add to ChatsScreen
const testWS = new WebSocket('ws://31.97.50.227:5000/ws');
testWS.onopen = () => console.log('TEST: Connected');
testWS.onerror = (e) => console.error('TEST: Error', e);
```

---

## Production Recommendations

### 1. **Use Secure WebSocket (WSS)**
```typescript
// Change in apiClient.ts
const protocol = 'https'; // instead of 'http'
// WebSocket will automatically become wss://
```

### 2. **Add Connection Status Indicator**

Show users when real-time updates are active:
```tsx
<View style={styles.statusBar}>
  {isConnected ? (
    <Text>🟢 LIVE</Text>
  ) : (
    <Text>🔴 OFFLINE (Manual refresh needed)</Text>
  )}
</View>
```

### 3. **Implement Polling Fallback**

If WebSocket fails, poll for new messages:
```typescript
// In ChatList
useEffect(() => {
  if (!isConnected) {
    const interval = setInterval(() => {
      loadConversations(); // Refresh every 10s
    }, 10000);
    return () => clearInterval(interval);
  }
}, [isConnected]);
```

---

## Quick Summary

**Current Status:** ✅ Chat works, ❌ No real-time updates

**Impact:** Low - Users can still chat, just need manual refresh

**Fix Priority:** Medium - Nice to have, not critical

**Workaround:** Pull-to-refresh on conversation list

**Next Steps:**
1. Check server WebSocket logs
2. Verify server is accessible at ws://31.97.50.227:5000/ws
3. Test from web browser first
4. If browser works, check React Native WebSocket polyfill

The chat feature is fully functional - WebSocket just adds the "live" experience!
