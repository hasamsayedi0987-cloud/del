import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AdminMetrics, AdminUserDto, AdminUserPage, AuditLogDto, ReportDto, ReportPage } from '@del/shared-types';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { AdminService } from './admin.service';

class BlockUserDto {
  /** علت مسدودسازی — در audit ثبت می‌شود */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class HandleReportDto {
  /** resolve = تخلف تأیید شد، dismiss = گزارش بی‌اساس بود */
  @IsIn(['resolve', 'dismiss'])
  action!: 'resolve' | 'dismiss';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  async users(
    @Query('q') q?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(25), ParseIntPipe) pageSize?: number,
    @Query('blocked') blocked?: string,
  ): Promise<AdminUserPage> {
    return this.admin.listUsers({
      q,
      page,
      pageSize,
      blocked: blocked === 'true' ? true : blocked === 'false' ? false : undefined,
    });
  }

  @Get('users/:id')
  async userDetail(@Param('id') id: string): Promise<AdminUserDto> {
    return this.admin.getUser(id);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  async block(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: BlockUserDto,
  ): Promise<AdminUserDto> {
    return this.admin.blockUser(
      req.user.sub,
      req.userName ?? null,
      id,
      dto.reason,
    );
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  async unblock(@Req() req: AuthedRequest, @Param('id') id: string): Promise<AdminUserDto> {
    return this.admin.unblockUser(
      req.user.sub,
      req.userName ?? null,
      id,
    );
  }

  @Get('reports')
  async reports(
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(25), ParseIntPipe) pageSize?: number,
  ): Promise<ReportPage> {
    return this.admin.listReports({ status, page, pageSize });
  }

  @Post('reports/:id/handle')
  @HttpCode(200)
  async handleReport(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: HandleReportDto,
  ): Promise<ReportDto> {
    return this.admin.handleReport(
      req.user.sub,
      req.userName ?? null,
      id,
      dto.action,
      dto.note,
    );
  }

  @Get('metrics')
  async metrics(): Promise<AdminMetrics> {
    return this.admin.metrics();
  }

  @Get('audit')
  async audit(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ): Promise<{ items: AuditLogDto[] }> {
    return this.admin.audit(limit);
  }
}
