# Bouge - Real-Time Messaging Platform

A modern React + Capacitor mobile application for real-time group messaging with ghost mode functionality, offline-first architecture, and WhatsApp-style instant delivery.

## 📚 Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** - Version history and bug fixes
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - System design and data flow
- **[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** - Common issues and solutions

## 🌟 Features

### Core Functionality
- **Phone Authentication**: Secure OTP verification via Twilio Verify API
- **Ghost Mode**: Toggle between anonymous and identified messaging
- **Anonymous Confessions**: Always-anonymous posts with category tagging
- **Group Management**: Create/join groups with invite codes
- **Real-time Messaging**: Live chat with emoji reactions and threading
- **Premium Design**: Sophisticated dark theme with smooth animations

### Authentication & Onboarding
- Phone number verification with SMS OTP
- First-time user onboarding flow
- Profile setup with name and avatar selection
- Secure session management with Supabase Auth

### Messaging Features
- Ghost mode toggle for privacy control
- Confession posts with categories (Funny, Serious, Advice, Support)
- Threaded replies with inline display
- Emoji reactions and interactive elements
- Image sharing capabilities
- Anonymous polls and voting

### Security & Privacy
- Row Level Security (RLS) for all database operations
- Anonymous message protection
- Content moderation and reporting system
- Privacy-first design principles

## 🚀 Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS, shadcn/ui components
- **Animations**: Framer Motion
- **Backend**: Supabase (Database, Auth, Storage)
- **SMS/OTP**: Twilio Verify API
- **State Management**: Zustand
- **Routing**: React Router DOM
- **Icons**: Lucide React
- **Deployment**: Netlify

## 📦 Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd confessr
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Setup**
Copy `.env.example` to `.env.local` and fill in your credentials:
```bash
cp .env.example .env.local
```

Required environment variables:
- `VITE_SUPABASE_URL`: Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anon key
- `TWILIO_ACCOUNT_SID`: Twilio Account SID (for edge functions)
- `TWILIO_AUTH_TOKEN`: Twilio Auth Token (for edge functions)
- `TWILIO_VERIFY_SID`: Twilio Verify Service SID (for edge functions)

4. **Database Setup**
Run the Supabase migrations to set up your database schema:
```sql
-- Apply the migration in supabase/migrations/01_create_database_schema.sql
```

5. **Start Development Server**
```bash
npm run dev
```

## 🗄️ Database Schema

The application uses the following main tables:
- `users`: User profiles and authentication data
- `groups`: Group information and settings
- `group_members`: Group membership relationships
- `messages`: Chat messages with ghost mode support
- `reactions`: Emoji reactions to messages
- `polls` & `poll_votes`: Anonymous polling system

## 🎨 Design System

### Color Palette
- **Primary**: Deep green (#10b981) for active states and branding
- **Background**: Rich dark (#0a0a0a) with subtle variations
- **Cards**: Semi-transparent overlays with backdrop blur
- **Accents**: Warm oranges/yellows for highlights and warnings

### Typography
- **Headings**: Bold, high contrast white text
- **Body**: Comfortable reading with proper line spacing
- **Code**: Mono-spaced font for invite codes and technical elements

### Components
- Consistent 8px spacing system
- Rounded corners (0.5rem base radius)
- Subtle shadows and borders
- Smooth hover states and transitions

## 🔧 Development

### Available Scripts
- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm run lint`: Run ESLint
- `npm run preview`: Preview production build

### Code Structure
```
src/
├── components/         # Reusable UI components
│   ├── ui/            # shadcn/ui components
│   ├── auth/          # Authentication components
│   ├── chat/          # Chat-related components
│   └── dashboard/     # Dashboard components
├── pages/             # Route components
├── store/             # Zustand stores
├── lib/               # Utility functions
└── hooks/             # Custom React hooks
```

## 🚢 Deployment

The application is configured for deployment on Netlify:

1. **Build Command**: `npm run build`
2. **Publish Directory**: `dist`
3. **Environment Variables**: Add your environment variables in Netlify dashboard
4. **Edge Functions**: Supabase edge functions are used for Twilio integration

## 🔐 Security Considerations

- All user data is protected with Row Level Security
- Anonymous messages cannot be traced back to users
- Phone numbers are securely hashed and stored
- Content moderation system prevents abuse
- Regular security audits and updates

## 📱 Mobile Support

While primarily designed for desktop, the application includes:
- Responsive design breakpoints
- Mobile-optimized touch interactions
- Adaptive layouts for smaller screens
- Progressive Web App capabilities

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, please open an issue on GitHub or contact the development team.

---

**Built with ❤️ by the Confessr team**

*Built with Bolt*

## 📱 Mobile Development with Capacitor

This app is configured with Capacitor for mobile development:

### Development Commands
```bash
# Build web app and sync with native platforms
npm run build && npx cap sync

# Open Android project in Android Studio
npx cap open android

# Run on Android device/emulator
npx cap run android

# Add iOS platform (requires macOS)
npx cap add ios
npx cap open ios
```

### Mobile Features
- Native app shell with web content
- Access to device APIs (camera, storage, etc.)
- App store distribution ready
- Offline capabilities

### Requirements
- **Android**: Android Studio with Android SDK
- **iOS**: Xcode (macOS only)
- **Device Testing**: USB debugging enabled

### Configuration
- App ID: `com.confessr.app`
- App Name: `Confessr`
- Web Directory: `dist`
- Android Scheme: `https`

## 🛠️ Dev Troubleshooting (Android + Supabase)

- Required env vars: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local. On Android, Vite injects these at build time.
- Realtime verbose logs: use Logcat; app logs are prefixed with [supabase-pipeline], [realtime-v2], [reconnection-mgr].
- Realtime on Android: on resume we refresh the session and apply the token to Realtime; expect logs: "App resume: token applied to realtime".
- No active group path: when there’s no active group, reconnection skips waiting for SUBSCRIBED and does not mark disconnected.
- SQLite migrations: migrations are idempotent. If you previously saw duplicate column errors, they should be gone.
- Edge Function CORS (dev): push-fanout now handles OPTIONS and sets Access-Control-Allow-Origin for https://localhost, capacitor://localhost, http://localhost by default. Override with DEV_CORS_ORIGINS env.
- Android dev origins: if testing via WebView (Capacitor), the origin is capacitor://localhost.
- Enable push testing: ensure device tokens are present in public.user_devices; function endpoint: <SUPABASE_URL>/functions/v1/push-fanout.
