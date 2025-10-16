import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Ghost, Phone, Sparkles, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { supabasePipeline } from '@/lib/supabasePipeline';
import { Capacitor } from '@capacitor/core';
import TruecallerAuth from '@/plugins/truecaller';
import { useAuthStore } from '@/store/authStore';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTruecallerLoading, setIsTruecallerLoading] = useState(false);
  const [isTruecallerAvailable, setIsTruecallerAvailable] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  // Check Truecaller availability on mount (Android only)
  useEffect(() => {
    const checkTruecaller = async () => {
      if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
        return;
      }

      try {
        const result = await TruecallerAuth.isAvailable();
        setIsTruecallerAvailable(result.available);
        console.log('[Truecaller] Available:', result.available);
      } catch (error) {
        console.error('[Truecaller] Error checking availability:', error);
      }
    };

    checkTruecaller();
  }, []);

  // Handle Truecaller one-tap verification
  const handleTruecallerLogin = async () => {
    setIsTruecallerLoading(true);
    try {
      console.log('[Truecaller] Starting verification...');

      // Step 1: Get authorization code from Truecaller SDK
      const result = await TruecallerAuth.verifyWithTruecaller();

      if (!result.success || !result.authorizationCode || !result.codeVerifier) {
        throw new Error('Truecaller verification failed');
      }

      console.log('[Truecaller] Authorization code received');

      // Step 2: Exchange authorization code for user profile via backend
      console.log('[Truecaller] Calling backend:', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/truecaller-verify`);
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/truecaller-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          authorizationCode: result.authorizationCode,
          state: result.state,
          codeVerifier: result.codeVerifier,
        }),
      });

      console.log('[Truecaller] Backend response status:', response.status);

      if (!response.ok) {
        let errorMessage = 'Backend verification failed';
        try {
          const errorData = await response.json();
          console.error('[Truecaller] Backend error response:', errorData);
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          // If response is not JSON, try to get text
          const errorText = await response.text();
          console.error('[Truecaller] Backend error text:', errorText);
          errorMessage = errorText || errorMessage;
        }
        throw new Error(`${errorMessage} (HTTP ${response.status})`);
      }

      const data = await response.json();
      console.log('[Truecaller] Backend response:', data);

      // Step 3: Handle custom JWT auth (bypasses Supabase Auth entirely)
      if (data.customAuth && data.token && data.user) {
        console.log('[Truecaller] Custom JWT received - logging in without Supabase Auth');
        toast.success('Logged in with Truecaller!');

        // Store custom JWT token and user data in localStorage
        localStorage.setItem('truecaller_token', data.token);
        localStorage.setItem('truecaller_user', JSON.stringify(data.user));

        console.log('[Truecaller] Token and user data stored');

        // Update auth store with user data (no Supabase session needed)
        setUser(data.user);

        // Navigate based on onboarding status
        if (data.user.is_onboarded) {
          console.log('[Truecaller] User onboarded - navigating to dashboard');
          navigate('/dashboard');
        } else {
          console.log('[Truecaller] User not onboarded - navigating to onboarding');
          navigate('/onboarding/name');
        }
      } else {
        // Fallback: Normal OTP flow
        console.log('[Truecaller] Falling back to normal OTP flow');
        const { error: otpError } = await supabasePipeline.signInWithOtp(data.phoneNumber);

        if (otpError) {
          throw new Error(otpError.message);
        }

        toast.success('Verification code sent to your phone!');
        navigate('/auth/verify', {
          state: {
            phone: data.phoneNumber,
            truecallerVerified: false,
            userName: data.user.displayName,
          }
        });
      }

    } catch (error: any) {
      console.error('[Truecaller] Verification error:', error);
      toast.error(error.message || 'Truecaller verification failed. Please use phone number instead.');
    } finally {
      setIsTruecallerLoading(false);
    }
  };

  // Handle manual phone number OTP
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;

    setIsLoading(true);
    try {
      const { error } = await supabasePipeline.signInWithOtp(phone.trim());

      if (error) {
        toast.error(error.message || 'Failed to send verification code');
      } else {
        toast.success('Verification code sent!');
        navigate('/auth/verify', { state: { phone: phone.trim() } });
      }
    } catch (error: any) {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-chart-2/10 rounded-full blur-3xl"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ 
              delay: 0.2, 
              type: 'spring', 
              stiffness: 200,
              duration: 0.8 
            }}
            className="relative inline-block mb-6"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary to-chart-2 rounded-3xl blur-xl opacity-30 animate-pulse"></div>
            <div className="relative bg-gradient-to-br from-primary to-chart-2 p-4 rounded-3xl shadow-2xl">
              <Ghost className="w-10 h-10 text-primary-foreground" />
            </div>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute -top-2 -right-2"
            >
              <Sparkles className="w-6 h-6 text-chart-2" />
            </motion.div>
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-5xl font-bold mb-3 bg-gradient-to-r from-primary via-chart-2 to-primary bg-clip-text text-transparent"
          >
            Confessr
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-muted-foreground text-lg leading-relaxed"
          >
            Your anonymous space for authentic conversations
          </motion.p>
        </div>

        <Card className="glass-card border-border/50 shadow-2xl card-hover">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
            <CardDescription className="text-base">
              Enter your phone number to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Truecaller One-Tap Login (Android only) */}
            {isTruecallerAvailable && (
              <div className="space-y-4 mb-6">
                <Button
                  type="button"
                  onClick={handleTruecallerLogin}
                  className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg"
                  disabled={isTruecallerLoading}
                >
                  {isTruecallerLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Verifying with Truecaller...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-2">
                      <Shield className="w-5 h-5" />
                      <span>Continue with Truecaller</span>
                    </div>
                  )}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border/50"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with phone</span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <div className="relative">
                  <Phone className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                  <Input
                    type="tel"
                    placeholder="+1 (555) 123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pl-12 h-12 text-base rounded-xl border-border/50 focus:border-primary/50 focus:ring-primary/20"
                    required
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Include country code (e.g., +1 for US, +91 for India)
                </p>
              </div>
              
              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold btn-modern"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
                    <span>Sending...</span>
                  </div>
                ) : (
                  'Send Verification Code'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center mt-8"
        >
          <p className="text-sm text-muted-foreground leading-relaxed">
            By continuing, you agree to our{' '}
            <span className="text-primary hover:underline cursor-pointer">Terms of Service</span>
            {' '}and{' '}
            <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}