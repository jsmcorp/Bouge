# Confessr - Premium Anonymous Messaging Platform

Build a premium, production-ready React web app called **"Confessr"** - an anonymous group confession and messaging platform for desktop that enables **anonymous messaging with known groups of people**. Create a sophisticated, modern interface with smooth animations and premium design aesthetics.

## 🎯 **Elevator Pitch**
**"Anonymous messaging with your known groups - your thoughts, your choice."**

*Confessr enables anonymous communication within trusted circles. Share confessions, join meaningful conversations, and toggle between anonymous and identified messaging in real-time with Ghost Mode. Connect authentically with people you know, while maintaining the freedom to be completely anonymous when needed.*

## 🎨 Design Requirements

### Visual Identity
- **Premium Color Palette**: Use a sophisticated dark theme with accent colors
  - Primary: Deep charcoal (#1a1a1a) and rich blacks
  - Secondary: Soft greens (#10b981, #065f46) for active states
  - Accent: Warm oranges/yellows (#f59e0b, #d97706) for highlights
  - Text: High contrast whites and soft grays
- **Typography**: Use clean, modern fonts with proper hierarchy
- **Layout**: Inspired by the provided Slack-like interface with left sidebar + main content
- **Animations**: Smooth micro-interactions, hover effects, and page transitions
- **Premium Feel**: Subtle shadows, rounded corners, and polished components

### Layout Structure
```
┌─────────────┬──────────────────┬─────────────────┐
│   Sidebar   │   Chat Area      │   Right Panel   │
│             │                  │   (Optional)    │
│  - Groups   │  - Messages      │  - Group Info   │
│  - Settings │  - Input         │  - Members      │
│  - Profile  │  - Ghost Toggle  │  - Media        │
└─────────────┴──────────────────┴─────────────────┘
```

## 🔧 Technical Stack

- **Framework**: Vite + React 18 with TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **Icons**: Lucide React
- **Authentication**: Supabase Auth + Twilio Verify API
- **Database**: Supabase
- **SMS/OTP**: Twilio Verify API for phone verification
- **Animations**: Framer Motion
- **State Management**: Zustand or React Context
- **Routing**: React Router DOM
- **File Upload**: Supabase Storage for avatar images
- **Deployment**: Netlify (include netlify.toml)

## 🚀 Core Features Implementation

### 1. Authentication System
```typescript
// Phone number authentication with Supabase + Twilio
- Registration: Phone number → OTP verification (Twilio Verify API)
- Login: Phone number → OTP verification (Twilio Verify API)
- First-time setup: Name input + Avatar selection
- Store user data: phone, display_name, avatar_url, created_at
```

*Implement phone number authentication using Supabase for user management and Twilio Verify API for sending and verifying OTP codes via SMS.*

**First-Time User Onboarding Flow:**
1. Phone number verification (Twilio OTP)
2. Welcome screen asking for display name
3. Avatar selection screen with random avatar options + upload capability
4. Save profile and redirect to dashboard

**Profile Setup Components:**
```tsx
- NameSetup: Input field for display name
- AvatarPicker: Grid of random avatars + upload option
- ProfileComplete: Confirmation screen before dashboard
```

### 2. Group Management
- **Create Groups**: Simple form with group name and description
- **Join Groups**: Via invite link or 6-digit code
- **Group Roles**: Creator is admin, can only remove users
- **Member List**: Show active members with online status

### 3. Ghost Mode Chat System
```typescript
interface Message {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  is_ghost: boolean; // Key feature
  message_type: 'text' | 'image' | 'confession' | 'poll';
  category?: 'funny' | 'serious' | 'advice' | 'support';
  created_at: string;
  reactions: Reaction[];
  replies_count: number;
  // Show user identity when ghost mode is OFF
  author_name?: string;
  author_avatar?: string;
}
```

**Ghost Mode Toggle**: Prominent toggle in chat input area
- ON (default): Messages appear as "Ghost" with no identity
- OFF: Show user's display name and avatar
- **Message Display Logic:**
  - Ghost Mode ON: Show as "Ghost" with generic ghost icon
  - Ghost Mode OFF: Show user's name + avatar from profile setup

### 4. Confessions & Threading
- **Confession Posts**: Always anonymous, support categories
- **Threaded Replies**: Up to 5 inline replies, then separate page
- **Categories**: Fixed list - Funny, Serious, Advice, Support, Random
- **Threading UI**: Indent replies, show reply count, "View Thread" button

### 5. Interactive Elements
- **Emoji Reactions**: Click to react, show reaction counts
- **Enhanced Anonymous Polls**: 
  - **Interactive Creation Interface**: Intuitive modal allowing users to define questions and multiple-choice options
  - **Dynamic Option Addition**: Allow users to add new options during poll creation
  - **Real-time Voting**: Instant visual feedback upon vote submission with animated progress bars
  - **Live Results Display**: Real-time percentage breakdowns with fluidly animated vote counts
  - **Visual Feedback**: Animated progress bars with gradient effects showing vote distribution
  - **Anonymous Voting**: Complete anonymity in voting process
  - **Poll Expiration**: 24-hour automatic poll closure with countdown timer
- **Image Sharing**: Upload with ghost mode support

### 6. Moderation & Safety
- **Report System**: Flag inappropriate content
- **Admin Tools**: Remove users, delete messages
- **Anonymous Protection**: Even admins can't see ghost message authors

## 📱 UI Components to Build

### Onboarding Components
```tsx
- PhoneVerification: Phone input + OTP verification with Twilio
- NameSetup: Display name input with validation
- AvatarSelection: Grid of pre-generated avatars + upload option
- WelcomeComplete: Profile summary before entering dashboard
```

### Sidebar Components
```tsx
- GroupList: Show joined groups with unread indicators
- UserProfile: Show name + avatar with edit options
- Settings: Ghost mode preferences, notifications
- CreateGroup: Modal for new group creation
```

### Chat Components
```tsx
- MessageList: Virtualized chat messages
- MessageBubble: Different styles for ghost/normal messages  
- ChatInput: Rich input with ghost toggle and media upload
- ReactionPicker: Emoji selection interface
- ThreadView: Expandable reply interface
```

### Enhanced Poll Components
```tsx
- PollCreationModal: Intuitive interface for creating polls with question and option inputs
- PollComponent: Interactive poll display with:
  - Animated progress bars for vote percentages
  - Real-time vote counts with fluid number transitions
  - Subtle scale animations on option selection
  - Gradient effects on progress indicators
  - Confetti animation upon successful vote submission
- PollResultsView: Live results with percentage breakdowns and animated transitions
- PollOptionSelector: Individual poll option with hover effects and selection animations
```

### Special Components
```tsx
- ConfessionCard: Styled confession posts with categories
- InviteModal: Share group invite links/codes
- ReportModal: Content reporting interface
```

## 🎭 Animation Requirements

### Micro-interactions
- Hover effects on all interactive elements
- Smooth ghost mode toggle animation
- Message send animation with subtle bounce
- Reaction emoji pop-in effects
- Loading states with skeleton screens

### Poll Animations
- **Smooth Transitions**: Use Framer Motion for all poll creation and display interactions
- **Animated Progress Bars**: Gradient-enhanced progress bars with smooth percentage updates
- **Option Selection**: Subtle scale animation (1.02x) when hovering/selecting poll options
- **Vote Submission**: Confetti animation burst upon successful vote with 2-second duration
- **Live Vote Counts**: Fluid number transitions using spring animations for real-time updates
- **Loading States**: Skeleton animations during poll data fetching with shimmer effects
- **Performance**: Ensure 60fps performance for all poll-related animations using transform properties
- **Micro-interactions**: Pulse effect on poll creation button, smooth modal transitions
- **Results Animation**: Staggered animation for poll results appearing with 100ms delays between options

### Page Transitions
- Smooth group switching
- Thread expansion animations
- Modal fade-in/out effects
- Sidebar collapse/expand

### Message Animations
```css
- New message slide-in from bottom
- Ghost mode messages with subtle glow effect
- Reaction count increment animations
- Typing indicators with dot animations
```

## 🗄️ Database Schema

### Core Tables
```sql
-- Users with profile data
users (
  id uuid PRIMARY KEY,
  phone_number varchar UNIQUE,
  display_name varchar NOT NULL,
  avatar_url varchar,
  is_onboarded boolean DEFAULT false,
  created_at timestamp
);

-- Groups
groups (
  id uuid PRIMARY KEY,
  name varchar,
  description text,
  invite_code varchar(6),
  created_by uuid REFERENCES users(id),
  created_at timestamp
);

-- Group memberships
group_members (
  group_id uuid REFERENCES groups(id),
  user_id uuid REFERENCES users(id),
  joined_at timestamp,
  PRIMARY KEY (group_id, user_id)
);

-- Messages with ghost mode
messages (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES groups(id),
  user_id uuid REFERENCES users(id),
  content text,
  is_ghost boolean DEFAULT true,
  message_type varchar,
  category varchar,
  parent_id uuid REFERENCES messages(id), -- for threading
  created_at timestamp
);

-- Reactions
reactions (
  id uuid PRIMARY KEY,
  message_id uuid REFERENCES messages(id),
  user_id uuid REFERENCES users(id),
  emoji varchar,
  created_at timestamp
);

-- Enhanced Polls with expiration
polls (
  id uuid PRIMARY KEY,
  message_id uuid REFERENCES messages(id),
  question text,
  options jsonb,
  created_at timestamp,
  closes_at timestamp DEFAULT (now() + interval '24 hours')
);

-- Poll votes
poll_votes (
  poll_id uuid REFERENCES polls(id),
  user_id uuid REFERENCES users(id),
  option_index integer,
  created_at timestamp
);
```

## 🔒 Security & Privacy

- **Anonymous Posts**: Never store user identity for ghost messages
- **Data Encryption**: Encrypt sensitive message content
- **Rate Limiting**: Prevent spam and abuse
- **Input Validation**: Sanitize all user inputs
- **Image Upload**: Secure file handling with size limits

## 📝 Key Pages/Routes

```typescript
/auth/login          // Phone number login
/auth/verify         // OTP verification (Twilio)
/onboarding/name     // First-time name setup
/onboarding/avatar   // Avatar selection/upload
/dashboard           // Main app interface
/groups/:id          // Group chat view
/groups/:id/thread/:messageId  // Thread detail view
/groups/create       // Create new group
/groups/join         // Join via invite
/settings            // User preferences
```

## 🎯 Essential Features Checklist

### Authentication ✅
- [x] Phone number registration (Supabase + Twilio Verify)
- [x] OTP verification via SMS
- [x] First-time onboarding flow
- [x] Name and avatar setup
- [x] Secure session management

### Group Management ✅
- [x] Create groups
- [x] Generate invite codes/links
- [x] Join groups
- [x] Admin controls

### Ghost Mode Chat ✅
- [x] Toggle ghost mode per message
- [x] Anonymous message display
- [x] Identity protection

### Confessions ✅
- [x] Always anonymous confessions
- [x] Category tagging
- [x] Threaded replies (max 5 inline)

### Enhanced Interactive Elements ✅
- [x] Emoji reactions
- [x] **Enhanced Anonymous Polls** with:
  - [x] Intuitive creation interface with question and option inputs
  - [x] Real-time voting with instant visual feedback
  - [x] Live results with animated percentage breakdowns
  - [x] Animated progress bars with gradient effects
  - [x] Confetti animation on vote submission
  - [x] Fluid number transitions for vote counts
  - [x] 24-hour poll expiration with countdown
  - [x] Skeleton loading states with 60fps performance
- [x] Image sharing
- [x] Reply threading

### Moderation ✅
- [x] Report system
- [x] Admin removal tools
- [x] Content moderation

## 🚀 Premium Polish

### Performance
- Implement message virtualization for large chats
- Optimize image loading with lazy loading
- Use React.memo for expensive components
- Implement proper loading states
- **Poll Performance**: Ensure 60fps animations using CSS transforms and GPU acceleration

### User Experience
- Smooth animations throughout
- Intuitive ghost mode toggle
- Clear visual feedback for all actions
- Responsive design for different screen sizes
- **Enhanced Poll UX**: Intuitive creation flow, instant feedback, and engaging animations

### Code Quality
- TypeScript for type safety
- ESLint + Prettier configuration
- Comprehensive error handling
- Production-ready code structure

**Deliverable**: A complete, production-ready React web application with all features implemented, premium design, smooth animations, enhanced real-time polling system, and ready for deployment. The app should feel polished, professional, and ready for real users.