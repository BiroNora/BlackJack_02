// src/components/BetBankDelayed.tsx

import type { GameStateData } from "../types/game-types";
import { formatNumber } from "../utilities/utils";
import "../styles/betting.css";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

interface BetBankDelayedProps {
  finalGameState: GameStateData; // Ez a prop most már helyesen van definiálva
  initialBet: number | null;
  initialTokens: number | null;
}

const BetBankDelayed: React.FC<BetBankDelayedProps> = ({
  finalGameState,
  initialBet,
  initialTokens,
}) => {
  const [displayedBet, setDisplayedBet] = useState<number | null>(initialBet);
  const [displayedTokens, setDisplayedTokens] = useState<number | null>(
    initialTokens,
  );

  useEffect(() => {
    setDisplayedTokens(initialTokens);
    setDisplayedBet(initialBet);

    const timeoutId: number = setTimeout(() => {
      //console.log("--- DEBUG --- BetBankDelayed: Késleltetés utáni frissítés.");
      setDisplayedTokens(finalGameState.tokens);
      setDisplayedBet(finalGameState.player.bet);
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [finalGameState, initialBet, initialTokens]);

  const tokensToDisplay =
    displayedTokens !== null ? formatNumber(displayedTokens) : "---";
  const betToDisplay =
    displayedBet !== null ? formatNumber(displayedBet) : "---";

  const fadeProps = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.7 }, // Egy picit gyorsabb animáció általában profibb érzetet kelt
  };

  return (
    <div className="bank-area-wrapper">
      {/* BET SZEKCIÓ */}
      <div className="bank1 merriweather">
        Bet:{"\u00A0"}
        <div style={{ display: "inline-grid", verticalAlign: "bottom" }}>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={betToDisplay}
              {...fadeProps}
              className="bet-amount"
              style={{ gridArea: "1 / 1", whiteSpace: "nowrap" }}
            >
              {betToDisplay}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      {/* BANK SZEKCIÓ */}
      <div className="bet-bank merriweather">
        Player's bank:{"\u00A0"}
        <div
          style={{
            display: "inline-grid",
            verticalAlign: "bottom",
            placeItems: "start",
            width: "5rem",
          }}
        >
          <AnimatePresence mode="popLayout">
            <motion.span
              key={tokensToDisplay}
              {...fadeProps}
              style={{
                gridArea: "1 / 1",
                whiteSpace: "nowrap",
                display: "inline-block", // Biztosítja, hogy legyen kiterjedése
              }}
            >
              {tokensToDisplay}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default BetBankDelayed;
