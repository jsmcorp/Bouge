# Essential Commands for Confessr Development

## Development Commands
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

## Mobile Development Commands
```bash
npm run build && npx cap sync    # Build and sync with native platforms
npx cap open android             # Open Android Studio
npx cap run android              # Run on Android device/emulator
npx cap add ios                  # Add iOS platform (macOS only)
npx cap open ios                 # Open Xcode
```

## Environment Setup
Required environment variables in `.env.local`:
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon key
- `TWILIO_ACCOUNT_SID` - Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Twilio Auth Token
- `TWILIO_VERIFY_SID` - Twilio Verify Service SID

## Testing Credentials
- Test Phone: `+917744939966`
- Test OTP: `212121`

## Git Commands
```bash
git status                    # Check repository status
git add .                     # Stage all changes
git commit -m "message"       # Commit changes
git push                      # Push to remote
```

## Windows System Commands
```bash
dir                           # List files (Windows equivalent of ls)
cd <directory>                # Change directory
cls                           # Clear screen (Windows equivalent of clear)
type <file>                   # Display file content (Windows equivalent of cat)
findstr "pattern" file        # Search in files (Windows equivalent of grep)
```