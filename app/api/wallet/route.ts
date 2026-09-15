import {safePaymentError} from '@/lib/payments/errors';
import {getChatGPTUser} from '../../chatgpt-auth';
import {database} from '@/db/raw';
import {walletSnapshot,beginDeposit,beginWithdrawal,reconcileTransfer} from '@/lib/payments/service';
export const dynamic='force-dynamic';
const respond=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to view your wallet.'},401);if(!await database().prepare('SELECT id FROM players WHERE id=?').bind(user.userId).first())return respond({error:'Create a player profile first.'},403);return respond(await walletSnapshot(user.userId));}catch{return respond({error:'Wallet service is unavailable. No funds were moved.'},503)}}
export async function POST(req:Request){try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return respond({error:'Request origin rejected.'},403);
 const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to use your wallet.'},401);
 if(!await database().prepare('SELECT id FROM players WHERE id=?').bind(user.userId).first())return respond({error:'Create a player profile first.'},403);
 const raw=await req.text();if(raw.length>2048)return respond({error:'Request too large.'},413);const b=JSON.parse(raw);
 if(b.action==='deposit')return respond(await beginDeposit(user.userId,b.id));
 if(b.action==='withdraw')return respond(await beginWithdrawal(user.userId,b.id,b.destination,b.amount));
 if(b.action==='reconcile'&&typeof b.id==='string')return respond(await reconcileTransfer(b.id,user.userId));
 return respond({error:'Unknown wallet action.'},400);
}catch(e){return respond({error:safePaymentError(e)},400)}}
