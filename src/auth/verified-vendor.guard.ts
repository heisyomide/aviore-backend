import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class VerifiedVendorGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.role !== 'VENDOR') return false;

    const vendor = await this.prisma.vendor.findUnique({
      where: { userId: user.id },
    });

    if (!vendor || !vendor.isVerified) {
      throw new ForbiddenException('Your account is not yet verified. Please complete KYC.');
    }

    // Attach vendorId to request for easy access in controllers
    request.user.vendorId = vendor.id;
    return true;
  }
}