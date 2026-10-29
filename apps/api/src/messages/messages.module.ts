import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';

@Module({
  imports: [AuthModule, PresenceModule, EventEmitterModule.forRoot()],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
})
export class MessagesModule {}
