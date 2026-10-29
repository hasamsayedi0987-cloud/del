import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import type { DevicePlatform } from '@del/shared-types';

export const PLATFORMS: DevicePlatform[] = ['android', 'ios', 'windows', 'macos', 'linux', 'web'];

export class VerifyOtpDto {
  @ApiProperty({ example: '09121234567' })
  @IsString()
  @MinLength(4)
  @MaxLength(24)
  phone!: string;

  /** کد ۶ رقمی ارسال‌شده */
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(4, 8)
  code!: string;

  @ApiPropertyOptional({ example: 'android' })
  @IsOptional()
  @IsIn(PLATFORMS)
  platform?: DevicePlatform;

  @ApiPropertyOptional({ example: 'Samsung S21' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  deviceName?: string;
}
