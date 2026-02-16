import type { GameStateData } from "../types/game-types";
import { formatNumber } from "../utilities/utils";
import "../styles/betting.css";
import { AnimatePresence, motion } from "motion/react";

interface BetBankProps {
  gameState: GameStateData;
}

const BetBank: React.FC<BetBankProps> = ({ gameState }) => {
  const { player, tokens } = gameState;
  const currentBet = player.bet;

  const fadeProps = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.7 },
  };

  return (
    <div className="bank-area-wrapper">
      {/* BET SZEKCIÓ */}
      <div className="bank1 merriweather">
        Bet:{"\u00A0"}
        <div style={{ display: "inline-grid", verticalAlign: "bottom" }}>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={formatNumber(currentBet)}
              {...fadeProps}
              className="bet-amount"
              style={{ gridArea: "1 / 1", whiteSpace: "nowrap" }}
            >
              {formatNumber(currentBet)}
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
              key={formatNumber(tokens)}
              {...fadeProps}
              style={{
                gridArea: "1 / 1",
                whiteSpace: "nowrap",
                display: "inline-block", // Biztosítja, hogy legyen kiterjedése
              }}
            >
              {formatNumber(tokens)}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default BetBank;
