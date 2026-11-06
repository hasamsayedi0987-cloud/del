import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { DevicesController } from './devices.controller';
import { NotificationsService } from './notifications.service';

/**
 * اعلان‌ها و مدیریت دستگاه‌ها (گام ۷)
 * MessagesModule برای MessagesGateway.isUserOnline درون‌ریزی می‌شود (چرخه‌ای نیست).
 */
@Module({
  imports: [AuthModule, MessagesModule],
  controllers: [DevicesController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
