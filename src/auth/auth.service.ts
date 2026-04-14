import { Injectable, UnauthorizedException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, UserRole } from './dto/register.dto'; // Ensure you have this DTO
import * as bcrypt from 'bcrypt';
import { UsersService } from 'src/users/users.service';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private usersService: UsersService,
    private mailService: MailService
  ) {}

async register(registerDto: RegisterDto) {
  const { email, password, role, firstName, lastName, storeName } = registerDto;

  // 1. PRE-FLIGHT CHECK
  // Do this before opening a transaction to save DB resources
  const existingUser = await this.prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ConflictException('An account with this email already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    // 2. STRICTURED TRANSACTION
    // Only put Database operations in here. No Email, No Logs, No External APIs.
    const newUser = await this.prisma.$transaction(async (tx) => {
      return await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          role: role || UserRole.CUSTOMER,
          ...(role === UserRole.VENDOR && {
            vendor: {
              create: {
                storeName: storeName || (firstName ? `${firstName}'s Shop` : email.split('@')[0]),
                vendorWallet: { create: {} },
              },
            },
          }),
        },
        include: { vendor: true },
      });
    });

    // 3. ASYNCHRONOUS POST-PROCESS
    // Trigger the email AFTER the transaction is committed.
    // We don't "await" this in a way that blocks the return to the user.
    this.mailService.sendWelcomeEmail(newUser.email, {
      name: newUser.firstName || 'User',
      role: newUser.role,
    }).catch(err => {
      // Log the error but don't stop the user from logging in
      console.error('🔴 Background Mail Error:', err.message);
    });

    // Return immediately so the frontend can move to the next screen
    return newUser;

  } catch (error: any) {
    if (error.code === 'P2002') {
      throw new ConflictException('This store name is already taken.');
    }
    throw new InternalServerErrorException('Registration failed. Please try again.');
  }
}

// src/auth/auth.service.ts



async login(loginDto: LoginDto, req: any) {
  const { email, password } = loginDto;
  
  // 1. EXTRACT METADATA IMMEDIATELY
  const ip = this.extractClientIp(req);
  const userAgent = req.headers?.['user-agent'] || 'Unknown Device';

  // 2. FETCH USER
  const user = await this.prisma.user.findUnique({
    where: { email },
    include: {
      vendor: {
        select: { id: true, isVerified: true, kycStatus: true },
      },
    },
  });

  // 3. VALIDATE PASSWORD
  const isPasswordValid = user && (await bcrypt.compare(password, user.password));

  if (!user || !isPasswordValid) {
    // Fire and forget the failed log so it doesn't slow down the error response
    this.prisma.loginLog.create({
      data: { email, ip, userAgent, status: 'FAILED' },
    }).catch(() => {}); 

    throw new UnauthorizedException('INVALID_CREDENTIALS');
  }

  // 4. BACKGROUND TASKS (Fire and Forget)
  // We remove 'await' from Promise.all to prevent blocking the HTTP response.
  // This is the "Grandmaster" move for speed.
  Promise.all([
    this.prisma.loginLog.create({
      data: { email, ip, userAgent, status: 'SUCCESS' },
    }),
    this.usersService.recordSession(user.id, userAgent, ip),
    this.mailService.sendLoginAlert(user.email, {
      ip,
      device: userAgent,
      name: user.firstName || 'User',
    }),
  ]).catch((err) => {
    // Log background errors without affecting the user's login experience
    console.error('🔴 Post-Login Background Task Failed:', err.message);
  });

  // 5. SIGN TOKEN & RETURN
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    vendorId: user.vendor?.id || null,
  };

  const accessToken = await this.jwtService.signAsync(payload);

  return {
    access_token: accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      vendorId: user.vendor?.id || null,
      isVerified: user.vendor?.isVerified || false,
      kycStatus: user.vendor?.kycStatus || 'NOT_SUBMITTED',
    },
  };
}
private extractClientIp(
  req: any,
): string {
  const forwardedFor =
    req.headers?.[
      'x-forwarded-for'
    ];

  if (
    typeof forwardedFor ===
    'string'
  ) {
    return forwardedFor
      .split(',')[0]
      .trim();
  }

  return (
    req.ip ||
    req.connection
      ?.remoteAddress ||
    req.raw?.ip ||
    '0.0.0.0'
  );
}
  
}