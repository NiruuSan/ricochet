import {PaymentError} from './errors';
export type PaymentSettings=Record<string,string|undefined>;
// Mainnet intentionally cannot be enabled in this development release.
// This is independent of client inputs, environment flags and country selection.
export const MAINNET_IMPLEMENTATION_APPROVED=false;
export function launchStatus(settings:PaymentSettings){return {
 mode:settings.SOLANA_NETWORK==='devnet'?'devnet':'disabled',
 configured:settings.SOLANA_NETWORK==='devnet'&&!!settings.SOLANA_RPC_URL&&!!settings.SOLANA_VAULT_KEY,
 mainnetEnabled:MAINNET_IMPLEMENTATION_APPROVED,
 message:'Real-money play is not launched. Devnet SOL is for testing and has no monetary value.',
};}
export function requireDevnet(settings:PaymentSettings){
 if(settings.SOLANA_NETWORK!=='devnet')throw new PaymentError('Solana payments are disabled. This build supports devnet only.');
 if(!settings.SOLANA_RPC_URL||!settings.SOLANA_VAULT_KEY)throw new PaymentError('Devnet payments need their RPC and encrypted wallet vault configured.');
 if(!settings.SOLANA_RPC_URL.startsWith('https://'))throw new PaymentError('The Solana RPC must use HTTPS.');
 return 'devnet' as const;
}
export function parseSol(value:unknown):number{
 if(typeof value!=='string'||!/^\d{1,6}(\.\d{1,9})?$/.test(value))throw new PaymentError('Enter a SOL amount with up to 9 decimal places.');
 const [whole,fraction='']=value.split('.');const amount=BigInt(whole)*BigInt(1000000000)+BigInt(fraction.padEnd(9,'0'));
 if(amount<=BigInt(0)||amount>BigInt(100000000000000))throw new PaymentError('Amount must be greater than zero and at most 100,000 SOL.');
 return Number(amount);
}
export function validateOperationId(value:unknown):string{
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new PaymentError('A valid operation ID is required.');
 return value.toLowerCase();
}
