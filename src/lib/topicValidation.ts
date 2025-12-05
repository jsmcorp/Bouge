/**
 * Topic Validation Utility
 * 
 * Provides data validation and sanitization for topic operations including:
 * - Required field validation (content, type, group_id)
 * - Expiration duration validation
 * - Poll options validation (2-10 items)
 * - User input sanitization
 * - User-friendly error messages
 * 
 * Requirements: 2.1, 2.2, 2.3
 */

import { CreateTopicInput } from '@/store/chatstore_refactored/types';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class TopicValidation {
  private static readonly VALID_TOPIC_TYPES = ['text', 'poll', 'confession', 'news', 'image'] as const;
  private static readonly VALID_EXPIRATION_DURATIONS = ['24h', '7d', 'never'] as const;
  private static readonly MIN_POLL_OPTIONS = 2;
  private static readonly MAX_POLL_OPTIONS = 10;
  private static readonly MAX_CONTENT_LENGTH = 500;
  private static readonly MAX_TITLE_LENGTH = 100;
  private static readonly MAX_POLL_OPTION_LENGTH = 50;
  private static readonly MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

  /**
   * Validate CreateTopicInput
   * Returns validation result with user-friendly error messages
   */
  public static validateCreateTopicInput(input: CreateTopicInput): ValidationResult {
    const errors: string[] = [];

    // Validate required fields
    if (!input.group_id || input.group_id.trim() === '') {
      errors.push('Group ID is required');
    }

    if (!input.type) {
      errors.push('Topic type is required');
    } else if (!this.VALID_TOPIC_TYPES.includes(input.type as any)) {
      errors.push(`Invalid topic type. Must be one of: ${this.VALID_TOPIC_TYPES.join(', ')}`);
    }

    if (!input.content || input.content.trim() === '') {
      errors.push('Content is required');
    } else if (input.content.length > this.MAX_CONTENT_LENGTH) {
      errors.push(`Content must be ${this.MAX_CONTENT_LENGTH} characters or less`);
    }

    // Validate expiration duration
    if (!input.expires_in) {
      errors.push('Expiration duration is required');
    } else if (!this.VALID_EXPIRATION_DURATIONS.includes(input.expires_in as any)) {
      errors.push(`Invalid expiration duration. Must be one of: ${this.VALID_EXPIRATION_DURATIONS.join(', ')}`);
    }

    // Validate title if provided
    if (input.title && input.title.length > this.MAX_TITLE_LENGTH) {
      errors.push(`Title must be ${this.MAX_TITLE_LENGTH} characters or less`);
    }

    // Type-specific validation
    if (input.type === 'poll') {
      const pollErrors = this.validatePollOptions(input.poll_options);
      errors.push(...pollErrors);
    }

    if (input.type === 'image') {
      const imageErrors = this.validateImage(input.image_file);
      errors.push(...imageErrors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate poll options
   * Requirements: 2.1, 2.3
   */
  private static validatePollOptions(options?: string[]): string[] {
    const errors: string[] = [];

    if (!options || !Array.isArray(options)) {
      errors.push('Poll options are required for poll topics');
      return errors;
    }

    // Filter out empty options
    const validOptions = options.filter(opt => opt && opt.trim() !== '');

    if (validOptions.length < this.MIN_POLL_OPTIONS) {
      errors.push(`Poll must have at least ${this.MIN_POLL_OPTIONS} options`);
    }

    if (validOptions.length > this.MAX_POLL_OPTIONS) {
      errors.push(`Poll can have at most ${this.MAX_POLL_OPTIONS} options`);
    }

    // Check individual option lengths
    for (let i = 0; i < validOptions.length; i++) {
      if (validOptions[i].length > this.MAX_POLL_OPTION_LENGTH) {
        errors.push(`Poll option ${i + 1} must be ${this.MAX_POLL_OPTION_LENGTH} characters or less`);
      }
    }

    // Check for duplicate options
    const uniqueOptions = new Set(validOptions.map(opt => opt.trim().toLowerCase()));
    if (uniqueOptions.size < validOptions.length) {
      errors.push('Poll options must be unique');
    }

    return errors;
  }

  /**
   * Validate image file
   */
  private static validateImage(imageFile?: File): string[] {
    const errors: string[] = [];

    if (!imageFile) {
      errors.push('Image file is required for image topics');
      return errors;
    }

    // Check file size
    if (imageFile.size > this.MAX_IMAGE_SIZE) {
      errors.push(`Image must be less than ${this.MAX_IMAGE_SIZE / (1024 * 1024)}MB`);
    }

    // Check file type
    if (!imageFile.type.startsWith('image/')) {
      errors.push('File must be an image');
    }

    return errors;
  }

  /**
   * Sanitize user input to prevent XSS and other attacks
   * Removes potentially dangerous characters and HTML tags
   */
  public static sanitizeInput(input: string): string {
    if (!input) return '';

    // Remove HTML tags
    let sanitized = input.replace(/<[^>]*>/g, '');

    // Remove script tags and their content
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove event handlers
    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
  }

  /**
   * Sanitize CreateTopicInput
   * Returns a new object with sanitized fields
   */
  public static sanitizeCreateTopicInput(input: CreateTopicInput): CreateTopicInput {
    return {
      ...input,
      content: this.sanitizeInput(input.content),
      title: input.title ? this.sanitizeInput(input.title) : undefined,
      poll_options: input.poll_options?.map(opt => this.sanitizeInput(opt))
    };
  }

  /**
   * Validate and sanitize CreateTopicInput
   * Convenience method that combines validation and sanitization
   */
  public static validateAndSanitize(input: CreateTopicInput): {
    isValid: boolean;
    errors: string[];
    sanitizedInput: CreateTopicInput;
  } {
    // First sanitize
    const sanitizedInput = this.sanitizeCreateTopicInput(input);

    // Then validate
    const validation = this.validateCreateTopicInput(sanitizedInput);

    return {
      isValid: validation.isValid,
      errors: validation.errors,
      sanitizedInput
    };
  }

  /**
   * Validate topic ID format (UUID)
   */
  public static isValidTopicId(topicId: string): boolean {
    if (!topicId) return false;
    
    // UUID v4 format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(topicId);
  }

  /**
   * Validate group ID format (UUID)
   */
  public static isValidGroupId(groupId: string): boolean {
    if (!groupId) return false;
    
    // UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(groupId);
  }

  /**
   * Get user-friendly error message from validation errors
   */
  public static getErrorMessage(errors: string[]): string {
    if (errors.length === 0) return '';
    if (errors.length === 1) return errors[0];
    
    return `Please fix the following errors:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
  }
}

// Export singleton methods
export const validateCreateTopicInput = TopicValidation.validateCreateTopicInput.bind(TopicValidation);
export const sanitizeInput = TopicValidation.sanitizeInput.bind(TopicValidation);
export const sanitizeCreateTopicInput = TopicValidation.sanitizeCreateTopicInput.bind(TopicValidation);
export const validateAndSanitize = TopicValidation.validateAndSanitize.bind(TopicValidation);
export const isValidTopicId = TopicValidation.isValidTopicId.bind(TopicValidation);
export const isValidGroupId = TopicValidation.isValidGroupId.bind(TopicValidation);
export const getErrorMessage = TopicValidation.getErrorMessage.bind(TopicValidation);
