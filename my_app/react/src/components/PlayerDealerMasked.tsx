import React, { type JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { GameStateData } from "../types/game-types";
import "../styles/playerDealer.css";
import { maskedScore } from "../utilities/utils";

interface TableProps {
  gameState: GameStateData;
  showInsLost: boolean;
}

const PlayerDealerMasked: React.FC<TableProps> = ({
  gameState,
  showInsLost,
}) => {
  const { player, dealer_masked } = gameState;

  const dealerMasked = dealer_masked.hand[1][1];
  const dealerMaskedScore = maskedScore(dealerMasked);

  const formatCard = (card: string): JSX.Element | string => {
    if (card.trim() === "✪") {
      return <span className="red-suit"> ✪ </span>;
    }

    const suit = card[0]; // Az első karakter a szín
    const value = card.substring(1).trim(); // A többi karakter az érték

    let suitClass = "";
    if (suit === "♥" || suit === "♦") {
      suitClass = "red-suit";
    } else if (suit === "♠" || suit === "♣") {
      suitClass = "black-suit";
    } else {
      return card; // Visszaadja a nyers stringet, ha nem felismerhető a szín
    }

    return (
      <React.Fragment>
        <span style={{ whiteSpace: "nowrap" }}>
          <span className={suitClass}>{suit}</span>
          <span className="merriweatherblack">{value}</span>
        </span>
      </React.Fragment>
    );
  };

  const formatHand = (cardStrings: string[]): JSX.Element[] => {
    const formattedElements = cardStrings.map((cardString, index) => {
      const separator =
        index > 0 ? (
          <span
            key={`hand-sep-${index}`}
            className="equal-text merriweather5grey"
          >
            {" "}
            +{" "}
          </span>
        ) : null;

      // React.Fragment használata a szeparátor és a kártya csoportosítására (fontos a 'key' prop!)
      return (
        <React.Fragment key={cardString + index}>
          {separator} {formatCard(cardString)}{" "}
        </React.Fragment>
      );
    });

    return formattedElements; // JSX elemek tömbje
  };

  const loop = (data: string[]): string[] => {
    return data.map((card) => String(card).trim());
  };

  const playerHand = loop(player.hand);
  const dealerHand = loop(dealer_masked.hand);

  const formattedPlayerHand = formatHand(playerHand);
  const formattedDealerHand = formatHand(dealerHand);

  const fadeProps = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: {
      duration: 1,
      delay: 0.3,
    },
  };

  return (
    <div className="player-dealer-area">
      <div id="dealer-hand" className="play">
        <div className="hand hand-area-wrapper">{formattedDealerHand}</div>
        <div className="score-area-wrapper">
          <span className="score-mood merriweather5grey2">{}</span>
        </div>
        <div className="band-area-wrapper">
          <span className="label-text">Dealer: </span>
          <span className="label-text1">{dealerMaskedScore}</span>
        </div>
      </div>
      <div id="player-hand" className="play">
        <div className="band-area-wrapper">
          <span className="label-text">Player: </span>
          <span className="label-text1"> {player.sum}</span>
        </div>
        <div className="score-area-wrapper">
          <AnimatePresence mode="wait">
            {" "}
            {/* Ajánlott a sima váltáshoz */}
            {showInsLost ? (
              <motion.span
                key="ins-lost" // Fix kulcs a feliratnak
                {...fadeProps}
                className="score-mood merriweather9red"
              >
                Insurance lost
              </motion.span>
            ) : (
              <motion.span
                key="ins-empty" // Fix kulcs az üres állapotnak
                {...fadeProps}
                className="score-mood merriweather5grey2"
              >
                {"\u00A0"} {/* Üres karakter, hogy a magasság megmaradjon */}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="hand hand-area-wrapper">{formattedPlayerHand}</div>
      </div>
    </div>
  );
};

export default PlayerDealerMasked;
