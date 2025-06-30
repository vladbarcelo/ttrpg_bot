import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DropType, TicketStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { DateTime } from 'luxon';

@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}

  async bookTicket(sessionId: number, userId: number, drop: DropType) {
    // Check if session exists
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { campaign: true, tickets: true },
    });
    if (!session) throw new NotFoundException('Сессия не найдена');
    // Check if user already has a ticket for this session
    const existing = await this.prisma.ticket.findFirst({
      where: { sessionId, userId },
    });
    if (existing) throw new ForbiddenException('Билет уже забронирован');
    // check if drop is valid
    const now = DateTime.now().setZone('Europe/Moscow');
    const sessionTime = DateTime.fromJSDate(session.dateTime).setZone(
      'Europe/Moscow',
    );
    const hoursToSession = sessionTime.diff(now, 'hours').hours;
    if (hoursToSession > 24 && drop === DropType.NON_PRIORITY) {
      throw new ForbiddenException('Слишком рано для бронирования');
    }
    // Check if max tickets reached
    const count = await this.prisma.ticket.count({
      where: {
        sessionId,
      },
    });
    if (count >= session.campaign.maxTickets)
      throw new ForbiddenException('Билеты закончились');

    let status: TicketStatus = TicketStatus.BOOKED;
    if (drop === DropType.PERMANENT) status = TicketStatus.CONFIRMED;
    if (drop === DropType.NON_PRIORITY) status = TicketStatus.CONFIRMED;

    // Book ticket
    return this.prisma.ticket.create({
      data: {
        sessionId,
        userId,
        status,
        drop,
      },
    });
  }

  async confirmTicket(ticketId: number, userId: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { session: true },
    });
    if (!ticket || ticket.userId !== userId)
      throw new NotFoundException('Билет не найден');

    const now = DateTime.now().setZone('Europe/Moscow');
    const sessionTime = DateTime.fromJSDate(ticket.session.dateTime).setZone(
      'Europe/Moscow',
    );
    const hoursToSession = sessionTime.diff(now, 'hours').hours;

    if (
      ticket.drop === DropType.PERMANENT ||
      ticket.drop === DropType.NON_PRIORITY
    )
      throw new ForbiddenException('🔒 Ваш билет не нужно подтверждать');

    if (ticket.status === TicketStatus.CONFIRMED)
      throw new ForbiddenException('🔒 Билет уже подтвержден');

    if (ticket.drop === DropType.PRIORITY && hoursToSession > 25)
      throw new ForbiddenException('⌛ Слишком рано для подтверждения');

    if (hoursToSession < 24)
      throw new ForbiddenException('⏰ Слишком поздно для подтверждения');

    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.CONFIRMED, confirmedAt: new Date() },
    });
  }

  async listUserTickets(userId: number) {
    return this.prisma.ticket.findMany({
      where: { userId },
      include: { session: { include: { campaign: true } } },
      orderBy: { session: { dateTime: 'desc' } },
    });
  }

  async cancelTicket(ticketId: number, userId: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || ticket.userId !== userId)
      throw new NotFoundException('🔒 Билет не найден');
    return this.prisma.ticket.delete({
      where: { id: ticketId },
    });
  }

  async createPermanentTicket(userId: number, campaignId: number) {
    // Only allow if not already exists
    const existing = await this.prisma.permanentTicket.findFirst({
      where: { userId },
    });
    if (existing)
      throw new ForbiddenException('🔒 У вас уже есть постоянный билет');
    return this.prisma.permanentTicket.create({ data: { userId, campaignId } });
  }

  async listPermanentTickets(userId: number) {
    return this.prisma.permanentTicket.findMany({
      where: { userId },
      include: { campaign: true },
    });
  }

  async listPermanentTicketsForCampaign(campaignId: number) {
    return this.prisma.permanentTicket.findMany({
      where: { campaignId },
    });
  }
}
