import sqlite3,pathlib
c=sqlite3.connect(':memory:')
c.executescript(pathlib.Path('drizzle/0000_shocking_silver_surfer.sql').read_text())
for uid in ['a','b']:
 c.execute('INSERT INTO players(id,name,created) VALUES(?,?,0)',(uid,uid))
c.execute("INSERT INTO matches(id,seed,stake,p1,p2,created) VALUES('m',1,1000000000,'a','b',0)")
for uid in ['a','b']:
 c.execute("INSERT INTO ledger VALUES(?,?,?,'entry',-1000000000,0)",(uid+'entry',uid,'m'))
for i in range(2):
 c.execute("INSERT OR IGNORE INTO ledger VALUES('payout','a','m','payout',1760000000,0)")
assert c.execute("SELECT balance FROM players WHERE id='a'").fetchone()[0]==20760000000
assert c.execute("SELECT balance FROM players WHERE id='b'").fetchone()[0]==19000000000
assert c.execute('SELECT SUM(balance) FROM players').fetchone()[0]==39760000000
try:
 c.execute("INSERT INTO ledger VALUES('overdraw','b','m','entry',-99900000000,0)")
 raise AssertionError('Overdraft accepted')
except sqlite3.IntegrityError: pass
assert not c.execute("SELECT 1 FROM ledger WHERE id='overdraw'").fetchone()
# A full tie refund restores both entries and takes no fee.
for uid in ['a','b']:
 before=c.execute('SELECT balance FROM players WHERE id=?',(uid,)).fetchone()[0]
 c.execute("INSERT INTO ledger VALUES(?,?,?,'entry',-50000000,0)",(uid+'tie',uid,'tie'))
 c.execute("INSERT INTO ledger VALUES(?,?,?,'payout',50000000,0)",(uid+'refund',uid,'tie'))
 assert c.execute('SELECT balance FROM players WHERE id=?',(uid,)).fetchone()[0]==before
c.execute("INSERT INTO runs(id,match_id,user_id,state,created) VALUES('r','m','a','{}',0)")
try:
 c.execute("INSERT INTO runs(id,match_id,user_id,state,created) VALUES('r2','m2','a','{}',0)")
 raise AssertionError('Second active run accepted')
except sqlite3.IntegrityError: pass
assert c.execute("UPDATE runs SET revision=revision+1 WHERE id='r' AND revision=0").rowcount==1
assert c.execute("UPDATE runs SET revision=revision+1 WHERE id='r' AND revision=0").rowcount==0
print('PASS: 12% per-entry economics, idempotent payouts, conservation, overdraft rejection, tie refunds, one active run, optimistic shot revisions.')
