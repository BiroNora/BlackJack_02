import type { GameState, GameStateData } from "../types/game-types";

export interface GameDataState {
  gameState: GameStateData; // Ez tartja a szerver adatait
  preRewardBet: number | null;
  preRewardTokens: number | null;
  insPlaced: boolean; // Gomb megjelenítéséhez
  showInsLost: boolean; // Felirathoz
  initDeckLen: number | null; // Animációhoz
}

// Definiáljuk az akciókat, ha még nincsenek a types-ban
export type GameAction =
  | { type: 'SYNC_SERVER_DATA'; payload: GameStateData }
  | { type: 'SET_UI_PHASE'; payload: GameState }
  | { type: 'SET_DECK_LEN'; payload: number | null }
  | { type: 'SET_BET_SNAPSHOTS'; payload: { bet: number; tokens: number } }
  | { type: 'SET_INS_PLACED'; payload: boolean }
  | { type: 'SET_SHOW_INS_LOST'; payload: boolean };

export const initialGameDataState: GameDataState = {
  gameState: {
    currentGameState: 'LOADING',
    tokens: 0,
    bet: 0,
    // ... ide kell az összes többi mező a GameStateData-ból (üresen vagy null-al)
  } as GameStateData,
  preRewardBet: null,
  preRewardTokens: null,
  insPlaced: false,
  showInsLost: false,
  initDeckLen: null,
};

export function gameReducer(state: GameDataState, action: GameAction): GameDataState {
  switch (action.type) {
    case 'SYNC_SERVER_DATA':
      return {
        ...state,
        gameState: action.payload,
      };
    case 'SET_UI_PHASE':
      return {
        ...state,
        gameState: { ...state.gameState, currentGameState: action.payload }
      };
    case 'SET_DECK_LEN':
      return { ...state, initDeckLen: action.payload };
    case 'SET_BET_SNAPSHOTS':
      return { ...state, preRewardBet: action.payload.bet, preRewardTokens: action.payload.tokens };
    case 'SET_INS_PLACED':
      return { ...state, insPlaced: action.payload };
    case 'SET_SHOW_INS_LOST':
      return { ...state, showInsLost: action.payload };
    default:
      return state;
  }
}
