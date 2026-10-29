import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class SendMessageDto {
  /** شناسه یگانه پیام تولید سمت کلاینت (UUID) — تضمین تحویل بدون تکرار */
  @ApiProperty({ example: '6f1c2a4e-1d2b-4c3a-9e5f-0a1b2c3d4e5f' })
  @IsUUID()
  clientMsgId!: string;

  @ApiProperty({ example: 'سلام! این اولین پیام دل است 👋' })
  @IsString()
  @Length(1, 4000)
  body!: string;
}

export class MarkReadDto {
  @ApiProperty({ example: 42 })
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  lastReadSeq!: number;
}

export class ListMessagesQuery {
  /** cursor: فقط پیام‌های با serverSeq کمتر از این مقدار (صفحه قبل) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  before?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
