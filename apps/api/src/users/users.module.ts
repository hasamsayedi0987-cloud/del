import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { BlocksService } from './blocks.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [BlocksService],
  exports: [BlocksService], // گام ۱۰ — MessagesModule/CallsModule برای اعمال مسدودسازی
})
export class UsersModule {}
