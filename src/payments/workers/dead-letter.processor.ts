import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';

@Processor('settlement') // Listens to the core settlement channel loop updates
export class DeadLetterProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  // Intercept system exception stack trace outputs
  async process(job: Job<any, any, string>): Promise<void> {
    // This handler will automatically capture jobs that exhaust their 5 retry attempts
    return;
  }

  // Global listener for BullMQ job failure thresholds
  async handleFailed(job: Job<any, any, string>, error: Error) {
    const totalAttemptsMade = job.attemptsMade;
    
    // Evaluate if retries are fully exhausted before logging to DLQ
    if (totalAttemptsMade >= 5) {
      await this.prisma.deadLetterJob.upsert({
        where: { jobId: job.id?.toString() || 'unknown' },
        create: {
          queueName: job.queueName,
          jobName: job.name,
          jobId: job.id?.toString() || 'unknown',
          payload: job.data,
          reason: error.message,
          stackTrace: error.stack,
        },
        update: {
          reason: error.message,
          stackTrace: error.stack,
        },
      });
    }
  }
}