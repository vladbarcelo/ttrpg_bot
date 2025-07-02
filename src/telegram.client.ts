import { Update, Start, Ctx, Command, InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { UserService } from './user.service';
import { CampaignService } from './campaign.service';
import { TicketService } from './ticket.service';
import { DropType, TicketStatus } from '@prisma/client';
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
        description: 'Все подтвержденные билеты',
      },
      {
        command: 'permanent',
        description: 'Зарегистрировать постоянный билет',
      },
      { command: 'next_session', description: 'Следующая сессия' },
      { command: 'create_session', description: '[ДМ] Создать сессию' },
    ]);
  }

  private readonly defaultKeyboardOpts = {
    reply_markup: {
      keyboard: [
        [{ text: '/book' }, { text: '/confirm' }, { text: '/cancel' }],
        [
          { text: '/my_tickets' },
          { text: '/tickets' },
          { text: '/next_session' },
        ],
      ],
    },
  };

  private readonly logger = new Logger('TelegramClient', { timestamp: true });

  private async handle(ctx: Context, fn: (ctx: Context) => Promise<void>) {
    const logMsg = `[${ctx?.from?.username}, ${ctx?.from?.id}] ${getMessageText(
      ctx,
    )}`;
    try {
      await fn(ctx);
      this.logger.log(logMsg);
    } catch (e) {
      let msg = e.message || 'Неизвестная ошибка';
      let isError = false;
      if (
        e?.getStatus &&
        typeof e.getStatus === 'function' &&
        e?.getStatus() > 500
      ) {
        msg = '❌ Ошибка: ' + msg;
        isError = true;
      }
      await ctx.reply(msg, this.defaultKeyboardOpts);
      if (isError) this.logger.error(`${logMsg}: ${msg}`);
      else this.logger.log(`${logMsg}: ${msg}`);
    }
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const name = ctx.from?.first_name || 'Unknown';
      await this.userService.registerUser(telegramId, name);
      await ctx.reply(
        `👋 Добро пожаловать, ${name}! Вы зарегистрированы.`,
        this.defaultKeyboardOpts,
      );
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
      if (!args || args.length < 2) {
        await ctx.reply('Пример: /create_campaign <name> <maxTickets>');
        return;
      }
      const [name, maxTicketsStr] = args;
      const maxTickets = parseInt(maxTicketsStr, 10);
      if (isNaN(maxTickets)) {
        await ctx.reply('maxTickets должен быть числом.');
        return;
      }
      const campaign = await this.campaignService.createCampaign(
        name,
        maxTickets,
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
        await ctx.reply('Кампаний не найдено.', this.defaultKeyboardOpts);
        return;
      }
      const list = campaigns
        .map((c) => `${c.id}: ${c.name} (макс. билетов: ${c.maxTickets})`)
        .join('\n');
      await ctx.reply(`🎲 Кампании:\n${list}`, this.defaultKeyboardOpts);
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
        await ctx.reply('🔒 Кампания не назначена.', this.defaultKeyboardOpts);
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
          this.defaultKeyboardOpts,
        );
      }
      await ctx.reply(
        `🎲 Сессия создана для кампании ${
          campaign.name
        } в ${nextThursday.toFormat('yyyy-MM-dd HH:mm')} (Московское время)`,
        this.defaultKeyboardOpts,
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

  @Command('next_session')
  async nextSession(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const session = await this.campaignService.getNextSession();
      const availableTickets = await this.ticketService.countAvailableTickets(
        session.id,
      );
      await ctx.reply(
        `🎲 Следующая сессия: ${
          session.campaign.name
        } в ${session.dateTime.toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
        })} (доступно билетов: ${availableTickets})`,
        this.defaultKeyboardOpts,
      );
    });
  }

  @Command('book')
  async book(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      // Find the next available session for the user's campaign, or soonest session overall
      const session = await this.campaignService.getNextSession();
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
        this.defaultKeyboardOpts,
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
        await ctx.reply('🔒 У вас нет билетов.', this.defaultKeyboardOpts);
        return;
      }
      const ticketId = tickets[0].id;
      await this.ticketService.confirmTicket(ticketId, user.id);
      await ctx.reply('🤝 Билет подтвержден!', this.defaultKeyboardOpts);
    });
  }

  private readonly statusEmojis = {
    [TicketStatus.CONFIRMED]: '✅',
    [TicketStatus.BOOKED]: '⌛️',
  };

  private readonly ticketTypeEmojis = {
    [DropType.NON_PRIORITY]: '',
    [DropType.PRIORITY]: '👑',
    [DropType.PERMANENT]: '🗿',
  };

  @Command('tickets')
  async tickets(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      await this.userService.findByTelegramId(telegramId);
      const session = await this.campaignService.getNextSession();
      const tickets = await this.ticketService.listTicketsForSession(
        session.id,
      );
      const list = tickets.map(
        (t) =>
          `[${t.id}] ${t.user.name} ${this.statusEmojis[t.status]} ${
            this.ticketTypeEmojis[t.drop]
          }`,
      );
      await ctx.reply(
        `🎫 Билеты для сессии ${session.campaign.name}:\n${list.join('\n')}`,
        this.defaultKeyboardOpts,
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
        await ctx.reply('🔒 У вас нет билетов.', this.defaultKeyboardOpts);
        return;
      }
      const list = tickets
        .map(
          (t) =>
            `[${t.id}] ${
              t.session.campaign.name
            } (${t.session.dateTime.toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
            })}) ${this.statusEmojis[t.status]} ${
              this.ticketTypeEmojis[t.drop]
            }`,
        )
        .join('\n');
      await ctx.reply(`🎫 Ваши билеты:\n${list}`, this.defaultKeyboardOpts);
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
        await ctx.reply('🔒 Пример: /permanent <campaignId>', {
          reply_markup: {
            keyboard: [[{ text: '/list_campaigns' }]],
          },
        });
        return;
      }
      const [campaignIdStr] = args;
      const campaignId = parseInt(campaignIdStr, 10);
      if (isNaN(campaignId)) {
        await ctx.reply('🔒 campaignId должен быть числом.', {
          reply_markup: {
            keyboard: [[{ text: '/list_campaigns' }]],
          },
        });
        return;
      }
      await this.ticketService.createPermanentTicket(user.id, campaignId);
      await ctx.reply(
        '🎫 Постоянный билет зарегистрирован!',
        this.defaultKeyboardOpts,
      );
    });
  }

  @Command('cancel')
  async cancel(@Ctx() ctx: Context) {
    await this.handle(ctx, async (ctx) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.userService.findByTelegramId(telegramId);
      const session = await this.campaignService.getNextSession();
      const ticket = user.tickets.find((t) => t.sessionId === session.id);
      if (!ticket) {
        await ctx.reply(
          '🔒 У вас нет билета для этой сессии.',
          this.defaultKeyboardOpts,
        );
        return;
      }
      await this.ticketService.cancelTicket(ticket.id, user.id);
      await ctx.reply('🤝 Билет отменен.', this.defaultKeyboardOpts);
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
        this.defaultKeyboardOpts,
      );
    });
  }
}
