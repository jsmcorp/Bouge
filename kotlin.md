# Confessr Android Kotlin Migration Specification

## Executive Summary

This document outlines the complete migration strategy from the current React/TypeScript/Capacitor app to a native Android Kotlin application. The primary goal is to eliminate Supabase Realtime connection issues during device lock/unlock cycles while preserving all existing functionality.

## Current App Architecture Analysis

### Tech Stack Overview
- **Frontend**: React 18 + TypeScript + Vite
- **State Management**: Zustand with persistence
- **Styling**: Tailwind CSS + shadcn/ui components
- **Backend**: Supabase (Database, Auth, Real-time)
- **Mobile**: Capacitor 7 with Android/iOS support
- **Database**: SQLite (local) + Supabase (remote)
- **Authentication**: Phone verification via Twilio Verify API

### Core Features Inventory

#### 1. Authentication System
- **Phone-based authentication** using Twilio Verify API
- **OTP verification** with test credentials (+917744939966, OTP: 212121)
- **Session management** with Supabase Auth
- **User profile sync** with `users` table
- **Persistent auth state** via Zustand store

#### 2. Database Schema (Supabase)
```sql
-- Core tables with Row Level Security
users (id, phone_number, display_name, avatar_url, is_onboarded, created_at)
groups (id, name, description, invite_code, created_by, avatar_url, created_at)
group_members (group_id, user_id, role, joined_at)
messages (id, group_id, user_id, content, is_ghost, message_type, category, parent_id, image_url, created_at, dedupe_key)
reactions (id, message_id, user_id, emoji, created_at)
polls (id, message_id, question, options, closes_at, created_at)
poll_votes (id, poll_id, user_id, option_index, created_at)
pseudonyms (group_id, user_id, pseudonym, created_at)
group_media (id, group_id, user_id, file_url, file_type, file_size, created_at)
```

#### 3. Real-time Messaging System
- **Ghost mode messaging** with anonymous pseudonyms
- **Group chats** with invite codes (6-character)
- **Message reactions** with emoji support
- **Thread replies** and message threading
- **Typing indicators** with real-time updates
- **Message delivery status** (sending, sent, delivered, failed)
- **Offline message queue** with SQLite outbox
- **Message deduplication** using dedupe_key

#### 4. Mobile-Specific Features
- **Encrypted SQLite** for offline storage
- **Biometric authentication** support (currently disabled)
- **Push notifications** via Firebase Cloud Messaging
- **Native splash screen** and status bar styling
- **Haptic feedback** for interactions
- **Network status monitoring** with reconnection logic
- **App state management** (foreground/background)

#### 5. UI/UX Components
- **Dark theme first** design system
- **Responsive mobile layout** with breakpoints
- **WhatsApp-style connection status** indicator
- **Swipe gestures** for message actions
- **Pull-to-refresh** functionality
- **Infinite scroll** for message history
- **Image upload and sharing** capabilities

### Current Issues Analysis

#### Primary Problem: Supabase Realtime Connection Instability
1. **Device Lock/Unlock Cycles**: Connection drops during device sleep/wake
2. **Multiple Client Instances**: "Multiple GoTrueClient instances detected" warnings
3. **Session Recovery Failures**: Token refresh issues after device unlock
4. **Network Transition Handling**: Poor WiFi/cellular switching
5. **Race Conditions**: Multiple concurrent reconnection attempts
6. **Timeout Issues**: 6-second timeouts too short for mobile networks

#### Secondary Issues
1. **SQLite Encryption**: Key access issues after device unlock
2. **Memory Management**: WebView memory leaks in long sessions
3. **Performance**: React rendering overhead for large message lists
4. **Battery Drain**: Excessive background processing
5. **App Store Compliance**: WebView-based apps face restrictions

## Migration Strategy

### Phase 1: Minimal Viable Product (MVP) - Supabase Connection Only

#### Objective
Create a minimal Android Kotlin app that only handles Supabase Realtime connections to isolate and solve the core connectivity issues.

#### MVP Features
- Supabase client initialization
- Authentication with phone/OTP
- Single Realtime channel subscription
- Device lock/unlock handling
- Network state monitoring
- Connection status UI

#### MVP Architecture
```kotlin
// Core classes
class SupabaseManager : Singleton
class ConnectionManager : Handles realtime subscriptions
class AuthManager : Manages authentication state
class NetworkMonitor : Monitors connectivity changes
class DeviceStateManager : Handles app lifecycle events
```

### Phase 2: Core Messaging Features

#### Features to Implement
- Message sending/receiving
- Ghost mode functionality
- Group management
- SQLite offline storage
- Message synchronization

### Phase 3: Advanced Features

#### Features to Implement
- File uploads and media sharing
- Push notifications
- Polls and reactions
- Thread replies
- UI polish and animations

## Technical Implementation Plan

### 1. Project Structure
```
app/
├── src/main/java/com/confessr/app/
│   ├── data/
│   │   ├── local/          # SQLite database
│   │   ├── remote/         # Supabase API
│   │   └── repository/     # Data layer
│   ├── domain/
│   │   ├── model/          # Data models
│   │   ├── repository/     # Repository interfaces
│   │   └── usecase/        # Business logic
│   ├── presentation/
│   │   ├── ui/             # Compose UI
│   │   ├── viewmodel/      # ViewModels
│   │   └── navigation/     # Navigation
│   ├── di/                 # Dependency injection
│   └── util/               # Utilities
```

### 2. Key Dependencies
```kotlin
// Supabase
implementation("io.github.jan-tennert.supabase:postgrest-kt:2.0.0")
implementation("io.github.jan-tennert.supabase:realtime-kt:2.0.0")
implementation("io.github.jan-tennert.supabase:gotrue-kt:2.0.0")

// Database
implementation("androidx.room:room-runtime:2.6.1")
implementation("androidx.room:room-ktx:2.6.1")
implementation("net.zetetic:android-database-sqlcipher:4.5.4")

// Networking
implementation("io.ktor:ktor-client-android:2.3.7")
implementation("io.ktor:ktor-client-content-negotiation:2.3.7")

// UI
implementation("androidx.compose.ui:ui:1.5.8")
implementation("androidx.compose.material3:material3:1.1.2")
implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")

// Dependency Injection
implementation("com.google.dagger:hilt-android:2.48")
```

### 3. Core Implementation Classes

#### SupabaseManager (Singleton)
```kotlin
class SupabaseManager private constructor() {
    private var client: SupabaseClient? = null
    
    suspend fun initialize(url: String, anonKey: String)
    suspend fun signInWithOtp(phone: String): AuthResult
    suspend fun verifyOtp(phone: String, token: String): AuthResult
    fun getRealtimeChannel(topic: String): RealtimeChannel
    suspend fun getCurrentSession(): Session?
}
```

#### ConnectionManager
```kotlin
class ConnectionManager(
    private val supabaseManager: SupabaseManager,
    private val networkMonitor: NetworkMonitor
) {
    private var realtimeChannel: RealtimeChannel? = null
    private val connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    
    suspend fun connect(groupId: String)
    suspend fun disconnect()
    fun observeConnectionState(): StateFlow<ConnectionState>
    private suspend fun handleDeviceUnlock()
    private suspend fun handleNetworkChange()
}
```

### 4. Database Schema (Room)
```kotlin
@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val id: String,
    val groupId: String,
    val userId: String,
    val content: String,
    val isGhost: Boolean,
    val messageType: String,
    val createdAt: Long,
    val dedupeKey: String?
)

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE groupId = :groupId ORDER BY createdAt DESC")
    fun getMessagesForGroup(groupId: String): Flow<List<MessageEntity>>
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: MessageEntity)
}
```

## Migration Timeline

### Week 1-2: MVP Development
- Set up Android project structure
- Implement Supabase connection manager
- Create basic authentication flow
- Test device lock/unlock scenarios

### Week 3-4: Core Messaging
- Implement message sending/receiving
- Add SQLite offline storage
- Create basic UI with Compose

### Week 5-6: Advanced Features
- Add ghost mode and pseudonyms
- Implement file uploads
- Add push notifications

### Week 7-8: Testing & Polish
- Comprehensive testing
- Performance optimization
- UI/UX refinements

## Success Criteria

### Primary Goals
1. **Stable Realtime Connection**: No disconnections during device lock/unlock
2. **Single Client Instance**: Eliminate multiple client warnings
3. **Reliable Session Management**: Seamless token refresh
4. **Network Resilience**: Handle network transitions gracefully

### Secondary Goals
1. **Performance**: 50% faster message loading
2. **Battery Life**: 30% less battery consumption
3. **Memory Usage**: 40% lower memory footprint
4. **User Experience**: Smoother animations and interactions

## Risk Mitigation

### Technical Risks
1. **Supabase Kotlin SDK Limitations**: Fallback to REST API if needed
2. **SQLite Encryption Issues**: Use Android Keystore for key management
3. **Push Notification Delivery**: Implement retry mechanisms

### Timeline Risks
1. **Learning Curve**: Allocate extra time for Kotlin/Compose learning
2. **Feature Parity**: Prioritize core features over nice-to-haves
3. **Testing Complexity**: Start testing early and often

## Next Steps

1. **Fix TypeScript errors** in networkDiagnostics.ts (completed)
2. **Create MVP Android project** with Supabase connection only
3. **Test device lock/unlock scenarios** in isolation
4. **Implement robust connection management**
5. **Gradually port features** while maintaining functionality

This migration will result in a native Android app that eliminates the current Supabase Realtime connection issues while providing better performance, battery life, and user experience.

## Detailed Technical Specifications

### Supabase Integration Architecture

#### Connection Management Strategy
```kotlin
class RealtimeConnectionManager {
    private val connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    private var reconnectJob: Job? = null
    private val maxRetries = 3
    private val baseRetryDelay = 2000L

    // Single-flight connection management
    private var connectionMutex = Mutex()

    suspend fun connect(groupId: String) = connectionMutex.withLock {
        // Prevent multiple concurrent connections
        if (connectionState.value == ConnectionState.CONNECTING) return@withLock

        connectionState.value = ConnectionState.CONNECTING
        try {
            val channel = supabaseManager.getRealtimeChannel("group:$groupId")
            setupChannelListeners(channel)
            channel.subscribe()
            connectionState.value = ConnectionState.CONNECTED
        } catch (e: Exception) {
            connectionState.value = ConnectionState.FAILED
            scheduleReconnect(groupId)
        }
    }

    private fun scheduleReconnect(groupId: String) {
        reconnectJob?.cancel()
        reconnectJob = CoroutineScope(Dispatchers.IO).launch {
            repeat(maxRetries) { attempt ->
                delay(baseRetryDelay * (attempt + 1))
                try {
                    connect(groupId)
                    return@launch
                } catch (e: Exception) {
                    Log.w("RealtimeConnection", "Reconnect attempt ${attempt + 1} failed", e)
                }
            }
            connectionState.value = ConnectionState.FAILED
        }
    }
}
```

#### Device Lifecycle Integration
```kotlin
class DeviceLifecycleManager : DefaultLifecycleObserver {
    private val connectionManager: RealtimeConnectionManager
    private val authManager: AuthManager

    override fun onResume(owner: LifecycleOwner) {
        super.onResume(owner)
        CoroutineScope(Dispatchers.IO).launch {
            // Validate session after device unlock
            val session = authManager.getCurrentSession()
            if (session?.isExpired() == true) {
                authManager.refreshSession()
            }

            // Reconnect realtime if needed
            connectionManager.validateAndReconnect()
        }
    }

    override fun onPause(owner: LifecycleOwner) {
        super.onPause(owner)
        // Gracefully disconnect to prevent zombie connections
        connectionManager.gracefulDisconnect()
    }
}
```

### Authentication Flow Implementation

#### Phone Authentication Manager
```kotlin
class AuthManager(
    private val supabaseManager: SupabaseManager,
    private val preferences: SharedPreferences
) {
    private val authState = MutableStateFlow<AuthState>(AuthState.Unauthenticated)

    suspend fun signInWithPhone(phoneNumber: String): Result<Unit> {
        return try {
            val result = supabaseManager.signInWithOtp(phoneNumber)
            if (result.error == null) {
                Result.success(Unit)
            } else {
                Result.failure(Exception(result.error.message))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun verifyOtp(phoneNumber: String, otp: String): Result<User> {
        return try {
            val result = supabaseManager.verifyOtp(phoneNumber, otp)
            result.data?.let { session ->
                saveSession(session)
                authState.value = AuthState.Authenticated(session.user)
                Result.success(session.user)
            } ?: Result.failure(Exception("Verification failed"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private suspend fun saveSession(session: Session) {
        preferences.edit()
            .putString("access_token", session.accessToken)
            .putString("refresh_token", session.refreshToken)
            .putLong("expires_at", session.expiresAt)
            .apply()
    }
}
```

### Message System Architecture

#### Message Repository Pattern
```kotlin
interface MessageRepository {
    suspend fun sendMessage(message: Message): Result<Message>
    suspend fun getMessages(groupId: String, limit: Int, offset: Int): List<Message>
    fun observeMessages(groupId: String): Flow<List<Message>>
    suspend fun syncMessages(groupId: String): Result<Unit>
}

class MessageRepositoryImpl(
    private val localDataSource: MessageLocalDataSource,
    private val remoteDataSource: MessageRemoteDataSource,
    private val networkMonitor: NetworkMonitor
) : MessageRepository {

    override suspend fun sendMessage(message: Message): Result<Message> {
        // Always save locally first for optimistic UI
        localDataSource.insertMessage(message.copy(status = MessageStatus.SENDING))

        return if (networkMonitor.isConnected()) {
            try {
                val sentMessage = remoteDataSource.sendMessage(message)
                localDataSource.updateMessage(sentMessage.copy(status = MessageStatus.SENT))
                Result.success(sentMessage)
            } catch (e: Exception) {
                // Queue for retry
                localDataSource.updateMessage(message.copy(status = MessageStatus.QUEUED))
                Result.failure(e)
            }
        } else {
            localDataSource.updateMessage(message.copy(status = MessageStatus.QUEUED))
            Result.success(message)
        }
    }
}
```

### UI Architecture with Jetpack Compose

#### Message List Composable
```kotlin
@Composable
fun MessageList(
    messages: List<Message>,
    onMessageClick: (Message) -> Unit,
    onReactionClick: (Message, String) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier,
        reverseLayout = true, // Show newest messages at bottom
        state = rememberLazyListState()
    ) {
        items(
            items = messages,
            key = { it.id }
        ) { message ->
            MessageItem(
                message = message,
                onClick = { onMessageClick(message) },
                onReactionClick = { emoji -> onReactionClick(message, emoji) },
                modifier = Modifier
                    .fillMaxWidth()
                    .animateItemPlacement()
            )
        }
    }
}

@Composable
fun MessageItem(
    message: Message,
    onClick: () -> Unit,
    onReactionClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .clickable { onClick() },
        colors = CardDefaults.cardColors(
            containerColor = if (message.isGhost) {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                MaterialTheme.colorScheme.surface
            }
        )
    ) {
        Column(
            modifier = Modifier.padding(12.dp)
        ) {
            // Author name (pseudonym for ghost messages)
            Text(
                text = if (message.isGhost) message.pseudonym else message.authorName,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // Message content
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp)
            )

            // Reactions
            if (message.reactions.isNotEmpty()) {
                LazyRow(
                    modifier = Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    items(message.reactions) { reaction ->
                        ReactionChip(
                            reaction = reaction,
                            onClick = { onReactionClick(reaction.emoji) }
                        )
                    }
                }
            }
        }
    }
}
```

### Performance Optimizations

#### Message Pagination Strategy
```kotlin
class MessagePagingSource(
    private val repository: MessageRepository,
    private val groupId: String
) : PagingSource<Int, Message>() {

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, Message> {
        return try {
            val page = params.key ?: 0
            val messages = repository.getMessages(
                groupId = groupId,
                limit = params.loadSize,
                offset = page * params.loadSize
            )

            LoadResult.Page(
                data = messages,
                prevKey = if (page == 0) null else page - 1,
                nextKey = if (messages.isEmpty()) null else page + 1
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }
}
```

#### Memory Management
```kotlin
class MessageCacheManager {
    private val messageCache = LruCache<String, List<Message>>(maxSize = 50) // 50 groups max
    private val imageCache = LruCache<String, Bitmap>(maxSize = 20 * 1024 * 1024) // 20MB

    fun cacheMessages(groupId: String, messages: List<Message>) {
        messageCache.put(groupId, messages)
    }

    fun getCachedMessages(groupId: String): List<Message>? {
        return messageCache.get(groupId)
    }

    fun clearCache() {
        messageCache.evictAll()
        imageCache.evictAll()
    }
}
```

This detailed specification provides the foundation for building a robust, native Android application that addresses all the current issues while maintaining feature parity with the React/TypeScript version.
