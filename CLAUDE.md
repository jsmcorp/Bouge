# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Confessr** - A premium anonymous messaging platform built with React, TypeScript, and Capacitor for mobile deployment. Features ghost mode messaging, group chats, confessions, and real-time communication with Supabase backend.

## Quick Commands

### Development
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

### Mobile Development
```bash
npm run build && npx cap sync    # Build and sync with native platforms
npx cap open android             # Open Android Studio
npx cap run android              # Run on Android device/emulator
npx cap add ios                  # Add iOS platform (macOS only)
npx cap open ios                 # Open Xcode
```

### Environment Setup
Required environment variables in `.env.local`:
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon key
- `TWILIO_ACCOUNT_SID` - Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Twilio Auth Token
- `TWILIO_VERIFY_SID` - Twilio Verify Service SID

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **State Management**: Zustand stores with persistence
- **Styling**: Tailwind CSS + shadcn/ui components
- **Backend**: Supabase (Database, Auth, Real-time)
- **Mobile**: Capacitor 7 with Android/iOS support
- **Database**: SQLite (local) + Supabase (remote)

### Key Directories
```
src/
├── components/          # Reusable UI components
│   ├── ui/             # shadcn/ui components
│   ├── chat/           # Chat-related components
│   └── dashboard/      # Dashboard components
├── pages/              # Route components
├── store/              # Zustand stores
│   ├── authStore.ts    # Authentication state
│   └── chatStore.ts    # Chat/messaging state
├── lib/                # Utilities and services
│   ├── supabase.ts     # Supabase client & types
│   ├── sqliteService.ts # SQLite operations
│   └── pseudonymService.ts # Anonymous name generation
└── hooks/              # Custom React hooks
```

### Database Schema
Core tables with Row Level Security:
- `users` - User profiles (phone auth)
- `groups` - Group information with invite codes
- `group_members` - Membership relationships
- `messages` - Chat messages with ghost mode
- `reactions` - Emoji reactions to messages
- `polls` & `poll_votes` - Anonymous polling
- `group_media` - Shared files and images

### Authentication Flow
1. Phone number verification via Twilio Verify API
2. Supabase Auth session management
3. User profile sync with `users` table
4. Zustand auth store with persistence

### Key State Management
- **AuthStore**: User session, profile, auth state
- **ChatStore**: Group data, messages, real-time subscriptions
- Ghost mode toggled per message with `is_ghost` flag
- Anonymous pseudonyms auto-generated for ghost messages

### Mobile Features
- Capacitor SQLite for offline storage
- Biometric authentication support
- Native splash screen and status bar
- Push notification ready structure
- Responsive design with mobile breakpoints

## Development Notes

### Component Patterns
- Use shadcn/ui components as base (`src/components/ui/`)
- Consistent 8px spacing system
- Dark theme first design
- Framer Motion for animations
- Form handling with react-hook-form + zod

### API Patterns
- Supabase RLS for security
- Real-time subscriptions for chat
- Edge functions for Twilio integration
- Optimistic updates with rollback

### Testing Credentials
- Test Phone: `+917744939966` (from .env.example)
- Test OTP: `212121`

## Build & Deployment

### Build Output
- Web: `dist/` directory for Netlify
- Android: `android/` Gradle project
- iOS: `ios/` Xcode project (add with `npx cap add ios`)

### Configuration Files
- `capacitor.config.ts` - Mobile app config
- `vite.config.ts` - Build tooling with React plugin
- `netlify.toml` - Netlify deployment settings
- `tailwind.config.js` - CSS framework config