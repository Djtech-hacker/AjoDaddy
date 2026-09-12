// ============================================================
// SUPPORT MODULE
// ============================================================
import {
  Module, Controller, Get, Post, Patch, Body, Param, Query, Req,
  UseGuards, Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.module';
import { AdminGuard } from '../admin/admin.module';
import { CustomerServiceGuard } from '../disputes/disputes.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';

export class CreateTicketDto {
  @IsString() subject: string;
  @IsString() message: string;
  @IsOptional() @IsEnum(['LOW','MEDIUM','HIGH','URGENT']) priority?: string;
}
export class ReplyTicketDto { @IsString() message: string; }
export class UpdateTicketStatusDto { @IsEnum(['OPEN','IN_PROGRESS','RESOLVED','CLOSED']) status: string; }
export class AddInternalNoteDto {
  @IsString() content: string;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() fileName?: string;
  @IsOptional() fileSize?: number;
}
export class EscalateTicketDto { @IsOptional() @IsString() note?: string; }

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── User-facing ──────────────────────────────────────────
  async createTicket(userId: string, dto: CreateTicketDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: { userId, subject: dto.subject, priority: (dto.priority as any) || 'MEDIUM' },
    });
    await this.prisma.ticketReply.create({ data: { ticketId: ticket.id, authorId: userId, isAdminReply: false, message: dto.message } });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'TICKET_CREATED', entityType: 'SupportTicket', entityId: ticket.id, metadata: { subject: dto.subject } } });
    return ticket;
  }

  async getMyTickets(userId: string) {
    return this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async getTicketDetail(ticketId: string, requestingUserId?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (requestingUserId && ticket.userId !== requestingUserId) throw new ForbiddenException();
    const replies = await this.prisma.ticketReply.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
    return { ticket, replies };
  }

  async replyAsUser(userId: string, ticketId: string, dto: ReplyTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.userId !== userId) throw new NotFoundException('Ticket not found');
    await this.prisma.ticketReply.create({ data: { ticketId, authorId: userId, isAdminReply: false, message: dto.message } });
    if (['RESOLVED','CLOSED'].includes(ticket.status)) {
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'OPEN' } });
    }
    return { message: 'Reply added' };
  }

  // ── Customer Service ──────────────────────────────────────
  async csGetTickets(params: { status?: string; page?: number; limit?: number; assignedToId?: string }) {
    const { status, page = 1, limit = 20, assignedToId } = params;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status === 'ESCALATED') { where.escalatedAt = { not: null }; where.status = { notIn: ['RESOLVED','CLOSED'] }; }
    else if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.supportTicket.count({ where }),
    ]);
    const userIds = [...new Set(tickets.map(t => t.userId))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, email: true, firstName: true, lastName: true } }) : [];
    const userMap = new Map(users.map(u => [u.id, u]));
    return {
      tickets: tickets.map(t => ({ ...t, user: userMap.get(t.userId) || null })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async csGetTicketDetail(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const [replies, notes, user] = await Promise.all([
      this.prisma.ticketReply.findMany({
        where: { ticketId },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, firstName: true, lastName: true, username: true, role: true } } },
      }),
      this.prisma.internalNote.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findUnique({ where: { id: ticket.userId }, select: { id: true, username: true, email: true, firstName: true, lastName: true } }),
    ]);
    return { ticket, replies, notes, user };
  }

  async csReply(staffId: string, ticketId: string, dto: ReplyTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.prisma.ticketReply.create({ data: { ticketId, authorId: staffId, isAdminReply: true, message: dto.message } });
    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'IN_PROGRESS' } });
    await this.prisma.auditLog.create({ data: { actorId: staffId, action: 'TICKET_REPLY_SENT', entityType: 'SupportTicket', entityId: ticketId, metadata: { preview: dto.message.slice(0, 100) } } });
    await this.notificationsService.create({ userId: ticket.userId, type: 'SYSTEM', title: 'Support replied to your ticket', body: dto.message.slice(0, 140), data: { ticketId } }).catch(() => {});
    return { message: 'Reply sent' };
  }

   async addInternalNote(staffId: string, ticketId: string, dto: AddInternalNoteDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const note = await this.prisma.internalNote.create({ data: { ticketId, authorId: staffId, content: dto.content, fileUrl: dto.fileUrl, fileName: dto.fileName, fileSize: dto.fileSize } });
    await this.prisma.auditLog.create({ data: { actorId: staffId, action: 'INTERNAL_NOTE_ADDED', entityType: 'SupportTicket', entityId: ticketId, metadata: { noteId: note.id } } });
    return note;
  }

  async getInternalNotes(ticketId: string) {
    const notes = await this.prisma.internalNote.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
    const authorIds = [...new Set(notes.map(n => n.authorId))];
    const authors = authorIds.length ? await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, firstName: true, lastName: true, username: true, role: true } }) : [];
    const aMap = new Map(authors.map(a => [a.id, a]));
    return notes.map(n => ({ ...n, author: aMap.get(n.authorId) || null }));
  }

  async escalateTicket(staffId: string, ticketId: string, dto: EscalateTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.escalatedAt) throw new ForbiddenException('Already escalated');

    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { escalatedAt: new Date(), escalatedById: staffId, status: 'IN_PROGRESS' } });
    if (dto.note) await this.prisma.internalNote.create({ data: { ticketId, authorId: staffId, content: `[ESCALATION NOTE] ${dto.note}` } });
    await this.prisma.auditLog.create({ data: { actorId: staffId, action: 'TICKET_ESCALATED_TO_ADMIN', entityType: 'SupportTicket', entityId: ticketId, metadata: { note: dto.note } } });

    const admins = await this.prisma.user.findMany({ where: { role: { in: ['ADMIN','SUPER_ADMIN'] } }, select: { id: true } });
    await Promise.allSettled(admins.map(a => this.notificationsService.create({ userId: a.id, type: 'SYSTEM', title: '📋 Ticket escalated by CS', body: `"${ticket.subject}"${dto.note ? ' — ' + dto.note : ''}`, data: { ticketId } })));
    return { message: 'Escalated to Admin queue' };
  }

  async assignTicket(actorId: string, ticketId: string, assigneeId: string) {
    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { assignedToId: assigneeId } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'TICKET_ASSIGNED', entityType: 'SupportTicket', entityId: ticketId, metadata: { assigneeId } } });
    return { message: 'Assigned' };
  }

  async updateStatus(actorId: string, ticketId: string, status: string) {
    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: status as any, resolvedAt: ['RESOLVED','CLOSED'].includes(status) ? new Date() : null },
    });
    await this.prisma.auditLog.create({ data: { actorId, action: 'TICKET_STATUS_CHANGED', entityType: 'SupportTicket', entityId: ticketId, metadata: { status } } });
    return ticket;
  }

  async userCloseTicket(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.userId !== userId) throw new NotFoundException('Ticket not found');
    if (!['RESOLVED','IN_PROGRESS','OPEN'].includes(ticket.status)) throw new BadRequestException('Ticket cannot be closed at this stage');
    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'CLOSED', resolvedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'TICKET_CLOSED_BY_USER', entityType: 'SupportTicket', entityId: ticketId } });
    return { message: 'Ticket closed' };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoCloseResolvedTickets() {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await this.prisma.supportTicket.updateMany({
      where: { status: 'RESOLVED', resolvedAt: { lte: threeDaysAgo } },
      data: { status: 'CLOSED' },
    });
  }

  // ── Admin — Escalation Queue ──────────────────────────────
  async getEscalationQueue(page = 1, limit = 20) {
    const [escalatedTickets, escalatedDisputes, totalT, totalD] = await Promise.all([
      this.prisma.supportTicket.findMany({ where: { escalatedAt: { not: null }, status: { notIn: ['RESOLVED','CLOSED'] } }, orderBy: { escalatedAt: 'desc' } }),
      this.prisma.dispute.findMany({ where: { status: 'ESCALATED' }, orderBy: { escalatedAt: 'desc' } }),
      this.prisma.supportTicket.count({ where: { escalatedAt: { not: null }, status: { notIn: ['RESOLVED','CLOSED'] } } }),
      this.prisma.dispute.count({ where: { status: 'ESCALATED' } }),
    ]);

    const allUserIds = [...new Set([
      ...escalatedTickets.map(t => t.userId),
      ...escalatedTickets.map(t => t.escalatedById).filter(Boolean),
      ...escalatedDisputes.map(d => d.reporterId),
      ...escalatedDisputes.map(d => d.reportedUserId).filter(Boolean),
      ...escalatedDisputes.map(d => d.escalatedById).filter(Boolean),
    ])] as string[];

    const users = allUserIds.length ? await this.prisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, username: true, firstName: true, email: true } }) : [];
    const uMap = new Map(users.map(u => [u.id, u]));

    return {
      tickets: escalatedTickets.map(t => ({ ...t, _kind: 'ticket', user: uMap.get(t.userId) || null, escalatedBy: t.escalatedById ? uMap.get(t.escalatedById) || null : null })),
      disputes: escalatedDisputes.map(d => ({ ...d, _kind: 'dispute', reporter: uMap.get(d.reporterId) || null, reportedUser: d.reportedUserId ? uMap.get(d.reportedUserId) || null : null, escalatedBy: d.escalatedById ? uMap.get(d.escalatedById) || null : null })),
      totals: { tickets: totalT, disputes: totalD, total: totalT + totalD },
    };
  }
}

// ── Controllers ───────────────────────────────────────────────

@ApiTags('Support') @Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}
  @Post('tickets') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  create(@Req() req: any, @Body() dto: CreateTicketDto) { return this.supportService.createTicket(req.user.id, dto); }
  @Get('tickets') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  getMine(@Req() req: any) { return this.supportService.getMyTickets(req.user.id); }
  @Get('tickets/:id') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  getDetail(@Req() req: any, @Param('id') id: string) { return this.supportService.getTicketDetail(id, req.user.id); }
  @Post('tickets/:id/reply') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  replyAsUser(@Req() req: any, @Param('id') id: string, @Body() dto: ReplyTicketDto) { return this.supportService.replyAsUser(req.user.id, id, dto); }
  @Patch('tickets/:id/close') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  closeTicket(@Req() req: any, @Param('id') id: string) { return this.supportService.userCloseTicket(req.user.id, id); }
}

@ApiTags('CS Tickets') @Controller('cs/tickets') @UseGuards(JwtAuthGuard, CustomerServiceGuard) @ApiBearerAuth()
export class CSTicketsController {
  constructor(private readonly supportService: SupportService) {}
  @Get() getAll(@Query('status') status?: string, @Query('page') page = 1, @Query('limit') limit = 20, @Query('assignedToId') assignedToId?: string) { return this.supportService.csGetTickets({ status, page: +page, limit: +limit, assignedToId }); }
  @Get(':id') getDetail(@Param('id') id: string) { return this.supportService.csGetTicketDetail(id); }
  @Post(':id/reply') reply(@Req() req: any, @Param('id') id: string, @Body() dto: ReplyTicketDto) { return this.supportService.csReply(req.user.id, id, dto); }
  @Post(':id/notes') addNote(@Req() req: any, @Param('id') id: string, @Body() dto: AddInternalNoteDto) { return this.supportService.addInternalNote(req.user.id, id, dto); }
  @Get(':id/notes') getNotes(@Param('id') id: string) { return this.supportService.getInternalNotes(id); }
  @Patch(':id/escalate') escalate(@Req() req: any, @Param('id') id: string, @Body() dto: EscalateTicketDto) { return this.supportService.escalateTicket(req.user.id, id, dto); }
  @Patch(':id/assign') assign(@Req() req: any, @Param('id') id: string, @Body('assigneeId') assigneeId: string) { return this.supportService.assignTicket(req.user.id, id, assigneeId); }
  @Patch(':id/status') updateStatus(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTicketStatusDto) { return this.supportService.updateStatus(req.user.id, id, dto.status); }
}

@ApiTags('Admin Escalation') @Controller('admin/escalation-queue') @UseGuards(JwtAuthGuard, AdminGuard) @ApiBearerAuth()
export class AdminEscalationController {
  constructor(private readonly supportService: SupportService) {}
  @Get() getQueue(@Query('page') page = 1, @Query('limit') limit = 50) { return this.supportService.getEscalationQueue(+page, +limit); }
}

// Admin can view/act on tickets — including replying to escalated ones
@ApiTags('Admin Support') @Controller('admin/support') @UseGuards(JwtAuthGuard, AdminGuard) @ApiBearerAuth()
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}
  @Get('tickets') getAll(@Query('status') s?: string, @Query('page') p = 1, @Query('limit') l = 20) { return this.supportService.csGetTickets({ status: s, page: +p, limit: +l }); }
  @Get('tickets/:id') getDetail(@Param('id') id: string) { return this.supportService.csGetTicketDetail(id); }
  @Get('tickets/:id/notes') getNotes(@Param('id') id: string) { return this.supportService.getInternalNotes(id); }
  @Post('tickets/:id/notes') addNote(@Req() req: any, @Param('id') id: string, @Body() dto: AddInternalNoteDto) { return this.supportService.addInternalNote(req.user.id, id, dto); }

  // ── NEW: lets Admin/Super Admin reply on an escalated ticket ──
  // Reuses csReply(), which marks isAdminReply: true, sets status
  // IN_PROGRESS, notifies the user, and writes the TICKET_REPLY_SENT
  // audit log entry — same behavior as the CS reply endpoint, just
  // reachable by Admin/Super Admin roles too.
  @Post('tickets/:id/reply') reply(@Req() req: any, @Param('id') id: string, @Body() dto: ReplyTicketDto) { return this.supportService.csReply(req.user.id, id, dto); }

  @Patch('tickets/:id/status') updateStatus(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTicketStatusDto) { return this.supportService.updateStatus(req.user.id, id, dto.status); }
}

@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, CSTicketsController, AdminEscalationController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}