import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { initializeFirebase } from './config/firebase.config';

async function bootstrap() {
  // 1. Configure Winston Logger
  const loggerInstance = WinstonModule.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      // NOTE: Render has a read-only filesystem unless using Disks. 
      // Console transport is most important for Render logs.
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      }),
    ],
  });

  const app = await NestFactory.create(AppModule, {
    logger: loggerInstance,
  });

  initializeFirebase(); 

  // 2. Security & Middleware
  app.use(helmet());
  
  // 🚀 UPDATED CORS FOR PRODUCTION
  app.enableCors({
    origin: [
      process.env.FRONTEND_URL, // Your Vercel URL
      'https://aviore-frontend-v2.vercel.app',  // Local development
    ].filter(Boolean), 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // 3. Filters & Pipes
  app.useGlobalFilters(new AllExceptionsFilter()); 
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // 4. Swagger (Only enable in dev/staging if you want, or keep for docs)
  const config = new DocumentBuilder()
    .setTitle('Aviore Marketplace API')
    .setDescription('The backend API for Admin, Vendor, and Customer management')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // 5. PORT BINDING (Render Requirement)
  const port = process.env.PORT || 5000;
  
  // 🚀 Use '0.0.0.0' to allow external connections on Render
  await app.listen(port, '0.0.0.0');
  
  Logger.log(`🚀 API Vault Live on: http://0.0.0.0:${port}/api`, 'Bootstrap');
}
bootstrap();