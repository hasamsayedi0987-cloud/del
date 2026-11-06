import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { PrismaService } from '../infra/prisma.service';
import { MediaService } from '../media/media.service';
import { StoriesService } from './stories.service';
import type { StoryDto, StoryGroupDto } from '@del/shared-types';

/**
 * نکته: این DTO باید decorator داشته باشد — ValidationPipe سراسری با
 * whitelist:true فیلدهای بدون decorator را حذف می‌کند و متن استوری «خالی» می‌شد.
 */
const STORY_KINDS = ['text', 'image', 'video'] as const;

class CreateStoryDto {
  @IsIn(STORY_KINDS)
  kind!: (typeof STORY_KINDS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bgKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  textColor?: string;

  /** مسیر تازه — asset آمادهٔ pipeline (تصویر فشرده یا ویدیو ≤۶۰s) متعلق به خودم */
  @IsOptional()
  @IsUUID()
  mediaId?: string;

  /** مسیر legacy — تصویر base64 (بدون پیشوند data:) — فقط برای kind=image */
  @IsOptional()
  @IsString()
  @MaxLength(4 * 1024 * 1024)
  imageData?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  imageMime?: string;
}

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(
    private readonly stories: StoriesService,
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  @Post()
  async create(@Req() req: { user: { sub: string } }, @Body() dto: CreateStoryDto): Promise<StoryDto> {
    return this.stories.create(req.user.sub, dto);
  }

  @Get()
  async list(@Req() req: { user: { sub: string } }): Promise<{ groups: StoryGroupDto[] }> {
    return this.stories.list(req.user.sub);
  }

  /** بایت تصویر استوری قدیمی (مسیر legacy در DB) — با کش مرورگر/CDN */
  @Get(':id/media')
  @Header('Cache-Control', 'private, max-age=86400')
  async legacyMedia(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    void req;
    const s = await this.prisma.story.findUnique({
      where: { id },
      select: { mediaData: true, mediaMime: true, expiresAt: true },
    });
    if (!s || !s.mediaData || s.expiresAt < new Date()) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'STORY_NOT_FOUND', message: 'استوری پیدا نشد یا منقضی شد' },
      });
    }
    res.type(s.mediaMime ?? 'image/jpeg').send(Buffer.from(s.mediaData));
  }

  /** URL امضاشدهٔ رسانهٔ استوری (تصویر تازه/ویدیو) — دسترسی با گفتگوی مشترک چک می‌شود */
  @Get(':id/url')
  async url(@Req() req: AuthedRequest, @Param('id') id: string): Promise<{
    url: string;
    expiresAt: string;
    kind: string;
    mime: string;
  }> {
    return this.stories.urlFor(req.user.sub, id, this.media.publicBaseOf(req));
  }

  @Post(':id/view')
  async view(@Req() req: { user: { sub: string } }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.stories.view(req.user.sub, id);
  }

  @Delete(':id')
  async remove(@Req() req: { user: { sub: string } }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.stories.remove(req.user.sub, id);
  }
}
