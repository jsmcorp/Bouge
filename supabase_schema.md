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