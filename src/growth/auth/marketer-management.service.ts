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
      // 3. Save the new operator node into the schema layout
      const newMarketer = await this.prisma.marketer.create({
        data: {
          name,
          teamCode: creatorTeamCode, // Forces sub-marketers into the creator's team cluster
          passcodeHash,
          role: 'SUB_MARKETER',
          status: 'ACTIVE',
          wallet: { create: { balance: 0.0 } }, // Instantly spins up their ledger row
        },
      });

      // 4. Return the plain text passcode ONLY HERE so the creator can copy it
      return {
        message: 'Sub-marketer account successfully created.',
        id: newMarketer.id,
        name: newMarketer.name,
        teamCode: newMarketer.teamCode,
        role: newMarketer.role,
        generatedPasscode: rawPasscode, // 💡 Show this on the frontend layout once!
      };
    } catch (error) {
      // Catch Prisma unique constraint violations (e.g. rare passcode collision in same team)
      if (error.code === 'P2002') {
        throw new ConflictException('A signature conflict occurred. Please submit the request again.');
      }
      throw error;
    }
  }
}