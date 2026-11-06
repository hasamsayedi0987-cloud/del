import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class OtkDto {
  @ApiProperty({ example: 17 })
  @IsInt()
  @Min(1)
  keyId!: number;

  /** کلید عمومی X25519 (b64) */
  @ApiProperty({ example: 'qUB...' })
  @IsString()
  @Length(40, 80)
  key!: string;
}

export class UploadIdentityDto {
  /** عمومیِ کلید امضای هویت (Ed25519, b64) */
  @ApiProperty()
  @IsString()
  @Length(40, 80)
  ikEd!: string;

  /** عمومیِ کلید DH هویت (X25519, b64) */
  @ApiProperty()
  @IsString()
  @Length(40, 80)
  ikX!: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  spkKeyId!: number;

  @ApiProperty()
  @IsString()
  @Length(40, 80)
  spk!: string;

  @ApiProperty()
  @IsString()
  @Length(60, 120)
  spkSig!: string;

  @ApiPropertyOptional({ type: [OtkDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OtkDto)
  otks?: OtkDto[];
}

export class AddOtksDto {
  @ApiProperty({ type: [OtkDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OtkDto)
  otks!: OtkDto[];
}

export class SaveBackupDto {
  /** blob رمزشده با کلید مشتق از کلید بازیابی (b64 از nonce||ct) */
  @ApiProperty()
  @IsString()
  @Length(32, 16384)
  blob!: string;

  /** salt تصادفی ۱۶ بایتی (b64) */
  @ApiProperty()
  @IsString()
  @Length(16, 64)
  salt!: string;
}
