import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { UserService } from './user.service';
import { CampaignService } from './campaign.service';
import { TicketService } from './ticket.service';
import { BotUpdate } from './telegram.client';
import { TicketScheduler } from './ticket.scheduler';
import { ConfigModule } from './config.module';

@Module({
  imports: [
    ConfigModule,
    TelegrafModule.forRoot({
      token: process.env.BOT_TOKEN || 'TELEGRAM_BOT_TOKEN_PLACEHOLDER',
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [],
  providers: [
    PrismaService,
    UserService,
    CampaignService,
    TicketService,
    BotUpdate,
    TicketScheduler,
  ],
})
export class AppModule {}
