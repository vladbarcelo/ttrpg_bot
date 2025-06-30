import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { UserService } from './user.service';
import { TicketService } from './ticket.service';
import { Telegraf } from 'telegraf';
import { InjectBot } from 'nestjs-telegraf';
import { TicketStatus } from '@prisma/client';

@Injectable()
export class TicketScheduler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly ticketService: TicketService,
    @InjectBot() private readonly bot: Telegraf<any>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTicketDropsAndConfirmations() {
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: {
        dateTime: {
          gte: new Date(now.getTime() + 23 * 60 * 60 * 1000), // 23h from now
          lte: new Date(now.getTime() + 49 * 60 * 60 * 1000), // 49h from now
        },
      },
      include: { campaign: true, tickets: true },
    });

    for (const session of sessions) {
      const msToSession = session.dateTime.getTime() - now.getTime();
      const hToSession = msToSession / (60 * 60 * 1000);

      // 48h before: priority drop
      if (hToSession > 47.9 && hToSession < 48.1) {
        const priorityUsers = await this.prisma.user.findMany({
          where: { isPriority: true },
        });
        for (const user of priorityUsers) {
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
      }

      // 25h before: ask for confirmation
      if (hToSession > 24.9 && hToSession < 25.1) {
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
              `🔥 Пожалуйста, подтвердите ваше бронирование для сессии ${session.id} (${session.campaign.name}) в течение часа, иначе ваш билет будет отменен.`,
            );
          }
        }
      }

      // 24h before: non-priority drop and unbook unconfirmed tickets
      if (hToSession > 23.9 && hToSession < 24.1) {
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
      }
    }
  }
}
