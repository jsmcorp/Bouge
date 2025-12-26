# Implementation Plan: Topic Creation

## Overview

Minimal implementation to add topic creation functionality with a beautiful modal UI.

## Tasks

- [x] 1. Create the CreateTopicModal component
  - Create `src/components/topics/CreateTopicModal.tsx`
  - Implement full-screen modal with slide-up animation
  - Add header with close button and Post button
  - Add topic type selector (Discussion, News, Poll pills)
  - Add title input field (optional)
  - Add content textarea with character count
  - Add anonymous toggle switch
  - Style using existing Tailwind classes matching app theme
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3_

- [x] 2. Implement topic submission logic
  - Add form validation (content required)
  - Generate UUIDs for topic and message
  - Insert topic into Supabase `topics` table
  - Insert message into Supabase `messages` table with topic_id
  - Handle loading state on Post button
  - Handle success: close modal, show toast, trigger refresh
  - Handle error: show error toast
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 3. Integrate modal with GroupTopicsPage
  - Add modal state (isOpen) to GroupTopicsPage
  - Connect + FAB button to open modal
  - Pass groupId and onTopicCreated callback to modal
  - Refresh topics list after successful creation
  - _Requirements: 1.1, 5.3_
