import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { initializeFirebase } from './config/firebase.config';
import { NestExpressApplication } from '@nestjs/platform-express'; // Added for proxy support

async function bootstrap() {
  // 1. HARDENED LOGGER
  const loggerInstance = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, context }) => {
            return `[${timestamp}] ${level}: [${context || 'Bootstrap'}] ${message}`;
          }),
        ),
      }),
    ],
  });

  // Use NestExpressApplication to access underlying Express settings
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: loggerInstance,
  });

  initializeFirebase();

  // 🛡️ 2. RENDER PROXY SUPPORT
  // Required for FirewallMiddleware to get the REAL client IP from Render's load balancer
  app.set('trust proxy', 1);

  // 🛡️ 3. SECURITY
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));

  // 🚀 4. CLEAN CORS LOGIC
  const rawOrigins = process.env.FRONTEND_URL || '';
  const origins = [
    'http://localhost:3000',
    'https://aviore-frontend-v2.vercel.app',
    ...rawOrigins.split(',').map(item => item.trim()),
  ].filter(Boolean);

  app.enableCors({
    origin: origins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // 5. GLOBAL FILTERS & PIPES
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // 6. SWAGGER
  const config = new DocumentBuilder()
    .setTitle('Aviore Marketplace API')
    .setDescription('Core API for Admin, Vendor, and Customers')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // 7. PORT BINDING
  const port = process.env.PORT || 5000;
  await app.listen(port, '0.0.0.0');
  
  // 🚀 CLEAN LOGGING: No more accidental commas
  const isProd = process.env.NODE_ENV === 'production';
  const displayUrl = isProd 
    ? `https://aviore-backend.onrender.com/api` 
    : `http://localhost:${port}/api`;

  Logger.log(`🚀 Aviore API Vault is live at: ${displayUrl}`, 'Bootstrap');
}

bootstrap();