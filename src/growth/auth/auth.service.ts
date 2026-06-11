// src/growth/auth/auth.service.ts
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { Marketer } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class GrowthAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

async validateTeamMember(loginDto: LoginDto): Promise<{ accessToken: string }> {
  const { teamCode, passcode } = loginDto;

  console.log('====================================');
  console.log('🔑 [GROWTH AUTH INIT] Request Parameters:');
  console.log('Incoming TeamCode:', teamCode);
  console.log('Incoming Passcode Type:', typeof passcode, `(Length: ${passcode?.length})`);
  console.log('====================================');

  // 1. Fetch matching active growth profiles using the indexed team identifier
  const clusterMembers = await this.prisma.marketer.findMany({
    where: { 
      teamCode: teamCode, 
      // 💡 Temporarily comment out status filter to see if records exist but are inactive
      // status: 'ACTIVE' 
    },
  });

  console.log(`📊 [GROWTH AUTH DB SNAPSHOT] Found ${clusterMembers.length} records matching teamCode: "${teamCode}"`);
  if (clusterMembers.length > 0) {
    console.log('Sample Account Record Statuses:', clusterMembers.map(m => ({ id: m.id, status: m.status })));
  }
  console.log('====================================');

  if (!clusterMembers || clusterMembers.length === 0) {
    throw new UnauthorizedException('Invalid Team Code or verification parameters.');
  }

  // 2. Compute matching hashes sequentially across the specific team cluster pool
  let authenticatedMember: Marketer | null = null;
  for (const member of clusterMembers) {
    const isMatch = await bcrypt.compare(passcode, member.passcodeHash);
    if (isMatch) {
      authenticatedMember = member;
      break;
    }
  }

  if (!authenticatedMember) {
    throw new UnauthorizedException('Authentication credentials failed signature matching.');
  }

  // 3. Encode matching fields into payload
  const tokenPayload = {
    sub: authenticatedMember.id,
    id: authenticatedMember.id,  
    name: authenticatedMember.name,
    teamCode: authenticatedMember.teamCode,
    role: authenticatedMember.role,
  };

  return {
    accessToken: this.jwtService.sign(tokenPayload, {
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      expiresIn: '12h',
    }),
  };
}
async getProfile(marketerId: string) {
    // Isolated lookup focusing purely on confirmed native table metrics
    const marketer = await this.prisma.marketer.findUnique({
      where: { id: marketerId },
      select: {
        id: true,
        name: true,
        teamCode: true,
        role: true,
        status: true,
      },
    });

    if (!marketer) {
      throw new NotFoundException('Marketer profile session could not be verified.');
    }

    return {
      success: true,
      data: {
        id: marketer.id,
        name: marketer.name,
        teamCode: marketer.teamCode,
        role: marketer.role,
        status: marketer.status,
        // Provided cleanly as a static root fallback to eliminate type bugs entirely
        avatarUrl: '/images/mock-avatar.jpg',
      },
    };
  }
}