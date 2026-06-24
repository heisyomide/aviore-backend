import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { initializeFirebase } from './config/firebase.config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  // ==========================================
  // 🛡️ ENHANCED WINSTON LOGGER CONFIGURATION
  // ==========================================
  const loggerInstance = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }), // Unpacks deep nested trace stacks automatically
          winston.format.colorize(),
         winston.format.printf((info) => {
            // Cast info to any or a record type to prevent strict TypeScript property compilation errors
            const logData = info as Record<string, any>;

            const timestamp = logData.timestamp || new Date().toISOString();
            const level = logData.level || 'info';
            const context = logData.context || logData.metadata?.context || 'Bootstrap';
            const message = logData.message || '';
            const stack = logData.stack ? `\n${logData.stack}` : '';

            // Handle objects passed straight into logger functions gracefully
            const extraArgs = Object.keys(logData)
              .filter((key) => !['timestamp', 'level', 'context', 'message', 'stack'].includes(key))
              .map((key) => `\n  ${key}: ${JSON.stringify(logData[key])}`)
              .join('');

            return `[${timestamp}] ${level}: [${context}] ${message}${stack}${extraArgs}`;
          }),
        ),
      }),
    ],
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: loggerInstance,
  });

  // ==========================================
  // 🚀 INITIALIZATIONS & GLOBAL CONFIG
  // ==========================================
// ==========================================
  // 🚀 INITIALIZATIONS & GLOBAL CONFIG
  // ==========================================
  initializeFirebase();

  // Parse cookies before route handlers execute
  app.use(cookieParser());

  // Trust upstream reverse proxies (like Render's Load Balancer)
  app.set('trust proxy', 1);

  // SECURE WITH HELMET - BUT CLEAR OVERRIDE RESOURCE SETTINGS FOR CORS HANDSHAKES
  app.use(
    helmet({
      crossOriginResourcePolicy: false, // 👈 CRITICAL: Disable this so it stops stripping headers on preflight fetches
      crossOriginOpenerPolicy: false,
    }),
  );

  // ==========================================
  // 🌐 CORS DOMAIN ALIGNMENT SYSTEM
  // ==========================================
  const rawOrigins = process.env.FRONTEND_URL || '';
  const origins = [
    'http://localhost:3000',
    'https://aviore-frontend-v2.vercel.app',
    ...rawOrigins.split(',').map((item) => item.trim()),
  ].filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);
      
      const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
      const isAllowed = origins.includes(origin);

      if (isLocalhost || isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Blocked by AVIORÈ Security Vault Gateway (CORS)'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
  });
  // ==========================================
  // 🛡️ API PREFIX & HEALTH CHECK PARSING
  // ==========================================
  // Exclude structural endpoints from prefixing so Render can hit "/" and "/health" directly
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: '/', method: RequestMethod.HEAD },
      { path: 'health', method: RequestMethod.GET },
    ],
  });

  // Ensure database connections and background workers gracefully disconnect during zero-downtime scaling
  app.enableShutdownHooks();

  // ==========================================
  // 🛠️ DATA VALIDATION & ERROR FILTERS
  // ==========================================
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ==========================================
  // 📖 OPENAPI/SWAGGER DOCUMENTATION SYSTEM
  // ==========================================
  const config = new DocumentBuilder()
    .setTitle('AVIORÈ Marketplace API')
    .setDescription('Core enterprise commerce engine and asset infrastructure architecture.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // ==========================================
  // ⚡ SERVER BINDING & ENVIRONMENT RUNTIME
  // ==========================================
  const port = process.env.PORT || 10000;
  // Bind explicitly to 0.0.0.0 to route internal multi-instance containers on Render cleanly
  await app.listen(port, '0.0.0.0');

  const isProd = process.env.NODE_ENV === 'production';
  const displayUrl = isProd 
    ? `https://aviore-backend.onrender.com` 
    : `http://localhost:${port}`;

  Logger.log(`🚀 AVIORÈ API Vault is live at: ${displayUrl}`, 'Bootstrap');
}

bootstrap();