import { useState, useEffect } from 'react';
import { messageCache } from '@/lib/messageCache';

export function CacheStatus() {
  const [stats, setStats] = useState(messageCache.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(messageCache.getStats());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-black/80 text-white text-xs p-2 rounded font-mono z-50">
      <div>Cache: {stats.cacheSize} groups</div>
      <div>Hits: {stats.hits} | Misses: {stats.misses}</div>
      <div>Preloads: {stats.preloads}</div>
    </div>
  );
}