import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma.service';

@Injectable()
export class VendorInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user && user.role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId: user.id },
        select: { id: true }
      });

      if (!vendor) {
        throw new NotFoundException('Vendor profile not found for this user.');
      }

      // Attach vendorId to the request object
      request.user.vendorId = vendor.id;
    }

    return next.handle();
  }
}