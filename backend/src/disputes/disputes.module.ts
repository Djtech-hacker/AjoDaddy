// ============================================================
// DISPUTES MODULE
// ============================================================
import {
  Module, Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, Injectable,
  BadRequestException, NotFoundException, ForbiddenException, CanActivate, ExecutionContext,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.module';
import { AdminGuard } from '../admin/admin.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Injectable()
export class CustomerServiceGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (!['CUSTOMER_SERVICE','ADMIN','SUPER_ADMIN'].includes(req.user?.role)) throw new ForbiddenException('Customer service access required');
    return true;
  }
}

export class CreateDisputeDto {
  @IsString() type: string;
  @IsString() description: string;
  @IsOptional() @IsString() reportedUserId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) evidenceUrls?: string[];
}
export class ResolveDisputeDto { @IsEnum(['RESOLVED','DISMISSED','CLOSED']) status: string; @IsString() resolution: string; }
export class UpdateDisputeStatusDto { @IsEnum(['OPEN','UNDER_REVIEW']) status: string; }
export class EscalateDisputeDto { @IsOptional() @IsString() note?: string; }
export class AddInternalNoteDto { @IsString() content: string; }

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService, private readonly notificationsService: NotificationsService) {}

  async createDispute(reporterId: string, dto: CreateDisputeDto) {
    const dispute = await this.prisma.dispute.create({
      data: { reporterId, type: dto.type, description: dto.description, reportedUserId: dto.reportedUserId, groupId: dto.groupId, evidenceUrls: dto.evidenceUrls || [] },
    });
    await this.prisma.auditLog.create({ data: { actorId: reporterId, action: 'DISPUTE_FILED', entityType: 'Dispute', entityId: dispute.id, metadata: { type: dto.type } } });
    await this.checkAutoEscalation(dto.reportedUserId, dto.groupId);
    return dispute;
  }

  async getMyDisputes(userId: string) {
    return this.prisma.dispute.findMany({ where: { reporterId: userId }, orderBy: { createdAt: 'desc' } });
  }

  async getMyDisputeReplies(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.reporterId !== userId) throw new NotFoundException('Not found');
    const notes = await this.prisma.internalNote.findMany({
      where: {
        disputeId,
        OR: [
          { content: { startsWith: '[REPLY TO REPORTER]' } },
          { content: { startsWith: '[USER REPLY]' } },
        ]
      },
      orderBy: { createdAt: 'asc' },
    });
    return notes.map(n => ({
      ...n,
      isCS: n.content.startsWith('[REPLY TO REPORTER]'),
      content: n.content.replace('[REPLY TO REPORTER] ', '').replace('[USER REPLY] ', ''),
    }));
  }

  async replyToDispute(userId: string, disputeId: string, message: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.reporterId !== userId) throw new NotFoundException('Not found');
    await this.prisma.internalNote.create({ data: { disputeId, authorId: userId, content: `[USER REPLY] ${message}` } });
    if (dispute.assignedToId) {
      await this.notificationsService.create({ userId: dispute.assignedToId, type: 'SYSTEM', title: 'Reporter replied to their report', body: message.slice(0, 140), data: { disputeId } }).catch(() => {});
    }
    return { message: 'Reply sent' };
  }

  async csGetDisputes(params: { status?: string; reportedUserId?: string; groupId?: string; page?: number; limit?: number }) {
    const { status, reportedUserId, groupId, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (reportedUserId) where.reportedUserId = reportedUserId;
    if (groupId) where.groupId = groupId;

    const [disputes, total] = await Promise.all([
      this.prisma.dispute.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.dispute.count({ where }),
    ]);
    const userIds = [...new Set(disputes.flatMap(d => [d.reporterId, d.reportedUserId, d.assignedToId].filter(Boolean)))] as string[];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, email: true } }) : [];
    const uMap = new Map(users.map(u => [u.id, u]));
    return {
      disputes: disputes.map(d => ({ ...d, reporter: uMap.get(d.reporterId) || null, reportedUser: d.reportedUserId ? uMap.get(d.reportedUserId) || null : null, assignedTo: d.assignedToId ? uMap.get(d.assignedToId) || null : null })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async csGetDisputeDetail(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const notes = await this.prisma.internalNote.findMany({ where: { disputeId }, orderBy: { createdAt: 'asc' } });
    const userIds = [dispute.reporterId, dispute.reportedUserId, dispute.assignedToId].filter(Boolean) as string[];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, firstName: true, email: true } }) : [];
    const uMap = new Map(users.map(u => [u.id, u]));
    return { dispute, notes, reporter: uMap.get(dispute.reporterId) || null, reportedUser: dispute.reportedUserId ? uMap.get(dispute.reportedUserId) || null : null };
  }

  async addDisputeNote(staffId: string, disputeId: string, dto: AddInternalNoteDto) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const note = await this.prisma.internalNote.create({ data: { disputeId, authorId: staffId, content: dto.content } });
    await this.prisma.auditLog.create({ data: { actorId: staffId, action: 'DISPUTE_NOTE_ADDED', entityType: 'Dispute', entityId: disputeId, metadata: { noteId: note.id } } });
    return note;
  }

  async getDisputeNotes(disputeId: string) {
    return this.prisma.internalNote.findMany({ where: { disputeId }, orderBy: { createdAt: 'asc' } });
  }

  async updateDisputeStatus(actorId: string, disputeId: string, status: string) {
    const dispute = await this.prisma.dispute.update({ where: { id: disputeId }, data: { status: status as any } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'DISPUTE_STATUS_CHANGED', entityType: 'Dispute', entityId: disputeId, metadata: { status } } });
    return dispute;
  }

  async escalateDispute(actorId: string, disputeId: string, dto: EscalateDisputeDto) {
    const existing = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!existing) throw new NotFoundException('Dispute not found');
    if (['RESOLVED','DISMISSED','CLOSED'].includes(existing.status)) throw new BadRequestException('Cannot escalate a closed case');
    const dispute = await this.prisma.dispute.update({ where: { id: disputeId }, data: { status: 'ESCALATED', escalatedById: actorId, escalatedAt: new Date() } });
    if (dto.note) await this.prisma.internalNote.create({ data: { disputeId, authorId: actorId, content: `[ESCALATION NOTE] ${dto.note}` } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'DISPUTE_ESCALATED', entityType: 'Dispute', entityId: disputeId, metadata: { note: dto.note } } });
    const admins = await this.prisma.user.findMany({ where: { role: { in: ['ADMIN','SUPER_ADMIN'] } }, select: { id: true } });
    await Promise.allSettled(admins.map(a => this.notificationsService.create({ userId: a.id, type: 'SYSTEM', title: '🚨 Report escalated by CS', body: `${existing.type} report escalated${dto.note ? ': ' + dto.note : ''}`, data: { disputeId } })));
    return dispute;
  }

  async assignDispute(actorId: string, disputeId: string, assigneeId: string) {
    await this.prisma.dispute.update({ where: { id: disputeId }, data: { assignedToId: assigneeId } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'DISPUTE_ASSIGNED', entityType: 'Dispute', entityId: disputeId, metadata: { assigneeId } } });
    return { message: 'Assigned' };
  }

  async resolveDispute(adminId: string, disputeId: string, dto: ResolveDisputeDto) {
    const existing = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!existing) throw new NotFoundException('Dispute not found');
    const dispute = await this.prisma.dispute.update({ where: { id: disputeId }, data: { status: dto.status as any, resolution: dto.resolution, resolvedById: adminId, resolvedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'DISPUTE_RESOLVED', entityType: 'Dispute', entityId: disputeId, metadata: { status: dto.status, resolution: dto.resolution } } });
    await this.notificationsService.create({ userId: existing.reporterId, type: 'SYSTEM', title: 'Your report has been reviewed', body: dto.resolution, data: { disputeId } }).catch(() => {});
    return dispute;
  }

  private async checkAutoEscalation(reportedUserId?: string, groupId?: string) {
    if (!reportedUserId && !groupId) return;
    const settings = await this.prisma.platformSetting.findFirst();
    const flagT = settings?.reportFlagThreshold ?? 5;
    const highT = settings?.reportHighPriorityThreshold ?? 10;
    const autoT = settings?.reportAutoEscalateThreshold ?? 15;
    const where: any = { status: { not: 'DISMISSED' } };
    if (reportedUserId) where.reportedUserId = reportedUserId;
    if (groupId) where.groupId = groupId;
    const count = await this.prisma.dispute.count({ where });
    const label = reportedUserId ? `User ${reportedUserId}` : `Group ${groupId}`;
    if (count === autoT) {
      await this.prisma.dispute.updateMany({ where: { ...where, status: { in: ['OPEN','UNDER_REVIEW'] } }, data: { status: 'ESCALATED', escalatedById: 'SYSTEM', escalatedAt: new Date() } });
      await this.prisma.fraudFlag.create({ data: { userId: reportedUserId || null, type: 'AUTO_ESCALATED', description: `${label} reached ${count} reports and was auto-escalated.`, severity: 'CRITICAL', metadata: { count } } });
      const admins = await this.prisma.user.findMany({ where: { role: { in: ['ADMIN','SUPER_ADMIN'] } }, select: { id: true } });
      await Promise.allSettled(admins.map(a => this.notificationsService.create({ userId: a.id, type: 'SYSTEM', title: '🚨 Auto-escalated', body: `${label} hit ${count} reports and was auto-escalated.`, data: { reportedUserId, groupId } })));
    } else if (count === highT) {
      await this.prisma.fraudFlag.create({ data: { userId: reportedUserId || null, type: 'HIGH_PRIORITY_REPORTS', description: `${label} reached ${count} reports — high priority.`, severity: 'HIGH', metadata: { count } } });
    } else if (count === flagT) {
      await this.prisma.fraudFlag.create({ data: { userId: reportedUserId || null, type: 'REPORT_FLAG', description: `${label} reached ${count} reports and was flagged.`, severity: 'MEDIUM', metadata: { count } } });
    }
  }
}

// ── Controllers ───────────────────────────────────────────────

@ApiTags('Disputes') @Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post() @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  create(@Req() req: any, @Body() dto: CreateDisputeDto) { return this.disputesService.createDispute(req.user.id, dto); }

  @Get('mine') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  getMine(@Req() req: any) { return this.disputesService.getMyDisputes(req.user.id); }

  @Get(':id/replies') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  getMyReplies(@Req() req: any, @Param('id') id: string) { return this.disputesService.getMyDisputeReplies(req.user.id, id); }

  @Post(':id/reply') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  replyToDispute(@Req() req: any, @Param('id') id: string, @Body('message') message: string) { return this.disputesService.replyToDispute(req.user.id, id, message); }
}

@ApiTags('CS Disputes') @Controller('cs/disputes') @UseGuards(JwtAuthGuard, CustomerServiceGuard) @ApiBearerAuth()
export class CSDisputesController {
  constructor(private readonly disputesService: DisputesService) {}
  @Get() getAll(@Query('status') s?: string, @Query('reportedUserId') ru?: string, @Query('groupId') g?: string, @Query('page') p = 1, @Query('limit') l = 20) { return this.disputesService.csGetDisputes({ status: s, reportedUserId: ru, groupId: g, page: +p, limit: +l }); }
  @Get(':id') getDetail(@Param('id') id: string) { return this.disputesService.csGetDisputeDetail(id); }
  @Post(':id/notes') addNote(@Req() req: any, @Param('id') id: string, @Body() dto: AddInternalNoteDto) { return this.disputesService.addDisputeNote(req.user.id, id, dto); }
  @Get(':id/notes') getNotes(@Param('id') id: string) { return this.disputesService.getDisputeNotes(id); }
  @Patch(':id/status') updateStatus(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDisputeStatusDto) { return this.disputesService.updateDisputeStatus(req.user.id, id, dto.status); }
  @Patch(':id/escalate') escalate(@Req() req: any, @Param('id') id: string, @Body() dto: EscalateDisputeDto) { return this.disputesService.escalateDispute(req.user.id, id, dto); }
  @Patch(':id/assign') assign(@Req() req: any, @Param('id') id: string, @Body('assigneeId') assigneeId: string) { return this.disputesService.assignDispute(req.user.id, id, assigneeId); }
}

@ApiTags('Admin Disputes') @Controller('admin/disputes') @UseGuards(JwtAuthGuard, AdminGuard) @ApiBearerAuth()
export class AdminDisputesController {
  constructor(private readonly disputesService: DisputesService) {}
  @Get() getAll(@Query('status') s?: string, @Query('reportedUserId') ru?: string, @Query('groupId') g?: string, @Query('page') p = 1, @Query('limit') l = 20) { return this.disputesService.csGetDisputes({ status: s, reportedUserId: ru, groupId: g, page: +p, limit: +l }); }
  @Patch(':id/resolve') resolve(@Req() req: any, @Param('id') id: string, @Body() dto: ResolveDisputeDto) { return this.disputesService.resolveDispute(req.user.id, id, dto); }
}

@Module({
  imports: [NotificationsModule],
  controllers: [DisputesController, CSDisputesController, AdminDisputesController],
  providers: [DisputesService, CustomerServiceGuard],
  exports: [DisputesService, CustomerServiceGuard],
})
export class DisputesModule {}