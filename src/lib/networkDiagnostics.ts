/**
 * Network Diagnostics for Confessr
 * Helps diagnose connectivity issues with Supabase
 */

import { supabasePipeline } from './supabasePipeline';

interface DiagnosticResult {
  test: string;
  success: boolean;
  duration: number;
  error?: string;
  details?: any;
}

class NetworkDiagnostics {
  private log(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[network-diagnostics] ${timestamp} ${message}`);
  }

  /**
   * Test basic network connectivity
   */
  public async testBasicConnectivity(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      // Test if we can reach a reliable endpoint
      const response = await fetch('https://httpbin.org/status/200', {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      return {
        test: 'Basic Connectivity',
        success: response.ok,
        duration: Date.now() - startTime,
        details: { status: response.status }
      };
    } catch (error) {
      return {
        test: 'Basic Connectivity',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test Supabase endpoint connectivity
   */
  public async testSupabaseConnectivity(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('VITE_SUPABASE_URL not configured');
      }

      // Test basic HTTP connectivity to Supabase
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}`
        },
        signal: AbortSignal.timeout(10000)
      });
      
      return {
        test: 'Supabase Connectivity',
        success: response.ok,
        duration: Date.now() - startTime,
        details: { 
          status: response.status,
          url: supabaseUrl
        }
      };
    } catch (error) {
      return {
        test: 'Supabase Connectivity',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test Supabase client health
   */
  public async testSupabaseClientHealth(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const isHealthy = await supabasePipeline.checkHealth();
      
      return {
        test: 'Supabase Client Health',
        success: isHealthy,
        duration: Date.now() - startTime,
        details: { healthy: isHealthy }
      };
    } catch (error) {
      return {
        test: 'Supabase Client Health',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test session validity
   */
  public async testSessionValidity(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const session = await supabasePipeline.getWorkingSession();
      const hasValidSession = !!(session?.access_token);
      
      return {
        test: 'Session Validity',
        success: hasValidSession,
        duration: Date.now() - startTime,
        details: { 
          hasSession: !!session,
          hasAccessToken: !!session?.access_token,
          userId: session?.user?.id
        }
      };
    } catch (error) {
      return {
        test: 'Session Validity',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test message sending capability
   */
  public async testMessageSending(): Promise<DiagnosticResult> {
    const startTime = Date.now();

    try {
      // This is a dry run - we'll just test if we can get a client using the public method
      const client = await supabasePipeline.getDirectClient();

      // Test if we can prepare and execute a simple query to verify connectivity
      const { data, error } = await client
        .from('messages')
        .select('id')
        .limit(1);

      if (error) {
        throw error;
      }

      return {
        test: 'Message Sending Capability',
        success: true,
        duration: Date.now() - startTime,
        details: {
          clientAvailable: !!client,
          querySuccessful: !error,
          dataReceived: !!data
        }
      };
    } catch (error) {
      return {
        test: 'Message Sending Capability',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Run all diagnostic tests
   */
  public async runAllTests(): Promise<DiagnosticResult[]> {
    this.log('🔍 Starting network diagnostics...');
    
    const tests = [
      () => this.testBasicConnectivity(),
      () => this.testSupabaseConnectivity(),
      () => this.testSupabaseClientHealth(),
      () => this.testSessionValidity(),
      () => this.testMessageSending()
    ];

    const results: DiagnosticResult[] = [];
    
    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);
        this.log(`${result.success ? '✅' : '❌'} ${result.test}: ${result.duration}ms`);
        if (result.error) {
          this.log(`   Error: ${result.error}`);
        }
      } catch (error) {
        this.log(`❌ Test failed to run: ${error}`);
        results.push({
          test: 'Unknown Test',
          success: false,
          duration: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    this.log(`🔍 Diagnostics complete: ${successful}/${total} tests passed`);
    
    return results;
  }

  /**
   * Get a quick health summary
   */
  public async getHealthSummary(): Promise<{
    overall: 'healthy' | 'degraded' | 'unhealthy';
    issues: string[];
    recommendations: string[];
  }> {
    const results = await this.runAllTests();
    const failedTests = results.filter(r => !r.success);
    
    let overall: 'healthy' | 'degraded' | 'unhealthy';
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    if (failedTests.length === 0) {
      overall = 'healthy';
    } else if (failedTests.length <= 2) {
      overall = 'degraded';
    } else {
      overall = 'unhealthy';
    }
    
    // Analyze specific issues
    failedTests.forEach(test => {
      issues.push(`${test.test}: ${test.error || 'Failed'}`);
      
      if (test.test === 'Basic Connectivity') {
        recommendations.push('Check internet connection');
      } else if (test.test === 'Supabase Connectivity') {
        recommendations.push('Check Supabase service status and configuration');
      } else if (test.test === 'Session Validity') {
        recommendations.push('Try logging out and back in');
      }
    });
    
    // Add timeout-specific recommendations
    const hasTimeouts = failedTests.some(test => 
      test.error?.includes('timeout') || test.error?.includes('AbortError')
    );
    
    if (hasTimeouts) {
      recommendations.push('Network appears slow - consider switching networks or waiting for better connectivity');
    }
    
    return { overall, issues, recommendations };
  }
}

export const networkDiagnostics = new NetworkDiagnostics();
export default networkDiagnostics;
