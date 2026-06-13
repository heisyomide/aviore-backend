export interface FlutterwaveWebhook {
id: number;

tx_ref: string;

amount: number;

currency: string;

status: string;

customer: {
email: string;
};
}

export interface SettlementJob {
orderId: string;
}

export interface PaymentInitializationResponse {
paymentId: string;

reference: string;

link: string;
}