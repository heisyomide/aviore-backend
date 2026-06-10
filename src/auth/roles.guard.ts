import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<Role[]>(
        ROLES_KEY,
        [
          context.getHandler(),
          context.getClass(),
        ],
      );

    console.log('\n========== ROLES GUARD ==========');
    console.log(
      'Required Roles:',
      requiredRoles,
    );

    if (
      !requiredRoles ||
      requiredRoles.length === 0
    ) {
      console.log(
        'No role restrictions',
      );

      return true;
    }

    const request =
      context.switchToHttp().getRequest();

    const user = request.user;

    console.log('Request User:', user);

    if (!user) {
      console.log(
        'USER NOT FOUND',
      );

      throw new UnauthorizedException(
        'IDENTITY_NOT_FOUND_IN_REGISTRY',
      );
    }

    const hasPermission =
      requiredRoles.some(
        (role) =>
          user.role === role,
      );

    console.log(
      'User Role:',
      user.role,
    );

    console.log(
      'Has Permission:',
      hasPermission,
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `INSUFFICIENT_PERMISSIONS`
      );
    }

    console.log(
      'ROLE CHECK PASSED',
    );

    return true;
  }
}