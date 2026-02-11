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
  handleSplitHand,
  addToPlayersListByStand,
  addSplitPlayerToGame,
  addPlayerFromPlayers,
  handleSplitDouble,
  handleSplitStandAndRewards,
  setRestart,
  forceRestart,
  handleSplitHit,
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
      if (!isMountedRef.current) return;
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
    async <T,>(apiCallFn: () => Promise<T>): Promise<T | null> => {
      try {
        return await apiCallFn();
      } catch (error) {
        const httpError = error as HttpError;
        const status = httpError.response?.status;

        console.error(status && status < 500 ? "Kliens hiba:" : "Szerver hiba:", error);

        if (isMountedRef.current) {
          transitionToState("ERROR");
        }

        throw error; // Megállítja a végrehajtást a gomb-kezelőben is!
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

  const handleOnStartNew = useCallback(() => {
    executeAsyncAction(async () => {
      // 1. Meghívjuk az API-t a diplomata (handleApiAction) segítségével
      // Ha hiba van, a throw miatt itt megáll, és az executeAsyncAction catch ága vált ERROR-ra
      const data = await handleApiAction(clearGameState);

      // 2. Feldolgozzuk az adatot (itt már biztosan van data, különben throw történt volna)
      const response = extractGameStateData(data);
      if (!response) return;

      // 3. Szinkronizálunk
      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });

      // 4. Átlépünk az új fázisba (SHUFFLING vagy BETTING a szerver döntése alapján)
      transitionToState(response.target_phase ?? "ERROR", response);
    });
  }, [executeAsyncAction, handleApiAction, transitionToState, dispatch]);

  const handlePlaceBet = useCallback(
    async (amount: number) => {
      if (gameState.tokens < amount || amount <= 0) return;

      executeAsyncAction(async () => {
        const data = await handleApiAction(() => setBet(amount));

        const response = extractGameStateData(data);
        if (!response) return;

        dispatch({
          type: 'SYNC_SERVER_DATA',
          payload: response as GameStateData
        });

        transitionToState(response.target_phase ?? "ERROR", response);
      });
    },
    [gameState.tokens, executeAsyncAction, handleApiAction, transitionToState, dispatch]
  );

  const handleRetakeBet = useCallback(() => {
    // Guard clause: csak akkor indítunk, ha van mit visszavenni
    if (!gameState.bet_list || gameState.bet_list.length === 0) return;

    executeAsyncAction(async () => {
      const data = await handleApiAction(takeBackDeal);

      const response = extractGameStateData(data);
      if (!response) return;

      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });

      transitionToState(response.target_phase ?? "ERROR", response);
    });
  }, [gameState.bet_list, executeAsyncAction, handleApiAction, transitionToState, dispatch]);

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
      const response = extractGameStateData(data);

      if (!response) return;

      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });

      transitionToState(response.target_phase ?? "ERROR", response);
    });
  }, [executeAsyncAction, savePreActionState, handleApiAction, transitionToState]);

  const handleStandRequest = useCallback(() => {
    executeAsyncAction(async () => {
      dispatch({ type: 'SET_SHOW_INS_LOST', payload: false });
      savePreActionState();

      const data = await handleApiAction(handleStandAndRewards);

      const response = extractGameStateData(data);
      if (!response) return;
      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });

      transitionToState(response.target_phase ?? "ERROR", response);
    });
  }, [executeAsyncAction, savePreActionState, handleApiAction, transitionToState]);

  const handleDoubleRequest = useCallback(() => {
    executeAsyncAction(async () => {
      dispatch({
        type: 'SET_SHOW_INS_LOST',
        payload: false
      });

      const data = await handleApiAction(handleDouble);

      const response = extractGameStateData(data);
      if (!response) return;
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
      const response = extractGameStateData(data);
      if (!response) return;

      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });

      if (response.target_phase === "MAIN_TURN") {
        dispatch({ type: 'SET_SHOW_INS_LOST', payload: true });
      }
      transitionToState(response?.target_phase ?? "ERROR", response);
    });
  }, [executeAsyncAction, savePreActionState, handleApiAction, transitionToState]);

  // SPLIT PART
  const handleSplitRequest = useCallback(async () => {
    executeAsyncAction(async () => {
      dispatch({
        type: 'SET_SHOW_INS_LOST',
        payload: false
      });

      savePreActionState();

      const data = await handleApiAction(handleSplitHand);

      const response = extractGameStateData(data);
      if (!response) return;
      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });

      /* if (response && response.player) {
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
      } */
      transitionToState(response?.target_phase ?? "ERROR", response);
    });
  }, [executeAsyncAction, handleApiAction, savePreActionState, transitionToState]);

  const handleSplitHitRequest = useCallback(async () => {
    executeAsyncAction(async () => {
      const data = await handleApiAction(handleSplitHit);

      const response = extractGameStateData(data);
      if (!response) return;

      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });
      transitionToState(response?.target_phase ?? "ERROR", response);
      /* if (response && response.player) {
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
      } */
    });
  }, [executeAsyncAction, handleApiAction, transitionToState]);

  const handleSplitStandRequest = useCallback(async () => {
    executeAsyncAction(async () => {

      if ((gameState.player.has_hit || 0) === 0) {
        transitionToState("SPLIT_STAND_DOUBLE", gameState);
      } else {
        transitionToState("SPLIT_STAND", gameState);
      }
    });
  }, [executeAsyncAction, gameState, transitionToState]);

  const handleSplitDoubleRequest = useCallback(async () => {
    executeAsyncAction(async () => {

      const data = await handleApiAction(handleSplitDouble);
      const response = extractGameStateData(data);
      if (!response) return;
      dispatch({
        type: 'SYNC_SERVER_DATA',
        payload: response as GameStateData
      });

      /* if (data) {
        if (!isMountedRef.current) return;
        if (response && response.player && response.tokens) {
          transitionToState("SPLIT_STAND_DOUBLE", response);
        } else {
          transitionToState("SPLIT_TURN", gameState);
        }
      } */
      transitionToState(response?.target_phase ?? "ERROR", response);
    });
  }, [executeAsyncAction, handleApiAction, transitionToState]);

  // --- useEffect blokkok ---
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // --- SPECIÁLIS EFFECT: Csak az app indulásakor/inicializálásakor ---
  // --- LOADING ---
  useEffect(() => {
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

        if (!isMountedRef.current) return;

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
        // 1. API hívás (ha hiba van, a catch-re ugrik)
        const data = await handleApiAction(getShuffling);

        // 2. Ide már csak akkor jutunk, ha van adat
        const response = extractGameStateData(data);

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

      } catch {
        if (isMountedRef.current) {
          isProcessingRef.current = false; // Fontos felszabadítani hiba esetén is!
          // A transitionToState("ERROR")-t a handleApiAction már megcsinálta belül!
        }
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


        const response = extractGameStateData(data);

        if (!response || !isMountedRef.current) {
          isProcessingRef.current = false;
          return;
        }
        dispatch({ type: 'SYNC_SERVER_DATA', payload: response as GameStateData });

        isProcessingRef.current = false;

        const nextPhase = response.pre_phase as GameState;
        transitionToState(nextPhase, response);


      } catch (error) {
        console.error("Init Game hiba:", error);
        isProcessingRef.current = false;
      } finally {
        if (isMountedRef.current) setIsWFSR(false);
      }
    };

    initGameAct();
  }, [gameState.currentGameState,
    transitionToState,
    handleApiAction,
    resetGameVariables,
    dispatch,
    setIsWFSR, state.gameState.deck_len]);

  // --- MAIN_STAND ---
  useEffect(() => {
    if (gameState.currentGameState !== "MAIN_STAND" || isProcessingRef.current) return;

    isProcessingRef.current = true;
    console.log("--- MAIN_STAND INDUL ---");

    timeoutIdRef.current = window.setTimeout(() => {
      // Ellenőrizzük, hogy még mindig a komponensnél vagyunk-e
      if (isMountedRef.current) {
        // Fontos: Előbb felszabadítjuk a lockot, mielőtt váltunk,
        // hogy a következő fázis (pl. BETTING) tiszta lappal indulhasson.
        isProcessingRef.current = false;

        const rawPrePhase = gameState.pre_phase;
        const nextPhase = (rawPrePhase as string === "NONE" || !rawPrePhase)
          ? "BETTING"
          : (rawPrePhase as GameState);
        transitionToState(nextPhase, gameState);
      }
    }, 4000);

    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.currentGameState, gameState.pre_phase, transitionToState]);

  // --- MAIN_STAND_REWARDS_TRANSIT ---
  useEffect(() => {
    if (gameState.currentGameState !== "MAIN_STAND_REWARDS_TRANSIT" || isProcessingRef.current) return;

    isProcessingRef.current = true;
    console.log("--- MAIN_STAND_REWARDS_TRANSIT INDUL ---");

    const MainStandTransit = async () => {
      try {
        const data = await handleApiAction(handleStandAndRewards);

        const response = extractGameStateData(data);

        if (!response || !isMountedRef.current) {
          isProcessingRef.current = false;
          return;
        }
        timeoutIdRef.current = window.setTimeout(() => {
          if (isMountedRef.current) {
            isProcessingRef.current = false; // NYITÁS
            transitionToState(response?.target_phase as GameState, response);
          }
        }, 200);
      } catch (error) {
        console.error("Transit Error:", error);
        isProcessingRef.current = false;
      }
    };
    MainStandTransit();
  }, [gameState.currentGameState, handleApiAction, transitionToState]);

  // --- SPLIT_STAND and SPLIT_STAND_DOUBLE
  useEffect(() => {
    const isSplitStand = gameState.currentGameState === "SPLIT_STAND" ||
      gameState.currentGameState === "SPLIT_STAND_DOUBLE";

    // Kapuőr: Ha nem releváns az állapot, vagy már fut egy folyamat, kilépünk
    if (!isSplitStand || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setIsWFSR(true);
    console.log(`--- ${gameState.currentGameState} LOGIKA INDUL ---`);
    const SplitStand = async () => {
      try {
        // --- 1. KEZDETI VÁRAKOZÁS ---
        // Ha nem SPLIT_NAT21-ből jövünk, várunk 2 mp-et, hogy látszódjanak a lapok
        //const initialDelay = isSplitNat21.current ? 0 : 2000;
        const initialDelay = 2000;
        await new Promise(resolve => {
          timeoutIdRef.current = window.setTimeout(resolve, initialDelay);
        });

        if (!isMountedRef.current) return;

        // --- 2. ADATMENTÉS (Stand) ---
        const data = await addToPlayersListByStand();
        if (!data || !isMountedRef.current) {
          isProcessingRef.current = false;
          return;
        }

        const response = extractGameStateData(data);
        if (response?.split_req === 0) {
          transitionToState(response?.target_phase as GameState, response);
        } else {
          const splitResponse = await addSplitPlayerToGame();
          const ans = extractGameStateData(splitResponse);
          transitionToState(ans?.target_phase as GameState, ans);
        }
      } catch (error) {
        console.error("SplitStand Sequence Error:", error);
        if (isMountedRef.current) {
          transitionToState("ERROR");
        }
      } finally {
        if (isMountedRef.current) {
          setIsWFSR(false);
        }
      }
    };
    SplitStand();

    return () => {
      if (timeoutIdRef.current) window.clearTimeout(timeoutIdRef.current);
    };
  }, [gameState.currentGameState, transitionToState]);

  // --- SPLIT_NAT21_TRANSIT ---
  useEffect(() => {
    if (gameState.currentGameState !== "SPLIT_NAT21_TRANSIT" || isProcessingRef.current) return;
    //isSplitNat21.current = true;
    isProcessingRef.current = true;
    console.log("--- SPLIT_NAT21_TRANSIT INDUL ---");

    const SplitNat21Transit = async () => {
      try {
        timeoutIdRef.current = window.setTimeout(() => {
          if (isMountedRef.current) {
            //const nextState = (gameState?.pre_phase as GameState) || "SPLIT_STAND";
            isProcessingRef.current = false; // NYITÁS
            transitionToState(gameState?.pre_phase as GameState, gameState);
            return;
          }
        }, 2000);
      } catch {
        if (isMountedRef.current) {
          transitionToState("ERROR");
        }
      }
    };
    SplitNat21Transit();

    return () => {
      if (timeoutIdRef.current) window.clearTimeout(timeoutIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.currentGameState, transitionToState]);

  // --- SPLIT_ACE_TRANSIT ---
  useEffect(() => {
    if (gameState.currentGameState !== "SPLIT_ACE_TRANSIT" || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setIsWFSR(true);
    console.log("--- SPLIT_ACE_TRANSIT LOGIKA INDUL ---");

    const SplitAce21Transit = async () => {
      if (!isMountedRef.current) return;

      try {
        const data = await addToPlayersListByStand();
        if (!data || !isMountedRef.current) {
          isProcessingRef.current = false;
          return;
        }

        const response = extractGameStateData(data);

        if (response?.split_req === 0) {
          timeoutIdRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
              transitionToState(response?.target_phase as GameState, response);
            }
          }, 2000);
        } else {
          const splitResponse = await addSplitPlayerToGame();
          const ans = extractGameStateData(splitResponse);

          timeoutIdRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
              transitionToState(ans?.target_phase as GameState, ans);
            }
          }, 2000);
        }
      } catch (error) {
        console.error("Transit Error:", error);
        if (isMountedRef.current) {
          transitionToState("ERROR");
        }
      } finally {
        if (isMountedRef.current) {
          setIsWFSR(false);
        }
      }
    };

    SplitAce21Transit();

    return () => {
      if (timeoutIdRef.current) window.clearTimeout(timeoutIdRef.current);
    };
  }, [gameState.currentGameState, transitionToState]);

  // --- SPLIT_FINISH ---
  useEffect(() => {
    if (gameState.currentGameState === "SPLIT_FINISH") {
      const SplitFinish = async () => {
        if (!isMountedRef.current) return;

        try {
          savePreActionState();
          const data = await handleSplitStandAndRewards();
          if (data) {
            if (!isMountedRef.current) return;
            const response = extractGameStateData(data);

            if (response) {
              if (isMountedRef.current) {
                transitionToState("SPLIT_FINISH_OUTCOME", response);
              }
            } else {
              if (isMountedRef.current) {
                transitionToState("ERROR");
              }
            }
          }
        } catch (e) {
          console.error("Hiba a SPLIT_FINISH fázisban:", e);
          if (isMountedRef.current) {
            transitionToState("ERROR");
          }
        }
      };
      SplitFinish();
    }
  }, [gameState.currentGameState, handleApiAction, savePreActionState, transitionToState]);

  // --- SPLIT_FINISH_OUTCOME ---
  useEffect(() => {
    if (gameState.currentGameState === "SPLIT_FINISH_OUTCOME") {
      const SplitFinishTransit = async () => {
        if (!isMountedRef.current) return;

        try {
          if (gameState.players) {
            if (Object.keys(gameState.players).length === 0) {
              if (gameState.tokens === 0) {
                if (isMountedRef.current) {
                  transitionToState("OUT_OF_TOKENS");
                }
              } else {
                timeoutIdRef.current = window.setTimeout(() => {
                  if (isMountedRef.current) {
                    transitionToState("BETTING", {
                      ...initialGameState,
                      currentGameState: "BETTING",
                      deck_len: gameState.deck_len,
                      tokens: gameState.tokens,
                      bet: 0,
                    });
                  }
                }, 4000);
              }
            } else {
              const data = await addPlayerFromPlayers();
              if (data) {
                if (!isMountedRef.current) return;
                const response = extractGameStateData(data);
                timeoutIdRef.current = window.setTimeout(() => {
                  if (isMountedRef.current) {
                    transitionToState("SPLIT_FINISH", response);
                  }
                }, 4000);
              }
            }
          }
        } catch (e) {
          console.error("Hiba a SPLIT_FINISH_OUTCOME fázisban:", e);
          if (isMountedRef.current) {
            transitionToState("ERROR");
          }
        }
      };
      SplitFinishTransit();
    }
  }, [gameState.currentGameState, gameState.deck_len, gameState.players, gameState.tokens, handleApiAction, transitionToState]);
  // --- OUT_OF_TOKENS ---
  useEffect(() => {
    if (gameState.currentGameState === "OUT_OF_TOKENS") {
      const HandleOutOfTokens = async () => {
        if (!isMountedRef.current) return;

        try {
          const data = await setRestart();
          if (data) {
            if (!isMountedRef.current) return;
            const response = extractGameStateData(data);
            if (response) {
              timeoutIdRef.current = window.setTimeout(() => {
                if (isMountedRef.current) {
                  transitionToState("RESTART_GAME", response);
                }
              }, 5000);
            }
          }
        } catch (e) {
          console.error("Hiba a RESTART_GAME fázisban:", e);
          if (isMountedRef.current) {
            transitionToState("ERROR");
          }
        }
      };
      HandleOutOfTokens();
    }
  }, [gameState.currentGameState, handleApiAction, transitionToState]);

  // --- RESTART_GAME ---
  useEffect(() => {
    if (gameState.currentGameState === "RESTART_GAME") {
      const RestartGame = async () => {
        if (!isMountedRef.current) return;

        try {
          timeoutIdRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
              resetGameVariables();
              transitionToState("RELOADING", gameState);
            }
          }, 5000);
        } catch (e) {
          console.error("Hiba a RESTART_GAME fázisban:", e);
          if (isMountedRef.current) {
            transitionToState("ERROR");
          }
        }
      };
      RestartGame();
    }
  }, [gameState, gameState.currentGameState, handleApiAction, resetGameVariables, transitionToState]);

  // --- ERROR ---
  useEffect(() => {
    if (gameState.currentGameState === "ERROR") {
      const ForceRestart = async () => {
        if (!isMountedRef.current) return;

        await new Promise((resolve) => setTimeout(resolve, 5000));

        if (!isMountedRef.current) return;

        setIsWFSR(true);

        try {
          const data = await forceRestart();
          if (data) {
            if (!isMountedRef.current) return;
            const response = extractGameStateData(data);
            if (response) {
              transitionToState("RELOADING", response);
            }
          }
        } catch (error) {
          console.error("Hiba a kényszerített újraindítás során:", error);
        } finally {
          if (isMountedRef.current) {
            setIsWFSR(false);
          }
        }
      };
      ForceRestart();
    }
  }, [gameState.currentGameState, handleApiAction, transitionToState]);

  // --- RELOADING ---
  useEffect(() => {
    if (gameState.currentGameState === "RELOADING") {
      const Reloading = async () => {
        if (!isMountedRef.current) return;

        try {
          timeoutIdRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
              transitionToState("BETTING", gameState);
            }
          }, 5000);
        } catch (error) {
          console.error("Error: ", error);
        }
      };
      Reloading();
    }
  }, [gameState, transitionToState]);




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
