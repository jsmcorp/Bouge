// Simple TypeScript check script
const { execSync } = require('child_process');

try {
  console.log('🔍 Running TypeScript compiler check...');
  const result = execSync('npx tsc --noEmit', { encoding: 'utf8', cwd: process.cwd() });
  console.log('✅ TypeScript compilation successful!');
  console.log(result);
} catch (error) {
  console.log('❌ TypeScript compilation errors:');
  console.log(error.stdout || error.message);
  process.exit(1);
}
