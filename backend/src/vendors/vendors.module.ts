import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { VendorsController, VendorsReviewController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { VendorKycService } from './vendor-kyc.service';
import { VendorActiveGuard } from './guards/vendor-active.guard';

@Module({
  imports: [PrismaModule, NotificationsModule, CloudinaryModule],
  controllers: [VendorsController, VendorsReviewController],
  providers: [VendorsService, VendorKycService, VendorActiveGuard],
  // The products and orders modules will import VendorsModule to reuse the guard
  exports: [VendorsService, VendorKycService, VendorActiveGuard],
})
export class VendorsModule {}