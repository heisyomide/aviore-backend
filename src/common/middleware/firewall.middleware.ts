import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class FirewallMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // 1. Extract IP Address (handling proxies/load balancers)
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    // 2. Check Registry for Active Blocks
    const isBlocked = await this.prisma.blockedIp.findUnique({
      where: { ip: clientIp },
    });

    if (isBlocked) {
      // Log the attempted breach for the Security Center
      console.warn(`SECURITY_ALERT: Blocked IP ${clientIp} attempted access.`);
      
      throw new ForbiddenException({
        error: 'ACCESS_DENIED',
        message: 'Your IP address has been blacklisted by Aviorè Security.',
        reason: isBlocked.reason || 'Security Protocol Violation',
        timestamp: new Date().toISOString()
      });
    }

    next();
  }
}