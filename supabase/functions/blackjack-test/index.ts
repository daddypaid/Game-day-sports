import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Card = { rank: string; suit: string };
type SplitHand = {
  cards: Card[];
  stake: number;
  status: "active" | "stood" | "bust" | "won" | "lost" | "push";
  total: number;
  doubled?: boolean;
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

function makeDeck(): Card[] {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  return suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  const buffer = new Uint32Array(1);
  for (let index = result.length - 1; index > 0; index--) {
    crypto.getRandomValues(buffer);
    const randomIndex = buffer[0] % (index + 1);
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function total(cards: Card[]) {
  let sum = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      sum += 11;
      aces++;
    } else if (["K", "Q", "J"].includes(card.rank)) {
      sum += 10;
    } else {
      sum += Number(card.rank);
    }
  }
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces--;
  }
  return sum;
}

function cardValue(card: Card) {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function isBlackjack(cards: Card[]) {
  return cards.length === 2 && total(cards) === 21;
}

function canSplitCards(cards: Card[]) {
  return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
}

function currentSplitHand(row: any): SplitHand | null {
  if (!Array.isArray(row.player_hands)) return null;
  const index = Number(row.active_hand_index ?? 0);
  return row.player_hands[index] ?? null;
}

function publicHand(row: any, hideDealer = true) {
  const status = row.status ?? row.hand_status;
  const splitHand = currentSplitHand(row);
  const playerCards = splitHand?.cards ?? row.player_cards ?? [];
  const playerTotal = splitHand?.total ?? row.player_total ?? 0;
  const balance = row.balance === undefined ? undefined : Number(row.balance);
  const isActive = status === "active";
  const actionCount = Number(row.action_count ?? 0);
  const canDouble = isActive && playerCards.length === 2 && (balance === undefined || balance >= Number(splitHand?.stake ?? row.stake));
  const canSplit = isActive && !Array.isArray(row.player_hands) && actionCount === 0 && canSplitCards(playerCards) && (balance === undefined || balance >= Number(row.stake));
  return {
    id: row.id ?? row.hand_id,
    status,
    stake: Number(row.stake ?? 0),
    payout: Number(row.payout ?? 0),
    player_cards: playerCards,
    player_hands: row.player_hands ?? null,
    active_hand_index: row.active_hand_index ?? null,
    dealer_cards: hideDealer && isActive
      ? [...(row.dealer_cards ?? []).slice(0, 1), { rank: "?", suit: "" }]
      : (row.dealer_cards ?? []),
    player_total: playerTotal,
    dealer_total: hideDealer && isActive ? null : (row.dealer_total ?? 0),
    action_count: actionCount,
    can_hit: isActive,
    can_stand: isActive,
    can_double: canDouble,
    can_split: canSplit,
    balance,
  };
}

function playDealer(dealer: Card[], shoe: Card[]) {
  while (total(dealer) < 17 && shoe.length) dealer.push(shoe.pop()!);
}

function settleSingle(player: Card[], dealer: Card[], shoe: Card[], stake: number) {
  const playerTotal = total(player);
  if (playerTotal > 21) return { status: "player_bust", payout: 0 };
  playDealer(dealer, shoe);
  const dealerTotal = total(dealer);
  if (dealerTotal > 21) return { status: "dealer_bust", payout: stake * 2 };
  if (playerTotal > dealerTotal) return { status: "won", payout: stake * 2 };
  if (playerTotal < dealerTotal) return { status: "lost", payout: 0 };
  return { status: "push", payout: stake };
}

function settleSplitHands(hands: SplitHand[], dealer: Card[], shoe: Card[], totalStake: number) {
  const playable = hands.some((hand) => total(hand.cards) <= 21);
  if (playable) playDealer(dealer, shoe);
  const dealerTotal = total(dealer);
  let payout = 0;
  for (const hand of hands) {
    hand.total = total(hand.cards);
    if (hand.total > 21) {
      hand.status = "bust";
    } else if (dealerTotal > 21 || hand.total > dealerTotal) {
      hand.status = "won";
      payout += hand.stake * 2;
    } else if (hand.total < dealerTotal) {
      hand.status = "lost";
    } else {
      hand.status = "push";
      payout += hand.stake;
    }
  }
  let status = "lost";
  if (!playable) status = "player_bust";
  else if (dealerTotal > 21) status = "dealer_bust";
  else if (payout > totalStake) status = "won";
  else if (payout === totalStake) status = "push";
  return { status, payout };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return response({ error: "Authentication required" }, 401);

    const admin = createClient(url, service);
    const body = await req.json();
    const action = String(body?.action || "");

    const loadBalance = async () => {
      const { data, error } = await admin.from("wallets").select("balance").eq("user_id", userData.user.id).single();
      if (error) throw error;
      return Number(data.balance ?? 0);
    };

    const loadActive = async () => {
      const { data, error } = await admin.from("blackjack_hands")
        .select("id,user_id,stake,status,player_cards,player_hands,active_hand_index,dealer_cards,shoe,player_total,dealer_total,payout,action_count")
        .eq("user_id", userData.user.id).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    };

    if (action === "resume") {
      const active = await loadActive();
      const balance = active ? await loadBalance() : undefined;
      return response({ ok: true, hand: active ? publicHand({ ...active, balance }, true) : null, resumed: Boolean(active) });
    }

    if (action === "start") {
      const existing = await loadActive();
      if (existing) {
        const balance = await loadBalance();
        return response({ ok: true, resumed: true, hand: publicHand({ ...existing, balance }, true) });
      }
      const stake = Number(body?.stake);
      if (!Number.isFinite(stake) || !Number.isInteger(stake) || stake <= 0 || stake > 10000) throw new Error("Invalid stake");
      const shoe = shuffle(makeDeck());
      const player = [shoe.pop()!, shoe.pop()!];
      const dealer = [shoe.pop()!, shoe.pop()!];
      const playerTotal = total(player);
      const dealerTotal = total(dealer);
      let status: any = "active";
      let payout = 0;
      const playerBlackjack = isBlackjack(player);
      const dealerBlackjack = isBlackjack(dealer);
      if (playerBlackjack && dealerBlackjack) {
        status = "push";
        payout = stake;
      } else if (playerBlackjack) {
        status = "player_blackjack";
        payout = Math.round(stake * 2.5 * 100) / 100;
      } else if (dealerBlackjack) {
        status = "lost";
      }
      const { data: rows, error } = await admin.rpc("start_blackjack_test_hand_v2", {
        p_user_id: userData.user.id,
        p_stake: stake,
        p_player_cards: player,
        p_dealer_cards: dealer,
        p_shoe: shoe,
        p_player_total: playerTotal,
        p_dealer_total: dealerTotal,
        p_status: status,
        p_payout: payout,
      });
      if (error) {
        if (String(error.message || "").toLowerCase().includes("blackjack_one_active_hand_per_user")) {
          const raced = await loadActive();
          if (raced) {
            const balance = await loadBalance();
            return response({ ok: true, resumed: true, hand: publicHand({ ...raced, balance }, true) });
          }
        }
        throw error;
      }
      const result = Array.isArray(rows) ? rows[0] : rows;
      if (!result) throw new Error("Unable to start blackjack hand");
      const hand = {
        id: result.hand_id,
        status: result.hand_status,
        stake,
        payout: Number(result.payout),
        player_cards: player,
        player_hands: null,
        active_hand_index: null,
        dealer_cards: dealer,
        player_total: playerTotal,
        dealer_total: dealerTotal,
        action_count: result.action_count,
        balance: Number(result.balance),
      };
      return response({ ok: true, resumed: false, hand: publicHand(hand, true) });
    }

    if (!["hit", "stand", "double", "split", "state"].includes(action)) throw new Error("Invalid action");
    const handId = String(body?.hand_id || "");
    if (!handId) throw new Error("Hand ID is required");
    const { data: hand, error: handError } = await admin.from("blackjack_hands")
      .select("id,user_id,stake,status,player_cards,player_hands,active_hand_index,dealer_cards,shoe,player_total,dealer_total,payout,action_count")
      .eq("id", handId).single();
    if (handError || !hand) throw new Error("Blackjack hand not found");
    if (hand.user_id !== userData.user.id) throw new Error("You cannot access another user's hand");
    const startingBalance = await loadBalance();
    if (action === "state") return response({ ok: true, hand: publicHand({ ...hand, balance: startingBalance }, true) });
    if (hand.status !== "active") throw new Error("Blackjack hand already settled");

    let player: Card[] = [...(hand.player_cards ?? [])];
    let dealer: Card[] = [...(hand.dealer_cards ?? [])];
    let shoe: Card[] = [...(hand.shoe ?? [])];
    let hands: SplitHand[] | null = Array.isArray(hand.player_hands)
      ? hand.player_hands.map((item: SplitHand) => ({ ...item, cards: [...item.cards] }))
      : null;
    let activeIndex = Number(hand.active_hand_index ?? 0);
    let status: any = "active";
    let payout = 0;
    let totalStake = Number(hand.stake);
    let additionalDebit = 0;

    if (action === "split") {
      if (hands || Number(hand.action_count) !== 0 || !canSplitCards(player)) throw new Error("Split is not legal for this hand");
      if (startingBalance < totalStake) throw new Error("Insufficient test balance");
      if (shoe.length < 2) throw new Error("Shoe does not have enough cards");
      additionalDebit = totalStake;
      totalStake += additionalDebit;
      hands = [
        { cards: [player[0], shoe.pop()!], stake: additionalDebit, status: "active", total: 0 },
        { cards: [player[1], shoe.pop()!], stake: additionalDebit, status: "active", total: 0 },
      ];
      hands.forEach((splitHand) => splitHand.total = total(splitHand.cards));
      activeIndex = 0;
      player = hands[0].cards;
      if (player[0].rank === "A" && hands[1].cards[0].rank === "A") {
        hands.forEach((splitHand) => splitHand.status = "stood");
        const settled = settleSplitHands(hands, dealer, shoe, totalStake);
        status = settled.status;
        payout = settled.payout;
      }
    } else if (hands) {
      const splitHand = hands[activeIndex];
      if (!splitHand || splitHand.status !== "active") throw new Error("Split hand state is invalid");
      if (action === "hit") {
        if (!shoe.length) throw new Error("Shoe is empty");
        splitHand.cards.push(shoe.pop()!);
        splitHand.total = total(splitHand.cards);
        if (splitHand.total > 21) splitHand.status = "bust";
        else if (splitHand.total === 21) splitHand.status = "stood";
      } else if (action === "stand") {
        splitHand.status = "stood";
      } else if (action === "double") {
        if (splitHand.cards.length !== 2) throw new Error("Double is not legal for this hand");
        if (startingBalance < splitHand.stake) throw new Error("Insufficient test balance");
        if (!shoe.length) throw new Error("Shoe is empty");
        additionalDebit = splitHand.stake;
        splitHand.stake += additionalDebit;
        totalStake += additionalDebit;
        splitHand.doubled = true;
        splitHand.cards.push(shoe.pop()!);
        splitHand.total = total(splitHand.cards);
        splitHand.status = splitHand.total > 21 ? "bust" : "stood";
      }

      if (splitHand.status !== "active") {
        const nextIndex = hands.findIndex((candidate, index) => index > activeIndex && candidate.status === "active");
        if (nextIndex >= 0) {
          activeIndex = nextIndex;
          player = hands[activeIndex].cards;
        } else {
          const settled = settleSplitHands(hands, dealer, shoe, totalStake);
          status = settled.status;
          payout = settled.payout;
          player = hands[0].cards;
        }
      }
    } else if (action === "double") {
      if (player.length !== 2) throw new Error("Double is not legal for this hand");
      if (startingBalance < totalStake) throw new Error("Insufficient test balance");
      if (!shoe.length) throw new Error("Shoe is empty");
      additionalDebit = totalStake;
      totalStake += additionalDebit;
      player.push(shoe.pop()!);
      const settled = settleSingle(player, dealer, shoe, totalStake);
      status = settled.status;
      payout = settled.payout;
    } else {
      if (action === "hit") {
        if (!shoe.length) throw new Error("Shoe is empty");
        player.push(shoe.pop()!);
        const playerTotal = total(player);
        if (playerTotal > 21) status = "player_bust";
        else if (playerTotal === 21) {
          const settled = settleSingle(player, dealer, shoe, totalStake);
          status = settled.status;
          payout = settled.payout;
        }
      }
      if (action === "stand") {
        const settled = settleSingle(player, dealer, shoe, totalStake);
        status = settled.status;
        payout = settled.payout;
      }
    }

    const roundedPayout = Math.round(Number(payout) * 100) / 100;
    const { data: rows, error } = await admin.rpc("advance_blackjack_test_hand_v3", {
      p_user_id: userData.user.id,
      p_hand_id: hand.id,
      p_expected_action_count: hand.action_count,
      p_status: status,
      p_stake: totalStake,
      p_player_cards: player,
      p_player_hands: hands,
      p_active_hand_index: hands ? activeIndex : null,
      p_dealer_cards: dealer,
      p_shoe: shoe,
      p_player_total: total(player),
      p_dealer_total: total(dealer),
      p_payout: roundedPayout,
      p_additional_debit: additionalDebit,
    });
    if (error) throw error;
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (!result) throw new Error("Unable to update blackjack hand");
    const updated = {
      id: hand.id,
      status: result.hand_status,
      stake: totalStake,
      payout: Number(result.payout),
      player_cards: player,
      player_hands: hands,
      active_hand_index: hands ? activeIndex : null,
      dealer_cards: dealer,
      player_total: total(player),
      dealer_total: total(dealer),
      action_count: result.action_count,
      balance: Number(result.balance),
    };
    return response({ ok: true, hand: publicHand(updated, true) });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to process blackjack hand" }, 400);
  }
});
