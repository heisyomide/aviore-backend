import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { initializeFirebase } from './config/firebase.config';

async function bootstrap() {
  // 1. HARDENED LOGGER (Console-focused for Render)
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

  const app = await NestFactory.create(AppModule, {
    logger: loggerInstance,
  });

  // 2. INITIALIZE EXTERNAL SERVICES
  initializeFirebase();

  // 3. SECURITY & MIDDLEWARE
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allows images to load on frontend
  }));

  // 🚀 SMART CORS: Handles comma-separated strings from Env Vars
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

  // 4. GLOBAL FILTERS & PIPES
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // 5. SWAGGER DOCUMENTATION
  const config = new DocumentBuilder()
    .setTitle('Aviore Marketplace API')
    .setDescription('Core API for Admin, Vendor, and Customers')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // 6. PORT BINDING (Render Requirement)
  // 🚀 Fallback to 5000 is critical for local development
  const port = process.env.PORT || 5000;
  
  await app.listen(port, '0.0.0.0');
  
  const serverUrl = process.env.NODE_ENV === 'production' 
    ? `https://aviore-backend.onrender.com` 
    : `http://localhost:${port}`;

  Logger.log(`🚀 Aviore API Vault Live on: ${serverUrl}/api`, 'Bootstrap');
  Logger.log(`📜 Documentation available at: ${serverUrl}/api/docs`, 'Bootstrap');
}

bootstrap();