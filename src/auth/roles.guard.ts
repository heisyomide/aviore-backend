import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  UnauthorizedException, 
  ForbiddenException 
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. PROTOCOL_CHECK: Extract required roles from the metadata registry
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are defined, the route is public (or handled by JWT alone)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 2. IDENTITY_CHECK: Access the request from the HTTP context
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // GUARD_FAIL: If the JwtAuthGuard was skipped or failed
    if (!user) {
      throw new UnauthorizedException('IDENTITY_NOT_FOUND_IN_REGISTRY');
    }

    // 3. AUTHORIZATION_MATCH: Compare user role against required manifest
    const hasPermission = requiredRoles.some((role) => user.role === role);

    if (!hasPermission) {
      throw new ForbiddenException(
        `INSUFFICIENT_PERMISSIONS: Required one of [${requiredRoles.join(', ')}]`
      );
    }

    return true;
  }
}