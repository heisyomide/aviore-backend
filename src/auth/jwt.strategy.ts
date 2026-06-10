import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret =
      process.env.JWT_SECRET ||
      'AVIORE_MARKETPLACE_SECRET_2026';

    console.log('\n================ JWT STRATEGY ================');
    console.log('JWT STRATEGY LOADED');
    console.log('JWT_SECRET:', process.env.JWT_SECRET);
    console.log('SECRET IN USE:', secret);
    console.log('=============================================\n');

    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    console.log('\n========== JWT VALIDATE ==========');
    console.log('PAYLOAD:', payload);
    console.log('==================================\n');

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sessionId,
    };
  }
}