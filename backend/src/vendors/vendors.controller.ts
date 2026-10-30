import {
  Controller, Get, Post, Delete, Body, Param, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.module';
import { VendorsService } from './vendors.service';
import {
  SaveApplicationDto, AddDocumentDto, SubmitApplicationDto, ReviewDocumentDto,
  ApplicationNoteDto, RecommendDto, DecisionDto, SuspendVendorDto,
} from './dto/vendor.dto';

// ══════════════════════════════════════════════════════════════
// APPLICANT: any logged-in user
// ══════════════════════════════════════════════════════════════

@ApiTags('Vendors')
@Controller('vendors')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get('me')
  @ApiOperation({ summary: 'My vendor status, application and identity readiness' })
  getMine(@Req() req: any) { return this.vendors.getMine(req.user.id); }

  @Post('applications')
  @ApiOperation({ summary: 'Create or update my vendor application (business details)' })
  save(@Req() req: any, @Body() dto: SaveApplicationDto) {
    return this.vendors.saveApplication(req.user.id, dto, req.ip);
  }

  // Declared before the ":id" routes so "upload-signature" is never read as an id
  @Post('applications/upload-signature')
  @ApiOperation({ summary: 'Get a signed Cloudinary upload for a private vendor document' })
  uploadSignature(@Req() req: any) { return this.vendors.getDocUploadSignature(req.user.id); }

  @Post('applications/:id/documents')
  @ApiOperation({ summary: 'Attach an uploaded file (CAC, social proof or sales proof)' })
  addDocument(@Req() req: any, @Param('id') id: string, @Body() dto: AddDocumentDto) {
    return this.vendors.addDocument(req.user.id, id, dto, req.ip);
  }

  @Delete('applications/:id/documents/:docId')
  @ApiOperation({ summary: 'Remove one of my uploaded documents' })
  removeDocument(@Req() req: any, @Param('id') id: string, @Param('docId') docId: string) {
    return this.vendors.removeDocument(req.user.id, id, docId, req.ip);
  }

  @Post('applications/:id/submit')
  @ApiOperation({ summary: 'Submit my application for review' })
  submit(@Req() req: any, @Param('id') id: string, @Body() dto: SubmitApplicationDto) {
    return this.vendors.submit(req.user.id, id, dto, req.ip);
  }
}

// ══════════════════════════════════════════════════════════════
// STAFF: customer service, admin, super admin
// (the role check happens inside VendorsService, same pattern as KycService)
// ══════════════════════════════════════════════════════════════

@ApiTags('Vendor Review')
@Controller('vendors/review')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VendorsReviewController {
  constructor(private readonly vendors: VendorsService) {}

  @Get('applications')
  @ApiOperation({ summary: 'Review queue (default: submitted, under review, needs more info)' })
  list(@Req() req: any, @Query('status') status?: string, @Query('page') page?: string) {
    return this.vendors.listApplications(req.user.id, status, Number(page) || 1);
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'Application detail with documents, identity summary, payout account, notes' })
  detail(@Req() req: any, @Param('id') id: string) {
    return this.vendors.getApplicationDetail(req.user.id, id);
  }

  @Post('applications/:id/start')
  @ApiOperation({ summary: 'Mark an application as under review' })
  start(@Req() req: any, @Param('id') id: string) {
    return this.vendors.startReview(req.user.id, id, req.ip);
  }

  @Post('applications/:id/notes')
  @ApiOperation({ summary: 'Add an internal note' })
  addNote(@Req() req: any, @Param('id') id: string, @Body() dto: ApplicationNoteDto) {
    return this.vendors.addNote(req.user.id, id, dto.text, req.ip);
  }

  @Post('applications/:id/recommend')
  @ApiOperation({ summary: 'Recommend approve / reject / needs more info' })
  recommend(@Req() req: any, @Param('id') id: string, @Body() dto: RecommendDto) {
    return this.vendors.recommend(req.user.id, id, dto, req.ip);
  }

  @Post('applications/:id/decision')
  @ApiOperation({ summary: 'Final decision: approve, reject or ask for more info' })
  decide(@Req() req: any, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.vendors.decide(req.user.id, id, dto, req.ip);
  }

  @Post('documents/:docId/review')
  @ApiOperation({ summary: 'Mark a document verified or rejected' })
  reviewDocument(@Req() req: any, @Param('docId') docId: string, @Body() dto: ReviewDocumentDto) {
    return this.vendors.reviewDocument(req.user.id, docId, dto, req.ip);
  }

  @Get('documents/:docId/file')
  @ApiOperation({ summary: 'Open a private document (streamed through the backend, logged)' })
  async file(@Req() req: any, @Param('docId') docId: string, @Res() res: Response) {
    const { buffer, contentType } = await this.vendors.getDocumentFile(req.user.id, docId, req.ip);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'List vendor accounts' })
  accounts(@Req() req: any, @Query('status') status?: string) {
    return this.vendors.listVendors(req.user.id, status);
  }

  @Post('accounts/:userId/suspend')
  @ApiOperation({ summary: 'Admin: suspend a vendor (products paused, existing orders continue)' })
  suspend(@Req() req: any, @Param('userId') userId: string, @Body() dto: SuspendVendorDto) {
    return this.vendors.suspendVendor(req.user.id, userId, dto.reason, req.ip);
  }

  @Post('accounts/:userId/reinstate')
  @ApiOperation({ summary: 'Admin: reinstate a suspended vendor' })
  reinstate(@Req() req: any, @Param('userId') userId: string) {
    return this.vendors.reinstateVendor(req.user.id, userId, req.ip);
  }
  
  @Post('accounts/:userId/verify')
  @ApiOperation({ summary: 'Admin: give the Verified badge' })
  verify(@Req() req: any, @Param('userId') userId: string) {
    return this.vendors.setVendorVerified(req.user.id, userId, true, req.ip);
  }

  @Post('accounts/:userId/unverify')
  @ApiOperation({ summary: 'Admin: remove the Verified badge' })
  unverify(@Req() req: any, @Param('userId') userId: string) {
    return this.vendors.setVendorVerified(req.user.id, userId, false, req.ip);
  }
}