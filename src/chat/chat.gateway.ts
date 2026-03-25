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
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
  namespace: '/chat',
  transports: ['websocket'],
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly chatService: ChatService) {}

  /**
   * IDENTITY HANDSHAKE
   * Validates the node and secures the session
   */
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) throw new Error('Missing_Handshake_Token');

      const user = await this.chatService.verifyToken(token);
      
      // CRITICAL: Ensure the user object has a valid primary key
      if (!user || !user.id) throw new Error('Invalid_Identity_Payload');

      client.data.user = user; 
      
      // Join a private signaling room for inbox updates
      client.join(`inbox_${user.id}`);
      
      this.logger.log(`⚡ Node Synchronized: ${user.email}`);
    } catch (err) {
      this.logger.warn(`❌ Connection Refused: ${err.message}`);
      client.disconnect(); 
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Node Offline: ${client.id}`);
  }

  /**
   * CHANNEL REGISTRY
   * Links the authenticated node to a specific conversation stream
   */
  @SubscribeMessage('joinConversation')
  async handleJoinRoom(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.user?.id;
    if (!userId) throw new WsException('Identity_Token_Expired');

    const isParticipant = await this.chatService.isParticipant(conversationId, userId);
    
    if (isParticipant) {
      client.join(conversationId);
      this.logger.log(`📡 Node ${userId} joined room ${conversationId}`);
      return { event: 'joined', room: conversationId };
    }
    
    throw new WsException('Forbidden_Registry_Access');
  }

  /**
   * ATOMIC MESSAGE RELAY
   * Handles first-time DB creation and standard message persistence
   */
  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { 
      conversationId?: string; 
      orderId?: string;        
      vendorId?: string;       
      content: string; 
      senderRole: 'USER' | 'VENDOR';
      tempId?: string; 
    },
  ) {
    try {
      // 1. IDENTITY RESOLUTION
      const senderId = client.data.user?.id;
      if (!senderId) throw new WsException('Unauthorized_Transmission');
      if (!payload.content?.trim()) throw new WsException('Empty_Payload');

      let conversation;

      // 2. ATOMIC SYNC (Fixes Prisma senderId error)
      if (!payload.conversationId && payload.orderId && payload.vendorId) {
        // SCENARIO: First message initialization
        conversation = await this.chatService.initiateConversation({
          orderId: payload.orderId,
          userId: senderId,
          vendorId: payload.vendorId,
          content: payload.content,
        });
        
        // Auto-join the newly minted CUID room
        client.join(conversation.id);
      } else if (payload.conversationId) {
        // SCENARIO: Standard message relay
        conversation = await this.chatService.saveMessage({
          conversationId: payload.conversationId,
          content: payload.content,
          senderRole: payload.senderRole,
          senderId: senderId, // Explicitly passed to fix line 92 error
        });
      } else {
        throw new WsException('Identity_References_Missing');
      }

      // 3. DATA NORMALIZATION
      const convId = payload.conversationId || conversation.id;
      const latestMessage = conversation.messages 
        ? conversation.messages[conversation.messages.length - 1] 
        : conversation;

      // 4. MULTICAST BROADCAST
      const broadcastPayload = {
        ...latestMessage,
        conversationId: convId,
        tempId: payload.tempId 
      };

      this.server.to(convId).emit('newMessage', broadcastPayload);
      
      // 5. INBOX SIGNALING (For Recipient Sidebar)
      const recipientId = await this.chatService.getRecipientId(convId, senderId);
      if (recipientId) {
        this.server.to(`inbox_${recipientId}`).emit('inbox_sync', {
          conversationId: convId,
          snippet: payload.content,
          updatedAt: broadcastPayload.createdAt
        });
      }

      return { status: 'delivered', conversationId: convId };
    } catch (error) {
      this.logger.error(`Transmission Failure: ${error.message}`);
      return { error: error.message || 'Sync_Failure' };
    }
  }
}