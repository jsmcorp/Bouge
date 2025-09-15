import { webViewLifecycle } from './webViewLifecycle';
import { deviceLockDetection } from './deviceLockDetection';
import { whatsappConnection } from './whatsappStyleConnection';
import { mobileLogger } from './mobileLogger';
import { validateEncryptionAfterUnlock } from './sqliteSecret';
import { supabasePipeline } from './supabasePipeline';

/**
 * Comprehensive Reconnection Test Suite
 * Tests all components of the WhatsApp-style reconnection system
 */

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: string;
  details?: any;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  totalDuration: number;
  successCount: number;
  failureCount: number;
}

class ReconnectionTester {
  private testResults: TestSuite[] = [];

  constructor() {
    this.log('🧪 Reconnection Test Suite initialized');
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[reconnection-test] ${timestamp} ${message}`);
    mobileLogger.log('info', 'general', message);
  }

  /**
   * Run a single test with timing and error handling
   */
  private async runTest(name: string, testFn: () => Promise<any>): Promise<TestResult> {
    const startTime = Date.now();
    this.log(`🔬 Running test: ${name}`);

    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      
      this.log(`✅ Test passed: ${name} (${duration}ms)`);
      return {
        name,
        success: true,
        duration,
        details: result,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.log(`❌ Test failed: ${name} (${duration}ms) - ${errorMessage}`);
      return {
        name,
        success: false,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Test WebView lifecycle detection
   */
  async testWebViewLifecycle(): Promise<TestSuite> {
    const suite: TestSuite = {
      name: 'WebView Lifecycle',
      results: [],
      totalDuration: 0,
      successCount: 0,
      failureCount: 0,
    };

    const suiteStartTime = Date.now();

    // Test 1: WebView readiness check
    suite.results.push(await this.runTest('WebView Readiness Check', async () => {
      const state = webViewLifecycle.getState();
      return {
        isReady: state.isReady,
        jsContextReady: state.jsContextReady,
        networkStackReady: state.networkStackReady,
        contextRestoredAt: state.contextRestoredAt,
      };
    }));

    // Test 2: Force readiness check
    suite.results.push(await this.runTest('Force Readiness Check', async () => {
      const isReady = await webViewLifecycle.forceCheck();
      return { isReady };
    }));

    // Test 3: Wait for ready with timeout
    suite.results.push(await this.runTest('Wait for Ready (5s timeout)', async () => {
      const isReady = await webViewLifecycle.waitForReady(5000);
      return { isReady };
    }));

    // Calculate suite metrics
    suite.totalDuration = Date.now() - suiteStartTime;
    suite.successCount = suite.results.filter(r => r.success).length;
    suite.failureCount = suite.results.filter(r => !r.success).length;

    return suite;
  }

  /**
   * Test device lock detection
   */
  async testDeviceLockDetection(): Promise<TestSuite> {
    const suite: TestSuite = {
      name: 'Device Lock Detection',
      results: [],
      totalDuration: 0,
      successCount: 0,
      failureCount: 0,
    };

    const suiteStartTime = Date.now();

    // Test 1: Get lock state
    suite.results.push(await this.runTest('Get Lock State', async () => {
      const state = deviceLockDetection.getLockState();
      return {
        isLocked: state.isLocked,
        unlockCount: state.unlockCount,
        lastUnlockTime: state.lastUnlockTime,
        lockDuration: state.lockDuration,
      };
    }));

    // Test 2: Reconnection strategy
    suite.results.push(await this.runTest('Reconnection Strategy', async () => {
      const shortStrategy = deviceLockDetection.getReconnectionStrategy(30000); // 30s
      const longStrategy = deviceLockDetection.getReconnectionStrategy(1800000); // 30min
      
      return {
        shortLock: shortStrategy,
        longLock: longStrategy,
      };
    }));

    // Test 3: Force unlock simulation
    suite.results.push(await this.runTest('Force Unlock Simulation', async () => {
      deviceLockDetection.forceUnlock();
      const timeSinceUnlock = deviceLockDetection.getTimeSinceUnlock();
      return { timeSinceUnlock };
    }));

    suite.totalDuration = Date.now() - suiteStartTime;
    suite.successCount = suite.results.filter(r => r.success).length;
    suite.failureCount = suite.results.filter(r => !r.success).length;

    return suite;
  }

  /**
   * Test SQLite encryption validation
   */
  async testSQLiteEncryption(): Promise<TestSuite> {
    const suite: TestSuite = {
      name: 'SQLite Encryption',
      results: [],
      totalDuration: 0,
      successCount: 0,
      failureCount: 0,
    };

    const suiteStartTime = Date.now();

    // Test 1: Encryption validation
    suite.results.push(await this.runTest('Encryption Validation', async () => {
      const isValid = await validateEncryptionAfterUnlock();
      return { isValid };
    }));

    suite.totalDuration = Date.now() - suiteStartTime;
    suite.successCount = suite.results.filter(r => r.success).length;
    suite.failureCount = suite.results.filter(r => !r.success).length;

    return suite;
  }

  /**
   * Test WhatsApp-style connection manager
   */
  async testConnectionManager(): Promise<TestSuite> {
    const suite: TestSuite = {
      name: 'Connection Manager',
      results: [],
      totalDuration: 0,
      successCount: 0,
      failureCount: 0,
    };

    const suiteStartTime = Date.now();

    // Test 1: Get current status
    suite.results.push(await this.runTest('Get Connection Status', async () => {
      const status = whatsappConnection.getStatus();
      return {
        state: status.state,
        message: status.message,
        isUserVisible: status.isUserVisible,
      };
    }));

    // Test 2: Manual reconnection
    suite.results.push(await this.runTest('Manual Reconnection', async () => {
      await whatsappConnection.manualReconnect();
      
      // Wait a moment for status to update
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const status = whatsappConnection.getStatus();
      return { finalState: status.state };
    }));

    suite.totalDuration = Date.now() - suiteStartTime;
    suite.successCount = suite.results.filter(r => r.success).length;
    suite.failureCount = suite.results.filter(r => !r.success).length;

    return suite;
  }

  /**
   * Test Supabase pipeline
   */
  async testSupabasePipeline(): Promise<TestSuite> {
    const suite: TestSuite = {
      name: 'Supabase Pipeline',
      results: [],
      totalDuration: 0,
      successCount: 0,
      failureCount: 0,
    };

    const suiteStartTime = Date.now();

    // Test 1: Health check
    suite.results.push(await this.runTest('Pipeline Health Check', async () => {
      const isHealthy = await supabasePipeline.checkHealth();
      return { isHealthy };
    }));

    // Test 2: Get session
    suite.results.push(await this.runTest('Get Working Session', async () => {
      const session = await supabasePipeline.getWorkingSession();
      return {
        hasSession: !!session,
        hasAccessToken: !!session?.access_token,
        userId: session?.user?.id,
      };
    }));

    suite.totalDuration = Date.now() - suiteStartTime;
    suite.successCount = suite.results.filter(r => r.success).length;
    suite.failureCount = suite.results.filter(r => !r.success).length;

    return suite;
  }

  /**
   * Run complete test suite
   */
  async runCompleteTestSuite(): Promise<void> {
    this.log('🚀 Starting complete reconnection test suite');
    this.testResults = [];

    const overallStartTime = Date.now();

    try {
      // Run all test suites
      this.testResults.push(await this.testWebViewLifecycle());
      this.testResults.push(await this.testDeviceLockDetection());
      this.testResults.push(await this.testSQLiteEncryption());
      this.testResults.push(await this.testConnectionManager());
      this.testResults.push(await this.testSupabasePipeline());

      const overallDuration = Date.now() - overallStartTime;
      
      // Calculate overall metrics
      const totalTests = this.testResults.reduce((sum, suite) => sum + suite.results.length, 0);
      const totalSuccesses = this.testResults.reduce((sum, suite) => sum + suite.successCount, 0);
      const totalFailures = this.testResults.reduce((sum, suite) => sum + suite.failureCount, 0);

      this.log(`📊 Test suite completed in ${overallDuration}ms`);
      this.log(`📈 Results: ${totalSuccesses}/${totalTests} tests passed (${totalFailures} failed)`);

      // Log detailed results
      this.logDetailedResults();

    } catch (error) {
      this.log(`❌ Test suite failed: ${error}`);
    }
  }

  /**
   * Log detailed test results
   */
  private logDetailedResults(): void {
    this.log('📋 Detailed Test Results:');
    
    this.testResults.forEach(suite => {
      this.log(`\n📁 ${suite.name} (${suite.successCount}/${suite.results.length} passed, ${suite.totalDuration}ms)`);
      
      suite.results.forEach(result => {
        const status = result.success ? '✅' : '❌';
        this.log(`  ${status} ${result.name} (${result.duration}ms)`);
        
        if (!result.success && result.error) {
          this.log(`    Error: ${result.error}`);
        }
        
        if (result.details && typeof result.details === 'object') {
          this.log(`    Details: ${JSON.stringify(result.details, null, 2)}`);
        }
      });
    });
  }

  /**
   * Get test results for external use
   */
  getTestResults(): TestSuite[] {
    return [...this.testResults];
  }

  /**
   * Export test results as JSON
   */
  exportResults(): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      testSuites: this.testResults,
      summary: {
        totalSuites: this.testResults.length,
        totalTests: this.testResults.reduce((sum, suite) => sum + suite.results.length, 0),
        totalSuccesses: this.testResults.reduce((sum, suite) => sum + suite.successCount, 0),
        totalFailures: this.testResults.reduce((sum, suite) => sum + suite.failureCount, 0),
      },
    }, null, 2);
  }
}

// Export singleton instance and make it globally available for debugging
export const reconnectionTester = new ReconnectionTester();

// Make available globally for console debugging
if (typeof window !== 'undefined') {
  (window as any).reconnectionTester = reconnectionTester;
}
