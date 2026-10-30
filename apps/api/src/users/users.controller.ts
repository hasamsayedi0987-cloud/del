import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { BlockListDto, ReportDto, UserDto } from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { RateLimitService } from '../common/rate-limit.service';
import { toE164 } from '../auth/phone.util';
import { BlocksService } from './blocks.service';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  about?: string;

  /** رضایت کلی هوش مصنوعی (گام ۹) — اختیاری در PATCH /users/me */
  @IsOptional()
  @IsBoolean()
  aiConsent?: boolean;
}

const REPORT_REASONS = ['spam', 'abuse', 'impersonation', 'other'] as const;

class CreateReportDto {
  @IsIn(REPORT_REASONS)
  reason!: (typeof REPORT_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** گفتگوی مرتبط (اختیاری) برای زمینه رسیدگی ادمین */
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}


@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('me')
  async me(@Req() req: AuthedRequest): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) throw new NotFoundException('User not found');
    return this.toUserDto(user);
  }

  @Patch('me')
  async updateMe(@Req() req: AuthedRequest, @Body() dto: UpdateMeDto): Promise<UserDto> {
    const user = await this.prisma.user.update({
      where: { id: req.user.sub },
      data: {
        displayName: dto.displayName,
        about: dto.about,
        ...(dto.aiConsent === undefined ? {} : { aiConsent: dto.aiConsent }),
      },
    });
    return this.toUserDto(user);
  }

  /** یافتن کاربر برای شروع گفتگو — فقط حداقل اطلاعات عمومی */
  @Get('by-phone/:phone')
  async byPhone(@Req() req: AuthedRequest, @Param('phone') phone: string): Promise<{
    id: string;
    displayName: string | null;
    phone: string;
  }> {
    void req;
    const e164 = toE164(decodeURIComponent(phone));
    const user = e164
      ? await this.prisma.user.findUnique({ where: { phone: e164 } })
      : null;
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'USER_NOT_FOUND', message: 'No user with this phone' },
      });
    }
    return { id: user.id, displayName: user.displayName, phone: user.phone };
  }

  // ————— مسدودسازی و گزارش (گام ۱۰) —————

  /** فهرست مسدودسازی‌های من */
  @Get('me/blocks')
  async myBlocks(@Req() req: AuthedRequest): Promise<BlockListDto> {
    return this.blocks.listMine(req.user.sub);
  }

  /** مسدودسازی کاربر — گفتگوهای مستقیم دوطرفه بسته می‌شود */
  @Post(':id/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.blocks.block(req.user.sub, id);
  }

  /** رفع مسدودسازی */
  @Delete(':id/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.blocks.unblock(req.user.sub, id);
  }

  /**
   * گزارش سوءاستفاده — صف رسیدگی ادمین
   * سقف نرخ: ۲۰ گزارش در ساعت برای هر کاربر؛ برای هر (گزارش‌دهنده، هدف) فقط یک
   * گزارش «باز» — گزارش تکراری همان رکورد برمی‌گرداند (idempotent).
   */
  @Post(':id/report')
  @HttpCode(HttpStatus.OK)
  async report(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: CreateReportDto,
  ): Promise<{ report: ReportDto; duplicate: boolean }> {
    await this.rateLimit.hit(`report:${req.user.sub}`, 3600, 20);
    if (id === req.user.sub) {
      throw new HttpException(
        {
          statusCode: 400,
          error: { code: 'CANNOT_REPORT_SELF', message: 'You cannot report yourself' },
        },
        400,
      );
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'USER_NOT_FOUND', message: 'User does not exist' },
      });
    }

    const open = await this.prisma.userReport.findFirst({
      where: { reporterId: req.user.sub, reportedId: id, status: 'open' },
    });
    if (open) {
      return { report: this.toReportDto(open), duplicate: true };
    }

    const created = await this.prisma.userReport.create({
      data: {
        reporterId: req.user.sub,
        reportedId: id,
        conversationId: dto.conversationId ?? null,
        reason: dto.reason,
        note: dto.note ?? null,
      },
    });
    return { report: this.toReportDto(created), duplicate: false };
  }

  // ————— مبدل —————

  private toUserDto(u: {
    id: string;
    phone: string;
    displayName: string | null;
    avatarUrl: string | null;
    about: string | null;
    aiConsent: boolean;
    role: string;
    createdAt: Date;
  }): UserDto {
    return {
      id: u.id,
      phone: u.phone,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      about: u.about,
      aiConsent: u.aiConsent,
      role: u.role as UserDto['role'],
      createdAt: u.createdAt.toISOString(),
    };
  }

  private toReportDto(r: {
    id: string;
    reporterId: string;
    reportedId: string;
    conversationId: string | null;
    reason: string;
    note: string | null;
    status: string;
    resolution: string | null;
    handledBy: string | null;
    handledAt: Date | null;
    createdAt: Date;
  }): ReportDto {
    // فهرست‌های ادمین گزارشِ کامل با کاربران می‌سازند؛ این نسخه مینیمال برای پاسخ کاربر است
    return {
      id: r.id,
      reporter: { id: r.reporterId, displayName: null, phone: '' },
      reported: { id: r.reportedId, displayName: null, phone: '', blockedAt: null },
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
