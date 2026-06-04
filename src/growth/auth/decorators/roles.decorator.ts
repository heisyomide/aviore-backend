// src/growth/auth/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { MarketerRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: MarketerRole[]) => SetMetadata(ROLES_KEY, roles);