import { Injectable, NotFoundException } from '@nestjs/common';
import { Session } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { DateTime } from 'luxon';

@Injectable()
export class CampaignService {
  constructor(private readonly prisma: PrismaService) {}

  async createCampaign(name: string, maxTickets: number) {
    const scheduleOrder = (await this.prisma.campaign.count()) + 1;
    return this.prisma.campaign.create({
      data: { name, maxTickets, scheduleOrder },
    });
  }

  async listCampaigns() {
    return this.prisma.campaign.findMany({
      orderBy: { scheduleOrder: 'desc' },
      select: {
        id: true,
        name: true,
        maxTickets: true,
        scheduleOrder: true,
        dungeonMasterId: true,
        sessions: true,
      },
    });
  }

  async getCampaignById(campaignId: number) {
    return this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
  }

  async createSession(campaignId: number, dateTime: Date) {
    return this.prisma.session.create({
      data: { campaignId, dateTime },
    });
  }

  async cancelSession(sessionId: number) {
    await this.prisma.ticket.deleteMany({
      where: { sessionId },
    });
    return this.prisma.session.delete({
      where: { id: sessionId },
    });
  }

  async listSessionsForCampaign(campaignId: number) {
    return this.prisma.session.findMany({
      where: { campaignId },
      orderBy: { dateTime: 'asc' },
    });
  }

  async getNextSessionForCampaign(campaignId: number) {
    return this.prisma.session.findFirst({
      where: {
        campaignId,
        dateTime: { gte: new Date() },
      },
      include: {
        campaign: true,
        tickets: {
          include: {
            user: true,
          },
        },
      },
      orderBy: { dateTime: 'asc' },
    });
  }

  async getNextSession() {
    let session: Awaited<
      ReturnType<CampaignService['getNextSessionForCampaign']>
    > = null;
    const allCampaigns = await this.listCampaigns();
    for (const c of allCampaigns) {
      const s = await this.getNextSessionForCampaign(c.id);
      if (s && (!session || s.dateTime < session.dateTime)) {
        session = s;
      }
    }

    if (!session) {
      throw new NotFoundException('🔒 Запланированных сессий не найдено');
    }
    return session;
  }

  getHoursToSession(session: Session) {
    const now = DateTime.now().setZone('Europe/Moscow');
    const sessionTime = DateTime.fromJSDate(session.dateTime).setZone(
      'Europe/Moscow',
    );
    const msToSession =
      sessionTime.toJSDate().getTime() - now.toJSDate().getTime();
    const hToSession = msToSession / (60 * 60 * 1000);

    return hToSession;
  }
}
