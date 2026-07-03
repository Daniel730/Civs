# Civs Sprint 2 — Manual Test Plan

Quick in-game verification after deploying `civs-1.11.6.jar` with Vault + economy.

## StatManager (CIVS-006)

1. Grant a territorial stat via console/API (`StatManager.addModifier` with `SHOP_DISCOUNT` ADD 0.1).
2. Stand in your town/region, open Civs shop, confirm discounted price vs raw price.
3. PvP two full town members inside the same town — territorial attack/defense perks should **not** apply.
4. `/papi parse me %civs_stat_shop_discount%` returns modifier total.

## Auction BIN (CIVS-007)

1. `/civs auction sell 100` with item in main hand — listing appears in browse GUI.
2. Browse GUI: toggle price/name sort; hold diamond, click filter; clear filter.
3. Sell GUI: click held item → chat suggests `/civs auction sell `; complete command lists item.
4. Another player buys listing; seller receives Vault deposit.
5. Cancel own listing from My Listings; expired listing returns via `/civs auction claim`.
6. `/papi parse me %civs_auction_listings%` and `%civs_auction_my_listings%`.
7. Switch locale `pt_br` — auction menu strings appear in Portuguese.

## SpellPreCastEvent (CIVS-008)

1. Cast any Civs spell with sufficient mana — spell works normally.
2. With a test plugin listener cancelling `SpellPreCastEvent`, cast again — no mana consumed, no spell effect.

## Reload

1. `/civs reload` — auction listings persist; menus reopen without error.
