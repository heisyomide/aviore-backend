import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = 
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = 
      exception instanceof HttpException 
        ? exception.getResponse() 
        : { message: 'Internal server error', statusCode: 500 };

    // Log the error for the Admin Audit Logs if necessary
    console.error(`[Error] ${request.method} ${request.url}`, exception);

    response.status(status).json({
      success: false,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: message,
    });
  }
}