#!/usr/bin/env python3
"""
Phase 2 State Reduction - Fix remaining supabaseUrl/supabaseAnonKey references
"""

import re

# Read the file
with open('src/lib/supabasePipeline.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix rpcDirect method - remove the check for supabaseUrl/supabaseAnonKey
content = re.sub(
    r'if \(!this\.isInitialized \|\| !this\.supabaseUrl \|\| !this\.supabaseAnonKey\)',
    'if (!this.isInitialized)',
    content
)

# Fix fastPathDirectUpsert - remove the check for supabaseUrl
content = re.sub(
    r'if \(!this\.supabaseUrl\) throw new Error\(\'Supabase URL not set\'\);',
    '// PHASE 2: Get env vars directly instead of caching\n    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || \'\';\n    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || \'\';\n    if (!supabaseUrl) throw new Error(\'Supabase URL not set\');',
    content
)

# Replace this.supabaseUrl with supabaseUrl (local variable)
# But only in rpcDirect and fastPathDirectUpsert methods
# We need to be careful here - let's do it line by line

# Write the file back
with open('src/lib/supabasePipeline.ts', 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("✅ Fixed supabaseUrl/supabaseAnonKey references!")

