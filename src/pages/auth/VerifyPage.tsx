import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Shield, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

export default function VerifyPage() {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuthStore();
  
  const phone = location.state?.phone;

  useEffect(() => {
    if (!phone) {
      navigate('/auth/login');
      return;
    }

    // Start countdown
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phone, navigate]);

  const handleVerify = async () => {
    if (code.length !== 6) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });

      if (error) {
        toast.error(error.message || 'Invalid verification code');
        return;
      }

      if (data.session && data.user) {
        // Check if user exists in our users table
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (userError) {
          // Only handle PGRST116 (no rows found) as expected for new users
          if (userError.code === 'PGRST116') {
            // User doesn't exist, create new user record
            const { data: newUser, error: createError } = await supabase
              .from('users')
              .insert({
                id: data.user.id,
                phone_number: phone,
                display_name: 'New User',
                is_onboarded: false,
              })
              .select()
              .single();

            if (createError) {
              toast.error('Failed to create user profile');
              return;
            }

            setUser(newUser);
            toast.success('Phone verified successfully!');
            navigate('/onboarding/name');
          } else {
            // Handle other database errors
            toast.error('Failed to fetch user profile');
            return;
          }
        } else if (userData) {
          setUser(userData);
          toast.success('Welcome back!');
          navigate(userData.is_onboarded ? '/dashboard' : '/onboarding/name');
        }
      }
    } catch (error: any) {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
      });

      if (error) {
        toast.error(error.message || 'Failed to send verification code');
      } else {
        toast.success('New verification code sent!');
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } catch (error) {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (code.length === 6) {
      handleVerify();
    }
  }, [code]);

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
        className="w-full max-w-md relative z-10">
        <Button
          variant="ghost"
          onClick={() => navigate('/auth/login')}
          className="mb-6 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <Card className="glass-card border-border/50 shadow-2xl card-hover">
          <CardHeader className="space-y-1 text-center">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ 
                delay: 0.2, 
                type: 'spring', 
                stiffness: 200 
              }}
              className="relative inline-block mb-4 mx-auto"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-primary to-chart-2 rounded-2xl blur-xl opacity-30 animate-pulse"></div>
              <div className="relative bg-gradient-to-br from-primary to-chart-2 p-3 rounded-2xl shadow-xl">
                <Shield className="w-8 h-8 text-primary-foreground" />
              </div>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                className="absolute -top-1 -right-1"
              >
                <Sparkles className="w-5 h-5 text-chart-2" />
              </motion.div>
            </motion.div>
            
            <CardTitle className="text-2xl font-bold">Verify your phone</CardTitle>
            <CardDescription className="text-base">
              We sent a verification code to{' '}
              <span className="font-medium text-foreground">{phone}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={setCode}
                disabled={isLoading}
              >
                <InputOTPGroup className="gap-2 sm:gap-3">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot 
                      key={index}
                      index={index} 
                      className="w-10 h-10 sm:w-12 sm:h-12 text-base sm:text-lg font-bold rounded-lg sm:rounded-xl border-border/50 focus:border-primary/50 focus:ring-primary/20"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            <div className="text-center">
              {countdown > 0 ? (
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-muted-foreground"
                >
                  Resend code in{' '}
                  <span className="font-medium text-primary">{countdown}s</span>
                </motion.p>
              ) : (
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  disabled={isLoading}
                  className="text-primary hover:text-primary/80 hover:bg-primary/10 rounded-xl"
                >
                  {isLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                      <span>Sending...</span>
                    </div>
                  ) : (
                    'Resend code'
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}