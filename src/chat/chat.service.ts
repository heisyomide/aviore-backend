import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  /**
   * IDENTITY VERIFICATION
   * Normalizes the JWT payload so the 'id' field is always present.
   */
  async verifyToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      
      // CRITICAL: Normalization Protocol
      // If the ID is hidden in 'sub' (Passport default), we map it to 'id' 
      // so the Gateway logic doesn't crash.
      return {
        ...payload,
        id: payload.id || payload.sub, 
        email: payload.email
      };
    } catch (e) {
      throw new UnauthorizedException('Invalid_Registry_Token');
    }
  }

  /**
   * ACCESS PROTOCOL
   * Validates if the human node (userId) is authorized for this channel.
   */
  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await this.prisma.orderConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, vendorId: true }
    });

    if (!conversation) return false;
    
    // Direct check for Buyer node
    if (conversation.userId === userId) return true;

    // Deep check for Merchant owner node
    const vendorRecord = await this.prisma.vendor.findUnique({
      where: { id: conversation.vendorId },
      select: { userId: true }
    });

    return vendorRecord?.userId === userId;
  }

  /**
   * INITIALIZATION HANDSHAKE (Ghost-Proof)
   * Prevents empty database rows by only creating the registry on first message.
   */
  async initiateConversation(data: { 
    orderId: string; 
    userId: string; 
    vendorId: string; 
    content: string 
  }) {
    return this.prisma.$transaction(async (tx) => {
      return await tx.orderConversation.create({
        data: {
          orderId: data.orderId,
          userId: data.userId,
          vendorId: data.vendorId,
          messages: {
            create: {
              content: data.content,
              senderRole: 'USER',
              senderId: data.userId, 
            }
          }
        },
        include: {
          messages: true,
          order: { select: { id: true } }
        }
      });
    });
  }

  /**
   * PERSISTENCE PROTOCOL
   * Logs individual message artifacts and heartbeats the channel.
   */
  async saveMessage(data: { 
    conversationId: string; 
    content: string; 
    senderRole: string; 
    senderId: string 
  }) {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.orderMessage.create({
        data: {
          conversationId: data.conversationId,
          content: data.content,
          senderRole: data.senderRole,
          senderId: data.senderId,
        },
      });

      // Transmit heartbeat to the main registry
      await tx.orderConversation.update({
        where: { id: data.conversationId },
        data: { updatedAt: new Date() },
      });

      return message;
    });
  }

  /**
   * ROUTING PROTOCOL
   * Maps the recipient human ID for private socket emission.
   */
  async getRecipientId(conversationId: string, senderId: string): Promise<string | null> {
    const convo = await this.prisma.orderConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, vendorId: true }
    });

    if (!convo) return null;

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: convo.vendorId },
      select: { userId: true }
    });

    const vendorUserId = vendor?.userId ?? null;

    // Logic: Route to the human currently NOT sending the message
    return senderId === convo.userId ? vendorUserId : convo.userId;
  }
}