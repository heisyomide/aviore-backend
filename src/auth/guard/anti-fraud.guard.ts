import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AntiFraudGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { email, deviceFingerprint } = request.body;

    // Initialize suspicion baseline context property
    request['isSuspiciousDevice'] = false;

    if (!email) return true;

    try {
      // Pull the last historical signature log that successfully authenticated
      const lastSecureLogin: any = await this.prisma.loginLog.findFirst({
        where: {
          email: email.toLowerCase().trim(),
          status: 'SUCCESS',
        },
        orderBy: { createdAt: 'desc' },
      });

      // Assert safe structural matches against types
      if (lastSecureLogin?.deviceFingerprint && deviceFingerprint) {
        if (lastSecureLogin.deviceFingerprint !== deviceFingerprint) {
          // Flag request as suspicious context for downstream processing loops
          request['isSuspiciousDevice'] = true;
        }
      }
    } catch (err) {
      console.error('⚠️ ANTIFRAUD_GUARD_EXCEPTION:', err);
    }

    return true;
  }
}