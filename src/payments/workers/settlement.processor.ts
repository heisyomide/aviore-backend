import {
Processor,
WorkerHost,
} from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { SettlementService } from '../services/settlement.service';

@Processor('settlement')
export class SettlementProcessor extends WorkerHost {
constructor(
private readonly settlementService: SettlementService,
) {
super();
}

async process(
job: Job,
) {
switch (job.name) {
case 'SETTLE_ORDER':
return this.settlementService.processSettlement(
job.data.orderId,
);

  default:
    throw new Error(
      `UNKNOWN_JOB: ${job.name}`,
    );
}

}
}