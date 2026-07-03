import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class KycApprovedGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  // 🌟 FIX: Changed from ': Object' to ': Promise<boolean>'
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by your JwtAuthGuard

    if (!user) return false;

    // Check if user is a vendor
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId: user.id },
    });

    if (!vendor) {
      throw new ForbiddenException('Access denied: No vendor profile established.');
    }

    if (vendor.kycStatus !== 'APPROVED') {
      throw new ForbiddenException(
        `Access denied: Your account compliance status is currently ${vendor.kycStatus}. Access restricted.`,
      );
    }

    // 🌟 Ensure a boolean value is explicitly returned here
    return true;
  }
}