import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any) {
    // 🚨 THIS WILL PRINT THE EXACT FAILURE REASON IN YOUR TERMINAL
    if (info) {
      console.error('🔒 [JWT Auth Guard Debug] Passport Failure Reason:', info.message);
    }
    
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication layer validation failed.');
    }
    return user;
  }
}