import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

export const Roles = (
  ...roles: Role[]
): CustomDecorator<string> => {
  console.log(
    '[ROLES DECORATOR]',
    roles,
  );

  return SetMetadata(
    ROLES_KEY,
    roles,
  );
};