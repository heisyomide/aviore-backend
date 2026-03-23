import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET, // Using that unique secret you generated
    });
  }

async validate(payload: any) {
  // Changing 'userId' to 'id' to match the rest of your controllers
  return { id: payload.sub, email: payload.email, role: payload.role };
}
}