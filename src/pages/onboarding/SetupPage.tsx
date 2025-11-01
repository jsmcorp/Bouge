import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, Users, Shield } from 'lucide-react';
import { useContactsStore } from '../../store/contactsStore';
import { useAuthStore } from '../../store/authStore';



interface SetupStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  action: () => Promise<void>;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
}

export const SetupPage: React.FC = () => {
  const navigate = useNavigate();
  const { requestPermission, syncContacts, discoverInBackgroundV3, syncProgress } = useContactsStore();
  const { user, isInitialized: authInitialized } = useAuthStore();
  const [setupComplete, setSetupComplete] = useState(false);
  const [steps, setSteps] = useState<SetupStep[]>([
    {
      id: 'contacts',
      title: 'Access Your Contacts',
      description: 'We need permission to find your friends on Bouge',
      icon: <Users className="w-8 h-8" />,
      action: async () => {
        const granted = await requestPermission();
        if (!granted) {
          throw new Error('Contacts permission denied');
        }
      },
      status: 'pending'
    },
    {
      id: 'sync',
      title: 'Sync Your Contacts',
      description: 'Finding your friends on Bouge',
      icon: <Loader2 className="w-8 h-8 animate-spin" />,
      action: async () => {
        console.log('📇 [SETUP] Starting contact sync and discovery...');

        try {
          // STEP 1: Fetch contacts from device and save to SQLite (batched transaction)
          console.log('📇 [SETUP] Fetching contacts from device...');
          await syncContacts();

          // Get contact count for validation
          const { contacts } = useContactsStore.getState();
          if (contacts.length === 0) {
            console.warn('⚠️ [SETUP] No contacts found on device');
            console.warn('⚠️ [SETUP] User may not have any contacts or permission was revoked');
            // Continue anyway - user might genuinely have no contacts
          } else {
            console.log(`✅ [SETUP] Synced ${contacts.length} contacts from device to local SQLite`);
          }

          // STEP 2: Discover registered users from synced contacts (V3 with exponential backoff)
          console.log('📇 [SETUP] Discovering registered users...');
          await discoverInBackgroundV3();

          // Get registered user count for validation
          const { registeredUsers } = useContactsStore.getState();
          console.log(`✅ [SETUP] Found ${registeredUsers.length} registered users`);

        } catch (error) {
          console.error('❌ [SETUP] Contact sync/discovery failed:', error);
          // Don't throw - allow user to continue even if sync fails
        }
      },
      status: 'pending'
    },
    {
      id: 'complete',
      title: 'All Set!',
      description: 'Your account is ready to use',
      icon: <Check className="w-8 h-8" />,
      action: async () => {
        // Mark setup as complete in preferences
        localStorage.setItem('setup_complete', 'true');
        localStorage.setItem('setup_completed_at', Date.now().toString());
      },
      status: 'pending'
    }
  ]);

  useEffect(() => {
    // Check if setup is already complete
    const setupCompleteFlag = localStorage.getItem('setup_complete');
    if (setupCompleteFlag === 'true') {
      console.log('📇 Setup already complete, redirecting to dashboard');
      navigate('/dashboard', { replace: true });
      return;
    }

    if (!authInitialized) {
      console.log('📇 Waiting for auth before starting setup...');
      return;
    }

    console.log('📇 Auth ready, starting first-time setup flow...');
    // Start setup automatically with a small delay to ensure page is mounted
    // This prevents permission dialogs from being skipped
    const timer = setTimeout(() => {
      runSetup();
    }, 300);

    return () => clearTimeout(timer);
  }, [authInitialized]); // Re-run when authInitialized changes

  const runSetup = async () => {
    for (let i = 0; i < steps.length; i++) {
      console.log(`📇 [SETUP] Starting step ${i + 1}/${steps.length}: ${steps[i].title}`);

      // Update step status to in_progress
      setSteps(prev => prev.map((step, idx) =>
        idx === i ? { ...step, status: 'in_progress' } : step
      ));

      try {
        // Execute step action
        await steps[i].action();

        console.log(`✅ [SETUP] Step ${i + 1}/${steps.length} complete: ${steps[i].title}`);

        // Mark as complete
        setSteps(prev => prev.map((step, idx) =>
          idx === i ? { ...step, status: 'complete' } : step
        ));

        // Small delay for UX
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ [SETUP] Step ${steps[i].id} failed:`, error);
        console.error(`❌ [SETUP] Error details:`, {
          step: steps[i].title,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });

        // Mark as error
        setSteps(prev => prev.map((step, idx) =>
          idx === i ? { ...step, status: 'error' } : step
        ));

        // For contacts permission error, allow user to continue to dashboard
        // They can sync contacts later from settings
        if (steps[i].id === 'contacts' || steps[i].id === 'sync') {
          console.log('⚠️ [SETUP] Contacts/sync failed, but allowing user to continue');
          // Mark setup as complete anyway
          localStorage.setItem('setup_complete', 'true');
          localStorage.setItem('setup_completed_at', Date.now().toString());
          // Wait a bit to show the error state
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Navigate to dashboard anyway
          navigate('/dashboard', { replace: true });
          return;
        }

        // For other errors, stop setup
        return;
      }
    }

    // All steps complete
    console.log('🎉 [SETUP] All steps complete!');
    setSetupComplete(true);

    // Navigate to dashboard after 1 second (reduced from 2s for faster UX)
    setTimeout(() => {
      navigate('/dashboard', { replace: true });
    }, 1000);
  };

  const getStepIcon = (step: SetupStep) => {
    if (step.status === 'complete') {
      return <Check className="w-8 h-8 text-green-500" />;
    }
    if (step.status === 'in_progress') {
      return <Loader2 className="w-8 h-8 text-primary animate-spin" />;
    }
    if (step.status === 'error') {
      return <div className="w-8 h-8 text-red-500">✕</div>;
    }
    return <div className="w-8 h-8 text-muted-foreground">{step.icon}</div>;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.5 }}
            className="w-20 h-20 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-4"
          >
            <Shield className="w-10 h-10 text-primary" />
          </motion.div>
          <h1 className="text-3xl font-bold">Setting Up Bouge</h1>
          <p className="text-muted-foreground">
            Just a moment while we get everything ready...
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {steps.map((step, index) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`
                p-4 rounded-lg border-2 transition-all
                ${step.status === 'complete' ? 'border-green-500 bg-green-500/10' : ''}
                ${step.status === 'in_progress' ? 'border-primary bg-primary/10' : ''}
                ${step.status === 'error' ? 'border-red-500 bg-red-500/10' : ''}
                ${step.status === 'pending' ? 'border-border bg-card' : ''}
              `}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  {getStepIcon(step)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg">{step.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {step.description}
                  </p>

                  {/* Progress bar for sync step */}
                  {step.id === 'sync' && step.status === 'in_progress' && syncProgress && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {syncProgress.message}
                        </span>
                        <span className="font-medium">
                          {Math.round((syncProgress.current / syncProgress.total) * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{
                            width: `${(syncProgress.current / syncProgress.total) * 100}%`
                          }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Success message */}
        <AnimatePresence>
          {setupComplete && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center space-y-2"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', duration: 0.5 }}
                className="w-16 h-16 mx-auto bg-green-500 rounded-full flex items-center justify-center"
              >
                <Check className="w-8 h-8 text-white" />
              </motion.div>
              <h2 className="text-2xl font-bold text-green-500">You're All Set!</h2>
              <p className="text-muted-foreground">
                Redirecting to your dashboard...
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* User info */}
        {user && (
          <div className="text-center text-sm text-muted-foreground">
            Setting up for {user.phone_number}
          </div>
        )}
      </div>
    </div>
  );
};

