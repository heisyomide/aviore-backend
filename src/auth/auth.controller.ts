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
async login(@Body() dto: LoginDto, @Req() req: any, @Res() res: any) {
  const result = await this.authService.login(dto, req);

  res.cookie('refresh_token', result.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });

  return res.json({
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
@Post('refresh')
async refresh(@Req() req: any) {
  const refreshToken = req.cookies?.['refresh_token'];
  const sessionId = req.cookies?.['session_id']; // Ensure you are setting this cookie on login

  if (!refreshToken || !sessionId) {
    throw new UnauthorizedException('Missing required refresh credentials');
  }

  // Pass both arguments as defined in auth.service.ts
  return this.authService.refresh(sessionId, refreshToken);
}

@UseGuards(JwtAuthGuard)
@Post('logout')
logout(@Request() req) {
  return this.authService.logout(req.user.sessionId);
}
}