import {PaymentError} from './errors';
import {env} from 'cloudflare:workers';
import {Keypair,PublicKey} from '@solana/web3.js';
import {database} from '../../db/raw';
import {requireDevnet,validateOperationId,parseSol,launchStatus} from './policy';
import {encryptWallet,decryptWallet} from './vault';
import {devnetConnection,prepareTransfer,recipientAddress} from './solana';
export const settings=()=>env as unknown as Record<string,string|undefined>;
export const cashAccountId=(uid:string)=>`devnet:${uid}`;
export const HOUSE='__house__',POOL='__player_pool__';
type Wallet={id:string,network:string,owner:string,address:string,encrypted_key:string};
export type Transfer={id:string,network:string,user_id:string,account_id:string,kind:string,source:string,destination:string,amount:number,fee:number,signature:string,wire:string,last_valid_block_height:number,status:string,slot:number|null,error:string|null,created:number,updated:number};
const publicTransfer=(t:Transfer)=>({id:t.id,kind:t.kind,amount:t.amount,fee:t.fee,destination:t.destination,signature:t.signature,status:t.status,error:t.error,created:t.created});
export async function ensureCashAccount(uid:string){await database().prepare('INSERT OR IGNORE INTO cash_accounts(id,network,user_id,created) VALUES(?,?,?,?)').bind(cashAccountId(uid),'devnet',uid,Date.now()).run();return cashAccountId(uid)}
export async function ensureWallet(uid:string):Promise<Wallet>{
 const s=settings();requireDevnet(s);const db=database(),id=`devnet:${uid}`;
 let wallet=await db.prepare('SELECT * FROM custody_wallets WHERE id=?').bind(id).first<Wallet>();if(wallet)return wallet;
 const generated=Keypair.generate(),encrypted=await encryptWallet(generated,s.SOLANA_VAULT_KEY!,id);
 await db.prepare('INSERT OR IGNORE INTO custody_wallets(id,network,owner,address,encrypted_key,created) VALUES(?,?,?,?,?,?)').bind(id,'devnet',uid,generated.publicKey.toBase58(),encrypted,Date.now()).run();
 generated.secretKey.fill(0);wallet=await db.prepare('SELECT * FROM custody_wallets WHERE id=?').bind(id).first<Wallet>();if(!wallet)throw new PaymentError('Wallet could not be created.');return wallet;
}
async function replay(id:string,uid:string,kind:string,destination?:string,amount?:number){const t=await database().prepare('SELECT * FROM cash_transfers WHERE id=?').bind(id).first<Transfer>();if(!t)return null;if(t.user_id!==uid||t.kind!==kind||(destination&&t.destination!==destination)||(amount!==undefined&&t.amount!==amount))throw new PaymentError('Operation ID was already used for a different request.');return t}
export async function beginDeposit(uid:string,idInput:unknown){
 const id=validateOperationId(idInput),prior=await replay(id,uid,'deposit');if(prior)return publicTransfer(prior);
 const s=settings();requireDevnet(s);const connection=await devnetConnection(s.SOLANA_RPC_URL!),wallet=await ensureWallet(uid),pool=await ensureWallet(POOL),account=await ensureCashAccount(uid);
 const balance=await connection.getBalance(new PublicKey(wallet.address),'finalized');if(!Number.isSafeInteger(balance)||balance<=0)throw new PaymentError('No confirmed devnet SOL was found at your deposit address.');
 const signer=await decryptWallet(wallet.encrypted_key,s.SOLANA_VAULT_KEY!,wallet.id);
 const prepared=await prepareTransfer(connection,signer,new PublicKey(pool.address),balance,id,true);signer.secretKey.fill(0);
 await insertTransfer({id,uid,account,kind:'deposit',source:wallet.address,destination:pool.address,...prepared},false);
 return reconcileTransfer(id,uid);
}
export async function beginWithdrawal(uid:string,idInput:unknown,destinationInput:unknown,amountInput:unknown,treasury=false){
 const id=validateOperationId(idInput),amount=parseSol(amountInput),destination=recipientAddress(destinationInput).toBase58(),kind=treasury?'treasury':'withdrawal';
 const prior=await replay(id,uid,kind,destination,amount);if(prior)return publicTransfer(prior);
 const s=settings();requireDevnet(s);const db=database();
 if(await db.prepare('SELECT 1 FROM custody_wallets WHERE address=?').bind(destination).first())throw new PaymentError('Use an external wallet, not a Ricochet deposit or custody address.');
 const connection=await devnetConnection(s.SOLANA_RPC_URL!),pool=await ensureWallet(POOL),account=await ensureCashAccount(treasury?HOUSE:uid);
 const signer=await decryptWallet(pool.encrypted_key,s.SOLANA_VAULT_KEY!,pool.id);
 const prepared=await prepareTransfer(connection,signer,new PublicKey(destination),amount,id);signer.secretKey.fill(0);
 const available=await db.prepare('SELECT balance FROM cash_accounts WHERE id=?').bind(account).first<{balance:number}>();
 if(!available||available.balance<amount+prepared.fee)throw new PaymentError('Insufficient available balance, including the network fee.');
 if(await connection.getBalance(new PublicKey(pool.address),'finalized')<amount+prepared.fee)throw new PaymentError('Custody liquidity is insufficient. No withdrawal was submitted.');
 await insertTransfer({id,uid,account,kind,source:pool.address,destination,...prepared},true);
 return reconcileTransfer(id,uid);
}
type NewTransfer={id:string,uid:string,account:string,kind:string,source:string,destination:string,amount:number,fee:number,signature:string,wire:string,lastValidBlockHeight:number};
async function insertTransfer(t:NewTransfer,reserve:boolean){
 const db=database(),now=Date.now();const ops=[db.prepare(`INSERT INTO cash_transfers(id,network,user_id,account_id,kind,source,destination,amount,fee,signature,wire,last_valid_block_height,status,created,updated) VALUES(?,'devnet',?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).bind(t.id,t.uid,t.account,t.kind,t.source,t.destination,t.amount,t.fee,t.signature,t.wire,t.lastValidBlockHeight,now,now)];
 if(reserve)ops.push(db.prepare("INSERT INTO cash_ledger(id,account_id,kind,amount,reference,created) VALUES(?,?,'withdrawal_reserve',?,?,?)").bind(`${t.id}:reserve`,t.account,-t.amount-t.fee,t.id,now));
 // A source-wallet uniqueness constraint serializes outgoing transactions. The
 // balance trigger and this batch make reservation and outbox creation atomic.
 await db.batch(ops);
}
export async function reconcileTransfer(id:string,uid:string){
 const db=database();const t=await db.prepare('SELECT * FROM cash_transfers WHERE id=? AND user_id=?').bind(id,uid).first<Transfer>();if(!t)throw new PaymentError('Transfer not found.');
 if(t.status==='finalized'||t.status==='failed')return publicTransfer(t);
 const s=settings();requireDevnet(s);const connection=await devnetConnection(s.SOLANA_RPC_URL!);
 const status=(await connection.getSignatureStatuses([t.signature],{searchTransactionHistory:true})).value[0];
 if(status?.confirmationStatus==='finalized'){
  const success=status.err===null,ops=[];
  if(success&&t.kind==='deposit')ops.push(db.prepare("INSERT OR IGNORE INTO cash_ledger(id,account_id,kind,amount,reference,created) VALUES(?,?,'deposit',?,?,?)").bind(`${t.id}:deposit`,t.account_id,t.amount,t.id,Date.now()));
  if(!success&&t.kind!=='deposit')ops.push(db.prepare("INSERT OR IGNORE INTO cash_ledger(id,account_id,kind,amount,reference,created) VALUES(?,?,'withdrawal_refund',?,?,?)").bind(`${t.id}:refund`,t.account_id,t.amount,t.id,Date.now()));
  ops.push(db.prepare('UPDATE cash_transfers SET status=?,slot=?,error=?,updated=? WHERE id=?').bind(success?'finalized':'failed',status.slot,success?null:'Transaction failed on-chain. Any network fee remains charged.',Date.now(),id));await db.batch(ops);
 }else if(await connection.getBlockHeight('finalized')>t.last_valid_block_height){
  // A missing response is not proof that money was never sent. Never generate
  // a second payment or release its reserve from a timeout alone.
  await db.prepare("UPDATE cash_transfers SET status='review',error=?,updated=? WHERE id=? AND status='pending'").bind('Confirmation could not be established before expiry. Funds remain reserved for reconciliation.',Date.now(),id).run();
 }else if(t.status==='pending'){
  try{await connection.sendRawTransaction(Buffer.from(t.wire,'base64'),{skipPreflight:false,maxRetries:2,preflightCommitment:'finalized'});}catch{
   await db.prepare('UPDATE cash_transfers SET error=?,updated=? WHERE id=? AND status=\'pending\'').bind('Submission was not confirmed. Recheck status; the same signed transaction will be retried.',Date.now(),id).run();
  }
 }
 return publicTransfer((await db.prepare('SELECT * FROM cash_transfers WHERE id=? AND user_id=?').bind(id,uid).first<Transfer>())!);
}
export async function walletSnapshot(uid:string){
 const status=launchStatus(settings());if(!status.configured)return {...status,address:null,balance:0,transfers:[],activity:[]};
 const wallet=await ensureWallet(uid),account=await ensureCashAccount(uid),db=database();
 const [balance,transfers,activity]=await Promise.all([db.prepare('SELECT balance FROM cash_accounts WHERE id=?').bind(account).first<{balance:number}>(),db.prepare('SELECT * FROM cash_transfers WHERE account_id=? ORDER BY created DESC LIMIT 50').bind(account).all<Transfer>(),db.prepare('SELECT kind,amount,reference,created FROM cash_ledger WHERE account_id=? ORDER BY created DESC LIMIT 100').bind(account).all()]);
 return {...status,address:wallet.address,balance:balance?.balance??0,transfers:transfers.results.map(publicTransfer),activity:activity.results};
}
export async function treasurySnapshot(){const db=database();await ensureCashAccount(HOUSE);return {configured:launchStatus(settings()).configured,network:'devnet',balance:(await db.prepare('SELECT balance FROM cash_accounts WHERE id=?').bind(cashAccountId(HOUSE)).first<{balance:number}>())?.balance??0,transfers:(await db.prepare("SELECT id,kind,amount,fee,destination,signature,status,error,created FROM cash_transfers WHERE kind='treasury' ORDER BY created DESC LIMIT 50").all()).results,review:(await db.prepare("SELECT id,kind,signature,error,created FROM cash_transfers WHERE status='review' ORDER BY created ASC LIMIT 50").all()).results};}
