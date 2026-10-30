import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { VendorActiveGuard } from '../vendors/guards/vendor-active.guard';
import { SsProductsService } from './products/ss-products.service';
import {
  SsVendorProductsController, SsProductsController, SsCareProductsController,
} from './products/ss-products.controller';
import { SsEscrowService } from './escrow/ss-escrow.service';
import { SsOrdersService } from './orders/ss-orders.service';
import { SsOrdersController, SsVendorOrdersController } from './orders/ss-orders.controller';
import { SsCronService } from './cron/ss-cron.service';
import { SsCronController } from './cron/ss-cron.controller';

// Everything for Pay Small Small lives here.
// Still to come: chat messages and the customer care order tools.
@Module({
  imports: [PrismaModule, NotificationsModule, CloudinaryModule],
  controllers: [
    SsVendorProductsController, SsProductsController, SsCareProductsController,
    SsOrdersController, SsVendorOrdersController, SsCronController,
  ],
  providers: [SsProductsService, SsEscrowService, SsOrdersService, SsCronService, VendorActiveGuard],
  exports: [SsProductsService, SsOrdersService, SsEscrowService],
})
export class SmallSmallModule {}