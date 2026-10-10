const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,A,B,cards}=require('./fixtures/blackjack-insurance-fixture.cjs');
function choice(hand,accept=true){return{action:accept?'insure':'decline_insurance',hand_id:hand.id,expected_action_count:hand.action_count};}
function noSecret(hand){assert.equal(hand.dealer_cards[1].rank,'?');assert.equal(hand.dealer_total,null);assert.equal(Object.hasOwn(hand,'shoe'),false);}

test('Ace upcard offers insurance before dealer/player naturals, hides the hole card and blocks play',async()=>{
 const f=await fixture({player:cards('A','K')});try{
 const {hand}=await f.start();assert.equal(hand.status,'active');assert.equal(hand.insurance_status,'pending');assert.equal(hand.insurance_offer,.5);assert.equal(hand.can_insure,true);assert.equal(hand.can_decline_insurance,true);noSecret(hand);
 for(const action of ['hit','stand','double','split']){assert.equal(hand['can_'+action],false);const bad=await f.send({action,hand_id:hand.id,expected_action_count:0});assert.equal(bad.httpStatus,400);assert.match(bad.error,/insurance or decline/);}
 assert.equal(await f.wallet(),99);assert.equal((await f.ledger()).length,1);
 const row=(await f.db.query('select * from blackjack_hands')).rows[0];
 await assert.rejects(f.db.query('select * from advance_blackjack_test_hand_v3($1,$2,0,\'lost\',1,$3::jsonb,null,null,$4::jsonb,$5::jsonb,21,21,0,0)',[A,row.id,JSON.stringify(row.player_cards),JSON.stringify(row.dealer_cards),JSON.stringify(row.shoe)]),/insurance or decline/);
 }finally{await f.db.close();}
});

test('Insurance wins 2:1 profit, returns its stake once and settles dealer blackjack',async()=>{
 const f=await fixture();try{const start=await f.start();const accepted=await f.send(choice(start.hand));const h=accepted.hand;
 assert.equal(h.status,'lost');assert.equal(h.insurance_status,'accepted');assert.equal(h.insurance_stake,.5);assert.equal(h.insurance_payout,1.5);assert.equal(h.payout,0);assert.equal(h.action_count,1);assert.equal(h.dealer_cards[1].rank,'K');assert.equal(await f.wallet(),100);
 const retry=await f.send(choice(start.hand));assert.deepEqual(retry.hand,h);assert.equal(await f.wallet(),100);assert.equal((await f.ledger()).length,3);
 const reDeal=await f.start();assert.equal(reDeal.hand.id,h.id);assert.equal(reDeal.hand.insurance_status,'accepted');assert.equal(await f.wallet(),100);
 }finally{await f.db.close();}
});

test('Declining insurance peeks and settles a natural without an insurance debit',async()=>{
 for(const player of [cards(10,6),cards('A','K')]){const f=await fixture({player,stake:5});try{const start=await f.start();const declined=await f.send(choice(start.hand,false));assert.equal(declined.hand.status,player[0].rank==='A'?'push':'lost');assert.equal(declined.hand.insurance_stake,0);assert.equal(await f.wallet(),player[0].rank==='A'?100:95);assert.equal((await f.ledger()).length,player[0].rank==='A'?2:1);}finally{await f.db.close();}}
});

test('Insured player blackjack pushes against dealer blackjack and includes both correct returns',async()=>{
 const f=await fixture({player:cards('A','K'),stake:5});try{const h=(await f.send(choice((await f.start()).hand))).hand;assert.equal(h.status,'push');assert.equal(h.payout,5);assert.equal(h.insurance_stake,2.5);assert.equal(h.insurance_payout,7.5);assert.equal(await f.wallet(),105);}finally{await f.db.close();}
});

test('Failed dealer peek loses insurance while keeping the hidden hole card and main hand playable',async()=>{
 const f=await fixture({player:cards(10,8),dealer:cards('A',6),draws:cards(2),stake:5});try{const h=(await f.send(choice((await f.start()).hand))).hand;assert.equal(h.status,'active');assert.equal(h.insurance_stake,2.5);assert.equal(h.insurance_payout,0);assert.equal(h.can_stand,true);assert.equal(h.can_insure,false);noSecret(h);assert.equal(await f.wallet(),92.5);
 const final=(await f.send({action:'stand',hand_id:h.id,expected_action_count:h.action_count})).hand;assert.equal(final.dealer_total,19);assert.equal(final.status,'lost');assert.equal(final.insurance_stake,2.5);assert.equal(final.insurance_payout,0);assert.equal(await f.wallet(),92.5);
 }finally{await f.db.close();}
});

test('Player blackjack waits for insurance then pays 3:2 when dealer has no blackjack',async()=>{
 for(const accept of [true,false]){const f=await fixture({player:cards('A','K'),dealer:cards('A',6),stake:5});try{const h=(await f.send(choice((await f.start()).hand,accept))).hand;assert.equal(h.status,'player_blackjack');assert.equal(h.payout,12.5);assert.equal(h.insurance_payout,0);assert.equal(await f.wallet(),accept?105:107.5);}finally{await f.db.close();}}
});

test('Insurance decision preserves double/split legality and additional-wager accounting',async()=>{
 const f=await fixture({player:cards(8,8),dealer:cards('A',6),draws:cards(10,10,2),stake:5});try{let h=(await f.send(choice((await f.start()).hand,false))).hand;assert.equal(h.can_split,true);h=(await f.send({action:'split',hand_id:h.id,expected_action_count:h.action_count})).hand;assert.equal(h.player_hands.length,2);assert.equal(h.stake,10);assert.equal(await f.wallet(),90);h=(await f.send({action:'stand',hand_id:h.id,expected_action_count:h.action_count})).hand;h=(await f.send({action:'stand',hand_id:h.id,expected_action_count:h.action_count})).hand;assert.equal(h.status,'lost');assert.equal(h.insurance_status,'declined');assert.equal(await f.wallet(),90);
 }finally{await f.db.close();}
 const d=await fixture({player:cards(5,6),dealer:cards('A',6),draws:cards(10,2),stake:5});try{let h=(await d.send(choice((await d.start()).hand))).hand;assert.equal(h.can_double,true);h=(await d.send({action:'double',hand_id:h.id,expected_action_count:h.action_count})).hand;assert.equal(h.stake,10);assert.equal(h.payout,20);assert.equal(h.insurance_stake,2.5);assert.equal(await d.wallet(),107.5);}finally{await d.db.close();}
});

test('Concurrent insurance copies settle once, and saved choice cannot be changed',async()=>{
 const f=await fixture({stake:5});try{const start=await f.start();const responses=await Promise.all(Array.from({length:12},()=>f.send(choice(start.hand))));assert(responses.every(r=>r.httpStatus===200&&r.hand.insurance_status==='accepted'));assert.equal(await f.wallet(),100);assert.equal((await f.ledger()).length,3);
 const conflict=await f.send({...choice(responses[0].hand,false)});assert.equal(conflict.httpStatus,400);assert.match(conflict.error,/decision already saved/);assert.equal(await f.wallet(),100);
 }finally{await f.db.close();}
});

test('Insufficient insurance balance keeps the decision pending and allows free decline',async()=>{
 const f=await fixture({stake:5,balance:5});try{const start=await f.start();assert.equal(start.hand.can_insure,false);assert.equal(start.hand.can_decline_insurance,true);const rejected=await f.send(choice(start.hand));assert.equal(rejected.httpStatus,400);assert.match(rejected.error,/Insufficient test balance for insurance/);assert.equal(await f.wallet(),0);const state=(await f.send({action:'state',hand_id:start.hand.id})).hand;assert.equal(state.insurance_status,'pending');assert.equal(state.action_count,0);const declined=await f.send(choice(state,false));assert.equal(declined.hand.status,'lost');assert.equal((await f.ledger()).length,1);}finally{await f.db.close();}
});

test('Insurance transaction failure rolls back debit, choice, main settlement and credits',async()=>{
 const f=await fixture({stake:5});try{const start=await f.start();await f.db.exec("alter table wallet_transactions add constraint reject_insurance_credit check (note not like 'Blackjack test insurance payout%')");const rejected=await f.send(choice(start.hand));assert.equal(rejected.httpStatus,400);assert.equal(await f.wallet(),95);const state=(await f.send({action:'state',hand_id:start.hand.id})).hand;assert.equal(state.insurance_status,'pending');assert.equal(state.action_count,0);assert.equal(state.status,'active');assert.equal((await f.ledger()).length,1);await f.db.exec('alter table wallet_transactions drop constraint reject_insurance_credit');assert.equal((await f.send(choice(state))).hand.insurance_status,'accepted');assert.equal(await f.wallet(),100);}finally{await f.db.close();}
});

test('Insurance and hidden state are owner-only and its RPC is denied to browsers',async()=>{
 const f=await fixture();try{const start=await f.start();for(const action of ['state','insure','decline_insurance']){const bad=await f.send({action,hand_id:start.hand.id,expected_action_count:0},B);assert.equal(bad.httpStatus,400);assert.match(bad.error,/another user/);}assert.equal((await f.send(choice(start.hand),'expired')).httpStatus,401);assert.equal(await f.wallet(),99);assert.equal(await f.wallet(B),100);
 const row=(await f.db.query("select has_function_privilege('anon','decide_blackjack_test_insurance(uuid,uuid,integer,boolean)','EXECUTE') as anon,has_function_privilege('authenticated','decide_blackjack_test_insurance(uuid,uuid,integer,boolean)','EXECUTE') as authenticated,has_function_privilege('service_role','decide_blackjack_test_insurance(uuid,uuid,integer,boolean)','EXECUTE') as service")).rows[0];assert.deepEqual(row,{anon:false,authenticated:false,service:true});
 }finally{await f.db.close();}
});


test('Cached clients without insurance controls retain normal peek/play behavior and receipts',async()=>{
 for(const dealer of [cards('A','K'),cards('A',6)]){const f=await fixture({dealer});try{
  const old=await f.send({action:'start',stake:1,request_id:'44444444-4444-4444-8444-444444444444'});
  assert.equal(old.httpStatus,200);assert.equal(old.hand.insurance_status,'not_offered');assert.equal(old.hand.status,dealer[1].rank==='K'?'lost':'active');assert.equal(old.hand.can_stand,dealer[1].rank!=='K');
  const upgradedRetry=await f.send({action:'start',stake:1,request_id:'44444444-4444-4444-8444-444444444444',supports_insurance:true});assert.equal(upgradedRetry.hand.id,old.hand.id);assert.equal(upgradedRetry.hand.insurance_status,'not_offered');assert.equal(await f.wallet(),99);
 }finally{await f.db.close();}}
});
