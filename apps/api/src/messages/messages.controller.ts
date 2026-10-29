import {
  Body,
  Controller,
  Delete,
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
import type { MessageDto } from '@del/shared-types';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListMessagesQuery, MarkReadDto, SendMessageDto } from './dto/message.dto';
import {
  AddMembersDto,
  CreateGroupDto,
  UpdateGroupDto,
  UpdateMemberRoleDto,
} from './dto/group.dto';

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

  /** تاریخچه پیام‌ها — ?before=<seq> صفحه به عقب، ?since=<seq> همگام‌سازی آفلاین */
  @Get(':id/messages')
  listMessages(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query() q: ListMessagesQuery,
  ) {
    return this.messages.getMessages(req.user.sub, id, {
      before: q.before,
      since: q.since,
      limit: q.limit,
    });
  }

  /** ارسال پیام (idempotent با clientMsgId) — رسانه‌ای یا متنی */
  @Post(':id/messages')
  @HttpCode(201)
  send(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Promise<{ message: MessageDto; duplicate: boolean }> {
    return this.messages.sendMessage(req.user.sub, id, dto.clientMsgId, dto.body, dto.mediaId);
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

  // ————— گروه‌ها (گام ۴) —————

  /** ساخت گروه — سازنده ادمین می‌شود */
  @Post('group')
  createGroup(@Req() req: AuthedRequest, @Body() dto: CreateGroupDto) {
    return this.messages.createGroup(req.user.sub, dto.title, dto.memberUserIds ?? []);
  }

  /** افزودن عضو — فقط ادمین */
  @Post(':id/members')
  @HttpCode(200)
  addMembers(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.messages.addMembers(req.user.sub, id, dto.userIds);
  }

  /** حذف عضو — فقط ادمین */
  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.messages.removeMember(req.user.sub, id, userId);
  }

  /** تغییر نقش عضو — فقط ادمین */
  @Patch(':id/members/:userId')
  @HttpCode(204)
  async updateMemberRole(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<void> {
    await this.messages.updateMemberRole(req.user.sub, id, userId, dto.role);
  }

  /** خروج از گروه */
  @Post(':id/leave')
  @HttpCode(204)
  async leaveGroup(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.messages.leaveGroup(req.user.sub, id);
  }

  /** تغییر نام گروه — فقط ادمین */
  @Patch(':id')
  renameGroup(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.messages.renameGroup(req.user.sub, id, dto.title);
  }
}
