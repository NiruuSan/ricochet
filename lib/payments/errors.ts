/** Only deliberately written, non-sensitive messages may cross the API boundary. */
export class PaymentError extends Error {}

export function safePaymentError(error: unknown): string {
  if (error instanceof PaymentError) return error.message;
  if (error instanceof Error && /SQLITE|UNIQUE|constraint|cash balance insufficient/i.test(error.message)) {
    return "A payment is already pending or your balance changed. Refresh your wallet before retrying.";
  }
  return "The payment service could not confirm this request. Refresh your wallet and recheck existing transfers before trying again.";
}
