// src/growth/auth/guards/jwt-auth.guard.ts
import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  UnauthorizedException 
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { MarketerRole } from '@prisma/client';

// Strong type signature ensuring compiler assistance across controllers and handlers
export interface AuthenticatedUserPayload {
  id: string;
  sub: string;
  name: string;
  teamCode: string;
  role: MarketerRole;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUserPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Access Denied: Missing cryptographic identity token.');
    }

    try {
      // Decode and verify using your exact environment growth key vector
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      });
      
      // Normalize layout structure to bridge standard JWT claims cleanly with internal models
      request.user = {
        id: payload.id || payload.sub,
        sub: payload.sub || payload.id,
        name: payload.name,
        teamCode: payload.teamCode,
        role: payload.role as MarketerRole,
      };
    } catch (error) {
      throw new UnauthorizedException('Access Denied: Session token has expired or is invalid.');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}