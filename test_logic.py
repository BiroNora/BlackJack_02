
from my_app.backend.game import BJ_IMMEDIATE_STOP, Game
from my_app.backend.phase_state import PhaseState
from my_app.backend.winner_state import WinnerState
from my_app.backend.game_serializer import GameSerializer


def run_diagnostics():
    game = Game()
    # --- 1. RÉSZ: Blackjack logics Tesztek ---
    print("=== BLACKJACK LOGIKAI ELLENŐRZÉS ===")

    # --- 1. RÉSZ: Client Bets Serialization Teszt ---
    print("=== CLIENT BETS (CALC_PHASE) ELLENŐRZÉS ===")

    # Teszt esetek: (leírás, deck_méret, is_active, is_init, elvárt_pre)
    client_bet_tests = [
        ("Teli pakli, új session", 104, False, True, "SHUFFLING"),
        ("Normál pakli, folyamatban", 80, False, False, "INIT_GAME"),
        ("Kevés lap, keverni kell", 55, False, False, "SHUFFLING"),
        ("Aktív kör (valódi hosszt néz)", 55, True, False, "SHUFFLING"),
    ]

    for desc, deck_size, active, is_init, expected_pre in client_bet_tests:
        game.clear_up()
        game.deck = ["X"] * deck_size
        game.is_round_active = active
        game.is_session_init = is_init

        # Itt hívjuk meg a konkrét szériázót, amit tesztelni akarunk
        # A hívás helyesen:
        serialized = GameSerializer.serialize_for_client_bets(game)

        actual_pre = serialized["pre_phase"]
        status = "✅ OK" if actual_pre == expected_pre else f"❌ HIBA (Kapott: {actual_pre})"

        print(f"[{desc}]")
        print(f"  - Deck len (számolt): {serialized['deck_len']}")
        print(f"  - Pre-phase: {actual_pre} (Várt: {expected_pre})")
        print(f"  EREDMÉNY: {status}\n")
    # --- 2. RÉSZ: Blackjack Stop & Target Phase Tesztek ---
    print("\n=== INITIAL GAME & BJ STOP TESZTEK ===")

    # Teszt esetek: (Név, Játékos lapok, Dealer lapok, Várt Target Phase, Várt Dealer nat_21 láthatóság)
    bj_test_cases = [
        (
            "Játékos Blackjack (Sima nyerés)",
            ["♥A", "♠K"], ["♦5", "♣10"],
            PhaseState.MAIN_STAND, True  # Meg kell állnia és látnia kell a BJ-t
        ),
        (
            "Push (Mindkettőnek Blackjack)",
            ["♥A", "♠Q"], ["♦A", "♣J"],
            PhaseState.MAIN_STAND, True  # Meg kell állnia és látnia kell a BJ-t
        ),
        (
            "Nincs Blackjack (Játék folytatódik)",
            ["♥10", "♠8"], ["♦A", "♣5"],
            PhaseState.MAIN_TURN, False  # Mehet tovább a kör, nat_21 titkos (0)
        ),
        (
            "Dealer Blackjack (De a játékosnak nincs)",
            ["♥10", "♠8"], ["♦A", "♣K"],
            PhaseState.MAIN_TURN, False # Itt MAIN_TURN lesz, mert a játékos még dönthet (pl. Biztosítás)
        )
    ]

    for desc, p_hand, d_hand, exp_phase, exp_nat21_visible in bj_test_cases:
        # Manuálisan beállítjuk a környezetet, mintha az initialize_new_round futna
        game.clear_up()
        game.deck = ["X"] * 10 # Legyen elég lap a pop-hoz, de nem használjuk őket

        # Szimuláljuk az initialize_new_round logikáját
        player_hand = p_hand
        dealer_hand = d_hand

        # Lefuttatjuk a belső számításokat
        game.natural_21 = game.init_natural_21_state(player_hand, dealer_hand)

        # Ez az a logika, amit tesztelünk:
        game.target_phase = (
            PhaseState.MAIN_STAND
            if game.natural_21 in BJ_IMMEDIATE_STOP
            else PhaseState.MAIN_TURN
        )

        # Maszkolt nat_21 szűrés
        masked_nat21 = (
            game.natural_21
            if game.natural_21 in BJ_IMMEDIATE_STOP
            else WinnerState.NONE
        )

        # Ellenőrzés
        phase_ok = game.target_phase == exp_phase
        nat21_ok = (masked_nat21 != WinnerState.NONE) == exp_nat21_visible

        status = "✅ OK" if (phase_ok and nat21_ok) else "❌ HIBA"
        print(f"[{desc}]")
        print(f"  - Target Phase: {game.target_phase} (Várt: {exp_phase}) {'ok' if phase_ok else '!!!'}")
        print(f"  - Dealer maszkolt BJ: {masked_nat21} {'látható' if nat21_ok else 'rejtett'} {'ok' if nat21_ok else '!!!'}")
        print(f"  EREDMÉNY: {status}\n")

if __name__ == "__main__":
    run_diagnostics()
