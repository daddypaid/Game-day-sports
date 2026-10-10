create unique index if not exists wallet_transactions_wager_type_once_idx
on public.wallet_transactions(wager_id, transaction_type)
where wager_id is not null
  and transaction_type in ('wager_debit'::transaction_type,'wager_credit'::transaction_type,'refund'::transaction_type);
