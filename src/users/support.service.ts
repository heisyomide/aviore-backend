import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  // 1. FAQ Logic
  async getFaqs() {
    return this.prisma.fAQ.findMany();
  }

  // 2. Ticket Logic
  async createTicket(userId: string, data: any) {
    return this.prisma.ticket.create({ data: { userId, ...data } });
  }

  // 3. Live Chat Initialization
  async startOrGetChat(orderId: string, userId: string, vendorId: string) {
    return this.prisma.orderConversation.upsert({
      where: { orderId },
      update: {},
      create: { orderId, userId, vendorId },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
  }

  // 4. Returns Logic
  async createReturn(userId: string, data: any) {
    return this.prisma.returnRequest.create({ data: { userId, ...data } });
  }
}