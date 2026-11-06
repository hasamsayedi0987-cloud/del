import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateConversationDto {
  /** کاربر طرف گفتگوی مستقیم (direct) */
  @ApiProperty({ example: '8dbadf6e-e4c2-404c-ad3e-1db17bbd8fd9' })
  @IsUUID()
  userId!: string;
}
