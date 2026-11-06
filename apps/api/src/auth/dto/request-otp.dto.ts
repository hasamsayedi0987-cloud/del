import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class RequestOtpDto {
  /** شماره موبایل — ارقام فارسی و فرمت‌های ایرانی هم پذیرفته می‌شود */
  @ApiProperty({ example: '09121234567' })
  @IsString()
  @MinLength(4)
  @MaxLength(24)
  phone!: string;
}
