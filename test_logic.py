
from my_app.backend.game import BJ_IMMEDIATE_STOP, Game
from my_app.backend.phase_state import PhaseState
from my_app.backend.winner_state import WinnerState


def run_diagnostics():
    game = Game()
    # --- 1. RÉSZ: Blackjack logics Tesztek ---
    print("=== BLACKJACK LOGIKAI ELLENŐRZÉS ===")

    # Teszt esetek listája: (leírás, deck_méret, is_active, manuális_pre, várt_eredmény)
    test_cases = [
        ("Teli pakli indításkor", 104, False, PhaseState.NONE, PhaseState.SHUFFLING),
        ("Normál játékmenet", 80, False, PhaseState.NONE, PhaseState.INIT_GAME),
        ("Kevés lap a pakliban", 55, False, PhaseState.NONE, PhaseState.SHUFFLING),
        ("Aktív kör alatt (nem szabadna keverni)", 55, True, PhaseState.NONE, PhaseState.INIT_GAME),
        ("Manuális felülbírálás", 80, False, PhaseState.LOADING, PhaseState.LOADING),
    ]

    for desc, deck_size, active, manual, expected in test_cases:
        game.deck = [i for i in range(deck_size)]
        game.is_round_active = active
        game.pre_phase = manual

        result = game.get_pre_phase()
        status = "✅ OK" if result == expected else f"❌ HIBA (Kapott: {result})"

        print(f"[{desc}] -> {status}")

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
