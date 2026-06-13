import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class SettlementQueue {
constructor(
@InjectQueue('settlement')
private readonly queue: Queue,
) {}

async settleOrder(
orderId: string,
) {
return this.queue.add(
'SETTLE_ORDER',
{
orderId,
},
{
attempts: 5,

    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
);

}
}