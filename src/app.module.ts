import { Module, Global, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
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
import { PayoutModule } from './payout/payout.module';

@Global()
@Module({
  imports: [
    // 📂 0. STATIC ASSETS
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),

 // 🔐 1. ENV VALIDATION (Strict Mode)
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(5000),
        DATABASE_URL: Joi.string().required(),
        // Redis Validation
          REDIS_URL: Joi.string().required(),
        // Extras
        FRONTEND_URL: Joi.string().required(),
        CLOUDINARY_CLOUD_NAME: Joi.string().required(),
        RESEND_API_KEY: Joi.string().required(),
      }),
    }),

    // 🛡️ 2. SECURITY: RATE LIMITING
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 50, // Increased slightly for marketplace browsing
    }]),
    
BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    redis: config.get<string>('REDIS_URL'),

    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  }),
}),


CacheModule.registerAsync({
  isGlobal: true,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const store = await redisStore({
      url: config.get<string>('REDIS_URL'),
      ttl: 600000, // 10 minutes
    });

    const client = store.client;

    client.on('error', (err) =>
      console.error('🔴 Redis Error:', err.message),
    );

    client.on('ready', () =>
      console.log('🟢 Redis Connected'),
    );

    return {
      store: store as any,
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
    PayoutModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
  exports: [PrismaService],
})
export class AppModule implements NestModule {
 configure(consumer: MiddlewareConsumer) {
  consumer
    .apply(FirewallMiddleware)
    .forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
}
}