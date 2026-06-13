import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

@Injectable()
export class SettlementQueue {
  constructor(@InjectQueue('settlement') private readonly queue: Queue) {}

  async addSettlementJob(orderId: string, paymentId: string, reference: string): Promise<void> {
    await this.queue.add(
      'process-split-settlement',
      { orderId, paymentId, reference },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000, // Starts at 2s, doubles up through each retry cycle
        },
        removeOnComplete: true,
        removeOnFail: false, // Leave failed jobs available to extract error history context
      },
    );
  }
}