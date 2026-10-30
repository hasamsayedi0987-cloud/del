import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { UsersModule } from '../users/users.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { SyncController } from './sync.controller';

@Module({
  imports: [AuthModule, PresenceModule, UsersModule, EventEmitterModule.forRoot()],
  controllers: [MessagesController, SyncController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesGateway], // گام ۷ — NotificationsModule برای isUserOnline
})
export class MessagesModule {}
