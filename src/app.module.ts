import { Module, Global, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq'; // ✅ Upgraded to matching BullMQ package
import { CacheModule } from '@nestjs/cache-manager';
import { ServeStaticModule } from '@nestjs/serve-static';
import { redisStore } from 'cache-manager-redis-yet';
import { join } from 'path';
import * as Joi from 'joi';

// Core Services
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
import { PayoutModule } from './payout/payout.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { BannerModule } from './admin/banner/banner.module';
import { ReferralModule } from './referral/referral.module';
import { VoucherModule } from './voucher/voucher.module';
import { AntiAbuseService } from './common/services/anti-abuse.service';
import { AnalyticsModule } from './analytics/analytics.module';
import { GrowthModule } from './growth/growth.module';
import { NotificationModule } from './notification/notification.module';

@Global()
@Module({
  imports: [
    // 📂 0. STATIC ASSETS
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),

    // 🔐 1. ENV VALIDATION
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(10000),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        FRONTEND_URL: Joi.string().required(),
        CLOUDINARY_CLOUD_NAME: Joi.string().required(),
        RESEND_API_KEY: Joi.string().required(),
      }),
    }),

    // 🛡️ 2. SECURITY: RATE LIMITING
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100, 
    }]),
    
    // 🐂 3. BULLMQ GLOBAL CONFIGURATION (Render Key-Value Mesh Target)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL') || '';
        
        // Parse the internal redis connection string to configure BullMQ connection object
        const parsedUrl = new URL(redisUrl);
        
        return {
          connection: {
            host: parsedUrl.hostname,
            port: parseInt(parsedUrl.port, 10) || 6379,
            username: parsedUrl.username || undefined,
            password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
            maxRetriesPerRequest: null,
            // Render Key-Value uses an unencrypted redis:// protocol over a private network mesh.
            // TLS optimization rules are skipped unless switching back to an external rediss:// string.
            tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        };
      },
    }),

    // ⚡ 4. CACHE MANAGER (Render Internal Network Optimization)
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL') || '';

        const store = await redisStore({
          url: redisUrl,
          ttl: 600000, // 10 Minutes cache mapping lifespan
          socket: {
            connectTimeout: 30000, 
            keepAlive: 5000,
            tls: redisUrl.startsWith('rediss://'),
            reconnectStrategy: (retries) => {
              if (retries > 20) return new Error('REDIS_TERMINAL_FAILURE');
              return Math.min(retries * 200, 5000);
            },
          }
        });

        const client = store.client;

        client.on('error', (err) =>
          console.error('🔴 Redis Connection Logic:', err.message),
        );

        client.on('ready', () =>
          console.log('🟢 AVIORÈ_CACHE: Redis Node Synchronized over Render Internal Mesh.'),
        );

        return { store: store as any };
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
    PayoutModule,
    WishlistModule,
    BannerModule,
    ReferralModule,
    VoucherModule,
    AnalyticsModule,
    GrowthModule,
    NotificationModule
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, AntiAbuseService],
  exports: [PrismaService , AntiAbuseService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(FirewallMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}