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
      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          role: string;
          joined_at: string | null;
        };
        Insert: {
          group_id: string;
          user_id: string;
          role?: string;
          joined_at?: string | null;
        };
        Update: {
          group_id?: string;
          user_id?: string;
          role?: string;
          joined_at?: string | null;
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
          dedupe_key: string | null;
          users?: {
            display_name: string;
            avatar_url: string | null;
            phone_number: string | null;
            created_at: string;
          };
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
          dedupe_key?: string | null;
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
          dedupe_key?: string | null;
        };
      };
      message_receipts: {
        Row: {
          message_id: string;
          user_id: string;
          delivered_at: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
          delivered_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          message_id?: string;
          user_id?: string;
          delivered_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
      };
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
          id: string;
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
      user_devices: {
        Row: {
          id: string;
          user_id: string;
          platform: string;
          token: string;
          app_version: string;
          active: boolean;
          last_seen_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          platform: string;
          token: string;
          app_version: string;
          active?: boolean;
          last_seen_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          platform?: string;
          token?: string;
          app_version?: string;
          active?: boolean;
          last_seen_at?: string;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
