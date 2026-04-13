import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common'; // Added RequestMethod
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { initializeFirebase } from './config/firebase.config';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
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

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: loggerInstance,
  });

  initializeFirebase();

  app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));

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

  // 🛡️ THE FIX: EXCLUDE ROOT PATHS FROM THE GLOBAL PREFIX
  // This allows Render to ping "/" and "health" without adding "/api"
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: '/', method: RequestMethod.HEAD },
      { path: 'health', method: RequestMethod.GET },
    ],
  });

  app.enableShutdownHooks();

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  const config = new DocumentBuilder()
    .setTitle('Aviore Marketplace API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Bind to 0.0.0.0 for Render compatibility
  const port = process.env.PORT || 10000; 
  await app.listen(port, '0.0.0.0');
  
  const isProd = process.env.NODE_ENV === 'production';
  const displayUrl = isProd 
    ? `https://aviore-backend.onrender.com` 
    : `http://localhost:${port}`;

  Logger.log(`🚀 Aviore API Vault is live at: ${displayUrl}`, 'Bootstrap');
}

bootstrap();