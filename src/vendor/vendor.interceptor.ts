import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma.service';

@Injectable()
export class VendorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(
    VendorInterceptor.name,
  );

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request =
      context.switchToHttp().getRequest();

    const user = request.user;

    // No authenticated user
    if (!user) {
      return next.handle();
    }

    // Only run for vendors
    if (user.role !== 'VENDOR') {
      return next.handle();
    }

    this.logger.log(
      `Resolving vendor profile for user ${user.id}`,
    );

    const vendor =
      await this.prisma.vendor.findUnique({
        where: {
          userId: user.id,
        },
        select: {
          id: true,
          storeName: true,
          status: true,
          isVerified: true,
        },
      });

    if (!vendor) {
      this.logger.warn(
        `Vendor profile not found for user ${user.id}`,
      );

      throw new NotFoundException(
        'Vendor profile not found for this user.',
      );
    }

    request.user = {
      ...request.user,
      vendorId: vendor.id,
    };

    this.logger.log(
      `Vendor resolved successfully: ${vendor.id}`,
    );

    return next.handle();
  }
}