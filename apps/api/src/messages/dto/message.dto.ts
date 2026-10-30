import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class SendMessageDto {
  /** شناسه یگانه پیام تولید سمت کلاینت (UUID) — تضمین تحویل بدون تکرار */
  @ApiProperty({ example: '6f1c2a4e-1d2b-4c3a-9e5f-0a1b2c3d4e5f' })
  @IsUUID()
  clientMsgId!: string;

  /** متن یا کپشن — برای پیام رسانه‌ای اختیاری است؛ در پیام E2EE پاکت رمز است */
  @ApiProperty({ example: 'سلام! این اولین پیام دل است 👋' })
  @IsOptional()
  @IsString()
  @Length(0, 30000)
  body?: string;

  /** رمزنگاری سرتاسری (گام ۸) — body پاکت رمز multi-device است */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isE2ee?: boolean;

  /** پیام رسانه‌ای (گام ۵) — MediaAsset با status=ready متعلق به خودم در همین مکالمه */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mediaId?: string;
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

  /** cursor همگام‌سازی آفلاین: فقط پیام‌های با serverSeq بیشتر از این مقدار (صعودی) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
