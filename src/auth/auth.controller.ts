import { 
  Controller, Post, Body, HttpCode, HttpStatus, Req,
  Get, UseGuards, Request 
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

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() loginDto: LoginDto, 
    @Req() req: Request // <--- Add this to capture the request data
  ) {
    // Pass both the login data and the request object to the service
    return this.authService.login(loginDto, req);
  }

  // --- PROFILE ---
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    // req.user contains { sub, email, role, vendorId } from the JWT strategy
    return req.user;
  }
}