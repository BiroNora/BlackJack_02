import type { GameState, GameStateData } from "../types/game-types";

export interface GameDataState {
  lastResponse: GameStateData | null;
  currentUIPhase: GameState;
  // Külön is tárolhatunk fontos értékeket a könnyebb eléréshez
  tokens: number;
}

// Definiáljuk az akciókat, ha még nincsenek a types-ban
export type GameAction =
  | { type: 'SYNC_SERVER_DATA'; payload: GameStateData }
  | { type: 'SET_UI_PHASE'; payload: GameState };

export const initialGameDataState: GameDataState = {
  lastResponse: null,
  currentUIPhase: 'LOADING',
  tokens: 0,
};

export function gameReducer(state: GameDataState, action: GameAction): GameDataState {
  switch (action.type) {
    case 'SYNC_SERVER_DATA':
      return {
        ...state,
        lastResponse: action.payload,
        tokens: action.payload.tokens, // A GameStateData-ban ott a tokens!
      };

    case 'SET_UI_PHASE':
      return {
        ...state,
        currentUIPhase: action.payload
      };

    default:
      return state;
  }
}
