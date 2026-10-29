import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'خانواده' })
  @IsString()
  @Length(1, 80)
  title!: string;

  /** اعضای اولیه (اختیاری) — شناسه کاربران؛ سازنده خودکار ادمین می‌شود */
  @ApiProperty({ example: [], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberUserIds?: string[];
}

export class AddMembersDto {
  @ApiProperty({ example: [] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class UpdateGroupDto {
  @ApiProperty({ example: 'نام تازه گروه' })
  @IsString()
  @Length(1, 80)
  title!: string;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ['admin', 'member'] })
  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}
