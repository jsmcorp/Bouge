# Task Completion Checklist - Confessr

## Before Marking Task as Complete

### Code Quality Checks
- [ ] Code follows established TypeScript/React patterns
- [ ] No TypeScript errors (`npm run build` passes)
- [ ] ESLint passes with no errors (`npm run lint`)
- [ ] No console.log statements left in production code
- [ ] Dark theme styling is consistent throughout
- [ ] Mobile responsive design verified

### Testing Requirements
- [ ] Tested on web browser (Chrome/Firefox)
- [ ] Tested on mobile view (responsive design)
- [ ] For mobile features: tested on Android emulator/device
- [ ] Authentication flow tested with test credentials
- [ ] Real-time features tested with multiple users/sessions

### Mobile-Specific Checks
- [ ] Capacitor sync completed (`npm run build && npx cap sync`)
- [ ] Android build successful (if applicable)
- [ ] iOS build successful (if applicable - macOS only)
- [ ] Biometric authentication tested (if implemented)
- [ ] SQLite operations tested on device

### Security Checks
- [ ] No sensitive data exposed in logs
- [ ] Environment variables properly used
- [ ] Supabase RLS policies maintained
- [ ] No hardcoded secrets or keys

### Performance Checks
- [ ] Bundle size reviewed (no unnecessary dependencies)
- [ ] Images optimized for web/mobile
- [ ] Lazy loading implemented where appropriate
- [ ] Real-time subscriptions properly cleaned up

### User Experience Checks
- [ ] Loading states implemented
- [ ] Error handling with user-friendly messages
- [ ] Form validation working correctly
- [ ] Accessibility considerations addressed

## Post-Completion Steps
1. Run final build: `npm run build`
2. Run lint check: `npm run lint`
3. Test on target devices/platforms
4. Update documentation if API changes
5. Commit with clear, descriptive message