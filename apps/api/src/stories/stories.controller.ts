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
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../infra/prisma.service';
import { StoriesService } from './stories.service';
import type { StoryDto, StoryGroupDto } from '@del/shared-types';

class CreateStoryDto {
  kind: 'text' | 'image';
  text?: string;
  bgKey?: string;
  textColor?: string;
  /** تصویر base64 (بدون پیشوند data:) — فقط برای kind=image */
  imageData?: string;
  imageMime?: string;
}

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(
    private readonly stories: StoriesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async create(@Req() req: { user: { sub: string } }, @Body() dto: CreateStoryDto): Promise<StoryDto> {
    return this.stories.create(req.user.sub, dto);
  }

  @Get()
  async list(@Req() req: { user: { sub: string } }): Promise<{ groups: StoryGroupDto[] }> {
    return this.stories.list(req.user.sub);
  }

  /** بایت تصویر استوری — با کش مرورگر/CDN */
  @Get(':id/media')
  @Header('Cache-Control', 'private, max-age=86400')
  async media(
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

  @Post(':id/view')
  async view(@Req() req: { user: { sub: string } }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.stories.view(req.user.sub, id);
  }

  @Delete(':id')
  async remove(@Req() req: { user: { sub: string } }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.stories.remove(req.user.sub, id);
  }
}
