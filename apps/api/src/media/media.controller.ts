import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { MediaService } from './media.service';
import { CompleteDto, MediaUrlQuery, PresignDto } from './dto/media.dto';

@ApiTags('media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** صدور URL امضاشده آپلود — بایت‌ها مستقیم به S3 می‌روند، نه از API */
  @Post('presign')
  @HttpCode(200)
  presign(@Req() req: AuthedRequest, @Body() dto: PresignDto) {
    return this.media.presign(req.user.sub, dto);
  }

  /** تأیید نهایی آپلود — magic bytes و قواعد سرور اینجا چک می‌شود */
  @Post('complete')
  @HttpCode(200)
  complete(@Req() req: AuthedRequest, @Body() dto: CompleteDto) {
    return this.media.complete(req.user.sub, dto);
  }

  /** متادیتای رسانه */
  @Get(':id')
  meta(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.getMeta(req.user.sub, id);
  }

  /** لینک دانلود امضاشده کوتاه‌عمر — پس از بررسی مجوز */
  @Get(':id/url')
  url(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: MediaUrlQuery,
  ) {
    return this.media.getUrl(req.user.sub, id, q.variant ?? 'original');
  }
}
