/**
 * Manual test for Topic Validation
 * Run this in the browser console to verify validation works
 */

import { TopicValidation } from '../topicValidation';
import { CreateTopicInput } from '@/store/chatstore_refactored/types';

export function runManualValidationTests() {
  console.log('🧪 Running manual validation tests...\n');

  // Test 1: Valid text topic
  console.log('Test 1: Valid text topic');
  const validInput: CreateTopicInput = {
    group_id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'text',
    content: 'This is a test topic',
    expires_in: '7d'
  };
  const result1 = TopicValidation.validateCreateTopicInput(validInput);
  console.log('Result:', result1.isValid ? '✅ PASS' : '❌ FAIL', result1);

  // Test 2: Empty content
  console.log('\nTest 2: Empty content (should fail)');
  const emptyContent: CreateTopicInput = {
    group_id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'text',
    content: '',
    expires_in: '7d'
  };
  const result2 = TopicValidation.validateCreateTopicInput(emptyContent);
  console.log('Result:', !result2.isValid ? '✅ PASS' : '❌ FAIL', result2);

  // Test 3: XSS sanitization
  console.log('\nTest 3: XSS sanitization');
  const xssInput = '<script>alert("xss")</script>Hello World';
  const sanitized = TopicValidation.sanitizeInput(xssInput);
  console.log('Input:', xssInput);
  console.log('Sanitized:', sanitized);
  console.log('Result:', sanitized === 'Hello World' ? '✅ PASS' : '❌ FAIL');

  // Test 4: Poll validation (too few options)
  console.log('\nTest 4: Poll with too few options (should fail)');
  const pollTooFew: CreateTopicInput = {
    group_id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'poll',
    content: 'What is your favorite color?',
    expires_in: '7d',
    poll_options: ['Red']
  };
  const result4 = TopicValidation.validateCreateTopicInput(pollTooFew);
  console.log('Result:', !result4.isValid ? '✅ PASS' : '❌ FAIL', result4);

  // Test 5: Poll validation (valid)
  console.log('\nTest 5: Valid poll');
  const validPoll: CreateTopicInput = {
    group_id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'poll',
    content: 'What is your favorite color?',
    expires_in: '7d',
    poll_options: ['Red', 'Blue', 'Green']
  };
  const result5 = TopicValidation.validateCreateTopicInput(validPoll);
  console.log('Result:', result5.isValid ? '✅ PASS' : '❌ FAIL', result5);

  console.log('\n✅ Manual validation tests complete!');
}
