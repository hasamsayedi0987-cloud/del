import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { MessagesService } from './messages.service';

export class SyncUpdatesQuery {
  /** ISO 8601 cursor — مکالمه‌های تغییریافته پس از این لحظه */
  @IsDateString({}, { message: 'since must be an ISO 8601 timestamp' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  since!: string;
}

export class SyncLimitQuery {
  @Type(() => Number)
  @Min(0)
  @Max(50)
  limit?: number;
}

/**
 * همگام‌سازی چنددستگاهی (گام ۷):
 *  - GET /sync/bootstrap → دستگاه تازه: همه مکالمه‌ها + پروفایل + serverTime
 *  - GET /sync/updates?since=<iso> → فقط مکالمه‌های تغییریافته پس از cursor
 * تاریخچه پیام‌ها با GET /conversations/:id/messages?since=<seq> گرفته می‌شود (گام ۳).
 */
@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly messages: MessagesService) {}

  /** بوت‌استرپ کامل دستگاه تازه */
  @Get('bootstrap')
  bootstrap(@Req() req: AuthedRequest) {
    return this.messages.syncBootstrap(req.user.sub);
  }

  /** همگام‌سازی افزایشی پس از cursor */
  @Get('updates')
  updates(@Req() req: AuthedRequest, @Query() q: SyncUpdatesQuery) {
    const since = new Date(q.since);
    return this.messages.syncUpdates(req.user.sub, since);
  }
}
