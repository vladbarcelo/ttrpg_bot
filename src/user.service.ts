import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async registerUser(telegramId: string, name: string) {
    return this.prisma.user.upsert({
      where: { telegramId },
      update: { name },
      create: { telegramId, name },
    });
  }

  async findByTelegramId(telegramId: string) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      include: { permanentTickets: true, tickets: true },
    });
    if (!user) {
      throw new ForbiddenException('🔒 Вы должны зарегистрироваться.');
    }

    return user;
  }

  async setAdmin(telegramId: string, isAdmin: boolean) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { isAdmin },
    });
  }

  async setDungeonMaster(telegramId: string, isDungeonMaster: boolean) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { isDungeonMaster },
    });
  }

  async setPriority(telegramId: string, isPriority: boolean) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { isPriority },
    });
  }

  async listAdmins() {
    return this.prisma.user.findMany({ where: { isAdmin: true } });
  }

  async listDungeonMasters() {
    return this.prisma.user.findMany({ where: { isDungeonMaster: true } });
  }

  async listPriorityUsers() {
    return this.prisma.user.findMany({ where: { isPriority: true } });
  }

  checkRole(
    user: any,
    requiredRoles: ('admin' | 'dungeonMaster' | 'priority')[],
  ) {
    if (!user) return false;
    for (const role of requiredRoles) {
      if (role === 'admin' && user.isAdmin) return;
      if (role === 'dungeonMaster' && user.isDungeonMaster) return;
      if (role === 'priority' && user.isPriority) return;
    }

    throw new ForbiddenException('Недостаточно прав.');
  }

  async setUserPriority(telegramId: string, isPriority: boolean) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { isPriority },
    });
  }

  async setUserAsDungeonMaster(telegramId: string, isDungeonMaster: boolean) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { isDungeonMaster },
    });
  }

  async listUsers() {
    return this.prisma.user.findMany();
  }
}
