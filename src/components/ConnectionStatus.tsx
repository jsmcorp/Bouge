import React, { useEffect, useState } from 'react';
import { whatsappConnection, ConnectionStatus as ConnectionStatusType } from '@/lib/whatsappStyleConnection';
import { cn } from '@/lib/utils';

/**
 * WhatsApp-style connection status indicator
 * Shows connection state with progress and user-friendly messages
 */

interface ConnectionStatusProps {
  className?: string;
  showWhenConnected?: boolean; // Whether to show status when connected
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ 
  className,
  showWhenConnected = false 
}) => {
  const [status, setStatus] = useState<ConnectionStatusType | null>(null);

  useEffect(() => {
    // Subscribe to connection status changes
    const unsubscribe = whatsappConnection.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    // Get initial status
    setStatus(whatsappConnection.getStatus());

    return unsubscribe;
  }, []);

  // Don't render if no status or if connected and showWhenConnected is false
  if (!status || (!showWhenConnected && status.state === 'connected' && !status.isUserVisible)) {
    return null;
  }

  // Don't render if not user visible
  if (!status.isUserVisible && status.state === 'connected') {
    return null;
  }

  const getStatusColor = (state: ConnectionStatusType['state']) => {
    switch (state) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
      case 'reconnecting':
      case 'validating':
      case 'syncing':
        return 'bg-yellow-500';
      case 'disconnected':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusIcon = (state: ConnectionStatusType['state']) => {
    switch (state) {
      case 'connected':
        return '✓';
      case 'connecting':
      case 'reconnecting':
        return '⟳';
      case 'validating':
        return '🔍';
      case 'syncing':
        return '↻';
      case 'disconnected':
        return '✗';
      default:
        return '?';
    }
  };

  const shouldShowProgress = status.progress !== undefined && 
    (status.state === 'connecting' || status.state === 'validating' || status.state === 'syncing');

  return (
    <div className={cn(
      "fixed top-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm",
      "transform transition-transform duration-300 ease-in-out",
      status.isUserVisible ? "translate-y-0" : "-translate-y-full",
      className
    )}>
      <div className="flex items-center justify-center px-4 py-2 space-x-2">
        {/* Status indicator dot */}
        <div className={cn(
          "w-2 h-2 rounded-full flex-shrink-0",
          getStatusColor(status.state),
          (status.state === 'connecting' || status.state === 'reconnecting') && "animate-pulse"
        )} />

        {/* Status icon */}
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
          {getStatusIcon(status.state)}
        </span>

        {/* Status message */}
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 flex-1 text-center">
          {status.message}
        </span>

        {/* Progress bar */}
        {shouldShowProgress && (
          <div className="w-16 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full transition-all duration-300 ease-out rounded-full",
                getStatusColor(status.state)
              )}
              style={{ width: `${status.progress}%` }}
            />
          </div>
        )}

        {/* Timestamp (for debugging) */}
        {process.env.NODE_ENV === 'development' && (
          <span className="text-xs text-gray-400 font-mono">
            {new Date(status.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Compact connection status for use in headers or toolbars
 */
export const CompactConnectionStatus: React.FC<{ className?: string }> = ({ className }) => {
  const [status, setStatus] = useState<ConnectionStatusType | null>(null);

  useEffect(() => {
    const unsubscribe = whatsappConnection.onStatusChange(setStatus);
    setStatus(whatsappConnection.getStatus());
    return unsubscribe;
  }, []);

  if (!status) return null;

  const getStatusColor = (state: ConnectionStatusType['state']) => {
    switch (state) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
      case 'reconnecting':
      case 'validating':
      case 'syncing':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className={cn("flex items-center space-x-1", className)}>
      <div className={cn(
        "w-2 h-2 rounded-full",
        status.state === 'connected' ? 'bg-green-500' :
        status.state === 'disconnected' ? 'bg-red-500' : 'bg-yellow-500',
        (status.state === 'connecting' || status.state === 'reconnecting') && "animate-pulse"
      )} />
      {status.state !== 'connected' && (
        <span className={cn("text-xs font-medium", getStatusColor(status.state))}>
          {status.message}
        </span>
      )}
    </div>
  );
};

/**
 * Debug connection status for development
 */
export const DebugConnectionStatus: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatusType | null>(null);
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = whatsappConnection.onStatusChange(setStatus);
    const metricsUnsubscribe = whatsappConnection.onReconnectionComplete(setMetrics);
    
    setStatus(whatsappConnection.getStatus());
    
    return () => {
      unsubscribe();
      metricsUnsubscribe();
    };
  }, []);

  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <div className="fixed bottom-4 right-4 bg-black bg-opacity-80 text-white p-3 rounded-lg text-xs font-mono max-w-sm">
      <div className="font-bold mb-2">Connection Debug</div>
      {status && (
        <div className="space-y-1">
          <div>State: {status.state}</div>
          <div>Message: {status.message}</div>
          <div>Visible: {status.isUserVisible ? 'Yes' : 'No'}</div>
          {status.progress !== undefined && <div>Progress: {status.progress}%</div>}
          <div>Time: {new Date(status.timestamp).toLocaleTimeString()}</div>
        </div>
      )}
      {metrics && (
        <div className="mt-2 pt-2 border-t border-gray-600">
          <div className="font-bold mb-1">Last Reconnection</div>
          <div>Total: {metrics.totalReconnectionTime}ms</div>
          <div>Lock: {metrics.lockType} ({metrics.lockDuration}ms)</div>
          <div>WebView: {metrics.webViewReadyAt ? `${metrics.webViewReadyAt - metrics.unlockTimestamp}ms` : 'N/A'}</div>
        </div>
      )}
    </div>
  );
};
