import { Injectable, UnauthorizedException, ConflictException, InternalServerErrorException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, UserRole } from './dto/register.dto'; // Ensure you have this DTO
import * as bcrypt from 'bcrypt';
import { UsersService } from 'src/users/users.service';
import { MailProcessor, MailService } from 'src/mail/mail.service';
import * as crypto from 'crypto';
import { ReferralService } from 'src/referral/referral.service';
import { NotificationService } from 'src/notification/notification.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private usersService: UsersService,
    private mailService: MailService,
    private readonly referralService: ReferralService,
    private notificationService: NotificationService
  ) {}


async processForgotPassword(email: string): Promise<{ message: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

  const genericResponse = { 
    message: 'If an account matches this email, a secure recovery layout link has been dispatched.' 
  };
  
  if (!user) return genericResponse;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      resetTokenHash: tokenHash,
      resetTokenExpires: expiresAt,
    },
  });

  const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetLink = `${frontendBaseUrl}/reset-password?token=${rawToken}`;

  // Instantiate dummy styling engine references to pass layout templates context down seamlessly
  const processorMock = new MailProcessor();

  // 🟢 SYNCHRONOUSLY MONITORED RUNTIME COUPLING
// Inside your auth controller / service:
this.mailService.sendPasswordResetEmailDirectly(user.email, {
  name: user.firstName || 'User',
  resetLink,
})
.then(() => {
  console.log(`✅ SUCCESS LOG: Recovery template transferred to Brevo relay directly for ${user.email}`);
})
.catch((mailError) => {
  console.error('❌ CRITICAL RECOVERY SMTP DISPATCH ERROR:', {
    message: mailError.message,
    code: mailError.code,
    command: mailError.command,
    response: mailError.response,
    timestamp: new Date().toISOString()
  });
});

  return genericResponse;
}

  async executePasswordReset(dto: any): Promise<{ success: boolean; message: string }> {
    // Hash the incoming URL query parameter token to match against the DB record hash
    const incomingHash = crypto.createHash('sha256').update(dto.token).digest('hex');

    // Query for a matching hash where the token expiration timestamp hasn't passed yet
    const user = await this.prisma.user.findFirst({
      where: {
        resetTokenHash: incomingHash,
        resetTokenExpires: { gte: new Date() }, // Active validation timeframe check
      },
    });

    if (!user) {
      // 🟢 ADVANCED SECURITY: Return generic message so hackers don't know why it failed
      throw new BadRequestException('Security token context is invalid or has expired.');
    }

    // Hash the new credential password securely with 12 rounds
    const hashedNewPassword = await bcrypt.hash(dto.password, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedNewPassword,
        resetTokenHash: null,    // 🟢 ADVANCED SECURITY: Immediately burn token on first use
        resetTokenExpires: null, // Clear expiration parameters completely
      },
    });

    return { 
      success: true, 
      message: 'Authorization pool updated successfully. Please proceed to login.' 
    };
  }



async verifyUserEmailDirect(userId: string) {
    // 1. Fetch the targeted registration account to ensure it exists
    const updatedUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!updatedUser) {
      throw new NotFoundException('No user identity matched the requested execution parameters.');
    }

    if (updatedUser.isEmailVerified) {
      return { success: true, message: 'Identity has already been authorized and activated.' };
    }

    // 2. Commit status changes directly onto the active User row entry
    await this.prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true },
    });

    // 3. BACKGROUND POST-PROCESS: Safely invoke growth validation algorithms out-of-band
    this.referralService.processReferralQualification(userId).catch((err) => {
      console.error('🔴 Background Referral Qualification Error:', err.message);
    });

return {
    success: true,
    message: 'Email verified successfully',
    user: updatedUser // 👈 Pass the db record down the line here
  };
  }


async register(registerDto: RegisterDto) {
  const {
    email,
    password,
    role,
    firstName,
    middleName,   // 🌟 FIX: Extract middleName
    lastName,
    phone,        // 🌟 FIX: Extract phone number
    dob,          // 🌟 FIX: Extract dob string timestamp
    storeName,
    referralCode,
    ipAddress,
    deviceFingerprint,
  } = registerDto;

  console.log('==========================');
  console.log('REGISTER REQUEST RECEIVED');
  console.log('EMAIL:', email);
  console.log('REFERRAL CODE:', referralCode);
  console.log('ROLE:', role);
  console.log('IP:', ipAddress);
  console.log('FINGERPRINT:', deviceFingerprint);
  console.log('==========================');

  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = await this.prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw new ConflictException(
      'An account with this email already exists',
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const generatedReferralCode =
    this.referralService.generateSecureReferralCode();

  // Variable to track the marketer relation mapping if this is a vendor account
  let connectedMarketerId: string | null = null;

  // Verify if an affiliate team node match exists for incoming vendors
  if (role === UserRole.VENDOR && referralCode) {
    const activeMarketerNode = await this.prisma.marketer.findFirst({
      where: {
        teamCode: referralCode.trim().toUpperCase(),
        status: 'ACTIVE',
      },
    });

    if (activeMarketerNode) {
      connectedMarketerId = activeMarketerNode.id;
      console.log(`AFFILIATE ROUTE MATCHED: Connecting Vendor to Marketer ID ${connectedMarketerId}`);
    } else {
      console.log(`WARNING: Referral code '${referralCode}' passed but no active Marketer match found.`);
    }
  }

  try {
    const newUser = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        firstName,
        middleName: middleName || null, // 🌟 FIX: Map to User Model Schema
        lastName,
        phone: phone ? phone.trim() : null, // 🌟 FIX: Map to User Model Schema
        dob: dob ? new Date(dob) : null, // 🌟 FIX: Convert your ISO String to native JavaScript Date Object
        role: role || UserRole.CUSTOMER,

        referralCode: generatedReferralCode,

        signupIp: ipAddress || null,
        deviceFingerprint: deviceFingerprint || null,

        ...(role === UserRole.VENDOR && {
          vendor: {
            create: {
              storeName:
                storeName ||
                (firstName
                  ? `${firstName}'s Shop`
                  : normalizedEmail.split('@')[0]),
              
              // If a marketer node was found, hook up the nested relational database connection link
              ...(connectedMarketerId && {
                marketer: {
                  connect: { id: connectedMarketerId }
                }
              }),

              vendorWallet: {
                create: {},
              },
            },
          },
        }),
      },

      include: {
        vendor: true,
      },
    });

    console.log(
      'NEW USER CREATED:',
      newUser.id,
    );

    // Standard user-to-user customer referrals process (remains untouched)
    if (
      referralCode &&
      role !== UserRole.VENDOR
    ) {
      console.log(
        'STARTING CLIENT REFERRAL PROCESS:',
        referralCode,
      );

      await this.referralService.handleUserSignupReferral(
        newUser.id,
        referralCode,
        ipAddress || '',
        deviceFingerprint || null,
      );

      console.log(
        'REFERRAL PROCESS COMPLETED',
      );
    } else {
      console.log(
        'AFFILIATE OR CLEAN ACCOUNT DETECTED. BYPASSING CUSTOMER REFERRAL GENERATION.',
      );
    }

    this.mailService
      .sendWelcomeEmail(newUser.email, {
        name:
          newUser.firstName || 'User',
        role: newUser.role,
      })
      .catch((err) => {
        console.error(
          'MAIL ERROR:',
          err.message,
        );
      });

      // At the bottom of your register() method inside auth.service.ts, before returning:
const registrationToken = this.jwtService.sign(
  { 
    sub: newUser.id, 
    email: newUser.email,
    purpose: 'REGISTRATION_ONBOARDING' // 👈 Scope identifier
  },
  { expiresIn: '5m' } // 👈 Expires quickly
);

// Return both the user data and the token
return {
  user: newUser,
  onboardingToken: registrationToken,
};

  } catch (error: any) {
    // 🌟 ENHANCEMENT: This will print the raw database error directly to your console logs so you see exactly what failed.
    console.error(
      '❌ [CRITICAL DATABASE WRITE EXCEPTION]:',
      error?.message || error,
    );

    if (error.code === 'P2002') {
      throw new ConflictException(
        'This store name or unique constraint identifier is already taken.',
      );
    }

    if (
      error instanceof BadRequestException
    ) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Registration pipeline failure: ${error?.message || 'Database execution fault'}`,
    );
  }
}
// src/auth/auth.service.ts



async login(loginDto: LoginDto, req: any) {
  const { email, password } = loginDto;

  // =========================
  // REQUEST METADATA
  // =========================
  const ip = this.extractClientIp(req);
  const userAgent =
    req.headers?.['user-agent'] || 'Unknown Device';

  // =========================
  // FIND USER
  // =========================
  const user = await this.prisma.user.findUnique({
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

  // =========================
  // INVALID USER
  // =========================
  if (!user) {
    this.prisma.loginLog.create({
      data: {
        email,
        ip,
        userAgent,
        status: 'FAILED',
      },
    }).catch(() => {});

    throw new UnauthorizedException(
      'Invalid email or password',
    );
  }

  // =========================
  // PASSWORD CHECK
  // =========================
  const isPasswordValid = await bcrypt.compare(
    password,
    user.password,
  );

  if (!isPasswordValid) {
    this.prisma.loginLog.create({
      data: {
        email,
        ip,
        userAgent,
        status: 'FAILED',
      },
    }).catch(() => {});

    throw new UnauthorizedException(
      'Invalid email or password',
    );
  }

  // =========================
  // GENERATE SESSION ID
  // =========================
  const sessionId = crypto.randomUUID();

  // =========================
  // JWT PAYLOAD
  // =========================
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    sessionId,
  };

  // =========================
  // TOKENS
  // =========================
  const accessToken =
    await this.jwtService.signAsync(payload, {
      expiresIn: '1d',
    });

  const refreshToken =
    await this.jwtService.signAsync(payload, {
      expiresIn: '30d',
    });

  // =========================
  // HASH REFRESH TOKEN
  // =========================
  const hashedRefreshToken =
    await bcrypt.hash(refreshToken, 10);

  // =========================
  // DATABASE OPERATIONS
  // =========================
  try {
    // login log
    await this.prisma.loginLog.create({
      data: {
        email,
        ip,
        userAgent,
        status: 'SUCCESS',
      },
    });

    // reset previous sessions
    await this.prisma.session.updateMany({
      where: {
        userId: user.id,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });

    // create new session
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        device: userAgent,
        ipAddress: ip,
        lastUsed: new Date(),
        refreshToken: hashedRefreshToken,
        isCurrent: true,
      },
    });

  } catch (err: any) {
    console.error(
      'LOGIN SESSION ERROR:',
      err.message,
    );

    throw new InternalServerErrorException(
      'Failed to initialize session',
    );
  }

  // =========================
  // BACKGROUND EMAIL
  // =========================
  this.mailService.sendLoginAlert(user.email, {
    ip,
    device: userAgent,
    name: user.firstName || 'User',
  }).catch((err) => {
    console.error(
      'MAIL SERVICE ERROR:',
      err.message,
    );
  });

this.notificationService.send({
    userId: user.id,
    userEmail: user.email,
    title: '🔒 New Login Detected',
    message: `A new login session was opened from ${userAgent} (${ip}). If this wasn't you, secure your account immediately.`,
    category: 'security', // Categorized securely so it overrides normal toggle suppressions if needed
  }).catch((err) => {
    console.error('NOTIFICATION SERVICE ERROR:', err.message);
  });
  // =========================
  // RESPONSE
  // =========================
  return {
    access_token: accessToken,

    refresh_token: refreshToken,

    session_id: sessionId,

    user: {
      id: user.id,
      email: user.email,
      role: user.role,

      firstName: user.firstName,
      lastName: user.lastName,

      vendorId: user.vendor?.id || null,

      isVerified:
        user.vendor?.isVerified || false,

      kycStatus:
        user.vendor?.kycStatus ||
        'NOT_SUBMITTED',
    },
  };
}


// ====================================
// REFRESH TOKEN
// ====================================
async refresh(
  sessionId: string,
  refreshToken: string,
) {
  // =========================
  // FIND SESSION
  // =========================
  const session =
    await this.prisma.session.findUnique({
      where: {
        id: sessionId,
      },
    });

  if (!session) {
    throw new UnauthorizedException(
      'Session not found',
    );
  }

  // =========================
  // VERIFY REFRESH TOKEN
  // =========================
  const isMatch = await bcrypt.compare(
    refreshToken,
    session.refreshToken,
  );

  if (!isMatch) {
    throw new UnauthorizedException(
      'Invalid refresh token',
    );
  }

  // =========================
  // FIND USER
  // =========================
  const user = await this.prisma.user.findUnique({
    where: {
      id: session.userId,
    },
  });

  if (!user) {
    throw new UnauthorizedException(
      'User not found',
    );
  }

  // =========================
  // NEW PAYLOAD
  // =========================
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    sessionId: session.id,
  };

  // =========================
  // GENERATE NEW TOKENS
  // =========================
  const newAccessToken =
    await this.jwtService.signAsync(payload, {
      expiresIn: '1d',
    });

  const newRefreshToken =
    await this.jwtService.signAsync(payload, {
      expiresIn: '30d',
    });

  // =========================
  // HASH NEW REFRESH TOKEN
  // =========================
  const hashedRefreshToken =
    await bcrypt.hash(newRefreshToken, 10);

  // =========================
  // UPDATE SESSION
  // =========================
  try {
    await this.prisma.session.update({
      where: {
        id: session.id,
      },
      data: {
        refreshToken: hashedRefreshToken,
        lastUsed: new Date(),
      },
    });
  } catch (err: any) {
    console.error(
      'REFRESH SESSION ERROR:',
      err.message,
    );

    throw new InternalServerErrorException(
      'Failed to refresh session',
    );
  }

  // =========================
  // RESPONSE
  // =========================
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
private extractClientIp(req: any): string {

    const forwardedFor = req.headers?.['x-forwarded-for'];

    if (typeof forwardedFor === 'string') {

      return forwardedFor.split(',')[0].trim();

    }

    return (

      req.ip ||

      req.connection?.remoteAddress ||

      req.socket?.remoteAddress ||

      '0.0.0.0'

    );

  }

}

