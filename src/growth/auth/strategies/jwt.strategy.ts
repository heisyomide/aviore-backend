// src/growth/auth/strategies/jwt.strategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      // 1. Extract the bearer token from the incoming request authorization headers
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // 2. Ensure this matches the exact secret string or env variable used when signing your tokens
      secretOrKey: process.env.JWT_SECRET || 'aviore-fallback-super-secret-key', 
    });
  }

  /**
   * Passport automatically invokes this hook after successfully validating the token signature.
   * Whatever object is returned here is bound directly to execution context as `req.user`
   */
  async validate(payload: any) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid or malformed ecosystem authentication payload.');
    }

    return { 
      id: payload.sub, // Maps standard JWT 'sub' to req.user.id
      teamCode: payload.teamCode,
      role: payload.role 
    };
  }
}