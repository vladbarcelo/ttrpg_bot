import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CampaignService {
  constructor(private readonly prisma: PrismaService) {}

  async createCampaign(
    name: string,
    maxTickets: number,
    scheduleOrder: number,
  ) {
    return this.prisma.campaign.create({
      data: { name, maxTickets, scheduleOrder },
    });
  }

  async listCampaigns() {
    return this.prisma.campaign.findMany({
      orderBy: { scheduleOrder: 'asc' },
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
      },
      orderBy: { dateTime: 'asc' },
    });
  }
}
