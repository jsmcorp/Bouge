import { supabase } from '@/lib/supabase';
import { compressImage, generateUniqueFileName } from './utils';

export interface FileActions {
  compressImage: (file: File, maxWidth?: number, maxHeight?: number, quality?: number) => Promise<Blob>;
  generateUniqueFileName: (originalName: string, userId: string) => string;
  uploadFileToStorage: (file: File) => Promise<string>;
}

export const createFileActions = (_set: any, _get: any): FileActions => ({
  compressImage,
  generateUniqueFileName,

  uploadFileToStorage: async (file: File) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      console.log('📤 Starting file upload process...');
      console.log('📁 Original file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2), 'MB');

      // Compress the image
      const compressedBlob = await compressImage(file);
      console.log('🗜️ Compressed size:', (compressedBlob.size / 1024 / 1024).toFixed(2), 'MB');

      // Generate unique file name
      const fileName = generateUniqueFileName(file.name, user.id);
      console.log('📝 Generated file name:', fileName);

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('chat-media')
        .upload(fileName, compressedBlob, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (error) {
        console.error('❌ Upload error:', error);
        throw error;
      }

      console.log('✅ Upload successful:', data.path);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('chat-media')
        .getPublicUrl(data.path);

      console.log('🔗 Public URL:', publicUrl);
      return publicUrl;

    } catch (error) {
      console.error('💥 File upload failed:', error);
      throw error;
    }
  },
});