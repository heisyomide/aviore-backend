import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class FirewallMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // 1. Extract IP Address
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    
    console.log(`🔍 DEBUG_FIREWALL: Analyzing IP [${clientIp}]`);

    try {
      // 2. Check Registry for Active Blocks
      // We add a .catch() here to prevent a DB timeout from crashing the Middleware
      const isBlocked = await this.prisma.blockedIp.findUnique({
        where: { ip: clientIp },
      });

      if (isBlocked) {
        console.warn(`🚨 SECURITY_ALERT: Blocked IP ${clientIp} attempted access.`);
        throw new ForbiddenException({
          error: 'ACCESS_DENIED',
          message: 'Your IP address has been blacklisted by Aviorè Security.',
          reason: isBlocked.reason || 'Security Protocol Violation',
          timestamp: new Date().toISOString()
        });
      }

      console.log(`✅ DEBUG_FIREWALL: IP [${clientIp}] passed.`);
} catch (error: any) { // 🟢 Adding ': any' is the quickest way to bypass this
      // 3. The "Fail-Safe" Logic
      console.error(`⚠️ DEBUG_FIREWALL_ERROR: Database check bypassed.`, {
        code: error?.code || 'NO_CODE',
        message: error?.message || 'Unknown Error'
      });
    }

    next();
  }
}