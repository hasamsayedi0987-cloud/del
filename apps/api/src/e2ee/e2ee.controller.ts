import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, AuthedRequest } from '../common/jwt-auth.guard';
import { E2eeService } from './e2ee.service';
import { AddOtksDto, SaveBackupDto, UploadIdentityDto } from './dto/e2ee.dto';

@ApiTags('e2ee')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('e2ee')
export class E2eeController {
  constructor(private readonly e2ee: E2eeService) {}

  /** وضعیت E2EE خودم */
  @Get('status')
  status(@Req() req: AuthedRequest) {
    return this.e2ee.status(req.user.sub);
  }

  /**
   * ثبت/به‌روزرسانی هویت E2EE این دستگاه (فقط کلیدهای عمومی).
   * deviceId از توکن دسترسی (did) گرفته می‌شود — کلاینت نمی‌تواند به نام دستگاه دیگر آپلود کند.
   */
  @Post('identity')
  @HttpCode(200)
  uploadIdentity(@Req() req: AuthedRequest, @Body() dto: UploadIdentityDto) {
    const deviceId = req.user.did ?? 'unknown';
    return this.e2ee.uploadIdentity(req.user.sub, deviceId, dto);
  }

  /** افزودن کلیدهای یک‌بارمصرف تازه برای این دستگاه */
  @Post('otks')
  @HttpCode(200)
  addOtks(@Req() req: AuthedRequest, @Body() dto: AddOtksDto) {
    const deviceId = req.user.did ?? 'unknown';
    return this.e2ee.addOtks(req.user.sub, deviceId, dto.otks);
  }

  /** فهرست هویت‌های عمومی یک کاربر — برای تشخیص فعال‌بودن E2EE و top-up */
  @Get('devices/:userId')
  deviceKeys(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    void req;
    return this.e2ee.deviceKeys(userId);
  }

  /** bundle برای X3DH — هر دستگاهِ کاربر یک bundle؛ یک OTK مصرف می‌شود */
  @Get('bundle/:userId')
  bundles(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    void req;
    return this.e2ee.fetchBundles(userId);
  }

  /** ذخیره پشتیبان رمزشده هویت (blob — بدون کلید بازیابی) */
  @Put('backup')
  @HttpCode(200)
  saveBackup(@Req() req: AuthedRequest, @Body() dto: SaveBackupDto) {
    return this.e2ee.saveBackup(req.user.sub, dto);
  }

  /** گرفتن پشتیبان خودم — بازیابی روی دستگاه تازه */
  @Get('backup')
  getBackup(@Req() req: AuthedRequest) {
    return this.e2ee.getBackup(req.user.sub);
  }

  /** ریست هویت‌های خودم — پشتیبان باقی می‌ماند */
  @Delete('identity')
  @HttpCode(204)
  async deleteIdentities(@Req() req: AuthedRequest): Promise<void> {
    await this.e2ee.deleteIdentities(req.user.sub);
  }
}
