/**
 * گام ۹ — هوش مصنوعی: DTOها
 * همه endpointها محتوای کاربر را فقط پس از رضایت صریح به provider می‌فرستند.
 */
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SetAiConsentDto {
  @IsBoolean()
  enabled!: boolean;
}

export class SetConversationAiConsentDto {
  /** null = تبعیت از رضایت کلی کاربر */
  @IsOptional()
  @IsBoolean()
  enabled!: boolean | null;
}

export class TranslateDto {
  @IsUUID()
  messageId!: string;

  /** کد یا نام زبان مقصد — پیش‌فرض fa (فارسی) */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  target?: string;
}

export class FixDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}

export class SuggestDto {
  @IsUUID()
  conversationId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  count?: number;
}

export class SummarizeDto {
  @IsUUID()
  conversationId!: string;

  /** حداکثر پیام‌های واردشده در خلاصه */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** فقط پیام‌های خوانده‌نشده من؟ */
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;
}

export const AI_FEATURES = ['translate', 'fix', 'suggest', 'summarize'] as const;
export type AiFeatureName = (typeof AI_FEATURES)[number];

export class UsageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(AI_FEATURES)
  feature?: AiFeatureName;
}
