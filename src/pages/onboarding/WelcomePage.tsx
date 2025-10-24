import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Ghost, MessageCircle, Users, Shield, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Feature slides data
const FEATURE_SLIDES = [
  {
    id: 1,
    icon: Ghost,
    emoji: '👻',
    title: 'Anonymous Messaging',
    description: 'Send messages without revealing your identity. Be yourself, freely.',
    gradient: 'from-purple-500 to-pink-500',
    bgGradient: 'from-purple-500/10 to-pink-500/10',
  },
  {
    id: 2,
    icon: MessageCircle,
    emoji: '💬',
    title: 'Group Chats',
    description: 'Create groups and chat with friends. Share moments, stay connected.',
    gradient: 'from-blue-500 to-cyan-500',
    bgGradient: 'from-blue-500/10 to-cyan-500/10',
  },
  {
    id: 3,
    icon: Users,
    emoji: '🕵️',
    title: 'Ghost Mode',
    description: 'Toggle ghost mode anytime. Your identity, your choice.',
    gradient: 'from-green-500 to-emerald-500',
    bgGradient: 'from-green-500/10 to-emerald-500/10',
  },
  {
    id: 4,
    icon: Shield,
    emoji: '🔒',
    title: 'Secure & Private',
    description: 'Your conversations stay private.',
    gradient: 'from-orange-500 to-red-500',
    bgGradient: 'from-orange-500/10 to-red-500/10',
  },
  {
    id: 5,
    icon: Sparkles,
    emoji: '✨',
    title: 'Express Yourself',
    description: 'Polls, reactions, and more. Make every conversation fun.',
    gradient: 'from-yellow-500 to-amber-500',
    bgGradient: 'from-yellow-500/10 to-amber-500/10',
  },
];

const AUTO_SLIDE_INTERVAL = 3500; // 3.5 seconds

export default function WelcomePage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoSliding, setIsAutoSliding] = useState(true);
  const navigate = useNavigate();

  // Auto-slide functionality
  useEffect(() => {
    if (!isAutoSliding) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % FEATURE_SLIDES.length);
    }, AUTO_SLIDE_INTERVAL);

    return () => clearInterval(interval);
  }, [isAutoSliding]);

  // Pause auto-slide when user manually interacts
  const handleManualSlide = (index: number) => {
    setCurrentSlide(index);
    setIsAutoSliding(false);
    // Resume auto-slide after 5 seconds of inactivity
    setTimeout(() => setIsAutoSliding(true), 5000);
  };

  const handleNext = () => {
    handleManualSlide((currentSlide + 1) % FEATURE_SLIDES.length);
  };

  const handlePrev = () => {
    handleManualSlide((currentSlide - 1 + FEATURE_SLIDES.length) % FEATURE_SLIDES.length);
  };

  const handleContinue = () => {
    // Store terms acceptance
    localStorage.setItem('terms_accepted', 'true');
    localStorage.setItem('terms_accepted_at', new Date().toISOString());

    // Navigate to login page
    navigate('/auth/login');
  };

  const currentFeature = FEATURE_SLIDES[currentSlide];
  const Icon = currentFeature.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col items-center justify-between p-6 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className={`absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br ${currentFeature.bgGradient} rounded-full blur-3xl`}
        />
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.5, 0.3, 0.5],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className={`absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br ${currentFeature.bgGradient} rounded-full blur-3xl`}
        />
      </div>

      {/* Logo/Brand */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 mt-8"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary to-chart-2 rounded-2xl blur-lg opacity-50"></div>
            <div className="relative bg-gradient-to-br from-primary to-chart-2 p-3 rounded-2xl">
              <Ghost className="w-8 h-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent">
            Bouge
          </h1>
        </div>
      </motion.div>

      {/* Feature Slides */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-md">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentSlide}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="text-center"
          >
            {/* Icon with emoji */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                delay: 0.2,
                type: 'spring',
                stiffness: 200,
              }}
              className="relative inline-block mb-8"
            >
              <div className={`absolute inset-0 bg-gradient-to-r ${currentFeature.gradient} rounded-full blur-2xl opacity-40 animate-pulse`}></div>
              <div className={`relative bg-gradient-to-br ${currentFeature.gradient} p-8 rounded-full shadow-2xl`}>
                <Icon className="w-16 h-16 text-white" />
              </div>
              <motion.div
                animate={{
                  scale: [1, 1.2, 1],
                  rotate: [0, 10, -10, 0],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                className="absolute -top-4 -right-4 text-5xl"
              >
                {currentFeature.emoji}
              </motion.div>
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className={`text-3xl font-bold mb-4 bg-gradient-to-r ${currentFeature.gradient} bg-clip-text text-transparent`}
            >
              {currentFeature.title}
            </motion.h2>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-lg text-muted-foreground max-w-sm mx-auto"
            >
              {currentFeature.description}
            </motion.p>
          </motion.div>
        </AnimatePresence>

        {/* Navigation arrows */}
        <div className="flex items-center gap-4 mt-12">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrev}
            className="rounded-full hover:bg-primary/10"
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>

{/* Pagination dots */}
<div className="flex items-center gap-2">
  {FEATURE_SLIDES.map((_, index) => {
    const isActive = index === currentSlide;
    return (
      <button
        key={index}
        onClick={() => handleManualSlide(index)}
        aria-label={`Go to slide ${index + 1}`}
        aria-current={isActive}
        className={[
          // Reset all button styles for mobile
          "appearance-none border-0 outline-0 bg-transparent p-0 m-0",
          // Force exact dimensions (override minHeight/minWidth)
          "min-h-0 min-w-0 flex-shrink-0",
          // Dot styling
          "rounded-full transition-all duration-200",
          // Inactive state
          !isActive && "w-2 h-2 bg-muted-foreground/40 hover:bg-muted-foreground/60",
          // Active state  
          isActive && "w-2.5 h-2.5 bg-primary",
        ].join(" ")}
        style={{
          // Force override native mobile button styles
          minHeight: 0,
          minWidth: 0,
          WebkitAppearance: 'none',
          MozAppearance: 'none',
        }}
      />
    );
  })}
</div>


          <Button
            variant="ghost"
            size="icon"
            onClick={handleNext}
            className="rounded-full hover:bg-primary/10"
          >
            <ChevronRight className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {/* Terms and Continue Button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="relative z-10 w-full max-w-md space-y-4 mb-8"
      >
        {/* Terms text */}
        <p className="text-center text-sm text-muted-foreground px-4">
          Read our{' '}
          <a
            href="/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-medium"
          >
            Privacy Policy
          </a>{' '}
          and tap Agree and continue to accept the{' '}
          <a
            href="/terms-of-service"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-medium"
          >
            Terms of Service
          </a>
        </p>

        {/* Continue button */}
        <Button
          onClick={handleContinue}
          className="w-full h-14 text-lg font-semibold rounded-xl bg-primary hover:bg-primary/90 shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-[1.02]"
        >
          Agree and continue
        </Button>
      </motion.div>
    </div>
  );
}

