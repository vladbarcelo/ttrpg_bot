import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { UserService } from './user.service';
import { TicketService } from './ticket.service';
import { Telegraf } from 'telegraf';
import { InjectBot } from 'nestjs-telegraf';
import { TicketStatus } from '@prisma/client';
import { CampaignService } from './campaign.service';

@Injectable()
export class TicketScheduler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignService: CampaignService,
    @InjectBot() private readonly bot: Telegraf<any>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTicketDropsAndConfirmations() {
    const now = new Date();
    const session = await this.campaignService.getNextSession();

    const msToSession = session.dateTime.getTime() - now.getTime();
    const hToSession = msToSession / (60 * 60 * 1000);

    // priority drop
    if (!session.priorityDropNotified) {
      const priorityUsers = await this.prisma.user.findMany({
        where: { isPriority: true },
        include: {
          tickets: true,
        },
      });
      for (const user of priorityUsers) {
        if (user.tickets.some((t) => t.sessionId === session.id)) {
          continue;
        }

        await this.bot.telegram.sendMessage(
          user.telegramId,
          `👑 Открыто приоритетное бронирование для сессии ${session.id} (${session.campaign.name})`,
          {
            reply_markup: {
              keyboard: [[{ text: '/book' }]],
            },
          },
        );
      }
      await this.prisma.session.update({
        where: { id: session.id },
        data: { priorityDropNotified: true },
      });
    }

    // 25h before: ask for confirmation
    if (
      hToSession > 24.9 &&
      hToSession < 25.1 &&
      !session.confirmationRequested
    ) {
      const tickets = await this.prisma.ticket.findMany({
        where: {
          sessionId: session.id,
          status: TicketStatus.BOOKED,
        },
      });
      for (const ticket of tickets) {
        const user = await this.prisma.user.findUnique({
          where: { id: ticket.userId },
        });
        if (user) {
          await this.bot.telegram.sendMessage(
            user.telegramId,
            `🔥 Пожалуйста, подтвердите ваше бронирование для сессии ${session.id} (${session.campaign.name}) в течение 3 часов, иначе ваш билет будет отменен.`,
            {
              reply_markup: {
                keyboard: [[{ text: '/confirm' }]],
              },
            },
          );
        }
      }
      await this.prisma.session.update({
        where: { id: session.id },
        data: { confirmationRequested: true },
      });
    }

    // 22h before: non-priority drop and unbook unconfirmed tickets
    if (
      hToSession > 21.9 &&
      hToSession < 22.1 &&
      !session.nonPriorityDropNotified
    ) {
      // Unbook unconfirmed tickets
      const tickets = await this.prisma.ticket.findMany({
        where: { sessionId: session.id, status: 'BOOKED' },
      });
      for (const ticket of tickets) {
        await this.prisma.ticket.delete({
          where: { id: ticket.id },
        });
        const user = await this.prisma.user.findUnique({
          where: { id: ticket.userId },
        });
        if (user) {
          await this.bot.telegram.sendMessage(
            user.telegramId,
            `‼️ Ваш билет для сессии ${session.id} (${session.campaign.name}) был отменен из-за не подтверждения бронирования.`,
          );
        }
      }
      // Notify all users about non-priority drop
      const users = await this.prisma.user.findMany();
      for (const user of users) {
        await this.bot.telegram.sendMessage(
          user.telegramId,
          `⚡ Открыто бронирование для сессии ${session.id} (${session.campaign.name})`,
          {
            reply_markup: {
              keyboard: [[{ text: '/book' }]],
            },
            disable_notification: true,
          },
        );
      }
      await this.prisma.session.update({
        where: { id: session.id },
        data: { nonPriorityDropNotified: true },
      });
    }
  }
}
