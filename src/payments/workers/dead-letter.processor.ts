import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('dead-letter')
export class DeadLetterProcessor extends WorkerHost {
  async process(job: Job<any>) {
    console.log(
      `Dead Letter Job: ${job.id}`,
    );

    console.log(job.data);

    return true;
  }
}