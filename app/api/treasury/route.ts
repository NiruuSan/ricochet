import {safePaymentError} from '@/lib/payments/errors';
import {getChatGPTUser} from '../../chatgpt-auth';
import {adminId,database} from '@/db/raw';
import {treasurySnapshot,beginWithdrawal,reconcileTransfer} from '@/lib/payments/service';
export const dynamic='force-dynamic';
const respond=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
async function administrator(){const u=await getChatGPTUser();return u&&adminId()&&u.userId===adminId()?u:null;}
export async function GET(){if(!await administrator())return respond({error:'Administrator access required.'},403);try{return respond(await treasurySnapshot())}catch{return respond({error:'Treasury is unavailable.'},503)}}
export async function POST(req:Request){if(req.headers.get('origin')!==new URL(req.url).origin)return respond({error:'Request origin rejected.'},403);const u=await administrator();if(!u)return respond({error:'Administrator access required.'},403);try{const raw=await req.text();if(raw.length>2048)return respond({error:'Request too large.'},413);const b=JSON.parse(raw);if(b.action==='withdraw')return respond(await beginWithdrawal(u.userId,b.id,b.destination,b.amount,true));if(b.action==='reconcile'&&typeof b.id==='string'){const transfer=await database().prepare('SELECT user_id FROM cash_transfers WHERE id=?').bind(b.id).first<{user_id:string}>();if(!transfer)return respond({error:'Transfer not found.'},404);return respond(await reconcileTransfer(b.id,transfer.user_id));}return respond({error:'Unknown action.'},400)}catch(e){return respond({error:safePaymentError(e)},400)}}
