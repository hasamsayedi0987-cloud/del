import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { CleanupService } from './cleanup.service';

@Module({
  controllers: [StoriesController],
  providers: [StoriesService, CleanupService],
  exports: [StoriesService],
})
export class StoriesModule {}
