# Project Overview: Confessr

## Purpose
**Confessr** is a premium anonymous messaging platform that enables users to send messages anonymously in group chats. The platform features ghost mode messaging, confessions, real-time communication, and is designed for both web and mobile deployment.

## Core Features
- Anonymous group messaging with ghost mode
- Real-time chat with Supabase backend
- Mobile app support via Capacitor
- Phone authentication via Twilio Verify
- Anonymous pseudonyms for ghost messages
- Emoji reactions and polling
- Media sharing capabilities
- Biometric authentication support

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **State Management**: Zustand stores with persistence
- **Backend**: Supabase (Database, Auth, Real-time)
- **Mobile**: Capacitor 7 with Android/iOS support
- **Database**: SQLite (local) + Supabase (remote)
- **Authentication**: Phone verification via Twilio

## Key Architecture
- Dark theme first design
- Responsive design with mobile breakpoints
- Optimistic updates with rollback
- Real-time subscriptions for chat
- Edge functions for Twilio integration
- RLS (Row Level Security) for data protection