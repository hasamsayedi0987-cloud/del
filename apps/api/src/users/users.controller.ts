import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';
import type { UserDto } from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { toE164 } from '../auth/phone.util';

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

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@Req() req: AuthedRequest): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      about: user.about,
      aiConsent: user.aiConsent,
      createdAt: user.createdAt.toISOString(),
    };
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
    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      about: user.about,
      aiConsent: user.aiConsent,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** یافتن کاربر برای شروع گفتگو — فقط حداقل اطلاعات عمومی */
  @Get('by-phone/:phone')
  async byPhone(@Req() req: AuthedRequest, @Param('phone') phone: string) {
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
}
