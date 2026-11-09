import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/auth.module';
import { VendorActiveGuard } from '../../vendors/guards/vendor-active.guard';
import { SsChatService } from './ss-chat.service';
import { SendChatMessageDto } from './dto/chat.dto';

// Chat between a customer and a vendor. A chat can start before the customer buys.
// Only those two people can use a thread (the service checks this on every call).
@ApiTags('Small Small: Chat')
@Controller('small-small/chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SsChatController {
  constructor(private readonly chat: SsChatService) {}

  // The customer taps "Message the vendor" on a product
  @Post('product/:productId')
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Open (or reopen) a chat with the vendor of a product' })
  startForProduct(@Req() req: any, @Param('productId') productId: string) {
    return this.chat.startProductChat(req.user.id, productId);
  }

  // The vendor's inbox
  @Get('vendor/threads')
  @UseGuards(VendorActiveGuard)
  @ApiOperation({ summary: 'All conversations customers started with me' })
  vendorThreads(@Req() req: any) {
    return this.chat.listVendorThreads(req.user.id);
  }

  // Every conversation I am part of (as a customer or as a vendor)
  @Get('threads')
  @ApiOperation({ summary: 'All my conversations, newest first, with unread counts' })
  myThreads(@Req() req: any) {
    return this.chat.listMyThreads(req.user.id);
  }

  // The number shown on the Messages button
  @Get('unread-count')
  @ApiOperation({ summary: 'How many unread messages I have' })
  unread(@Req() req: any) {
    return this.chat.unreadCount(req.user.id);
  }

  @Get(':threadId/messages')
  @ApiOperation({ summary: 'The latest messages in a chat (also marks them as read)' })
  list(@Req() req: any, @Param('threadId') threadId: string) {
    return this.chat.listMessages(req.user.id, threadId);
  }

  @Post(':threadId/messages')
  @Throttle({ long: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a message in a chat' })
  send(@Req() req: any, @Param('threadId') threadId: string, @Body() dto: SendChatMessageDto) {
    return this.chat.sendMessage(req.user.id, threadId, dto.content);
  }

  @Delete(':threadId/messages/:messageId')
  @ApiOperation({ summary: 'Delete one of my own messages' })
  remove(@Req() req: any, @Param('threadId') threadId: string, @Param('messageId') messageId: string) {
    return this.chat.deleteMessage(req.user.id, threadId, messageId);
  }
}