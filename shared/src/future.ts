/**
 * Shapes reserved for later systems. None of these are implemented, stored, or
 * messaged in M0. There is intentionally no trade or player-to-player item
 * exchange type: Tiny Realms will not have player trading.
 */

export interface FutureItemDef {
  id: string;
  name: string;
  stack: number;
}

export interface FutureInventorySlot {
  itemId: string;
  qty: number;
}

export interface FutureGear {
  weapon: string | null;
  armor: string | null;
  trinket: string | null;
}

export interface FutureQuestState {
  questId: string;
  step: number;
  done: boolean;
}

export interface FutureParty {
  id: string;
  leaderCharacterId: number;
  memberCharacterIds: number[];
}

export interface FutureCraftRecipe {
  id: string;
  inputs: { itemId: string; qty: number }[];
  outputItemId: string;
  outputQty: number;
}

/** A dungeon instance is its own region sim. M0 only stores the entrance. */
export interface DungeonInstance {
  instanceId: string;
  dungeonId: string;
  shardId: string;
}
