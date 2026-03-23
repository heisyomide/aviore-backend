import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * ROLES_KEY Registry
 * Unique identifier for the Roles metadata within the NestJS Reflector.
 */
export const ROLES_KEY = 'roles';

/**
 * @Roles Decorator Protocol
 * * Attaches specific administrative or vendor roles to a route manifest.
 * Used by the RolesGuard to authorize access based on the Identity Registry.
 * * @param roles - One or more Role enums (e.g., Role.ADMIN, Role.VENDOR)
 */
export const Roles = (...roles: Role[]): CustomDecorator<string> => 
  SetMetadata(ROLES_KEY, roles);