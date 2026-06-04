// src/growth/tools/growth-tools.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class GrowthToolsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates localized marketing codes, dynamic vendor tracking links, 
   * and context-aware pitch copy frameworks for growth team tiers.
   */
  async getMarketingResources(marketerId: string) {
    // 1. Fetch user tracking metadata straight from the database
    const user = await this.prisma.user.findUnique({
      where: { id: marketerId },
      select: { 
        referralCode: true, 
        firstName: true, 
        lastName: true 
      },
    });

    // 2. Pure Tracking Logic: Ensure a structural code exists. 
    // If it's missing, fall back to a clean string using their real profile data instead of checking roles.
    const trackingCode = user?.referralCode || `AVR-${user?.firstName?.toUpperCase() || 'MARKETER'}-NODE`;

    // 3. Environment Context Setup (Targeting your verified merchant staging domain)
    const baseDomain = process.env.FRONTEND_URL || 'https://shopaviore.store';
    const referralLink = `${baseDomain}/join/vendor?ref=${trackingCode}`;

    // 4. Generate context-aware pitch frameworks tailored for Vendor Onboarding
    const pitchTemplates = [
      {
        id: 1,
        label: 'Premium Luxury Merchant Pitch',
        text: `Hello! I am partnering with AVIORÈ, Africa's premier digital marketplace for luxury and premium retail. We're launching an exclusive ecosystem that connects top-tier designers and high-end boutiques with discerning buyers across the region. Setting up your store takes less than 5 minutes, and once you upload your first 5 products, your catalog goes live to a highly curated customer base. Secure your verified storefront wrapper today using our priority registration code: ${trackingCode}`,
      },
      {
        id: 2,
        label: 'Logistics & Fulfillment First Pitch',
        text: `Scale your premium retail brand with AVIORÈ. Beyond a stunning, custom-branded digital storefront, our network provides integrated third-party logistics (3PL) and Southwest regional distribution nodes engineered specifically to handle high-value luxury goods seamlessly. Register your brand today using my direct track link: ${referralLink}`,
      },
    ];

    // 5. Define static media assets catalog
    const mediaKitAssets = [
      {
        title: 'AVIORÈ Core Logomark Pack',
        description: 'High-definition master assets including light/dark variants and isolated primary icons.',
        type: 'IMAGE',
        sizeOrFormat: 'SVG / PNG • 4.2 MB',
        downloadUrl: `${baseDomain}/assets/downloads/aviore-logo-kit.zip`,
      },
      {
        title: 'Luxury Merchant Onboarding Brochure',
        description: 'A premium guide breaking down commission tiers, escrow clearings, and setup guidelines.',
        type: 'DOCUMENT',
        sizeOrFormat: 'PDF Document • 1.8 MB',
        downloadUrl: `${baseDomain}/assets/downloads/merchant-onboarding-guide.pdf`,
      },
    ];

    return {
      trackingCode,
      referralLink,
      pitchTemplates,
      mediaKitAssets,
    };
  }
}