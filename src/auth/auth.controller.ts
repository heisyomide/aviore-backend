import { 
  Controller, Post, Body, HttpCode, HttpStatus, Req,
  Get, UseGuards, Request, 
  UnauthorizedException,
  Res
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    // We can remove UsersService here if AuthService handles registration
  ) {}

  // --- REGISTRATION ---
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    // Let AuthService handle the "ConflictException" and "Vendor Creation"
    const newUser = await this.authService.register(registerDto);

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
  @Res() res: any,
) {
  // 1. AUTH SERVICE
  const result = await this.authService.login(dto, req);

  // 2. ENV CHECK
  const isProd = process.env.NODE_ENV === 'production';

  // 3. REFRESH TOKEN COOKIE
  res.cookie('refresh_token', result.refresh_token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  // 4. SESSION ID COOKIE
  res.cookie('session_id', result.session_id, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  // 5. RESPONSE
  return res.status(HttpStatus.OK).json({
    success: true,
    message: 'Login successful',

    access_token: result.access_token,

    user: result.user,
  });
}
  // --- PROFILE ---
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    // req.user contains { sub, email, role, vendorId } from the JWT strategy
    return req.user;
  }


@Post('refresh')
async refresh(
  @Req() req: any,
  @Res() res: any,
) {
  const refreshToken =
    req.cookies?.['refresh_token'];

  const sessionId =
    req.cookies?.['session_id'];

  if (!refreshToken || !sessionId) {
    throw new UnauthorizedException(
      'Missing required refresh credentials',
    );
  }

  const result = await this.authService.refresh(
    sessionId,
    refreshToken,
  );

  const isProd =
    process.env.NODE_ENV === 'production';

  // 🔥 ROTATE REFRESH TOKEN COOKIE
  res.cookie(
    'refresh_token',
    result.refresh_token,
    {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  );

  // session_id remains same
  res.cookie(
    'session_id',
    sessionId,
    {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  );

  return res.json({
    access_token: result.access_token,
  });
}

@UseGuards(JwtAuthGuard)
@Post('logout')
logout(@Request() req) {
  return this.authService.logout(req.user.sessionId);
}
}