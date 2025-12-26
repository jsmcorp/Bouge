# Supabase Schema Reference

This document contains the current database schema for reference during development.

## Tables

### group_join_requests
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| group_id | uuid | NO | - |
| user_id | uuid | NO | - |
| invited_by | uuid | YES | - |
| status | text | NO | 'pending' |
| created_at | timestamp with time zone | YES | now() |
| updated_at | timestamp with time zone | YES | now() |

### group_members
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| group_id | uuid | NO | - |
| user_id | uuid | NO | - |
| joined_at | timestamp with time zone | YES | now() |
| last_read_at | timestamp with time zone | YES | now() |
| last_read_message_id | uuid | YES | - |
| role | text | YES | 'member' |

### groups
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | - |
| description | text | YES | - |
| invite_code | text | NO | - |
| created_by | uuid | NO | - |
| created_at | timestamp with time zone | YES | now() |

### message_receipts
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| message_id | uuid | NO | - |
| user_id | uuid | NO | - |
| delivered_at | timestamp with time zone | YES | - |
| read_at | timestamp with time zone | YES | - |
| created_at | timestamp with time zone | YES | now() |

### messages
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| group_id | uuid | NO | - |
| user_id | uuid | NO | - |
| content | text | NO | - |
| is_ghost | boolean | YES | true |
| message_type | text | YES | 'text' |
| category | text | YES | - |
| parent_id | uuid | YES | - |
| image_url | text | YES | - |
| created_at | timestamp with time zone | YES | now() |
| dedupe_key | text | YES | - |
| topic_id | uuid | YES | - |

### notification_queue
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| message_id | uuid | NO | - |
| group_id | uuid | NO | - |
| sender_id | uuid | NO | - |
| created_at | timestamp with time zone | NO | - |
| enqueued_at | timestamp with time zone | NO | now() |
| processed_at | timestamp with time zone | YES | - |
| attempt_count | integer | NO | 0 |

### poll_votes
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| poll_id | uuid | NO | - |
| user_id | uuid | NO | - |
| option_index | integer | NO | - |
| created_at | timestamp with time zone | YES | now() |

### polls
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| message_id | uuid | NO | - |
| question | text | NO | - |
| options | jsonb | NO | - |
| created_at | timestamp with time zone | YES | now() |
| closes_at | timestamp with time zone | NO | now() + '24:00:00' |

### reactions
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| message_id | uuid | NO | - |
| user_id | uuid | NO | - |
| emoji | text | NO | - |
| created_at | timestamp with time zone | YES | now() |

### topic_likes
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| topic_id | uuid | NO | - |
| user_id | uuid | NO | - |
| created_at | timestamp with time zone | YES | now() |

### topics
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | - |
| group_id | uuid | NO | - |
| type | text | NO | - |
| title | text | YES | - |
| expires_at | timestamp with time zone | YES | - |
| views_count | bigint | YES | 0 |
| likes_count | bigint | YES | 0 |
| replies_count | bigint | YES | 0 |
| is_anonymous | boolean | YES | false |
| created_at | timestamp with time zone | YES | now() |

**Check Constraint:** `topics_type_check` - type must be one of: `'text'`, `'poll'`, `'confession'`, `'news'`, `'image'`

### user_contacts
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | - |
| contact_name | text | YES | - |
| contact_phone | text | NO | - |
| synced_at | timestamp with time zone | YES | now() |
| phone_e164 | text | YES | - |

### user_devices
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | - |
| platform | text | NO | - |
| token | text | NO | - |
| last_seen_at | timestamp with time zone | NO | now() |
| app_version | text | YES | - |
| active | boolean | NO | true |

### user_pseudonyms
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| group_id | uuid | NO | - |
| user_id | uuid | NO | - |
| pseudonym | text | NO | - |
| created_at | timestamp with time zone | YES | now() |

### users
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| phone_number | text | NO | - |
| display_name | text | NO | - |
| avatar_url | text | YES | - |
| is_onboarded | boolean | YES | false |
| created_at | timestamp with time zone | YES | now() |
| phone_e164 | text | YES | - |
