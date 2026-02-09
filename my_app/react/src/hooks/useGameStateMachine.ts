import { useState, useEffect, useCallback, useRef, useReducer } from "react";
import {
  initializeSessionAPI,
  setBet,
  takeBackDeal,
  clearGameState,
  recoverGameState,
  getShuffling,
  startGame,
  handleHit,
  //handleRewards,
  handleInsurance,
  handleDouble,
  handleStandAndRewards,
  splitHand,
  //addToPlayersListByStand,
  //addSplitPlayerToGame,
  //addPlayerFromPlayers,
  handleSplitDouble,
  //handleSplitStandAndRewards,
  //setRestart,
  //forceRestart,
  splitHit,
  type HttpError,
} from "../api/api-calls";
import type {
  GameState,
  GameStateData,
  GameStateMachineHookResult,
  SessionInitResponse,
} from "../types/game-types";
import { extractGameStateData } from "../utilities/utils";
import { gameReducer, initialGameDataState } from "../context/gameReducer";

// Kezdeti állapot a játékgép számára
const initialGameState: GameStateData = {
  currentGameState: "LOADING",
  player: {
    id: "NONE",
    hand: [],
    sum: 0,
    hand_state: 0,
    can_split: false,
    stated: false,
    bet: 0,
    has_hit: 0,
  },
  dealer_masked: {
    hand: [],
    sum: 0,
    can_insure: false,
    nat_21: 0,
  },
  dealer_unmasked: {
    hand: [],
    sum: 0,
    hand_state: 0,
    natural_21: 0,
  },
  aces: false,
  natural_21: 0,
  winner: 0,
  players: {},
  split_req: 0,
  deck_len: 104,
  tokens: 0,
  bet: 0,
  bet_list: [],
  is_round_active: false,
  has_rewards: false,
  target_phase: "LOADING",
  pre_phase: "INIT_GAME",
};

// A hook visszatérési típusa most inline van deklarálva, nincs külön 'type' definíció.
export function useGameStateMachine(): GameStateMachineHookResult {
  const [gameState, setLocalGameState] =
    useState<GameStateData>(initialGameState);
  // isWaitingForServerResponse = isWFSR  (button disabling)
  // setIsWaitingForServerResponse = setIsWFSR
  const [isWFSR, setIsWFSR] = useState(false);
  const [state, dispatch] = useReducer(gameReducer, initialGameDataState);

  //const isSplitNat21 = useRef(false);
  const timeoutIdRef = useRef<number | null>(null);
  // Az isMounted ref-et is használjuk a komponens mountolt állapotának követésére
  // Ennek típusa boolean, a useRef pedig automatikusan kikövetkezteti.
  const isMountedRef = useRef(true);
  // Ez a védelmi zár (lock) az ismételt hívások ellen
  const isProcessingRef = useRef(false);
  const isAppInitializedRef = useRef(false);

  // Állapotváltó funkció
  const transitionToState = useCallback(
    (newState: GameState, newData?: Partial<GameStateData>) => {
      isProcessingRef.current = false;
      setLocalGameState((prev) => {
        const updatedState = {
          ...prev,
          ...newData,
          currentGameState: newState,
        };
        //console.log(
        //  `>>> Állapotváltás: ${prev.currentGameState} -> ${newState}`,
        //  updatedState
        //);
        return updatedState;
      });
    },
    [],
  );

  const savePreActionState = useCallback(() => {
    if (gameState) {
      // Használd a meglévő Reducer akciódat!
      dispatch({
        type: 'SET_BET_SNAPSHOTS',
        payload: {
          bet: gameState.player.bet,
          tokens: gameState.tokens
        }
      });
    }
  }, [gameState, dispatch]);

  const resetGameVariables = useCallback(() => {
    dispatch({ type: 'RESET_TURN_VARIABLES' });

    // Az isWFSR-t (Wait For Server Response) érdemes lehet megtartani useState-ként,
    // ha az csak a gombok tiltására szolgál és nem része a globális játékállapotnak.
    setIsWFSR(false);
  }, [dispatch]);

  const executeAsyncAction = useCallback(async (actionFn: () => Promise<void>) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsWFSR(true);

    try {
      await actionFn();
    } catch (error) {
      console.error("Action error:", error);
      if (isMountedRef.current) {
        transitionToState("ERROR");
      }
    } finally {
      if (isMountedRef.current) {
        setIsWFSR(false);
        isProcessingRef.current = false;
      }
    }
  }, [transitionToState]);

  const handleApiAction = useCallback(
    async <T>(apiCallFn: () => Promise<T>): Promise<T | null> => {
      try {
        const data = await apiCallFn();
        return data;
      } catch (error) {
        const httpError = error as HttpError;
        const response = httpError.response;

        if (response && typeof response.status === "number") {
          const status = response.status;

          if (status >= 400 && status < 500) {
            const errorMessage = httpError.message || "Érvénytelen kérés.";
            console.warn(`Nem kritikus API hiba (4xx): ${errorMessage}`);
            return null;
          } else {
            console.error("Kritikus hiba (5xx vagy hálózati):", error);
            transitionToState("ERROR");
            return null;
          }
        }

        // Ha nincs response.status (pl. hálózati timeout vagy nem HttpError)
        console.error("Hálózati vagy ismeretlen API hiba:", error);
        transitionToState("ERROR");
        return null;
      }
    },
    [transitionToState],
  );
  // MÉG NINCS MEG! Legutolsó az állapotváltozás miatt
  const handleOnContinue = useCallback(async () => {
    setIsWFSR(true);

    try {
      const data = await handleApiAction(recoverGameState);
      if (data) {
        if (!isMountedRef.current) return;

        const response = extractGameStateData(data);
        const hasSplit = response?.players && Object.keys(response.players).length > 0;
        const isActive = response?.is_round_active;

        if (hasSplit) {
          transitionToState(response.has_rewards ? "SPLIT_FINISH" : "SPLIT_TURN", response);
        } else if (isActive) {
          transitionToState("MAIN_TURN", response);
        } else {
          transitionToState("BETTING", response);
        }
      }
    } catch {
      if (isMountedRef.current) {
        transitionToState("ERROR");
      }
    } finally {
      if (isMountedRef.current) {
        setIsWFSR(false);
      }
    }
  }, [handleApiAction, transitionToState]);


  const handleOnStartNew = useCallback(async () => {
    setIsWFSR(true);

    try {
      const data = await handleApiAction(clearGameState);
      if (data) {
        if (!isMountedRef.current) return;

        const response = extractGameStateData(data);

        if (response) {
          dispatch({
            type: 'SYNC_SERVER_DATA',
            payload: response as GameStateData
          });

          transitionToState(response.target_phase ?? "ERROR", response);
        }
      }
    } catch {
      if (isMountedRef.current) {
        transitionToState("ERROR");
      }
    } finally {
      if (isMountedRef.current) {
        setIsWFSR(false);
      }
    }
  }, [handleApiAction, transitionToState, dispatch]);

  const handlePlaceBet = useCallback(
    async (amount: number) => {
      if (gameState.tokens >= amount && amount > 0) {
        setIsWFSR(true);

        try {
          const data = await handleApiAction(() => setBet(amount));
          if (data) {
            if (!isMountedRef.current) return;

            const response = extractGameStateData(data);

            if (response) {
              dispatch({
                type: 'SYNC_SERVER_DATA',
                payload: response as GameStateData
              });

              transitionToState(response.target_phase ?? "ERROR", response);
            }
          }
        } catch {
          if (isMountedRef.current) {
            transitionToState("ERROR");
          }
        } finally {
          if (isMountedRef.current) {
            setIsWFSR(false);
          }
        }
      }
    },
    [gameState.tokens, handleApiAction, transitionToState, dispatch]
  );

  const handleRetakeBet = useCallback(async () => {
    if (gameState.bet_list) {
      setIsWFSR(true);

      try {
        const data = await handleApiAction(takeBackDeal);
        if (data) {
          if (!isMountedRef.current) return;

          const response = extractGameStateData(data);

          if (response) {
            dispatch({
              type: 'SYNC_SERVER_DATA',
              payload: response as GameStateData
            });

            transitionToState(response.target_phase ?? "ERROR", response);
          }
        }
      } catch {
        if (isMountedRef.current) {
          transitionToState("ERROR");
        }
      } finally {
        if (isMountedRef.current) {
          setIsWFSR(false);
        }
      }
    }
  }, [gameState.bet_list, handleApiAction, transitionToState, dispatch]);

  const handleStartGame = useCallback(async () => {
    const response = state.gameState;
    console.log("handleStartGame response: ", response)
    if (!response) return;

    setIsWFSR(true);

    // A logika egyszerű: ha a szerver szerint kell valami "elő-fázis" (pl. SHUFFLING),
    // akkor oda megyünk. Ha nincs ilyen, akkor a végcélhoz (pl. INIT_GAME).
    const nextState = response.pre_phase || response.target_phase || "ERROR";

    transitionToState(nextState, response);

    setIsWFSR(false);
  }, [state.gameState, transitionToState]);

  const handleHitRequest = useCallback(() => {
    executeAsyncAction(async () => {
      dispatch({
        type: 'SET_SHOW_INS_LOST',
        payload: false
      });

      savePreActionState();

      const data = await handleApiAction(handleHit);
      if (data && isMountedRef.current) {
        const response = extractGameStateData(data);

        if (response) {
          dispatch({
            type: 'SYNC_SERVER_DATA',
            payload: response as GameStateData
          });

          transitionToState(response.target_phase ?? "ERROR", response);
        }
      }
    });
  }, [executeAsyncAction, savePreActionState, handleApiAction, transitionToState]);

  const handleStandRequest = useCallback(() => {
    executeAsyncAction(async () => {
      dispatch({ type: 'SET_SHOW_INS_LOST', payload: false });
      savePreActionState();

      const data = await handleApiAction(handleStandAndRewards);

      if (data && isMountedRef.current) {
        const response = extractGameStateData(data);
        if (response) {
          dispatch({
            type: 'SYNC_SERVER_DATA',
            payload: response as GameStateData
          });

          if (isMountedRef.current) {
            transitionToState(response.target_phase ?? "ERROR", response);
          }
        }
      }
    });
  }, [executeAsyncAction, savePreActionState, handleApiAction, transitionToState]);

  const handleDoubleRequest = useCallback(() => {
    executeAsyncAction(async () => {
      dispatch({
        type: 'SET_SHOW_INS_LOST',
        payload: false
      });

      const data = await handleApiAction(handleDouble);
      if (data && isMountedRef.current) {
        const response = extractGameStateData(data);
        if (response) {
          dispatch({
            type: 'SYNC_SERVER_DATA',
            payload: response as GameStateData
          });

          if (response.player && response.tokens !== undefined) {
            dispatch({
              type: 'SET_BET_SNAPSHOTS',
              payload: {
                bet: response.player.bet,
                tokens: response.tokens
              }
            });
          }

          transitionToState(response?.target_phase ?? "ERROR", response);
        }
      }
    });
  }, [executeAsyncAction, handleApiAction, transitionToState]);

  const handleInsRequest = useCallback(() => {
    executeAsyncAction(async () => {
      dispatch({
        type: 'SET_INS_PLACED',
        payload: true
      });

      savePreActionState();


      const data = await handleApiAction(handleInsurance);
      if (data && isMountedRef.current) {
        const response = extractGameStateData(data);

        if (response) {
          dispatch({
            type: 'SYNC_SERVER_DATA',
            payload: response as GameStateData
          });

          transitionToState(response?.target_phase ?? "ERROR", response);
        }
      }
    });
  }, [executeAsyncAction, savePreActionState, handleApiAction, transitionToState]);
  // INNEN
  // SPLIT part
  const handleSplitRequest = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    console.log("Split elindítva, sorompó LEZÁRVA (true)");
    setIsWFSR(true);
    dispatch({
      type: 'SET_SHOW_INS_LOST',
      payload: false
    });

    savePreActionState();

    try {
      const data = await handleApiAction(splitHand);
      if (data) {
        if (!isMountedRef.current) return;
        const response = extractGameStateData(data);
        if (response && response.player) {
          if (
            response.aces === true ||
            (response.player.hand.length === 2 && response.player.sum === 21)
          ) {
            console.log(
              "Speciális eset (Ász/21), sorompó KINYITVA a tranzithoz (false)",
            );
            isProcessingRef.current = false;

            const nextState =
              response.aces === true
                ? "SPLIT_ACE_TRANSIT"
                : "SPLIT_NAT21_TRANSIT";
            transitionToState(nextState, response);
            return;
          } else {
            transitionToState("SPLIT_TURN", response);
          }
        }
      }
    } catch {
      if (isMountedRef.current) {
        transitionToState("ERROR");
      }
    } finally {
      if (isMountedRef.current) {
        setIsWFSR(false);
      }
    }
  }, [handleApiAction, savePreActionState, transitionToState]);

  const handleSplitHitRequest = useCallback(async () => {
    setIsWFSR(true);

    try {
      const data = await handleApiAction(splitHit);
      if (data) {
        if (!isMountedRef.current) return;
        const response = extractGameStateData(data);

        if (response && response.player) {
          const playerHandValue = response.player.sum;
          if (playerHandValue >= 21) {
            if (response.player?.has_hit === 1) {
              transitionToState("SPLIT_STAND_DOUBLE", response);
            } else {
              transitionToState("SPLIT_STAND", response);
            }
          } else {
            transitionToState("SPLIT_TURN", response);
          }
        }
      }
    } catch {
      if (isMountedRef.current) {
        transitionToState("ERROR");
      }
    } finally {
      if (isMountedRef.current) {
        setIsWFSR(false);
      }
    }
  }, [handleApiAction, transitionToState]);

  const handleSplitStandRequest = useCallback(async () => {
    setIsWFSR(true);

    if ((gameState.player.has_hit || 0) === 0) {
      transitionToState("SPLIT_STAND_DOUBLE", gameState);
    } else {
      transitionToState("SPLIT_STAND", gameState);
    }
  }, [gameState, transitionToState]);

  const handleSplitDoubleRequest = useCallback(async () => {
    setIsWFSR(true);

    try {
      const data = await handleApiAction(handleSplitDouble);
      if (data) {
        if (!isMountedRef.current) return;
        const response = extractGameStateData(data);
        if (response && response.player && response.tokens) {
          transitionToState("SPLIT_STAND_DOUBLE", response);
        } else {
          transitionToState("SPLIT_TURN", gameState);
        }
      }
    } catch {
      if (isMountedRef.current) {
        transitionToState("ERROR");
      }
    } finally {
      if (isMountedRef.current) {
        setIsWFSR(false);
      }
    }
  }, [gameState, handleApiAction, transitionToState]);

  // --- useEffect blokkok ---
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // --- SPECIÁLIS EFFECT: Csak az app indulásakor/inicializálásakor ---
  // --- LOADING ÁLLAPOT KEZELÉSE ---
  useEffect(() => {
    // Ha nem LOADING-ban vagyunk, ez az effekt "alszik"
    if (gameState.currentGameState !== "LOADING" || isProcessingRef.current) return;

    // Dupla védelem: ha már inicializáltunk, nem futunk neki még egyszer
    if (isAppInitializedRef.current) return;
    isAppInitializedRef.current = true;

    isProcessingRef.current = true;
    console.log("--- INITIALIZING SESSION INDUL ---");

    const initializeApplicationOnLoad = async () => {
      try {
        const minLoadingTimePromise = new Promise((resolve) => setTimeout(resolve, 700));
        const initializationPromise = handleApiAction(initializeSessionAPI);

        const [initData] = await Promise.all([
          initializationPromise,
          minLoadingTimePromise,
        ]);

        if (!isMountedRef.current || !initData) {
          isProcessingRef.current = false;
          return;
        }

        const { tokens, game_state } = initData as SessionInitResponse;

        dispatch({
          type: 'SYNC_SERVER_DATA',
          payload: { tokens, ...game_state } as GameStateData
        });

        dispatch({ type: 'SET_DECK_LEN', payload: game_state.deck_len });

        // FONTOS: Itt manuálisan jelezzük a gépnek, hogy felszabadultunk
        isProcessingRef.current = false;

        const nextPhase = game_state.target_phase as GameState;
        transitionToState(nextPhase, { tokens, ...game_state });

      } catch (error) {
        console.error("Initialization Error: ", error);
        isProcessingRef.current = false;
        if (isMountedRef.current) transitionToState("ERROR", { tokens: 0, deck_len: 0 });
      }
    };

    initializeApplicationOnLoad();
  }, [gameState.currentGameState, transitionToState, handleApiAction, dispatch]);

  // --- SHUFFLING ---
  useEffect(() => {
    if (gameState.currentGameState !== "SHUFFLING" || isProcessingRef.current) return;

    isProcessingRef.current = true;
    console.log("--- SHUFFLING INDUL ---");

    const shufflingAct = async () => {
      try {
        const data = await handleApiAction(getShuffling);

        if (data && isMountedRef.current) {
          const response = extractGameStateData(data);

          // Mentés a központi állapotba
          if (response) {
            dispatch({ type: 'SYNC_SERVER_DATA', payload: response as GameStateData });
          }

          // A setTimeout ID-t elmentjük, hogy törölhessük ha kell
          timeoutIdRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
              isProcessingRef.current = false;
              transitionToState(response?.target_phase as GameState, response);
            }
          }, 1000);
        } else {
          isProcessingRef.current = false;
        }
      } catch {
        isProcessingRef.current = false;
        if (isMountedRef.current) transitionToState("ERROR");
      }
    };

    shufflingAct();

    // CLEANUP
    return () => {
      if (timeoutIdRef.current) {
        window.clearTimeout(timeoutIdRef.current);
      }
    };
  }, [gameState.currentGameState, handleApiAction, transitionToState, dispatch]);

  // --- INIT_GAME ---
  useEffect(() => {
    if (gameState.currentGameState !== "INIT_GAME" || isProcessingRef.current) return;

    isProcessingRef.current = true;
    console.log("--- INIT_GAME BLOKK INDUL ---");

    const initGameAct = async () => {
      try {
        setIsWFSR(true);
        resetGameVariables();
        const currentDeckLen = state.gameState.deck_len;
        dispatch({ type: 'SET_DECK_LEN', payload: currentDeckLen });

        const data = await handleApiAction(startGame);

        if (data && isMountedRef.current) {
          const response = extractGameStateData(data);
          console.log("Response init game: ", response);

          if (response) {
            dispatch({ type: 'SYNC_SERVER_DATA', payload: response as GameStateData });

            isProcessingRef.current = false;

            const nextPhase = response.pre_phase as GameState;
            transitionToState(nextPhase, response);
          }
        } else {
          isProcessingRef.current = false;
        }
      } catch {
        isProcessingRef.current = false;
        if (isMountedRef.current) transitionToState("ERROR");
      } finally {
        if (isMountedRef.current) setIsWFSR(false);
      }
    };

    initGameAct();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.currentGameState,
    transitionToState,
    handleApiAction,
    resetGameVariables,
    dispatch,
    setIsWFSR]);

  // INNEN
  useEffect(() => {
    if (gameState.currentGameState !== "MAIN_TURN") return;

    const MainTurn = async () => {
      // Itt ne zárd le a lakatot azonnal, mert a gombnyomásoknak működniük kell!
      setIsWFSR(true);
      try {
        // Ha eléri a 21-et vagy többet, automatikusan továbbküldjük
        if (gameState.player.sum >= 21) {
          if (isProcessingRef.current) return;
          isProcessingRef.current = true; // Csak az átmenetnél zárunk

          transitionToState("MAIN_STAND_REWARDS_TRANSIT", gameState);
        }
      } catch {
        if (isMountedRef.current) transitionToState("ERROR");
      } finally {
        if (isMountedRef.current) setIsWFSR(false);
      }
    };
    MainTurn();
  }, [gameState, gameState.currentGameState, gameState.player.sum, transitionToState]);

  useEffect(() => {
    if (gameState.currentGameState !== "MAIN_STAND") return;
    if (isProcessingRef.current) return;

    isProcessingRef.current = true; // Lezárjuk a 4 másodpercre
    console.log("--- MAIN_STAND: Eredmény mutatása ---");

    timeoutIdRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        isProcessingRef.current = false; // NYITÁS a váltás előtt

        if (gameState.tokens === 0) {
          transitionToState("OUT_OF_TOKENS");
        } else {
          const nextRoundGameState: Partial<GameStateData> = {
            ...initialGameState,
            currentGameState: "BETTING",
            deck_len: gameState.deck_len,
            tokens: gameState.tokens,
            bet: 0,
          };
          transitionToState("BETTING", nextRoundGameState);
        }
      }
    }, 4000);

    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
  }, [gameState.currentGameState, gameState.tokens, gameState.deck_len, transitionToState]);

  useEffect(() => {
    if (gameState.currentGameState !== "MAIN_STAND_REWARDS_TRANSIT") return;
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    console.log("--- MAIN_STAND_REWARDS_TRANSIT: API hívás ---");

    const MainStandDoubleTransit = async () => {
      try {
        const data = await handleStandAndRewards();
        if (data && isMountedRef.current) {
          const response = extractGameStateData(data);

          if (response) {
            timeoutIdRef.current = window.setTimeout(() => {
              if (isMountedRef.current) {
                isProcessingRef.current = false; // NYITÁS
                transitionToState("MAIN_STAND", response);
              }
            }, 200);
          }
        } else {
          isProcessingRef.current = false;
        }
      } catch {
        isProcessingRef.current = false;
        if (isMountedRef.current) transitionToState("ERROR");
      }
    };

    MainStandDoubleTransit();
  }, [gameState.currentGameState, transitionToState]);




  return {
    gameState,
    currentGameState: gameState.currentGameState,
    transitionToState,
    handleStartGame,
    handleOnContinue,
    handleOnStartNew,
    handlePlaceBet,
    handleRetakeBet,
    handleHitRequest,
    handleStandRequest,
    handleDoubleRequest,
    handleSplitRequest,
    handleSplitHitRequest,
    handleSplitStandRequest,
    handleSplitDoubleRequest,
    handleInsRequest,
    preRewardBet: state.preRewardBet,
    preRewardTokens: state.preRewardTokens,
    showInsLost: state.showInsLost,
    insPlaced: state.insPlaced,
    initDeckLen: state.initDeckLen,
    isWFSR,
  };
}
