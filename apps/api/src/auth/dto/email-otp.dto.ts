import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { DevicePlatform } from '@del/shared-types';
import { PLATFORMS } from './verify-otp.dto';

export class RequestEmailOtpDto {
  /** ایمیل — حروف کوچک/بزرگ نادیده گرفته می‌شود */
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  email!: string;
}

export class VerifyEmailOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  email!: string;

  /** کد ۶ رقمی ارسال‌شده به ایمیل */
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
