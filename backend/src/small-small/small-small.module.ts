import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { MailModule } from '../mail/mail.module';
import { VendorActiveGuard } from '../vendors/guards/vendor-active.guard';
import { SsProductsService } from './products/ss-products.service';
import {
  SsVendorProductsController, SsProductsController, SsCareProductsController,
} from './products/ss-products.controller';
import { SsEscrowService } from './escrow/ss-escrow.service';
import { SsOrdersService } from './orders/ss-orders.service';
import { SsOrdersController, SsVendorOrdersController } from './orders/ss-orders.controller';
import { SsChatService } from './chat/ss-chat.service';
import { SsChatController } from './chat/ss-chat.controller';
import { SsReportsService } from './reports/ss-reports.service';
import { SsReportsController } from './reports/ss-reports.controller';
import { SsCronService } from './cron/ss-cron.service';
import { SsCronController } from './cron/ss-cron.controller';

// Everything for Pay Small Small lives here.
// Still to come: the customer care order tools.
@Module({
  imports: [PrismaModule, NotificationsModule, CloudinaryModule, MailModule],
  controllers: [
    SsVendorProductsController, SsProductsController, SsCareProductsController,
    SsOrdersController, SsVendorOrdersController, SsChatController, SsReportsController, SsCronController,
  ],
  providers: [SsProductsService, SsEscrowService, SsOrdersService, SsChatService, SsReportsService, SsCronService, VendorActiveGuard],
  exports: [SsProductsService, SsOrdersService, SsEscrowService],
})
export class SmallSmallModule {}