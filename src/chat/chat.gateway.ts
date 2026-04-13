import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: 'chat', // Removed the leading slash, Nest handles this
  cors: {
    origin: [
      'http://localhost:3000',
      'https://aviore-frontend-v2.vercel.app',
      process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
  },
  // 🛡️ Remove the hardcoded transports: ['websocket'] 
  // Allow the default (polling -> upgrade to websocket)
  allowEIO3: true, 
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  /**
   * PRESENCE REGISTRY
   * userId -> socketId
   */
  private readonly onlineUsers = new Map<string, string>();

  constructor(private readonly chatService: ChatService) {}

  /**
   * SOCKET CONNECTION HANDSHAKE
   */
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;

      if (!token) {
        throw new Error('Missing token');
      }

      const user = await this.chatService.verifyToken(token);

      if (!user?.id) {
        throw new Error('Invalid user');
      }

      client.data.user = user;

      /**
       * REGISTER ONLINE USER
       */
      this.onlineUsers.set(user.id, client.id);

      /**
       * PRIVATE INBOX ROOM
       */
      client.join(`inbox_${user.id}`);

      this.logger.log(`ONLINE: ${user.email}`);
    } catch (error: any) {
      this.logger.warn(`Connection refused: ${error?.message}`);
      client.disconnect();
    }
  }

  /**
   * SOCKET DISCONNECT HANDLER
   */
  handleDisconnect(client: Socket) {
    const userId = client.data.user?.id;

    if (userId) {
      this.onlineUsers.delete(userId);
    }

    this.logger.log(`OFFLINE: ${client.id}`);
  }

  /**
   * CHECK VENDOR ONLINE STATUS
   */
  @SubscribeMessage('checkVendorStatus')
  async checkVendorStatus(
    @MessageBody() vendorUserId: string,
    @ConnectedSocket() client: Socket,
  ) {
    const isOnline = this.onlineUsers.has(vendorUserId);

    client.emit('vendorStatus', {
      online: isOnline,
    });

    return {
      status: 'success',
      online: isOnline,
    };
  }

  /**
   * JOIN CONVERSATION ROOM
   */
  @SubscribeMessage('joinConversation')
  async handleJoinRoom(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.user?.id;

    if (!userId) {
      throw new WsException('Identity_Token_Expired');
    }

    const isParticipant = await this.chatService.isParticipant(
      conversationId,
      userId,
    );

    if (!isParticipant) {
      throw new WsException('Forbidden_Registry_Access');
    }

    client.join(conversationId);

    this.logger.log(
      `ROOM JOINED: user=${userId} room=${conversationId}`,
    );

    return {
      event: 'joined',
      room: conversationId,
    };
  }

  /**
   * SEND MESSAGE
   */
  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId?: string;
      orderId?: string;
      vendorId?: string;
      content: string;
      senderRole: 'USER' | 'VENDOR';
      tempId?: string;
    },
  ) {
    try {
      const senderId = client.data.user?.id;

      if (!senderId) {
        throw new WsException('Unauthorized_Transmission');
      }

      if (!payload.content?.trim()) {
        throw new WsException('Empty_Payload');
      }

      let conversation: any;

      /**
       * CREATE NEW CONVERSATION
       */
      if (
        !payload.conversationId &&
        payload.orderId &&
        payload.vendorId
      ) {
        conversation =
          await this.chatService.initiateConversation({
            orderId: payload.orderId,
            userId: senderId,
            vendorId: payload.vendorId,
            content: payload.content,
          });

        client.join(conversation.id);
      }

      /**
       * EXISTING CONVERSATION
       */
      else if (payload.conversationId) {
        conversation = await this.chatService.saveMessage({
          conversationId: payload.conversationId,
          content: payload.content,
          senderRole: payload.senderRole,
          senderId,
        });
      } else {
        throw new WsException('Identity_References_Missing');
      }

      const convId =
        payload.conversationId || conversation.id;

      const latestMessage = conversation.messages
        ? conversation.messages[
            conversation.messages.length - 1
          ]
        : conversation;

      const broadcastPayload = {
        ...latestMessage,
        conversationId: convId,
        tempId: payload.tempId,
      };

      /**
       * ROOM BROADCAST
       */
      this.server
        .to(convId)
        .emit('newMessage', broadcastPayload);

      /**
       * SIDEBAR INBOX SYNC
       */
      const recipientId =
        await this.chatService.getRecipientId(
          convId,
          senderId,
        );

      if (recipientId) {
        this.server
          .to(`inbox_${recipientId}`)
          .emit('inbox_sync', {
            conversationId: convId,
            snippet: payload.content,
            updatedAt: broadcastPayload.createdAt,
          });
      }

      return {
        status: 'delivered',
        conversationId: convId,
      };
    } catch (error: any) {
      this.logger.error(
        `Transmission Failure: ${
          error?.message || 'Unknown error'
        }`,
      );

      return {
        error: error?.message || 'Sync_Failure',
      };
    }
  }
}