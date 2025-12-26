import { ArrowLeft, Palette, Moon, Sun, Monitor } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/components/theme-provider';
import { motion } from 'framer-motion';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div 
        className="border-b border-border/50 p-4 bg-card/30 backdrop-blur-sm"
        style={{
          paddingTop: Capacitor.getPlatform() === 'ios' ? 'calc(env(safe-area-inset-top, 0px) + 16px)' : undefined
        }}
      >
        <Button
          variant="ghost"
          onClick={() => navigate('/dashboard')}
          className="mb-4 hover:bg-muted/50"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-primary to-primary/80 rounded-xl">
            <Palette className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Customize your Confessr experience</p>
          </div>
        </div>
      </div>
      
      <div className="p-6 max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          {/* Appearance Settings */}
          <Card className="glass-card border-border/50 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Palette className="w-5 h-5 text-primary" />
                <span>Appearance</span>
              </CardTitle>
              <CardDescription>
                Customize how Confessr looks and feels
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="theme-select">Theme</Label>
                <Select value={theme} onValueChange={setTheme}>
                  <SelectTrigger id="theme-select" className="w-full">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    {themeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center space-x-2">
                          <option.icon className="w-4 h-4" />
                          <span>{option.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Choose your preferred theme. System will match your device settings.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Theme Preview */}
          <Card className="glass-card border-border/50 shadow-lg">
            <CardHeader>
              <CardTitle>Theme Preview</CardTitle>
              <CardDescription>
                See how your selected theme looks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                      <span className="text-primary-foreground text-sm font-medium">C</span>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Confessr</p>
                      <p className="text-sm text-muted-foreground">Anonymous messaging</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="bg-card p-3 rounded-lg border border-border/50">
                      <p className="text-sm text-foreground">This is how messages will look in your selected theme</p>
                    </div>
                    <div className="bg-primary/10 p-3 rounded-lg border border-primary/20">
                      <p className="text-sm text-primary">Ghost mode messages have this styling</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Coming Soon */}
          <Card className="glass-card border-border/50 shadow-lg opacity-60">
            <CardHeader>
              <CardTitle>More Settings</CardTitle>
              <CardDescription>
                Additional customization options coming soon
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Notification preferences</span>
                  <span className="text-xs bg-muted px-2 py-1 rounded">Soon</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Privacy settings</span>
                  <span className="text-xs bg-muted px-2 py-1 rounded">Soon</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Message history</span>
                  <span className="text-xs bg-muted px-2 py-1 rounded">Soon</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Account management</span>
                  <span className="text-xs bg-muted px-2 py-1 rounded">Soon</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}