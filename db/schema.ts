import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,index,uniqueIndex,check} from 'drizzle-orm/sqlite-core';
export const players=sqliteTable('players',{id:text('id').primaryKey(),name:text('name').notNull(),balance:integer('balance').notNull().default(20000000000),created:integer('created').notNull()},t=>[check('balance_nonnegative',sql`${t.balance} >= 0`)]);
export const matches=sqliteTable('matches',{id:text('id').primaryKey(),seed:integer('seed').notNull(),stake:integer('stake').notNull(),asset:text('asset').notNull().default('demo'),p1:text('p1').notNull(),p2:text('p2'),settled:integer('settled').notNull().default(0),winner:text('winner'),fee:integer('fee').notNull().default(0),created:integer('created').notNull()},t=>[index('match_queue').on(t.stake,t.settled,t.p2,t.created)]);
export const runs=sqliteTable('runs',{id:text('id').primaryKey(),matchId:text('match_id').notNull(),userId:text('user_id').notNull(),state:text('state').notNull(),revision:integer('revision').notNull().default(0),score:integer('score').notNull().default(0),done:integer('done').notNull().default(0),forfeit:integer('forfeit').notNull().default(0),created:integer('created').notNull()},t=>[uniqueIndex('one_run_per_player_match').on(t.matchId,t.userId),uniqueIndex('one_active_run_per_player').on(t.userId).where(sql`${t.done}=0`),index('runs_history').on(t.userId,t.created)]);
export const ledger=sqliteTable('ledger',{id:text('id').primaryKey(),userId:text('user_id').notNull(),matchId:text('match_id'),kind:text('kind').notNull(),amount:integer('amount').notNull(),created:integer('created').notNull()},t=>[index('ledger_user').on(t.userId,t.created)]);

// On-chain balances never share the demo-credit tables.
export const cashAccounts=sqliteTable('cash_accounts',{
 id:text('id').primaryKey(),network:text('network').notNull(),userId:text('user_id').notNull(),
 balance:integer('balance').notNull().default(0),created:integer('created').notNull()
},t=>[uniqueIndex('cash_account_owner').on(t.network,t.userId),check('cash_balance_nonnegative',sql`${t.balance} >= 0`)]);
export const custodyWallets=sqliteTable('custody_wallets',{
 id:text('id').primaryKey(),network:text('network').notNull(),owner:text('owner').notNull(),address:text('address').notNull(),
 encryptedKey:text('encrypted_key').notNull(),created:integer('created').notNull()
},t=>[uniqueIndex('custody_owner').on(t.network,t.owner),uniqueIndex('custody_address').on(t.address)]);
export const cashLedger=sqliteTable('cash_ledger',{
 id:text('id').primaryKey(),accountId:text('account_id').notNull().references(()=>cashAccounts.id),
 kind:text('kind').notNull(),amount:integer('amount').notNull(),reference:text('reference').notNull(),created:integer('created').notNull()
},t=>[index('cash_ledger_account').on(t.accountId,t.created)]);
export const transfers=sqliteTable('cash_transfers',{
 id:text('id').primaryKey(),network:text('network').notNull(),userId:text('user_id').notNull(),accountId:text('account_id').notNull(),
 kind:text('kind').notNull(),source:text('source').notNull(),destination:text('destination').notNull(),
 amount:integer('amount').notNull(),fee:integer('fee').notNull(),signature:text('signature').notNull(),wire:text('wire').notNull(),
 lastValidBlockHeight:integer('last_valid_block_height').notNull(),status:text('status').notNull().default('pending'),
 slot:integer('slot'),error:text('error'),created:integer('created').notNull(),updated:integer('updated').notNull()
},t=>[uniqueIndex('transfer_signature').on(t.signature),uniqueIndex('one_pending_source').on(t.source).where(sql`${t.status} IN ('pending','review')`),index('transfer_owner').on(t.userId,t.created)]);
