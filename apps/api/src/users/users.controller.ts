import { Body, Controller, Get, NotFoundException, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { UserDto } from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  about?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@Req() req: AuthedRequest): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      about: user.about,
      createdAt: user.createdAt.toISOString(),
    };
  }

  @Patch('me')
  async updateMe(@Req() req: AuthedRequest, @Body() dto: UpdateMeDto): Promise<UserDto> {
    const user = await this.prisma.user.update({
      where: { id: req.user.sub },
      data: { displayName: dto.displayName, about: dto.about },
    });
    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      about: user.about,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
