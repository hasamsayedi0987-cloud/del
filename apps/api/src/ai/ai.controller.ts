/**
 * گام ۹ — کنترلرهای هوش مصنوعی
 *  /ai/*            — قابلیت‌ها + رضایت کلی + وضعیت + مصرف
 *  /conversations/:id/ai-consent — رضایت گفتگو-محور (کنترلر دوم همین ماژول)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { AiService } from './ai.service';
import {
  FixDto,
  SetAiConsentDto,
  SetConversationAiConsentDto,
  SuggestDto,
  SummarizeDto,
  TranslateDto,
  UsageQueryDto,
} from './dto/ai.dto';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** وضعیت قابلیت AI برای من — آیا سرور provider دارد و رضایت من چیست */
  @Get('status')
  status(@Req() req: AuthedRequest) {
    return this.ai.status(req.user.sub);
  }

  /** رضایت کلی — بدون آن هیچ محتوایی به سرویس AI نمی‌رود */
  @Patch('consent')
  setConsent(@Req() req: AuthedRequest, @Body() dto: SetAiConsentDto) {
    return this.ai.setGlobalConsent(req.user.sub, dto.enabled);
  }

  /** ترجمهٔ یک پیام — پیام‌های رمز سرتاسری 422 می‌دهند */
  @Post('translate')
  @HttpCode(200)
  translate(@Req() req: AuthedRequest, @Body() dto: TranslateDto) {
    return this.ai.translate(req.user.sub, dto.messageId, dto.target);
  }

  /** اصلاح نگارشی پیش‌نویس */
  @Post('fix')
  @HttpCode(200)
  fix(@Req() req: AuthedRequest, @Body() dto: FixDto) {
    return this.ai.fix(req.user.sub, dto.text);
  }

  /** پیشنهاد پاسخ بر اساس آخرین پیام‌های گفتگو */
  @Post('suggest')
  @HttpCode(200)
  suggest(@Req() req: AuthedRequest, @Body() dto: SuggestDto) {
    return this.ai.suggest(req.user.sub, dto.conversationId, dto.count ?? 3);
  }

  /** خلاصهٔ گفتگو — کل یا فقط خوانده‌نشده‌ها */
  @Post('summarize')
  @HttpCode(200)
  summarize(@Req() req: AuthedRequest, @Body() dto: SummarizeDto) {
    return this.ai.summarize(
      req.user.sub,
      dto.conversationId,
      dto.limit ?? 20,
      dto.unreadOnly ?? false,
    );
  }

  /** مصرف من — فقط متادیتا برای کنترل هزینه */
  @Get('usage')
  usage(@Req() req: AuthedRequest, @Query() q: UsageQueryDto) {
    return this.ai.usage(req.user.sub, q.limit ?? 50, q.feature);
  }
}

/** رضایت گفتگو-محور — عضو می‌تواند در یک گفتگو خاص رضایتش را override کند */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationAiConsentController {
  constructor(private readonly ai: AiService) {}

  @Patch(':id/ai-consent')
  setConsent(
    @Req() req: AuthedRequest,
    @Param('id') conversationId: string,
    @Body() dto: SetConversationAiConsentDto,
  ) {
    return this.ai.setConversationConsent(req.user.sub, conversationId, dto.enabled ?? null);
  }
}
