import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class FirewallMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Firewall');

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // 1. Extract IP Address
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    
    this.logger.debug(`🔍 Analyzing request from IP: [${clientIp}]`);

    try {
      // 2. Database Check
      const isBlocked = await this.prisma.blockedIp.findUnique({
        where: { ip: clientIp },
      });

      // 3. If the user is explicitly blocked, we STOP them
      if (isBlocked) {
        this.logger.warn(`🚨 SECURITY_ALERT: Blocked IP ${clientIp} attempted access.`);
        
        throw new ForbiddenException({
          error: 'ACCESS_DENIED',
          message: 'Your IP address has been blacklisted by Aviorè Security.',
          reason: isBlocked.reason || 'Security Protocol Violation',
          timestamp: new Date().toISOString()
        });
      }

      this.logger.log(`✅ IP [${clientIp}] cleared.`);
    } catch (error: any) {
      // 4. Distinction Logic:
      // If the error was a ForbiddenException (the user IS blocked), re-throw it.
      if (error instanceof ForbiddenException) {
        throw error;
      }

      // If the error was a Database failure (P1001, P1000, etc.), log and bypass.
      this.logger.error(`⚠️ DATABASE_LAG: Firewall check bypassed during DB warm-up.`, {
        code: error?.code,
        message: error?.message,
      });
    }

    // Move to the next middleware or controller
    next();
  }
}