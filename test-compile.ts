// Simple test to verify our changes compile
import { supabasePipeline, SupabasePipeline } from './src/lib/supabasePipeline';

// Test static method
const timestamp = SupabasePipeline.safeTimestamp('2023-01-01');
console.log('Timestamp:', timestamp);

// Test instance methods
async function test() {
  const session = await supabasePipeline.getWorkingSession();
  const corrupted = await supabasePipeline.isClientCorrupted();
  console.log('Session:', !!session, 'Corrupted:', corrupted);
}

test().catch(console.error);
