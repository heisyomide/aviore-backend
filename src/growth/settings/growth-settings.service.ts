// src/growth/settings/growth-settings.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class GrowthSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves systemic view settings for a specific cluster node
   */
  async getOperatorSettings(marketerId: string) {
    const marketer = await this.prisma.marketer.findUnique({
      where: { id: marketerId },
      include: { settings: true },
    });

    if (!marketer) {
      throw new NotFoundException('Growth operator node not found');
    }

    // If a SUB_MARKETER is querying strategy details, pull the baseline configuration limits set by their cluster HEAD
    let strategyAllocation = 20;
    let crossVoucherLimit = 5;

    if (marketer.role === 'HEAD') {
      strategyAllocation = marketer.settings?.globalAllocationSplit ?? 20;
      crossVoucherLimit = marketer.settings?.voucherSignLimit ?? 5;
    } else {
      const headNode = await this.prisma.marketer.findFirst({
        where: { teamCode: marketer.teamCode, role: 'HEAD' },
        include: { settings: true },
      });
      strategyAllocation = headNode?.settings?.globalAllocationSplit ?? 20;
      crossVoucherLimit = headNode?.settings?.voucherSignLimit ?? 5;
    }

    return {
      role: marketer.role,
      status: marketer.status,
      profile: {
        fullName: marketer.name,
        systemNodeTagId: marketer.teamCode,
        email: `${marketer.teamCode.toLowerCase()}@node.ecosystem`, // Fallback or pull from an internal communication property
      },
      settlementNode: {
        bankInstitution: marketer.bankName || 'Access Bank Plc',
        accountNumber: marketer.accountNumber || '',
        verifiedAccountHolder: marketer.accountName || marketer.name.toUpperCase(),
      },
      notifications: {
        onVendorSignup: marketer.settings?.onVendorSignup ?? true,
        onSaleDelivered: marketer.settings?.onSaleDelivered ?? true,
        onPayoutSettled: marketer.settings?.onPayoutSettled ?? true,
        weeklyDigest: marketer.settings?.weeklyDigest ?? false,
      },
      privilegedStrategy: {
        globalTeamAllocationSplit: strategyAllocation,
        voucherMultiSignLimit: crossVoucherLimit,
      },
    };
  }

  /**
   * Persists data changes using a transaction block. 
   * Updates to cluster configurations will propagate instantly to all sub-marketers sharing the same team code.
   */
  async updateOperatorSettings(marketerId: string, dto: UpdateSettingsDto) {
    const marketer = await this.prisma.marketer.findUnique({
      where: { id: marketerId },
    });

    if (!marketer) {
      throw new NotFoundException('Growth operator node not found');
    }

    const checkingPrivilegedAlterations = 
      dto.globalTeamAllocationSplit !== undefined || dto.voucherMultiSignLimit !== undefined;

    if (checkingPrivilegedAlterations && marketer.role !== 'HEAD') {
      throw new ForbiddenException(
        'Advanced Adjustments Locked: Strategy configuration matrices can only be modified by the designated cluster HEAD.',
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. Process identity endpoint settings updates
      await tx.marketer.update({
        where: { id: marketerId },
        data: {
          bankName: dto.bankInstitution,
          accountNumber: dto.accountNumber,
        },
      });

      // 2. Persist private notification rules
      await tx.marketerSettings.upsert({
        where: { marketerId: marketer.id },
        update: {
          onVendorSignup: dto.notifications.onVendorSignup,
          onSaleDelivered: dto.notifications.onSaleDelivered,
          onPayoutSettled: dto.notifications.onPayoutSettled,
          weeklyDigest: dto.notifications.weeklyDigest ?? false,
        },
        create: {
          marketerId: marketer.id,
          onVendorSignup: dto.notifications.onVendorSignup,
          onSaleDelivered: dto.notifications.onSaleDelivered,
          onPayoutSettled: dto.notifications.onPayoutSettled,
          weeklyDigest: dto.notifications.weeklyDigest ?? false,
        },
      });

      // 3. Cascade critical strategy configurations down to all sub-marketer nodes if changed by HEAD
      if (marketer.role === 'HEAD' && checkingPrivilegedAlterations) {
        const clusterNodes = await tx.marketer.findMany({
          where: { teamCode: marketer.teamCode },
        });

        for (const node of clusterNodes) {
          await tx.marketerSettings.upsert({
            where: { marketerId: node.id },
            update: {
              globalAllocationSplit: dto.globalTeamAllocationSplit ?? 20,
              voucherSignLimit: dto.voucherMultiSignLimit ?? 5,
            },
            create: {
              marketerId: node.id,
              globalAllocationSplit: dto.globalTeamAllocationSplit ?? 20,
              voucherSignLimit: dto.voucherMultiSignLimit ?? 5,
            },
          });
        }
      }

      return { success: true, message: 'Cluster settings updated successfully.' };
    });
  }
}