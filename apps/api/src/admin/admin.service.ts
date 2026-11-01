import { HttpException, Injectable, Logger } from '@nestjs/common';
import type {
  AdminMetrics,
  AdminUserDto,
  AdminUserPage,
  AuditLogDto,
  ReportDto,
  ReportPage,
} from '@del/shared-types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../infra/prisma.service';
import { MessagesGateway } from '../messages/messages.gateway';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly gateway: MessagesGateway,
  ) {}

  // ————— کاربران —————

  async listUsers(opts: {
    q?: string;
    page?: number;
    pageSize?: number;
    blocked?: boolean;
  }): Promise<AdminUserPage> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(Math.max(1, opts.pageSize ?? 25), 100);
    const q = opts.q?.trim();
    const where = {
      ...(q
        ? {
            OR: [
              { phone: { contains: q, mode: 'insensitive' as const } },
              { displayName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(opts.blocked !== undefined ? { blockedAt: opts.blocked ? { not: null } : null } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          phone: true,
          displayName: true,
          role: true,
          blockedAt: true,
          lastSeenAt: true,
          createdAt: true,
          _count: {
            select: {
              participations: true,
              messages: true,
              devices: true,
              reportsAgainst: true,
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((u) => this.toAdminUserDto(u)),
      total,
      page,
      pageSize,
    };
  }

  async getUser(id: string): Promise<AdminUserDto> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        displayName: true,
        role: true,
        blockedAt: true,
        lastSeenAt: true,
        createdAt: true,
        _count: {
          select: {
            participations: true,
            messages: true,
            devices: true,
            reportsAgainst: true,
          },
        },
      },
    });
    if (!u) throw httpError(404, 'USER_NOT_FOUND', 'User does not exist');
    return this.toAdminUserDto(u);
  }

  /**
   * مسدودسازی حساب توسط ادمین — همزمان:
   * ۱) ثبت blockedAt  ۲) ابطال همه refresh tokenها  ۳) قطع socketهای WS
   * ۴) ثبت در دفتر اقدامات (audit)
   */
  async blockUser(actorId: string, actorName: string | null, userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User does not exist');
    if (user.role === 'admin') {
      throw httpError(409, 'CANNOT_BLOCK_ADMIN', 'Admins cannot be blocked from the panel');
    }
    if (userId === actorId) {
      throw httpError(409, 'CANNOT_BLOCK_SELF', 'You cannot block yourself');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { blockedAt: new Date() },
      }),
      // همه نشست‌ها باطل می‌شوند — گارد زندهٔ JWT هم مسیرهای API را همان لحظه می‌بندد
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          actorName,
          action: 'user.block',
          targetType: 'user',
          targetId: userId,
          meta: { reason: reason ?? null, phone: user.phone },
        },
      }),
    ]);

    // قطع فوری socketها — رویداد → gateway (emit + disconnect)
    this.events.emit('admin.user.blocked', { userId, reason: reason ?? null });
    this.logger.warn(`Admin ${actorId} blocked user ${userId} (${reason ?? 'no reason'})`);
    return this.getUser(userId);
  }

  async unblockUser(actorId: string, actorName: string | null, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User does not exist');
    if (!user.blockedAt) {
      throw httpError(409, 'NOT_BLOCKED', 'User is not blocked');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { blockedAt: null },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          actorName,
          action: 'user.unblock',
          targetType: 'user',
          targetId: userId,
          meta: { phone: user.phone },
        },
      }),
    ]);
    this.logger.log(`Admin ${actorId} unblocked user ${userId}`);
    return this.getUser(userId);
  }

  // ————— گزارش‌ها —————

  async listReports(opts: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ReportPage> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(Math.max(1, opts.pageSize ?? 25), 100);
    const where = opts.status ? { status: opts.status } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userReport.count({ where }),
      this.prisma.userReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          reporter: { select: { id: true, displayName: true, phone: true } },
          reported: { select: { id: true, displayName: true, phone: true, blockedAt: true } },
        },
      }),
    ]);
    return {
      items: rows.map((r) => this.toReportDto(r)),
      total,
      page,
      pageSize,
    };
  }

  /** رسیدگی به گزارش — resolve یا dismiss با یادداشت ادمین */
  async handleReport(
    actorId: string,
    actorName: string | null,
    reportId: string,
    action: 'resolve' | 'dismiss',
    note?: string,
  ): Promise<ReportDto> {
    const report = await this.prisma.userReport.findUnique({ where: { id: reportId } });
    if (!report) throw httpError(404, 'REPORT_NOT_FOUND', 'Report does not exist');
    if (report.status !== 'open') {
      throw httpError(409, 'REPORT_HANDLED', 'This report has already been handled');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.userReport.update({
        where: { id: reportId },
        data: {
          status: action === 'resolve' ? 'resolved' : 'dismissed',
          resolution: note ?? null,
          handledBy: actorId,
          handledAt: new Date(),
        },
        include: {
          reporter: { select: { id: true, displayName: true, phone: true } },
          reported: { select: { id: true, displayName: true, phone: true, blockedAt: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          actorName,
          action: action === 'resolve' ? 'report.resolve' : 'report.dismiss',
          targetType: 'report',
          targetId: reportId,
          meta: { reportedUserId: report.reportedId, note: note ?? null },
        },
      });
      return row;
    });
    return this.toReportDto(updated);
  }

  // ————— متریک‌ها —————

  async metrics(): Promise<AdminMetrics> {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000);
    const [
      usersTotal,
      adminsTotal,
      blockedTotal,
      convTotal,
      convDirect,
      msgTotal,
      msg24h,
      mediaTotal,
      mediaBytes,
      callsTotal,
      calls24h,
      reportsOpen,
      reportsTotal,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'admin' } }),
      this.prisma.user.count({ where: { blockedAt: { not: null } } }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { type: 'direct' } }),
      this.prisma.message.count(),
      this.prisma.message.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.mediaAsset.count(),
      this.prisma.mediaAsset.aggregate({ _sum: { size: true } }),
      this.prisma.call.count(),
      this.prisma.call.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.userReport.count({ where: { status: 'open' } }),
      this.prisma.userReport.count(),
    ]);
    void now;
    return {
      users: { total: usersTotal, admins: adminsTotal, blocked: blockedTotal },
      conversations: { total: convTotal, direct: convDirect, group: convTotal - convDirect },
      messages: { total: msgTotal, last24h: msg24h },
      media: { total: mediaTotal, bytes: mediaBytes._sum.size ?? 0 },
      calls: { total: callsTotal, last24h: calls24h },
      reports: { open: reportsOpen, total: reportsTotal },
      onlineNow: this.gateway.onlineCount(),
    };
  }

  async audit(limit = 50): Promise<{ items: AuditLogDto[] }> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(1, limit), 200),
    });
    return {
      items: rows.map((a) => ({
        id: a.id,
        actorId: a.actorId,
        actorName: a.actorName,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        meta: (a.meta as Record<string, unknown> | null) ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  // ————— مبدل‌ها —————

  private toAdminUserDto(u: {
    id: string;
    phone: string | null;
    displayName: string | null;
    role: string;
    blockedAt: Date | null;
    lastSeenAt: Date | null;
    createdAt: Date;
    _count: { participations: number; messages: number; devices: number; reportsAgainst: number };
  }): AdminUserDto {
    return {
      id: u.id,
      phone: u.phone,
      displayName: u.displayName,
      role: u.role as AdminUserDto['role'],
      blockedAt: u.blockedAt?.toISOString() ?? null,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      stats: {
        conversations: u._count.participations,
        messages: u._count.messages,
        devices: u._count.devices,
        reportsAgainst: u._count.reportsAgainst,
      },
    };
  }

  private toReportDto(r: {
    id: string;
    reporter: { id: string; displayName: string | null; phone: string | null };
    reported: { id: string; displayName: string | null; phone: string | null; blockedAt: Date | null };
    conversationId: string | null;
    reason: string;
    note: string | null;
    status: string;
    resolution: string | null;
    handledBy: string | null;
    handledAt: Date | null;
    createdAt: Date;
  }): ReportDto {
    return {
      id: r.id,
      reporter: r.reporter,
      reported: { ...r.reported, blockedAt: r.reported.blockedAt?.toISOString() ?? null },
      conversationId: r.conversationId,
      reason: r.reason as ReportDto['reason'],
      note: r.note,
      status: r.status as ReportDto['status'],
      resolution: r.resolution,
      handledBy: r.handledBy,
      handledAt: r.handledAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
