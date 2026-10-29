import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { MessageDto } from '@del/shared-types';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListMessagesQuery, MarkReadDto, SendMessageDto } from './dto/message.dto';

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** ساخت گفتگوی مستقیم با یک کاربر (idempotent) */
  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateConversationDto) {
    return this.messages.createDirect(req.user.sub, dto.userId);
  }

  /** لیست مکالمه‌های من */
  @Get()
  list(@Req() req: AuthedRequest) {
    return this.messages.listMine(req.user.sub);
  }

  /** جزئیات یک مکالمه */
  @Get(':id')
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.messages.getOne(req.user.sub, id);
  }

  /** تاریخچه پیام‌ها با cursor (GET ?before=<seq>&limit=50) */
  @Get(':id/messages')
  listMessages(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query() q: ListMessagesQuery,
  ) {
    return this.messages.getMessages(req.user.sub, id, {
      before: q.before,
      limit: q.limit,
    });
  }

  /** ارسال پیام (idempotent با clientMsgId) */
  @Post(':id/messages')
  @HttpCode(201)
  send(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Promise<{ message: MessageDto; duplicate: boolean }> {
    return this.messages.sendMessage(req.user.sub, id, dto.clientMsgId, dto.body);
  }

  /** علامت‌گذاری خواندن تا lastReadSeq */
  @Post(':id/read')
  @HttpCode(204)
  async markRead(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: MarkReadDto,
  ): Promise<void> {
    await this.messages.markRead(req.user.sub, id, dto.lastReadSeq);
  }
}
