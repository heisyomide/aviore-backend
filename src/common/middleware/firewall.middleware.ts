import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class FirewallMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Firewall');

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    // 1. If DB isn't ready yet, log it and let the request through.
    // This prevents the "Internal Server Error" during Neon's cold start.
    if (!this.prisma.isReady) {
      this.logger.warn(`⚠️ SYSTEM_WARMUP: Bypassing firewall for IP [${clientIp}] while DB connects.`);
      return next();
    }

    try {
      // 2. Perform the IP check with a strict timeout so the UI doesn't hang
      const isBlocked = await Promise.race([
        this.prisma.blockedIp.findUnique({ where: { ip: clientIp } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Query Timeout')), 4000))
      ]) as any;

      // 3. Block logic
      if (isBlocked) {
        this.logger.warn(`🚨 SECURITY_ALERT: Blocked IP ${clientIp} attempted access.`);
        throw new ForbiddenException({
          error: 'ACCESS_DENIED',
          message: 'Your IP address has been blacklisted by Aviorè Security.',
          reason: isBlocked.reason || 'Security Protocol Violation',
          timestamp: new Date().toISOString()
        });
      }

      this.logger.debug(`✅ IP [${clientIp}] cleared.`);
    } catch (error: any) {
      // If it's a real ForbiddenException, re-throw it
      if (error instanceof ForbiddenException) throw error;

      // Otherwise, it's a database lag/timeout. Log and allow passage.
      this.logger.error(`⚠️ FIREWALL_LAG: DB check timed out for [${clientIp}]. Bypassing guard.`);
    }

    next();
  }
}