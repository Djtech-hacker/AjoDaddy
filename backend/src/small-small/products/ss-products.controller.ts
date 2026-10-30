import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/auth.module';
import { VendorActiveGuard } from '../../vendors/guards/vendor-active.guard';
import { SsProductsService } from './ss-products.service';
import {
  CreateProductDto, UpdateProductDto, UpdateStockDto, SetProductStatusDto, FlagProductDto, ProductNoteDto,
} from './dto/products.dto';

// ══════════════════════════════════════════════════════════════
// VENDOR: only approved, active vendors
// ══════════════════════════════════════════════════════════════

@ApiTags('Small Small: Vendor Products')
@Controller('small-small/vendor/products')
@UseGuards(JwtAuthGuard, VendorActiveGuard)
@ApiBearerAuth()
export class SsVendorProductsController {
  constructor(private readonly products: SsProductsService) {}

  // Declared before the ":id" routes so "upload-signature" is never read as an id
  @Post('upload-signature')
  @ApiOperation({ summary: 'Get a signed Cloudinary upload for a product image' })
  uploadSignature(@Req() req: any) { return this.products.getImageUploadSignature(req.user.id); }

  @Post()
  @ApiOperation({ summary: 'Post a new product' })
  create(@Req() req: any, @Body() dto: CreateProductDto) {
    return this.products.createProduct(req.user.id, dto, req.ip);
  }

  @Get()
  @ApiOperation({ summary: 'My products' })
  list(@Req() req: any, @Query('status') status?: string, @Query('page') page?: string) {
    return this.products.listMine(req.user.id, status, Number(page) || 1);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my products, with stock history' })
  get(@Req() req: any, @Param('id') id: string) { return this.products.getMine(req.user.id, id); }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a product (existing customer plans keep their original terms)' })
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.updateProduct(req.user.id, id, dto, req.ip);
  }

  @Post(':id/stock')
  @ApiOperation({ summary: 'Set the total stock (increase any time; decrease down to reserved + sold)' })
  setStock(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateStockDto) {
    return this.products.setStock(req.user.id, id, dto, req.ip);
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Turn a product on, pause it, or archive it' })
  setStatus(@Req() req: any, @Param('id') id: string, @Body() dto: SetProductStatusDto) {
    return this.products.setStatus(req.user.id, id, dto, req.ip);
  }
}

// ══════════════════════════════════════════════════════════════
// CUSTOMERS: any logged-in user can browse
// ══════════════════════════════════════════════════════════════

@ApiTags('Small Small: Products')
@Controller('small-small/products')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SsProductsController {
  constructor(private readonly products: SsProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Browse and search products (name, description or reference number)' })
  list(@Query('q') q?: string, @Query('category') category?: string, @Query('page') page?: string) {
    return this.products.listPublic(q, category, Number(page) || 1);
  }

  @Get(':idOrReference')
  @ApiOperation({ summary: 'Product detail by id or reference number (SS-2026-123456)' })
  get(@Param('idOrReference') idOrReference: string) { return this.products.getPublic(idOrReference); }
}

// ══════════════════════════════════════════════════════════════
// CUSTOMER CARE (role check is inside the service, same as your KYC module)
// ══════════════════════════════════════════════════════════════

@ApiTags('Small Small: Care Products')
@Controller('small-small/care/products')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SsCareProductsController {
  constructor(private readonly products: SsProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Search by reference number, product name or vendor business name' })
  search(@Req() req: any, @Query('q') q?: string, @Query('page') page?: string) {
    return this.products.careSearch(req.user.id, q, Number(page) || 1);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Product detail with notes and stock history' })
  get(@Req() req: any, @Param('id') id: string) { return this.products.careGetProduct(req.user.id, id); }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add an internal note' })
  addNote(@Req() req: any, @Param('id') id: string, @Body() dto: ProductNoteDto) {
    return this.products.careAddNote(req.user.id, id, dto.text, req.ip);
  }

  @Post(':id/flag')
  @ApiOperation({ summary: 'Put a product on hold, or release the hold' })
  flag(@Req() req: any, @Param('id') id: string, @Body() dto: FlagProductDto) {
    return this.products.careFlag(req.user.id, id, dto, req.ip);
  }
}