| table_name      | column_name  | data_type                |
| --------------- | ------------ | ------------------------ |
| polls           | created_at   | timestamp with time zone |
| poll_votes      | created_at   | timestamp with time zone |
| group_members   | group_id     | uuid                     |
| group_members   | user_id      | uuid                     |
| group_members   | joined_at    | timestamp with time zone |
| messages        | id           | uuid                     |
| messages        | group_id     | uuid                     |
| messages        | user_id      | uuid                     |
| messages        | is_ghost     | boolean                  |
| messages        | parent_id    | uuid                     |
| messages        | created_at   | timestamp with time zone |
| user_pseudonyms | group_id     | uuid                     |
| user_pseudonyms | user_id      | uuid                     |
| user_pseudonyms | created_at   | timestamp with time zone |
| users           | is_onboarded | boolean                  |
| users           | created_at   | timestamp with time zone |
| polls           | id           | uuid                     |
| polls           | message_id   | uuid                     |
| polls           | options      | jsonb                    |
| users           | id           | uuid                     |
| polls           | closes_at    | timestamp with time zone |
| reactions       | id           | uuid                     |
| reactions       | message_id   | uuid                     |
| reactions       | user_id      | uuid                     |
| reactions       | created_at   | timestamp with time zone |
| groups          | id           | uuid                     |
| groups          | created_by   | uuid                     |
| groups          | created_at   | timestamp with time zone |
| poll_votes      | poll_id      | uuid                     |
| poll_votes      | user_id      | uuid                     |
| poll_votes      | option_index | integer                  |
| users           | phone_number | text                     |
| users           | display_name | text                     |
| users           | avatar_url   | text                     |
| messages        | content      | text                     |
| reactions       | emoji        | text                     |
| messages        | image_url    | text                     |
| messages        | message_type | text                     |
| polls           | question     | text                     |
| groups          | name         | text                     |
| groups          | description  | text                     |
| groups          | invite_code  | text                     |
| messages        | category     | text                     |
| user_pseudonyms | pseudonym    | text                     |



| column_name                 | data_type                |
| --------------------------- | ------------------------ |
| is_anonymous                | boolean                  |
| email_change_sent_at        | timestamp with time zone |
| last_sign_in_at             | timestamp with time zone |
| raw_app_meta_data           | jsonb                    |
| raw_user_meta_data          | jsonb                    |
| is_super_admin              | boolean                  |
| created_at                  | timestamp with time zone |
| updated_at                  | timestamp with time zone |
| phone_confirmed_at          | timestamp with time zone |
| phone_change_sent_at        | timestamp with time zone |
| confirmed_at                | timestamp with time zone |
| email_change_confirm_status | smallint                 |
| banned_until                | timestamp with time zone |
| reauthentication_sent_at    | timestamp with time zone |
| is_sso_user                 | boolean                  |
| deleted_at                  | timestamp with time zone |
| id                          | uuid                     |
| is_onboarded                | boolean                  |
| created_at                  | timestamp with time zone |
| instance_id                 | uuid                     |
| id                          | uuid                     |
| email_confirmed_at          | timestamp with time zone |
| invited_at                  | timestamp with time zone |
| confirmation_sent_at        | timestamp with time zone |
| recovery_sent_at            | timestamp with time zone |
| phone_number                | text                     |
| display_name                | text                     |
| avatar_url                  | text                     |
| phone_change                | text                     |
| email_change_token_new      | character varying        |
| email_change                | character varying        |
| phone_change_token          | character varying        |
| aud                         | character varying        |
| role                        | character varying        |
| email                       | character varying        |
| encrypted_password          | character varying        |
| email_change_token_current  | character varying        |
| phone                       | text                     |
| confirmation_token          | character varying        |
| reauthentication_token      | character varying        |
| recovery_token              | character varying        |


| table_schema | table_name         | column_name          | data_type                | is_nullable |
| ------------ | ------------------ | -------------------- | ------------------------ | ----------- |
| public       | group_members      | group_id             | uuid                     | NO          |
| public       | group_members      | user_id              | uuid                     | NO          |
| public       | group_members      | joined_at            | timestamp with time zone | YES         |
| public       | group_members      | last_read_at         | timestamp with time zone | YES         |
| public       | group_members      | last_read_message_id | uuid                     | YES         |
| public       | groups             | id                   | uuid                     | NO          |
| public       | groups             | name                 | text                     | NO          |
| public       | groups             | description          | text                     | YES         |
| public       | groups             | invite_code          | text                     | NO          |
| public       | groups             | created_by           | uuid                     | NO          |
| public       | groups             | created_at           | timestamp with time zone | YES         |
| public       | message_receipts   | message_id           | uuid                     | NO          |
| public       | message_receipts   | user_id              | uuid                     | NO          |
| public       | message_receipts   | delivered_at         | timestamp with time zone | YES         |
| public       | message_receipts   | read_at              | timestamp with time zone | YES         |
| public       | message_receipts   | created_at           | timestamp with time zone | YES         |
| public       | messages           | id                   | uuid                     | NO          |
| public       | messages           | group_id             | uuid                     | NO          |
| public       | messages           | user_id              | uuid                     | NO          |
| public       | messages           | content              | text                     | NO          |
| public       | messages           | is_ghost             | boolean                  | YES         |
| public       | messages           | message_type         | text                     | YES         |
| public       | messages           | category             | text                     | YES         |
| public       | messages           | parent_id            | uuid                     | YES         |
| public       | messages           | image_url            | text                     | YES         |
| public       | messages           | created_at           | timestamp with time zone | YES         |
| public       | messages           | dedupe_key           | text                     | YES         |
| public       | notification_queue | id                   | uuid                     | NO          |
| public       | notification_queue | message_id           | uuid                     | NO          |
| public       | notification_queue | group_id             | uuid                     | NO          |
| public       | notification_queue | sender_id            | uuid                     | NO          |
| public       | notification_queue | created_at           | timestamp with time zone | NO          |
| public       | notification_queue | enqueued_at          | timestamp with time zone | NO          |
| public       | notification_queue | processed_at         | timestamp with time zone | YES         |
| public       | notification_queue | attempt_count        | integer                  | NO          |
| public       | poll_votes         | poll_id              | uuid                     | NO          |
| public       | poll_votes         | user_id              | uuid                     | NO          |
| public       | poll_votes         | option_index         | integer                  | NO          |
| public       | poll_votes         | created_at           | timestamp with time zone | YES         |
| public       | polls              | id                   | uuid                     | NO          |
| public       | polls              | message_id           | uuid                     | NO          |
| public       | polls              | question             | text                     | NO          |
| public       | polls              | options              | jsonb                    | NO          |
| public       | polls              | created_at           | timestamp with time zone | YES         |
| public       | polls              | closes_at            | timestamp with time zone | NO          |
| public       | reactions          | id                   | uuid                     | NO          |
| public       | reactions          | message_id           | uuid                     | NO          |
| public       | reactions          | user_id              | uuid                     | NO          |
| public       | reactions          | emoji                | text                     | NO          |
| public       | reactions          | created_at           | timestamp with time zone | YES         |
| public       | user_devices       | id                   | uuid                     | NO          |
| public       | user_devices       | user_id              | uuid                     | NO          |
| public       | user_devices       | platform             | text                     | NO          |
| public       | user_devices       | token                | text                     | NO          |
| public       | user_devices       | last_seen_at         | timestamp with time zone | NO          |
| public       | user_devices       | app_version          | text                     | YES         |
| public       | user_devices       | active               | boolean                  | NO          |
| public       | user_pseudonyms    | group_id             | uuid                     | NO          |
| public       | user_pseudonyms    | user_id              | uuid                     | NO          |
| public       | user_pseudonyms    | pseudonym            | text                     | NO          |
| public       | user_pseudonyms    | created_at           | timestamp with time zone | YES         |
| public       | users              | id                   | uuid                     | NO          |
| public       | users              | phone_number         | text                     | NO          |
| public       | users              | display_name         | text                     | NO          |
| public       | users              | avatar_url           | text                     | YES         |
| public       | users              | is_onboarded         | boolean                  | YES         |
| public       | users              | created_at           | timestamp with time zone | YES         |