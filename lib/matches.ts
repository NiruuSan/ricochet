import {database} from '@/db/raw';
import {cashAccountId,ensureCashAccount,HOUSE} from './payments/service';
type Run={user_id:string,done:number,forfeit:number,score:number};
type Match={id:string,p2:string|null,settled:number,stake:number,asset:string};
export async function settle(mid:string){
 const db=database();const m=await db.prepare('SELECT * FROM matches WHERE id=?').bind(mid).first<Match>();
 if(!m||!m.p2||m.settled)return;
 const rr=(await db.prepare('SELECT * FROM runs WHERE match_id=?').bind(mid).all<Run>()).results;
 if(rr.length!==2||rr.some(r=>!r.done))return;
 const [a,b]=rr;
 const winner=a.forfeit!==b.forfeit?(a.forfeit?b.user_id:a.user_id):a.score===b.score?null:a.score>b.score?a.user_id:b.user_id;
 const now=Date.now(),payout=winner?m.stake*176/100:m.stake,fee=winner?m.stake*24/100:0;
 const recipients=winner?[winner]:[a.user_id,b.user_id];
 const ops=[];
 if(m.asset==='devnet'){
  await ensureCashAccount(HOUSE);
  for(const uid of recipients)ops.push(db.prepare("INSERT OR IGNORE INTO cash_ledger(id,account_id,kind,amount,reference,created) VALUES(?,?,'match_payout',?,?,?)").bind(`${mid}:cash:payout:${uid}`,cashAccountId(uid),payout,mid,now));
  if(fee)ops.push(db.prepare("INSERT OR IGNORE INTO cash_ledger(id,account_id,kind,amount,reference,created) VALUES(?,?,'house_fee',?,?,?)").bind(`${mid}:cash:fee`,cashAccountId(HOUSE),fee,mid,now));
  ops.push(db.prepare("INSERT OR IGNORE INTO cash_ledger(id,account_id,kind,amount,reference,created) VALUES(?,?,'escrow_release',?,?,?)").bind(`${mid}:cash:release`,cashAccountId('escrow:'+mid),-m.stake*2,mid,now));
 }else{
  for(const uid of recipients)ops.push(db.prepare("INSERT OR IGNORE INTO ledger(id,user_id,match_id,kind,amount,created) VALUES(?,?,?,'payout',?,?)").bind(`${mid}:payout:${uid}`,uid,mid,payout,now));
 }
 ops.push(db.prepare('UPDATE matches SET settled=1,winner=?,fee=? WHERE id=? AND settled=0').bind(winner,fee,mid));
 await db.batch(ops);
}
