// src/growth/auth/marketer-management.service.ts
import { Injectable, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { RegisterMarketerDto } from './dto/register-marketer.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class MarketerManagementService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generates a secure, random 6-digit numeric string
   */
  private generateSecurePasscode(): string {
    // Generates a random number between 100000 and 999999 securely
    const num = crypto.randomInt(100000, 1000000);
    return num.toString();
  }

  /**
   * Allows an existing HEAD marketer to spawn a SUB_MARKETER inside their own team cluster.
   */
 async createSubMarketer(creatorId: string, creatorTeamCode: string, name: string) {
  // 1. Generate the raw passcode
  const rawPasscode = this.generateSecurePasscode();
  
  // 2. Hash it before it hits your Neon PostgreSQL layer
  const saltRounds = 10;
  const passcodeHash = await bcrypt.hash(rawPasscode, saltRounds);

  try {
    // 3. Count existing sub-marketers in this specific team cluster to get the next index
    const subMarketerCount = await this.prisma.marketer.count({
      where: { 
        teamCode: creatorTeamCode,
        role: 'SUB_MARKETER'
      }
    });

    // 4. Calculate sequential index (e.g., count 0 becomes "01", count 1 becomes "02")
    const nextSequence = String(subMarketerCount + 1).padStart(2, '0');
    const uniqueTrackingTag = `${creatorTeamCode}${nextSequence}`; // e.g., "TEAM_IO01"

    // 5. Save the new operator node into the schema layout
    const newMarketer = await this.prisma.marketer.create({
      data: {
        name,
        teamCode: creatorTeamCode, // Keeps them inside the main structural group cluster
        trackingTag: uniqueTrackingTag, // 🎯 The explicit individual referral tracking tag
        passcodeHash,
        role: 'SUB_MARKETER',
        status: 'ACTIVE',
        wallet: { create: { balance: 0.0 } }, // Instantly spins up their ledger row
      },
    });

    // 6. Return structured precisely with a success flag and data wrapper matching frontend expectations
    return {
      success: true,
      message: 'Sub-marketer account successfully created.',
      data: {
        id: newMarketer.id,
        name: newMarketer.name,
        code: newMarketer.trackingTag, // 🎯 Pass the sequential tag "TEAM_IO01" to the front-end display!
        role: newMarketer.role,
        passcode: rawPasscode, // Show this on the frontend layout once!
      },
    };
  } catch (error) {
    // Catch Prisma unique constraint violations
    if (error.code === 'P2002') {
      throw new ConflictException('A tracking signature conflict occurred. Please submit the request again.');
    }
    throw error;
  }
}
}