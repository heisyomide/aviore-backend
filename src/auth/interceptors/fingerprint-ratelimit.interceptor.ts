import { 
  Injectable, 
  NestInterceptor, 
  ExecutionContext, 
  CallHandler, 
  HttpException, 
  HttpStatus, 
  Logger 
} from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis'; // Assumes standard ioredis client package setup

@Injectable()
export class FingerprintRateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger('FingerprintRateLimit');
  private readonly redis: Redis;

  constructor() {
    // Connects to your standard environmental Redis cache tier
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest();
    
    // Extract the explicit hardware token from the incoming DTO request body
    const fingerprint = request.body?.deviceFingerprint;

    // If no fingerprint is found (e.g. legacy system or disabled js), bypass cleanly
    if (!fingerprint) {
      return next.handle();
    }

    const redisKey = `ratelimit:fingerprint:${fingerprint}`;
    
    // Enforce thresholds: Max 5 authentication requests (logins/registrations) per 60 seconds
    const limit = 5;
    const windowSeconds = 60;

    try {
      // Increment the request count inside Redis
      const currentRequests = await this.redis.incr(redisKey);

      if (currentRequests === 1) {
        // Set key expiration on the first request of the time window
        await this.redis.expire(redisKey, windowSeconds);
      }

      if (currentRequests > limit) {
        this.logger.warn(`🛑 ABUSE DETECTED: Hardware Fingerprint [${fingerprint}] exceeded request limits.`);
        
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many authentication requests. Please try again in a minute.',
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
    } catch (error) {
      // Re-throw if it's our own TooManyRequests HttpException
      if (error instanceof HttpException) throw error;
      
      // Fail-open strategy: Log errors if Redis connection encounters an interruption
      this.logger.error('Redis execution failed inside RateLimit Interceptor:', error);
    }

    return next.handle();
  }
}