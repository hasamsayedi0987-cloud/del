import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiController, ConversationAiConsentController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [AuthModule],
  controllers: [AiController, ConversationAiConsentController],
  providers: [AiService],
})
export class AiModule {}
