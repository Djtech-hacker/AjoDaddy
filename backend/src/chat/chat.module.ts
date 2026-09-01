// ============================================================
// CHAT MODULE — Socket.io real-time group chat
// ============================================================

import {
  Module, Controller, Get, Post, Patch, Delete, Body, Req,
  Param, Query, UseGuards, Injectable, ForbiddenException,
  NotFoundException, Logger,
} from '@nestjs/common';
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  MessageBody, ConnectedSocket, OnGatewayInit,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.module';
import { NotificationsService } from '../notifications/notifications.service';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';

export class SendMessageDto {
  @IsString()
  groupId: string;

  @IsOptional() @IsString()
  content?: string;

  @IsEnum(['TEXT', 'IMAGE', 'FILE'])
  type: string;

  @IsOptional() @IsString()
  replyToId?: string;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma:         PrismaService,
    private readonly configService:  ConfigService,
  ) {
    cloudinary.config({
      cloud_name: configService.get('cloudinary.cloudName'),
      api_key:    configService.get('cloudinary.apiKey'),
      api_secret: configService.get('cloudinary.apiSecret'),
    });
  }

  async isMember(userId: string, groupId: string): Promise<boolean> {
    const member = await this.prisma.groupMember.findFirst({
      where: { groupId, userId, status: 'ACTIVE' },
    });
    return !!member;
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    const isMember = await this.isMember(userId, dto.groupId);
    if (!isMember) throw new ForbiddenException('Not a group member');

    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
      select: { chatEnabled: true },
    });
    if (!group?.chatEnabled) throw new ForbiddenException('Chat is disabled for this group');

    if (!dto.content && dto.type === 'TEXT') {
      throw new ForbiddenException('Message content required');
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        groupId:   dto.groupId,
        senderId:  userId,
        type:      dto.type as any,
        content:   dto.content,
        replyToId: dto.replyToId,
      },
      include: {
        sender: {
          select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });

    return message;
  }

  // ── NEW: Edit a message ──────────────────────────────────────
  async editMessage(userId: string, messageId: string, content: string) {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('Cannot edit this message');
    if (message.isDeleted) throw new ForbiddenException('Cannot edit a deleted message');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data:  { content, isEdited: true, updatedAt: new Date() },
      include: {
        sender: {
          select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });

    return updated;
  }

  async getMessages(userId: string, groupId: string, cursor?: string, limit = 50) {
    const isMember = await this.isMember(userId, groupId);
    if (!isMember) throw new ForbiddenException('Not a group member');

    const where: any = { groupId, isDeleted: false };
    if (cursor) where.createdAt = { lt: new Date(cursor) };

    const messages = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        sender: {
          select: { id: true, username: true, firstName: true, avatarUrl: true },
        },
      },
    });

    return {
      messages:   messages.reverse(),
      nextCursor: messages.length === limit ? messages[0]?.createdAt?.toISOString() : null,
    };
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');

    const isAdmin = await this.prisma.groupMember.findFirst({
      where: { groupId: message.groupId, userId, role: { in: ['ADMIN', 'MODERATOR'] }, status: 'ACTIVE' },
    });
    if (message.senderId !== userId && !isAdmin) throw new ForbiddenException('Cannot delete this message');

    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data:  { isDeleted: true, deletedAt: new Date() },
    });

    return { deleted: true };
  }

  async pinMessage(adminId: string, groupId: string, messageId: string) {
    const isAdmin = await this.prisma.groupMember.findFirst({
      where: { groupId, userId: adminId, role: { in: ['ADMIN', 'MODERATOR'] }, status: 'ACTIVE' },
    });
    if (!isAdmin) throw new ForbiddenException('Admin required');

    await this.prisma.pinnedMessage.upsert({
      where:  { groupId_messageId: { groupId, messageId } },
      create: { groupId, messageId, pinnedById: adminId },
      update: {},
    });

    return { pinned: true };
  }

  async getPinnedMessages(userId: string, groupId: string) {
    const isMember = await this.isMember(userId, groupId);
    if (!isMember) throw new ForbiddenException('Not a group member');

    const pinned = await this.prisma.pinnedMessage.findMany({
      where: { groupId },
    });

    if (!pinned.length) return [];

    const messageIds = pinned.map(p => p.messageId);
    const messages = await this.prisma.chatMessage.findMany({
      where: { id: { in: messageIds }, isDeleted: false },
      include: {
        sender: { select: { id: true, username: true, firstName: true, avatarUrl: true } },
      },
    });

    return messages;
  }

  async uploadFile(userId: string, groupId: string, file: Express.Multer.File) {
    const isMember = await this.isMember(userId, groupId);
    if (!isMember) throw new ForbiddenException('Not a group member');

    if (file.size > 10 * 1024 * 1024) throw new ForbiddenException('File too large (max 10MB)');

    return new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:         `paypaddy/groups/${groupId}/chat`,
          resource_type:  'auto',
          transformation: file.mimetype.startsWith('image/')
            ? [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' }]
            : undefined,
        },
        (error, result) => {
          if (error) reject(error);
          else if (result) resolve({
            url:      result.secure_url,
            publicId: result.public_id,
            mimeType: file.mimetype,
            fileName: file.originalname,
            fileSize: file.size,
          });
        },
      );
      stream.end(file.buffer);
    });
  }

  async toggleChatLock(adminId: string, groupId: string, lock: boolean) {
    const isAdmin = await this.prisma.groupMember.findFirst({
      where: { groupId, userId: adminId, role: 'ADMIN', status: 'ACTIVE' },
    });
    if (!isAdmin) throw new ForbiddenException('Admin required');

    await this.prisma.group.update({
      where: { id: groupId },
      data:  { chatEnabled: !lock },
    });

    return { chatEnabled: !lock };
  }
}

@WebSocketGateway({
  cors: {
    origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
  namespace: '/ws',
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private connectedUsers = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService:           JwtService,
    private readonly configService:        ConfigService,
    private readonly chatService:          ChatService,
    private readonly prisma:               PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('💬 WebSocket Gateway initialized');
    this.notificationsService.setSocketServer(server);
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
      if (!token) { client.disconnect(); return; }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });

      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);

      if (!this.connectedUsers.has(payload.sub)) {
        this.connectedUsers.set(payload.sub, new Set());
      }
      this.connectedUsers.get(payload.sub)!.add(client.id);

      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      const sockets = this.connectedUsers.get(userId);
      sockets?.delete(client.id);
      if (!sockets?.size) this.connectedUsers.delete(userId);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_group')
  async handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string },
  ) {
    const userId = client.data?.userId;
    if (!userId) return;

    const isMember = await this.chatService.isMember(userId, data.groupId);
    if (!isMember) return { error: 'Not a group member' };

    client.join(`group:${data.groupId}`);
    return { joined: true };
  }

  @SubscribeMessage('leave_group')
  handleLeaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string },
  ) {
    client.leave(`group:${data.groupId}`);
    return { left: true };
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; content: string; type?: string; replyToId?: string },
  ) {
    const userId = client.data?.userId;
    if (!userId) return { error: 'Unauthorized' };

    try {
      const message = await this.chatService.sendMessage(userId, {
        groupId:   data.groupId,
        content:   data.content,
        type:      (data.type || 'TEXT') as any,
        replyToId: data.replyToId,
      });

      this.server.to(`group:${data.groupId}`).emit('new_message', message);
      return { success: true, message };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ── NEW: Edit message via socket ─────────────────────────────
  @SubscribeMessage('edit_message')
  async handleEditMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; messageId: string; content: string },
  ) {
    const userId = client.data?.userId;
    if (!userId) return { error: 'Unauthorized' };

    try {
      const updated = await this.chatService.editMessage(userId, data.messageId, data.content);
      // Broadcast to ALL users in the room (including sender) so every client updates
      this.server.to(`group:${data.groupId}`).emit('message_edited', updated);
      return { success: true, message: updated };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ── NEW: Delete message via socket ───────────────────────────
  @SubscribeMessage('delete_message')
  async handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; messageId: string },
  ) {
    const userId = client.data?.userId;
    if (!userId) return { error: 'Unauthorized' };

    try {
      await this.chatService.deleteMessage(userId, data.messageId);
      // Broadcast to ALL users in the room
      this.server.to(`group:${data.groupId}`).emit('message_deleted', { messageId: data.messageId });
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  @SubscribeMessage('typing_start')
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; username: string },
  ) {
    client.to(`group:${data.groupId}`).emit('user_typing', {
      userId:   client.data?.userId,
      username: data.username,
    });
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string },
  ) {
    client.to(`group:${data.groupId}`).emit('user_stop_typing', {
      userId: client.data?.userId,
    });
  }

  emitContributionUpdate(groupId: string, data: any) {
    this.server.to(`group:${groupId}`).emit('contribution_update', data);
  }

  emitPayoutUpdate(groupId: string, data: any) {
    this.server.to(`group:${groupId}`).emit('payout_update', data);
  }

  isUserOnline(userId: string): boolean {
    return this.connectedUsers.has(userId) && (this.connectedUsers.get(userId)?.size || 0) > 0;
  }
}

@ApiTags('Chat')
@Controller('chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Get(':groupId/messages')
  @ApiOperation({ summary: 'Get paginated group messages' })
  getMessages(
    @Req() req: any,
    @Param('groupId') groupId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = 50,
  ) {
    return this.chatService.getMessages(req.user.id, groupId, cursor, +limit);
  }

  @Get(':groupId/pinned')
  @ApiOperation({ summary: 'Get pinned messages' })
  getPinned(@Req() req: any, @Param('groupId') groupId: string) {
    return this.chatService.getPinnedMessages(req.user.id, groupId);
  }

  @Post(':groupId/messages/:messageId/pin')
  @ApiOperation({ summary: 'Pin a message (admin)' })
  pinMessage(
    @Req() req: any,
    @Param('groupId') groupId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chatService.pinMessage(req.user.id, groupId, messageId);
  }

  // ── NEW: Edit message via REST (fallback for direct API calls) ──
  @Patch(':groupId/messages/:messageId')
  @ApiOperation({ summary: 'Edit a message' })
  async editMessage(
    @Req() req: any,
    @Param('groupId') groupId: string,
    @Param('messageId') messageId: string,
    @Body('content') content: string,
  ) {
    const updated = await this.chatService.editMessage(req.user.id, messageId, content);
    // Also broadcast via socket so real-time users see it
    this.chatGateway.server.to(`group:${groupId}`).emit('message_edited', updated);
    return updated;
  }

  @Delete(':groupId/messages/:messageId')
  @ApiOperation({ summary: 'Delete a message' })
  async deleteMessage(
    @Req() req: any,
    @Param('groupId') groupId: string,
    @Param('messageId') messageId: string,
  ) {
    const result = await this.chatService.deleteMessage(req.user.id, messageId);
    // Also broadcast via socket
    this.chatGateway.server.to(`group:${groupId}`).emit('message_deleted', { messageId });
    return result;
  }

  @Post(':groupId/lock')
  @ApiOperation({ summary: 'Lock/unlock group chat (admin)' })
  toggleLock(
    @Req() req: any,
    @Param('groupId') groupId: string,
    @Body('lock') lock: boolean,
  ) {
    return this.chatService.toggleChatLock(req.user.id, groupId, lock);
  }
}

@Module({
  imports:     [JwtModule, NotificationsModule],
  controllers: [ChatController],
  providers:   [ChatService, ChatGateway],
  exports:     [ChatService, ChatGateway],
})
export class ChatModule {}