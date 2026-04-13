import { Injectable, UnauthorizedException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, UserRole } from './dto/register.dto'; // Ensure you have this DTO
import * as bcrypt from 'bcrypt';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AuthService {
  mailService: any;
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

async register(registerDto: RegisterDto) {
  const { email, password, role, firstName, lastName, storeName } = registerDto;

  // 1. Initial check for existing user
  const existingUser = await this.prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ConflictException('An account with this email already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    // 2. Wrap in a transaction to ensure data integrity
    return await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName, 
          lastName,
          role: role || UserRole.CUSTOMER,
          // 3. Conditional nested creation
          ...(role === UserRole.VENDOR && {
            vendor: {
              create: {
                storeName: storeName || (firstName ? `${firstName}'s Shop` : email.split('@')[0]),
                // Good practice: Initialize a wallet for the vendor here if needed
                vendorWallet: { create: {} } 
              },
            },
          }),
        },
        include: { 
          vendor: true 
        },
      });

      return newUser;
    });
  } catch (error: any) {
    // Handle specific Prisma errors (e.g., P2002 for unique constraint on storeName)
    if (error.code === 'P2002') {
      throw new ConflictException('This store name is already taken. Please choose another.');
    }
    throw new InternalServerErrorException('Registration failed. Please try again.');
  }
}

// src/auth/auth.service.ts



async login(
  loginDto: LoginDto,
  req: any,
) {
  const { email, password } =
    loginDto;

  const ip =
    this.extractClientIp(req);

  const device =
    String(
      req.headers?.['user-agent'] ||
        'Unknown Device'
    );

  const user =
    await this.prisma.user.findUnique({
      where: { email },
      include: {
        vendor: {
          select: {
            id: true,
            isVerified: true,
            kycStatus: true,
          },
        },
      },
    });

  const isPasswordValid =
    user &&
    (await bcrypt.compare(
      password,
      user.password
    ));

  if (!user || !isPasswordValid) {
    await this.prisma.loginLog.create({
      data: {
        email,
        ip,
        userAgent: device,
        status: 'FAILED',
      },
    });

    throw new UnauthorizedException(
      'INVALID_CREDENTIALS'
    );
  }

await Promise.all([
  this.prisma.loginLog.create({
    data: { email, ip, userAgent: device, status: 'SUCCESS' },
  }),

  this.usersService.recordSession(user.id, device, ip),

  // 🔥 ADD THIS: Trigger the login alert email via the queue
  this.mailService.sendLoginAlert(user.email, {
    ip,
    device,
    name: user.firstName || 'User',
  }),


    this.usersService.recordSession(
      user.id,
      device,
      ip
    ),
  ]);

  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    vendorId:
      user.vendor?.id || null,
  };

  const accessToken =
    await this.jwtService.signAsync(
      payload
    );

  return {
    access_token: accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      vendorId:
        user.vendor?.id || null,
      isVerified:
        user.vendor
          ?.isVerified || false,
      kycStatus:
        user.vendor
          ?.kycStatus ||
        'NOT_SUBMITTED',
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