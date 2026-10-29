import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PresignDto {
  @ApiProperty({ description: 'مکالمه مقصد — فقط اعضا می‌توانند رسانه آپلود کنند' })
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @Matches(/^[a-z]+\/[a-z0-9.+-]+$/i, { message: 'mime must look like type/subtype' })
  mime!: string;

  @ApiProperty({ example: 245760 })
  @IsInt()
  @Min(1)
  @Max(1024 * 1024 * 1024)
  size!: number;

  @ApiPropertyOptional({ example: 'photo.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @ApiPropertyOptional({ example: 1080 })
  @IsOptional()
  @IsInt()
  @Min(0)
  width?: number;

  @ApiPropertyOptional({ example: 1920 })
  @IsOptional()
  @IsInt()
  @Min(0)
  height?: number;
}

export class CompleteDto {
  @ApiProperty()
  @IsUUID()
  mediaId!: string;

  /** فقط برای آپلود multipart — etag هر پارت به ترتیب partNumber */
  @ApiPropertyOptional({
    example: [{ partNumber: 1, etag: '"abc123"' }],
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  parts?: { partNumber: number; etag: string }[];
}

export class MediaUrlQuery {
  /** thumb = بندانگشتی تصویر */
  @IsOptional()
  @Matches(/^(thumb|original)$/)
  variant?: 'thumb' | 'original';
}
