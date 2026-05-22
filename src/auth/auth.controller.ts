import { 
  Controller, Post, Body, HttpCode, HttpStatus, Req,
  Get, UseGuards, Request, 
  UnauthorizedException,
  Res,
  Query
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import * as express from 'express';
import { GetCookies } from '../common/decorators/get-cookies.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
  ) {}

  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyUserEmailDirect(token);
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
  async login(
    @Body() dto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const result = await this.authService.login(dto, req);
    const isProd = process.env.NODE_ENV === 'production';

    const cookieOptions: express.CookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
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
  getProfile(@Request() req) {
    return req.user;
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
  logout(@Request() req) {
    return this.authService.logout(req.user.sessionId);
  }
}