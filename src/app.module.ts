import { Module, Global, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '@nestjs/cache-manager';
import { ServeStaticModule } from '@nestjs/serve-static'; // New Import
import { redisStore } from 'cache-manager-redis-yet';
import { join } from 'path'; // New Import
import * as Joi from 'joi';

// Core Services & Middleware
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { FirewallMiddleware } from './common/middleware/firewall.middleware';

// Feature Modules
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { MailModule } from './mail/mail.module';
import { AdminModule } from './admin/admin.module';
import { VendorModule } from './vendor/vendor.module';
import { CouponsModule } from './coupons/coupons.module';
import { ChatModule } from './chat/chat.module';
import { StorefrontModule } from './storefront/storefront.module';
import { CartModule } from './cart/cart.module';

@Global()
@Module({
  imports: [
    // 0. STATIC ASSETS ENGINE
    // This allows the browser to access files in http://localhost:5000/uploads/
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'), 
      serveRoot: '/uploads', 
    }),

    // 1. ENVIRONMENT CONFIGURATION & VALIDATION
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(5000),
        DATABASE_URL: Joi.string().required(),
        REDIS_HOST: Joi.string().required(),
        REDIS_PORT: Joi.number().default(6379),
        FRONTEND_URL: Joi.string().default('http://localhost:3000,https://aviore-frontend-v2.vercel.app'),
        CLOUDINARY_CLOUD_NAME: Joi.string().required(),
        CLOUDINARY_API_KEY: Joi.string().required(),
        CLOUDINARY_API_SECRET: Joi.string().required(),
        RESEND_API_KEY: Joi.string().required(),
      }),
    }),

    // 2. SECURITY: GLOBAL RATE LIMITING
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 20,
    }]),

// 3. INFRASTRUCTURE: REDIS QUEUE (BullMQ)
BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    // 🚀 Connection Configuration
    redis: {
      host: config.get('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT') || 6379,
      username: config.get('REDIS_USERNAME') || 'default',
      password: config.get('REDIS_PASSWORD'),
      
      // 🛡️ SECURITY & STABILITY (Critical for Upstash/Render)
      tls: {
        rejectUnauthorized: false // Necessary for some cloud providers
      },
      
      // 🛡️ RECOVERY LOGIC: Prevents app crashes during network blips
      maxRetriesPerRequest: null, 
      enableReadyCheck: false,
      
      // 🔄 RECONNECT STRATEGY: Exponential backoff
      retryStrategy: (times: number) => {
        // Stop retrying after 20 attempts
        if (times > 20) return null; 
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      
      // 🫀 HEARTBEAT: Keeps the connection alive on idle workers
      keepAlive: 10000, 
      connectTimeout: 20000,
    },
    
    // ⚙️ GLOBAL SETTINGS: Ensures jobs don't get "stuck"
    defaultJobOptions: {
      attempts: 3, // Retry failed jobs 3 times
      backoff: {
        type: 'exponential',
        delay: 5000, // Wait 5s, then 10s, etc.
      },
      removeOnComplete: true, // Keep Redis clean
      removeOnFail: false, // Keep failed jobs for debugging
    },
  }),
}),

    // 4. INFRASTRUCTURE: REDIS CACHING
// 4. INFRASTRUCTURE: REDIS CACHING
CacheModule.registerAsync({
  isGlobal: true,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const store = await redisStore({
      socket: {
        host: config.get('REDIS_HOST'),
        // 🚀 TWEAK 1: Explicitly cast Port to Number to prevent connection hangs
        port: Number(config.get('REDIS_PORT')) || 6379,
        tls: true,
        // 🛡️ RECONNECT LOGIC: Catch ECONNRESET
        reconnectStrategy: (retries) => {
          if (retries > 20) {
            console.error('❌ Redis Cache: Max reconnection attempts reached.');
            return new Error('Redis connection lost');
          }
          return Math.min(retries * 100, 3000); 
        },
        keepAlive: 5000,
      },
      username: config.get('REDIS_USERNAME') || 'default',
      password: config.get('REDIS_PASSWORD'),
      // 🚀 TWEAK 2: Use a clearer TTL (e.g., 10 minutes)
      ttl: 600 * 1000, 
    });

    return {
      store: store as any, // Cast helps with some cache-manager version mismatches
    };
  },
}),

    
    // 5. DOMAIN FEATURE MODULES
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    OrdersModule,
    PaymentsModule,
    VendorModule,
    MailModule,
    AdminModule,
    ChatModule,
    CouponsModule,
    StorefrontModule,
    CartModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
  exports: [PrismaService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(FirewallMiddleware)
      // 🛠️ FIX: Changed '*' to '*path' to resolve path-to-regexp warning
      .forRoutes('*path'); 
  }
}