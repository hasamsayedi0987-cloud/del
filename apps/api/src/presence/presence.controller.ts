import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PresenceDto } from '@del/shared-types';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PresenceService } from './presence.service';

@ApiTags('presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /** وضعیت حضور یک کاربر (آنلاین / آخرین بازدید) */
  @Get(':id/presence')
  async getPresence(@Param('id') id: string): Promise<PresenceDto> {
    return this.presence.get(id);
  }
}
