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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
    phone: string | null;
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

  /** یافتن کاربر با ایمیل — برای شروع گفتگو در اپ ایمیل‌محور (v1.4) */
  @Get('by-email/:email')
  async byEmail(@Req() req: AuthedRequest, @Param('email') email: string): Promise<{
    id: string;
    displayName: string | null;
    email: string | null;
  }> {
    void req;
    const normalized = decodeURIComponent(email).trim().toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
    const user = valid
      ? await this.prisma.user.findUnique({ where: { email: normalized } })
      : null;
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'USER_NOT_FOUND', message: 'No user with this email' },
      });
    }
    return { id: user.id, displayName: user.displayName, email: user.email };
  }

  // ————— عکس پروفایل (v1.4) — تصویر کوچک در دیتابیس —————

  /** آپلود آواتار — jpeg/png base64؛ سمت کلاینت به 256px فشرده می‌شود */
  @Post('me/avatar')
  async uploadAvatar(@Req() req: AuthedRequest, @Body() dto: { imageData?: string; mime?: string }): Promise<UserDto> {
    const raw = (dto.imageData ?? '').replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (buf.length < 64 || buf.length > 512 * 1024) {
      throw new HttpException(
        { statusCode: 400, error: { code: 'AVATAR_TOO_BIG', message: 'تصویر باید بین ۶۴ بایت تا ۵۱۲ کیلوبایت باشد' } },
        400,
      );
    }
    const mime = dto.mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const user = await this.prisma.user.update({
      where: { id: req.user.sub },
      data: { avatarImage: buf, avatarMime: mime },
    });
    return this.toUserDto(user);
  }

  /** حذف آواتار */
  @Delete('me/avatar')
  async removeAvatar(@Req() req: AuthedRequest): Promise<UserDto> {
    const user = await this.prisma.user.update({
      where: { id: req.user.sub },
      data: { avatarImage: null, avatarMime: null },
    });
    return this.toUserDto(user);
  }

  /** بایت آواتار کاربر — با کش نسخه‌دار (پارامتر v در آدرس) */
  @Get(':id/avatar')
  async avatar(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    void req;
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { avatarImage: true, avatarMime: true },
    });
    if (!u?.avatarImage) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'AVATAR_NOT_FOUND', message: 'بدون عکس پروفایل' },
      });
    }
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.type(u.avatarMime ?? 'image/jpeg').send(Buffer.from(u.avatarImage));
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
    phone: string | null;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    avatarImage?: Uint8Array | null;
    updatedAt?: Date;
    about: string | null;
    aiConsent: boolean;
    role: string;
    createdAt: Date;
  }): UserDto {
    // آواتار در v1.4 داخل دیتابیس است — آدرس عمومی با نسخه برای شکستن کش
    const avatarUrl =
      u.avatarImage && u.updatedAt
        ? `/api/v1/users/${u.id}/avatar?v=${u.updatedAt.getTime()}`
        : u.avatarUrl;
    return {
      id: u.id,
      phone: u.phone,
      email: u.email,
      displayName: u.displayName,
      avatarUrl,
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
