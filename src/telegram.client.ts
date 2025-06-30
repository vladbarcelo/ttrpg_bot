import { Update, Start, Ctx, Command, InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { UserService } from './user.service';
import { CampaignService } from './campaign.service';
import { TicketService } from './ticket.service';
import { DropType } from '@prisma/client';
import { DateTime } from 'luxon';
import { Logger } from '@nestjs/common';

function getMessageText(ctx: Context): string | undefined {
  const msg = ctx.message as { text?: string } | undefined;
  return msg?.text;
}

@Update()
export class BotUpdate {
  constructor(
    private readonly userService: UserService,
    private readonly campaignService: CampaignService,
    private readonly ticketService: TicketService,
    private readonly logger: Logger,
    @InjectBot() private bot: Telegraf,
  ) {
    this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Начать' },
      { command: 'book', description: 'Забронировать билет' },
      { command: 'confirm', description: 'Подтвердить билет' },
      { command: 'cancel', description: 'Отменить билет' },
      { command: 'my_tickets', description: 'Мои билеты' },
      {
        command: 'tickets',
        description: 'Общий список билетов на предстоящую сессию',
      },
      {
        command: 'permanent',
        description: 'Зарегистрировать постоянный билет',
      },
      { command: 'list_campaigns', description: 'Список кампаний' },
      { command: 'create_session', description: '[ДМ] Создать сессию' },
    ]);
  }

  private async handle(ctx: Context, fn: (ctx: Context) => Promise<void>) {
    const logMsg = `[${ctx.from?.id}] ${getMessageText(ctx)}`;
    try {
      this.logger.log(logMsg);
      await fn(ctx);
    } catch (e) {
      await ctx.reply('❌ Ошибка: ' + (e.message || 'Неизвестная ошибка'));
      this.logger.error(logMsg, e);
    }
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const name = ctx.from?.first_name || 'Unknown';
      await this.userService.registerUser(telegramId, name);
      await ctx.reply(`👋 Добро пожаловать, ${name}! Вы зарегистрированы.`, {
        reply_markup: {
          keyboard: [[{ text: '/book' }]],
        },
      });
    });
  }

  @Command('admins')
  async listAdmins(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin', 'dungeonMaster']);
      const admins = await this.userService.listAdmins();
      if (admins.length === 0) {
        await ctx.reply('Админы не найдены.');
        return;
      }
      const adminList = admins
        .map((a) => `${a.name} (${a.telegramId})`)
        .join('\n');
      await ctx.reply(`Админы:\n${adminList}`);
    });
  }

  @Command('dms')
  async listDungeonMasters(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin', 'dungeonMaster']);
      const dms = await this.userService.listDungeonMasters();
      if (dms.length === 0) {
        await ctx.reply('ДМы не найдены.');
        return;
      }
      const dmList = dms
        .map((dm) => `${dm.name} (${dm.telegramId})`)
        .join('\n');
      await ctx.reply(`ДМы:\n${dmList}`);
    });
  }

  @Command('create_campaign')
  async createCampaign(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin', 'dungeonMaster']);
      const text = getMessageText(ctx);
      const args = text?.split(' ').slice(1);
      if (!args || args.length < 3) {
        await ctx.reply(
          'Пример: /create_campaign <name> <maxTickets> <scheduleOrder>',
        );
        return;
      }
      const [name, maxTicketsStr, scheduleOrderStr] = args;
      const maxTickets = parseInt(maxTicketsStr, 10);
      const scheduleOrder = parseInt(scheduleOrderStr, 10);
      if (isNaN(maxTickets) || isNaN(scheduleOrder)) {
        await ctx.reply('maxTickets и scheduleOrder должны быть числами.');
        return;
      }
      const campaign = await this.campaignService.createCampaign(
        name,
        maxTickets,
        scheduleOrder,
      );
      await ctx.reply(
        `Кампания создана: ${campaign.name} (ID: ${campaign.id})`,
      );
    });
  }

  @Command('list_campaigns')
  async listCampaigns(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const campaigns = await this.campaignService.listCampaigns();
      if (campaigns.length === 0) {
        await ctx.reply('Кампаний не найдено.');
        return;
      }
      const list = campaigns
        .map((c) => `${c.id}: ${c.name} (макс. билетов: ${c.maxTickets})`)
        .join('\n');
      await ctx.reply(`🎲 Кампании:\n${list}`);
    });
  }

  @Command('create_session')
  async createSession(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin', 'dungeonMaster']);
      // Stub: get assigned campaign for DM
      const campaignId = await this.getAssignedCampaignIdForDM(user.id);
      if (!campaignId) {
        await ctx.reply('🔒 Кампания не назначена.');
        return;
      }
      // Calculate next Thursday 19:00 Moscow time
      const now = DateTime.now().setZone('Europe/Moscow');
      let nextThursday = now.set({
        hour: 19,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
      while (nextThursday.weekday !== 4 || nextThursday <= now) {
        nextThursday = nextThursday.plus({ days: 1 });
        nextThursday = nextThursday.set({
          hour: 19,
          minute: 0,
          second: 0,
          millisecond: 0,
        });
      }
      const dateTime = nextThursday.toJSDate();
      const session = await this.campaignService.createSession(
        campaignId,
        dateTime,
      );
      const perms = await this.ticketService.listPermanentTicketsForCampaign(
        campaignId,
      );
      const campaign = await this.campaignService.getCampaignById(campaignId);
      for (const perm of perms) {
        await this.ticketService.bookTicket(
          session.id,
          perm.userId,
          DropType.PERMANENT,
        );
        await this.bot.telegram.sendMessage(
          perm.userId,
          `🎫 Ваш постоянный билет зарегистрирован на сессию ${
            campaign.name
          } в ${nextThursday.toFormat('yyyy-MM-dd HH:mm')} (Московское время)`,
        );
      }
      await ctx.reply(
        `🎲 Сессия создана для кампании ${
          campaign.name
        } в ${nextThursday.toFormat('yyyy-MM-dd HH:mm')} (Московское время)`,
      );
    });
  }

  // Stub for DM campaign assignment
  private async getAssignedCampaignIdForDM(
    userId: number,
  ): Promise<number | null> {
    // Find the campaign where dungeonMasterId matches userId
    const campaigns = await this.campaignService.listCampaigns();
    const assigned = campaigns.find((c) => c.dungeonMasterId === userId);
    return assigned ? assigned.id : null;
  }

  @Command('list_sessions')
  async listSessions(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const text = getMessageText(ctx);
      const args = text?.split(' ').slice(1);
      if (!args || args.length < 1) {
        await ctx.reply('Usage: /list_sessions <campaignId>');
        return;
      }
      const [campaignIdStr] = args;
      const campaignId = parseInt(campaignIdStr, 10);
      if (isNaN(campaignId)) {
        await ctx.reply('campaignId must be a number.');
        return;
      }
      const sessions = await this.campaignService.listSessionsForCampaign(
        campaignId,
      );
      if (sessions.length === 0) {
        await ctx.reply('No sessions found for this campaign.');
        return;
      }
      const list = sessions
        .map(
          (s) =>
            `${s.id}: ${s.dateTime.toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
            })}`,
        )
        .join('\n');
      await ctx.reply(`Sessions for campaign ${campaignId}:\n${list}`);
    });
  }

  @Command('book')
  async book(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      // Find the next available session for the user's campaign, or soonest session overall
      let session = null;
      const allCampaigns = await this.campaignService.listCampaigns();
      for (const c of allCampaigns) {
        const s = await this.campaignService.getNextSessionForCampaign(c.id);
        if (s && (!session || s.dateTime < session.dateTime)) {
          session = s;
        }
      }
      if (!session) {
        await ctx.reply('🔒 Нет доступных сессий для бронирования.');
        return;
      }
      // Determine best drop type
      let dropType: DropType = DropType.NON_PRIORITY;
      if (
        user.isPriority &&
        !user.permanentTickets.some((t) => t.campaignId !== session.campaignId)
      ) {
        dropType = DropType.PRIORITY;
      }
      // Book the ticket
      await this.ticketService.bookTicket(session.id, user.id, dropType);
      const sessionTime = DateTime.fromJSDate(session.dateTime).setZone(
        'Europe/Moscow',
      );
      await ctx.reply(
        `🎫 Билет забронирован для сессии ${
          session.campaign.name
        } (${sessionTime.toFormat('yyyy-MM-dd HH:mm')})`,
      );
    });
  }

  @Command('confirm')
  async confirm(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      const tickets = await this.ticketService.listUserTickets(user.id);
      if (tickets.length === 0) {
        await ctx.reply('🔒 У вас нет билетов.');
        return;
      }
      const ticketId = tickets[0].id;
      await this.ticketService.confirmTicket(ticketId, user.id);
      await ctx.reply('🤝 Билет подтвержден!');
    });
  }

  async tickets(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      await this.userService.findByTelegramId(telegramId);
      let session = null;
      const allCampaigns = await this.campaignService.listCampaigns();
      for (const c of allCampaigns) {
        const s = await this.campaignService.getNextSessionForCampaign(c.id);
        if (s && (!session || s.dateTime < session.dateTime)) {
          session = s;
        }
      }
      if (!session) {
        await ctx.reply('🔒 Нет доступных сессий для просмотра билетов.');
        return;
      }
      const tickets = await this.ticketService.listTicketsForSession(
        session.id,
      );
      const list = tickets.map(
        (t) =>
          `ID: ${t.id}, Пользователь: ${t.user.name}, Статус: ${t.status}, Тип бронирования: ${t.drop}`,
      );
      await ctx.reply(
        `🎫 Билеты для сессии ${session.campaign.name}:\n${list.join('\n')}`,
      );
    });
  }

  @Command('my_tickets')
  async myTickets(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      const tickets = await this.ticketService.listUserTickets(user.id);
      if (tickets.length === 0) {
        await ctx.reply('🔒 У вас нет билетов.');
        return;
      }
      const list = tickets
        .map(
          (t) =>
            `ID: ${t.id}, Кампания: ${
              t.session.campaign.name
            }, Дата: ${t.session.dateTime.toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
            })}, Статус: ${t.status}, Тип бронирования: ${t.drop}`,
        )
        .join('\n');
      await ctx.reply(`🎫 Ваши билеты:\n${list}`);
    });
  }

  @Command('permanent')
  async permanent(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['priority']);
      const text = getMessageText(ctx);
      const args = text?.split(' ').slice(1);
      if (!args || args.length < 1) {
        await ctx.reply('🔒 Пример: /permanent <campaignId>');
        return;
      }
      const [campaignIdStr] = args;
      const campaignId = parseInt(campaignIdStr, 10);
      if (isNaN(campaignId)) {
        await ctx.reply('🔒 campaignId должен быть числом.');
        return;
      }
      await this.ticketService.createPermanentTicket(user.id, campaignId);
      await ctx.reply('🎫 Постоянный билет зарегистрирован!');
    });
  }

  @Command('cancel')
  async cancel(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      const allCampaigns = await this.campaignService.listCampaigns();
      let session = null;
      for (const c of allCampaigns) {
        const s = await this.campaignService.getNextSessionForCampaign(c.id);
        if (s && (!session || s.dateTime < session.dateTime)) {
          session = s;
        }
      }
      if (!session) {
        await ctx.reply('🔒 Нет доступных сессий для отмены.');
        return;
      }
      const ticket = user.tickets.find((t) => t.sessionId === session.id);
      if (!ticket) {
        await ctx.reply('🔒 У вас нет билета для этой сессии.');
        return;
      }
      await this.ticketService.cancelTicket(ticket.id, user.id);
      await ctx.reply('🤝 Билет отменен.');
    });
  }

  @Command('prioritize')
  async prioritizeUser(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin']);
      const text = getMessageText(ctx);
      const args = text?.split(' ').slice(1);
      if (!args || args.length < 1) {
        await ctx.reply('🔒 Пример: /prioritize <telegramId>');
        return;
      }
      const [telegramIdStr] = args;
      const targetUserId = parseInt(telegramIdStr, 10);
      if (isNaN(targetUserId)) {
        await ctx.reply('🔒 telegramId должен быть числом.');
        return;
      }
      await this.userService.setUserPriority(String(targetUserId), true);
      await ctx.reply('🤝 Пользователь приоритетизирован.');
    });
  }

  @Command('deprioritize')
  async deprioritizeUser(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin']);
      const text = getMessageText(ctx);
      const args = text?.split(' ').slice(1);
      if (!args || args.length < 1) {
        await ctx.reply('🔒 Пример: /deprioritize <telegramId>');
        return;
      }
      const [telegramIdStr] = args;
      const targetUserId = parseInt(telegramIdStr, 10);
      if (isNaN(targetUserId)) {
        await ctx.reply('🔒 telegramId должен быть числом.');
        return;
      }
      await this.userService.setUserPriority(String(targetUserId), false);
      await ctx.reply('🤝 Пользователь деприоритетизирован.');
    });
  }

  @Command('dm')
  async setUserAsDungeonMaster(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin']);
      const text = getMessageText(ctx);
      const args = text?.split(' ').slice(1);
      if (!args || args.length < 1) {
        await ctx.reply('🔒 Пример: /prioritize <telegramId>');
        return;
      }
      const [telegramIdStr] = args;
      const targetUserId = parseInt(telegramIdStr, 10);
      if (isNaN(targetUserId)) {
        await ctx.reply('🔒 telegramId должен быть числом.');
        return;
      }
      await this.userService.setUserAsDungeonMaster(String(targetUserId), true);
      await ctx.reply('🤝 Пользователь теперь ДМ.');
    });
  }

  @Command('undm')
  async undoDungeonMaster(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      this.userService.checkRole(user, ['admin']);
      const text = getMessageText(ctx);
      const args = text?.split(' ').slice(1);
      if (!args || args.length < 1) {
        await ctx.reply('🔒 Пример: /undm <telegramId>');
        return;
      }
      const [telegramIdStr] = args;
      const targetUserId = parseInt(telegramIdStr, 10);
      if (isNaN(targetUserId)) {
        await ctx.reply('🔒 telegramId должен быть числом.');
        return;
      }
      await this.userService.setUserAsDungeonMaster(
        String(targetUserId),
        false,
      );
      await ctx.reply('🤝 Пользователь теперь не ДМ.');
    });
  }

  @Command('users')
  async listUsers(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const users = await this.userService.listUsers();
      await ctx.reply(
        '🤝 Пользователи:\n' +
          users
            .map(
              (u) =>
                `${u.name} (${u.telegramId}) ${u.isPriority ? '👑' : ''} ${
                  u.isDungeonMaster ? '🎲' : ''
                }`,
            )
            .join('\n'),
      );
    });
  }
}
