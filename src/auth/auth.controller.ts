import { 
  Controller, Post, Body, HttpCode, HttpStatus, Req,
  Get, UseGuards, 
  UnauthorizedException,
  Res,
  Query,
  UseInterceptors
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

import * as express from 'express'; // 👈 Standard Express typings engine
import { GetCookies } from '../common/decorators/get-cookies.decorator';
import { AntiFraudGuard } from './guard/anti-fraud.guard';
import { FingerprintRateLimitInterceptor } from './interceptors/fingerprint-ratelimit.interceptor';
import { ReferralService } from 'src/referral/referral.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private readonly referralService: ReferralService,
  ) {}

@Get('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Query('token') token: string) {
    // 1. Execute email confirmation logic block
    const result = await this.authService.verifyUserEmailDirect(token);
    
    // 2. 🚀 Safe check: verify that the operation succeeded and the user sub-object exists
    if (result && result.success && result.user) {
      await this.referralService.processReferralQualification(result.user.id);
    }

    // Return the original response footprint so your frontend contract doesn't break
    return {
      success: result.success,
      message: result.message,
    };
  }

  // --- REGISTRATION ---
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto, @Req() req: express.Request) {
    // Extract IP dynamically (accounting for upstream reverse proxies like Nginx/Cloudflare)
    const ipAddress = 
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 
      req.socket.remoteAddress || 
      '';

    // Intercept custom modern frontend client fingerprint headers
    const deviceFingerprint = (req.headers['x-device-fingerprint'] as string) || '';

    // Merge telemetry properties into your data transfer object payload channel
    const userPayload = {
      ...registerDto,
      ipAddress,
      deviceFingerprint,
    };

    const newUser = await this.authService.register(userPayload);

    const { password: _, ...result } = newUser;
    return {
      message: 'User registered successfully',
      user: result,
    };
  }

  // --- LOGIN ---
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FingerprintRateLimitInterceptor) // 🛡️ Rate limit checks via memory layer
  @UseGuards(AntiFraudGuard)                  // 🛡️ Checks user hardware profile context
  async login(
    @Body() dto: LoginDto,
    @Req() req: express.Request, // 👈 FIXED: Swapped NestJS decorator out for real Express type
    @Res({ passthrough: true }) res: express.Response, // 👈 FIXED: Synchronized cleanly with Express namespace
  ) {
    const result = await this.authService.login(dto, req);
    const isProd = process.env.NODE_ENV === 'production';

    // 🍪 Strongly-typed options matching Express engine signatures
    const cookieOptions: express.CookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Days
      path: '/',
    };

    res.cookie('refresh_token', result.refresh_token, cookieOptions);
    res.cookie('session_id', result.session_id, cookieOptions);

    return {
      success: true,
      message: 'Login successful',
      access_token: result.access_token,
      user: result.user,
    };
  }

  // --- PROFILE ---
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: express.Request) { // 👈 FIXED: Clearer typing for custom user objects
    return (req as any).user;
  }

  // --- REFRESH TOKEN ---
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @GetCookies('refresh_token') refreshToken: string,
    @GetCookies('session_id') sessionId: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    if (!refreshToken || !sessionId) {
      throw new UnauthorizedException('Missing required refresh credentials');
    }

    const result = await this.authService.refresh(sessionId, refreshToken);

    const isProd = process.env.NODE_ENV === 'production';
    const cookieOptions: express.CookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    };

    res.cookie('refresh_token', result.refresh_token, cookieOptions);
    res.cookie('session_id', sessionId, cookieOptions);

    return {
      access_token: result.access_token,
    };
  }

  // --- LOGOUT ---
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Req() req: express.Request) { // 👈 FIXED: Aligned type declaration
    return this.authService.logout((req as any).user.sessionId);
  }
}