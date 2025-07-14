import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone_number: string;
          display_name: string;
          avatar_url: string | null;
          is_onboarded: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone_number: string;
          display_name: string;
          avatar_url?: string | null;
          is_onboarded?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone_number?: string;
          display_name?: string;
          avatar_url?: string | null;
          is_onboarded?: boolean;
          created_at?: string;
        };
      };
      groups: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          invite_code: string;
          created_by: string;
          created_at: string;
          avatar_url: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          invite_code: string;
          created_by: string;
          created_at?: string;
          avatar_url?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          invite_code?: string;
          created_by?: string;
          created_at?: string;
          avatar_url?: string | null;
        };
      };
      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          joined_at: string;
          role: 'admin' | 'participant';
        };
        Insert: {
          group_id: string;
          user_id: string;
          joined_at?: string;
          role?: 'admin' | 'participant';
        };
        Update: {
          group_id?: string;
          user_id?: string;
          joined_at?: string;
          role?: 'admin' | 'participant';
        };
      };
      group_media: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          type: 'photo' | 'document' | 'link';
          url: string;
          name: string;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          type: 'photo' | 'document' | 'link';
          url: string;
          name: string;
          uploaded_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          user_id?: string;
          type?: 'photo' | 'document' | 'link';
          url?: string;
          name?: string;
          uploaded_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          content: string;
          is_ghost: boolean;
          message_type: string;
          category: string | null;
          parent_id: string | null;
          image_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          content: string;
          is_ghost?: boolean;
          message_type?: string;
          category?: string | null;
          parent_id?: string | null;
          image_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          user_id?: string;
          content?: string;
          is_ghost?: boolean;
          message_type?: string;
          category?: string | null;
          parent_id?: string | null;
          image_url?: string | null;
          created_at?: string;
        };
      };
      reactions: {
        Row: {
          id: string;
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          user_id: string;
          emoji: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          user_id?: string;
          emoji?: string;
          created_at?: string;
        };
      };
      polls: {
        Row: {
          id: string;
          message_id: string;
          question: string;
          options: Json;
          created_at: string;
          closes_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          question: string;
          options: Json;
          created_at?: string;
          closes_at?: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          question?: string;
          options?: Json;
          created_at?: string;
          closes_at?: string;
        };
      };
      poll_votes: {
        Row: {
          poll_id: string;
          user_id: string;
          option_index: number;
          created_at: string;
        };
        Insert: {
          poll_id: string;
          user_id: string;
          option_index: number;
          created_at?: string;
        };
        Update: {
          poll_id?: string;
          user_id?: string;
          option_index?: number;
          created_at?: string;
        };
      };
    };
  };
}