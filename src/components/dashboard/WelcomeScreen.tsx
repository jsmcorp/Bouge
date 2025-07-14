import { motion } from 'framer-motion';
import { Ghost, MessageCircle, Users, Shield, Sparkles, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { useState } from 'react';
import { CreateGroupDialog } from '@/components/dashboard/CreateGroupDialog';
import { JoinGroupDialog } from '@/components/dashboard/JoinGroupDialog';

export function WelcomeScreen() {
  const { user } = useAuthStore();
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState(false);

  const features = [
    {
      icon: Ghost,
      title: 'Ghost Mode',
      description: 'Toggle between anonymous and identified messaging',
      color: 'from-primary to-chart-2',
    },
    {
      icon: MessageCircle,
      title: 'Confessions',
      description: 'Share your thoughts completely anonymously',
      color: 'from-chart-2 to-chart-3',
    },
    {
      icon: Users,
      title: 'Groups',
      description: 'Join communities and start conversations',
      color: 'from-chart-3 to-chart-4',
    },
    {
      icon: Shield,
      title: 'Privacy First',
      description: 'Your identity is protected by design',
      color: 'from-chart-4 to-primary',
    },
  ];

  return (
    <>
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-20 right-20 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 left-20 w-64 h-64 bg-chart-2/5 rounded-full blur-3xl"></div>
        </div>

        <div className="max-w-4xl w-full text-center space-y-12 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="relative inline-block mb-8">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute -inset-4"
              >
                <div className="w-full h-full bg-gradient-to-r from-primary via-chart-2 to-primary rounded-full opacity-20 blur-xl"></div>
              </motion.div>
              <div className="relative bg-gradient-to-br from-primary to-chart-2 p-6 rounded-3xl shadow-2xl">
                <Ghost className="w-16 h-16 text-primary-foreground" />
              </div>
              <motion.div
                animate={{ 
                  y: [-5, 5, -5],
                  rotate: [0, 5, -5, 0] 
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -top-2 -right-2"
              >
                <Sparkles className="w-8 h-8 text-chart-2" />
              </motion.div>
            </div>
            
            <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary via-chart-2 to-primary bg-clip-text text-transparent">
              Welcome to Confessr, {user?.display_name}!
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Your anonymous space for authentic conversations
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                whileHover={{ y: -5 }}
              >
                <Card className="glass-card border-border/50 shadow-lg card-hover h-full">
                  <CardContent className="p-8 text-center h-full flex flex-col">
                    <div className="relative mb-6">
                      <div className={`absolute inset-0 bg-gradient-to-r ${feature.color} rounded-2xl blur-xl opacity-20`}></div>
                      <div className={`relative inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r ${feature.color} rounded-2xl shadow-lg`}>
                        <feature.icon className="w-8 h-8 text-white" />
                      </div>
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-foreground">{feature.title}</h3>
                    <p className="text-muted-foreground leading-relaxed flex-1">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="space-y-6"
          >
            <p className="text-muted-foreground text-lg">
              Ready to start your anonymous journey?
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-md mx-auto">
              <Button
                onClick={() => setShowCreateGroup(true)}
                className="btn-modern flex-1"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Group
              </Button>
              <Button
                onClick={() => setShowJoinGroup(true)}
                variant="outline"
                className="flex-1 h-12 rounded-xl border-border/50 hover:bg-muted/50 hover:border-primary/50"
              >
                <Users className="w-5 h-5 mr-2" />
                Join Group
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      <CreateGroupDialog
        open={showCreateGroup}
        onOpenChange={setShowCreateGroup}
      />
      <JoinGroupDialog
        open={showJoinGroup}
        onOpenChange={setShowJoinGroup}
      />
    </>
  );
}