// src/cloudinary/cloudinary.provider.ts (or wherever you want)
import { v2 as cloudinary } from 'cloudinary';

export const CloudinaryProvider = {
  provide: 'CLOUDINARY', // ← this is the injection token
  useFactory: () => {
    console.log('--- CLOUDINARY DEBUG START ---');
    console.log('CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
    console.log('API_KEY EXISTS:', !!process.env.CLOUDINARY_API_KEY);
    console.log('API_SECRET EXISTS:', !!process.env.CLOUDINARY_API_SECRET);
    console.log('--- CLOUDINARY DEBUG END ---');

    // Optional: throw if missing (fail fast in production)
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error('Missing required Cloudinary environment variables');
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    return cloudinary; // ← the configured instance
  },
};