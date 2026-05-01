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

  const hashedPassword = await bcrypt.hash(password, 12);

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

  // 1. METADATA
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
    this.prisma.loginLog.create({
      data: { email, ip, userAgent, status: 'FAILED' },
    }).catch(() => {});

    throw new UnauthorizedException('INVALID_CREDENTIALS');
  }

  // ✅ 4. GENERATE SESSION ID FIRST
  const sessionId = crypto.randomUUID();

  // ✅ 5. TOKEN PAYLOAD
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    sessionId, // VERY IMPORTANT
  };

  // ✅ 6. GENERATE TOKENS
  const accessToken = await this.jwtService.signAsync(payload, {
    expiresIn: '15m',
  });

  const refreshToken = await this.jwtService.signAsync(payload, {
    expiresIn: '7d',
  });

  const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);

  // ✅ 7. BACKGROUND TASKS (NON-BLOCKING)
  Promise.all([
    // login log
    this.prisma.loginLog.create({
      data: { email, ip, userAgent, status: 'SUCCESS' },
    }),

    // 🔥 IMPORTANT: reset previous current session
    this.prisma.session.updateMany({
      where: { userId: user.id, isCurrent: true },
      data: { isCurrent: false },
    }),

    // ✅ CREATE NEW SESSION
    this.prisma.session.create({
      data: {
        id: sessionId, // 🔥 LINK TO JWT
        userId: user.id,
        device: userAgent,
        ipAddress: ip,
        lastUsed: new Date(),
        refreshToken: hashedRefreshToken,
        isCurrent: true,
      },
    }),

    // email alert
    this.mailService.sendLoginAlert(user.email, {
      ip,
      device: userAgent,
      name: user.firstName || 'User',
    }),
  ]).catch((err) => {
    console.error('🔴 Background Task Error:', err.message);
  });

  // ✅ 8. RETURN RESPONSE
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
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
private extractClientIp(req: any): string {
  const forwardedFor = req.headers?.['x-forwarded-for'];

  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0].trim();
  }

  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.raw?.ip ||
    '0.0.0.0'
  );
}

async refresh(sessionId: string, refreshToken: string) {
  const session = await this.prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new UnauthorizedException('Session not found');
  }

  const isMatch = await bcrypt.compare(refreshToken, session.refreshToken);

  if (!isMatch) {
    throw new UnauthorizedException('Invalid refresh token');
  }

  const user = await this.prisma.user.findUnique({
    where: { id: session.userId },
  });

  if (!user) {
    throw new UnauthorizedException();
  }

  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    sessionId: session.id,
  };

  // rotate token (VERY IMPORTANT)
  const newRefreshToken = await this.jwtService.signAsync(payload, {
    expiresIn: '7d',
  });

  const hashed = await bcrypt.hash(newRefreshToken, 10);

  await this.prisma.session.update({
    where: { id: session.id },
    data: {
      refreshToken: hashed,
      lastUsed: new Date(),
    },
  });

  const newAccessToken = await this.jwtService.signAsync(payload, {
    expiresIn: '15m',
  });

  return {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
  };
}

async logout(sessionId: string) {
  await this.prisma.session.delete({
    where: { id: sessionId },
  });

  return { message: 'Logged out successfully' };
}
}