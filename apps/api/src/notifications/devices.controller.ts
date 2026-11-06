import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { DeviceDto, PushTokenResponse } from '@del/shared-types';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { PrismaService } from '../infra/prisma.service';

export class RegisterPushTokenDto {
  /** توکن push دستگاه — توکن Expo (ExpoPushToken[…]) یا توکن بومی پلتفرم */
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  token!: string;
}

/**
 * مدیریت دستگاه‌ها و توکن push (گام ۷).
 * توکن push فقط سمت سرور ذخیره می‌شود و هرگز در پاسخ API برنمی‌گردد.
 */
@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly prisma: PrismaService) {}

  /** فهرست دستگاه‌های من */
  @Get()
  async listMine(@Req() req: AuthedRequest): Promise<DeviceDto[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: 'asc' },
    });
    return devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      name: d.name,
      pushRegistered: Boolean(d.pushToken),
      lastActiveAt: d.lastActiveAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    }));
  }

  /** ثبت/به‌روزرسانی توکن push این دستگاه (در JWT: did) */
  @Post('push-token')
  @HttpCode(200)
  async registerToken(
    @Req() req: AuthedRequest,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<PushTokenResponse> {
    if (!req.user.did) {
      // نشست بدون دستگاه (مثلاً توکن اسکریپت/وب بدون deviceName) — ثبت ممکن نیست
      return { deviceId: null, registered: false };
    }
    await this.prisma.device.updateMany({
      where: { id: req.user.did, userId: req.user.sub },
      data: { pushToken: dto.token, lastActiveAt: new Date() },
    });
    return { deviceId: req.user.did, registered: true };
  }

  /** حذف توکن push این دستگاه — هنگام خروج از حساب */
  @Delete('push-token')
  @HttpCode(200)
  async removeToken(@Req() req: AuthedRequest): Promise<PushTokenResponse> {
    if (!req.user.did) return { deviceId: null, registered: false };
    await this.prisma.device.updateMany({
      where: { id: req.user.did, userId: req.user.sub },
      data: { pushToken: null },
    });
    return { deviceId: req.user.did, registered: false };
  }
}
