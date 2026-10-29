import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export class StartCallDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  conversationId!: string;

  /** نوع تماس — صوتی یا تصویری */
  @ApiProperty({ enum: ['audio', 'video'] })
  @IsIn(['audio', 'video'])
  kind!: 'audio' | 'video';
}
