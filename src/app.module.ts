import { Module, Global, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
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
    
    // 🐂 3. BULL QUEUE (Stability Refactor)
   // 🐂 3. BULL QUEUE (Stability Refactor)
BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const redisUrl = config.get<string>('REDIS_URL');
    
    // Manual Parse to ensure options aren't dropped
    return {
      redis: {
        // This spreads the URL details (host, port, auth)
        // and forces the stability overrides
        ...(typeof redisUrl === 'string' ? { url: redisUrl } : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => Math.min(times * 100, 3000),
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
    // ⚡ 4. CACHE MANAGER (Stability Refactor)
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const store = await redisStore({
          url: config.get<string>('REDIS_URL'),
          ttl: 600000,
          // 🛡️ Handle potential connection drops
          socket: {
            reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
          }
        });

        const client = store.client;

        client.on('error', (err) =>
          console.error('🔴 Redis Error Logic:', err.message),
        );

        client.on('ready', () =>
          console.log('🟢 Redis Node Synchronized'),
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
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
  exports: [PrismaService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(FirewallMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}