// src/growth/auth/guards/roles.guard.ts
import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  ForbiddenException 
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MarketerRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<MarketerRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles metadata is defined, or the array is empty, grant open access to authenticated users
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request['user'];

    if (!user || !user.role) {
      throw new ForbiddenException('Access Denied: Missing structural role allocation profile.');
    }

    // Validate user role clearance levels explicitly
    const hasPermission = requiredRoles.includes(user.role);
    if (!hasPermission) {
      throw new ForbiddenException(
        `Access Denied: Operational node context requires permissions matching [${requiredRoles.join(', ')}].`
      );
    }

    return true;
  }
}