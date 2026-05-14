// src/common/decorators/get-cookies.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetCookies = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return data ? request.cookies?.[data] : request.cookies;
  },
);