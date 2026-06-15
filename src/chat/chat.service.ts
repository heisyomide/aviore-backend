import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import { NotificationService } from '../notification/notification.service'; 

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private notificationService: NotificationService 
  ) {}

  /**
   * IDENTITY VERIFICATION
   * Normalizes the JWT payload so the 'id' field is always present.
   */
  async verifyToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
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
    if (conversation.userId === userId) return true;

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
    const conversation = await this.prisma.$transaction(async (tx) => {
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

    // TRIGGER CHAT NOTIFICATION FOR INITIAL MESSAGE
    try {
      const recipientUserId = await this.getRecipientId(conversation.id, data.userId);
      if (recipientUserId) {
        const recipient = await this.prisma.user.findUnique({
          where: { id: recipientUserId },
          select: { email: true, firstName: true }
        });

        // ✅ FIXED: Using true '.vendor' relational selector mapping instead of 'vendorProfile'
        const sender = await this.prisma.user.findUnique({
          where: { id: data.userId },
          select: { 
            firstName: true,
            vendor: {
              select: {
                storeName: true 
              }
            }
          }
        });

        if (recipient) {
          // ✅ FIXED: Safely parsing storeName through the correct relation object matching the schema
          const senderName = (sender as any)?.vendor?.storeName || sender?.firstName || 'A customer';
          
          await this.notificationService.send({
            userId: recipientUserId,
            userEmail: recipient.email,
            title: '📩 New Message on Order',
            message: `${senderName} started a conversation: "${data.content.slice(0, 60)}${data.content.length > 60 ? '...' : ''}"`,
            category: 'chatMessages', 
          });
        }
      }
    } catch (error: any) {
      console.error('🔴 Chat Notification Link Error:', error.message);
    }

    return conversation;
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
    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.orderMessage.create({
        data: {
          conversationId: data.conversationId,
          content: data.content,
          senderRole: data.senderRole,
          senderId: data.senderId,
        },
      });

      await tx.orderConversation.update({
        where: { id: data.conversationId },
        data: { updatedAt: new Date() },
      });

      return msg;
    });

    // TRIGGER CHAT NOTIFICATION FOR RECURRING MESSAGES
    try {
      const recipientUserId = await this.getRecipientId(data.conversationId, data.senderId);
      if (recipientUserId) {
        const recipient = await this.prisma.user.findUnique({
          where: { id: recipientUserId },
          select: { email: true }
        });

        // ✅ FIXED: Selecting both firstName and relational vendor storeName fields
        const sender = await this.prisma.user.findUnique({
          where: { id: data.senderId },
          select: { 
            firstName: true,
            vendor: {
              select: {
                storeName: true
              }
            }
          }
        });

        if (recipient) {
          // ✅ FIXED: Extracted storeName accurately to avoid property 'storeName' does not exist compiler crashes
          const senderName = (sender as any)?.vendor?.storeName || sender?.firstName || 'A user';
          
          await this.notificationService.send({
            userId: recipientUserId,
            userEmail: recipient.email,
            title: `💬 Message from ${senderName}`,
            message: data.content.length > 70 ? `${data.content.slice(0, 70)}...` : data.content,
            category: 'chatMessages',
          });
        }
      }
    } catch (error: any) {
      console.error('🔴 Chat Reply Notification Link Error:', error.message);
    }

    return message;
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

    return senderId === convo.userId ? vendorUserId : convo.userId;
  }
}