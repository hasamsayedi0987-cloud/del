import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { CallsService } from './calls.service';
import { StartCallDto } from './dto/call.dto';

@ApiTags('calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /** شروع تماس — زنگ به گیرنده می‌خورد (WS call.incoming) */
  @Post()
  @HttpCode(201)
  start(@Req() req: AuthedRequest, @Body() dto: StartCallDto) {
    return this.calls.start(req.user.sub, dto);
  }

  /** پذیرش تماس — دو‌نفره: گیرنده؛ گروهی: هر عضو (اولین پاسخ تماس را فعال می‌کند) */
  @Post(':id/accept')
  @HttpCode(200)
  accept(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.accept(req.user.sub, id);
  }

  /** پیوستن به تماس گروهی فعال — همان پذیرش برای گروه */
  @Post(':id/join')
  @HttpCode(200)
  join(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.join(req.user.sub, id);
  }

  /** ترک تماس گروهی — اگر آخرین عضو باشید تماس برای همه تمام می‌شود */
  @Post(':id/leave')
  @HttpCode(200)
  leave(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.leave(req.user.sub, id);
  }

  /** رد تماس ورودی */
  @Post(':id/reject')
  @HttpCode(204)
  async reject(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.calls.reject(req.user.sub, id);
  }

  /** لغو تماس خروجی پیش از پاسخ */
  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.calls.cancel(req.user.sub, id);
  }

  /** پایان تماس فعال — هر طرف می‌تواند قطع کند */
  @Post(':id/end')
  @HttpCode(200)
  end(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.end(req.user.sub, id);
  }

  /** تاریخچه تماس‌ها — ?conversationId=&before=&limit= */
  @Get()
  history(
    @Req() req: AuthedRequest,
    @Query('conversationId') conversationId?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.calls.history(req.user.sub, {
      conversationId: conversationId || undefined,
      before: before || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
