import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GroupsModule } from './groups/groups.module';
import { WalletModule } from './wallet/wallet.module';
import { PaymentsModule } from './payments/payments.module';
import { ContributionsModule } from './contributions/contributions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ChatModule } from './chat/chat.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { SettingsModule, MaintenanceModeGuard } from './settings/settings.module';
import { SupportModule } from './support/support.module';
import { DisputesModule } from './disputes/disputes.module';
import appConfig from './config/app.config';
import { validate } from './config/env.validation';
import { KycModule } from './kyc/kyc.module';
import { GraceModule } from './grace/grace.module';

@Module({
  imports: [
    KycModule,
GraceModule,

    ConfigModule.forRoot({ isGlobal: true, load: [appConfig], validate, expandVariables: true }),

    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 1000,  limit: 10  },
      { name: 'medium', ttl: 10000, limit: 50  },
      { name: 'long',   ttl: 60000, limit: 200 },
    ]),

    ScheduleModule.forRoot(),

    PrismaModule,
    MailModule,

    AuthModule,
    UsersModule,
    GroupsModule,
    WalletModule,
    PaymentsModule,
    ContributionsModule,
    NotificationsModule,
    ChatModule,
    AnalyticsModule,
    AdminModule,
    SettingsModule,
    SupportModule,
    DisputesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: MaintenanceModeGuard },
  ],
})
export class AppModule {}