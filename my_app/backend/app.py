import os
import uuid
import logging
import math
from functools import wraps
from dotenv import load_dotenv
from sqlalchemy import select
from flask import Flask, current_app, json, jsonify, render_template, request, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta, timezone
from flask_session import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from psycopg2.errors import UniqueViolation

from my_app.backend.game import Game

load_dotenv()

MINIMUM_BET = 1

# =========================================================================
# FLASK APPLICATION BASICS
# =========================================================================
app = Flask(__name__, static_folder="../react/dist", template_folder="../react/dist")
app.config["SECRET_KEY"] = os.environ.get(
    "FLASK_SECRET_KEY", "default-dev-secret-key-NEVER-USE-IN-PROD"
)
# Session permanencia beállítása
# app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=31)  # Például 31 nap
# app.config["SESSION_COOKIE_SECURE"] = False

app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=31)
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("VERCEL", "False") == "True"
app.config["SESSION_COOKIE_HTTPONLY"] = True

# =========================================================================
# DATABASE SETUP (NEON POSTGRES)
# =========================================================================
DATABASE_URL = os.environ.get(
    "DATABASE_URL_SIMPLE", "postgresql://player:pass@localhost:5433/blackjack_game"
)

app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

# =========================================================================
# POSTGRES SESSION SETUP
# =========================================================================
# A sessionöket is a Postgresben tároljuk egy külön 'sessions' táblában
#app.config["SESSION_TYPE"] = "sqlalchemy"
#app.config["SESSION_SQLALCHEMY"] = db
#app.config["SESSION_SQLALCHEMY_TABLE"] = "sessions"
#
#sess = Session(app)

# Logging finomhangolás
log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)


# =========================================================================
# MODELS
# =========================================================================
class User(db.Model):
    __tablename__ = "my_users"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = db.Column(
        db.String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4())
    )
    tokens = db.Column(db.Integer, default=1000)
    current_game_state = db.Column(JSONB, nullable=True)
    idempotency_key = db.Column(db.String(36), nullable=True)
    last_activity = db.Column(
        db.TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self):
        return f"<User {self.id[:8]} (Client: {self.client_id[:8]})>"


with app.app_context():
    db.create_all()


# =========================================================================
# AUTH DECORATOR
# =========================================================================
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return (
                jsonify(
                    {
                        "error": "ERROR: Invalid user session.",
                        "game_state_hint": "INVALID_USER_SESSION",
                    }
                ),
                401,
            )

        user = db.session.get(User, user_id)
        if not user:
            session.pop("user_id", None)
            return (
                jsonify(
                    {
                        "error": "ERROR: Invalid user session.",
                        "game_state_hint": "INVALID_USER_SESSION",
                    }
                ),
                401,
            )

        user.last_activity = datetime.now(timezone.utc)

        return f(user=user, *args, **kwargs)

    return decorated_function


def with_game_state(f):
    @wraps(f)
    def decorated_function(user, *args, **kwargs):
        # 1. Alapvető ellenőrzés
        if not user.current_game_state:
            return jsonify({
                "error": "Game state not initialized.",
                "game_state_hint": "MISSING_GAME_STATE",
            }), 400

        # 2. IDEMPOTENCIA ELLENŐRZÉS
        # Megpróbáljuk kiszedni a kulcsot a JSON body-ból
        data = request.get_json(silent=True) or {}
        ikey = data.get("idempotency_key")

        # Deszerializálunk (szükség van rá az idempotens válaszhoz is)
        game = Game.deserialize(user.current_game_state)

        if ikey and user.idempotency_key == ikey:
            # Ha a kulcs egyezik, nem futtatjuk le a függvényt (f),
            # csak visszaadjuk az aktuális állapotot.
            return jsonify({
                "status": "success",
                "idempotent": True,
                "current_tokens": user.tokens,
                "game_state": game.serialize_for_client_bets(), # Vagy egy általánosabb kliens-széria
            }), 200

        # 3. A végpont végrehajtása
        response = f(user=user, game=game, *args, **kwargs)

        # 4. Automatikus mentés és Idempotencia kulcs frissítése
        status_code = 200
        if isinstance(response, tuple):
            status_code = response[1]
        elif hasattr(response, "status_code"):
            status_code = response.status_code

        if 200 <= status_code < 300:
            user.current_game_state = game.serialize()
            # Itt mentjük el az új kulcsot, hogy a következő azonos kérést már megfogjuk
            if ikey:
                user.idempotency_key = ikey
            db.session.commit()

        return response

    return decorated_function


def api_error_handler(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)  # Meghívjuk az eredeti végpont függvényt
        except ValueError as e:
            # Specifikus hiba (pl. pakli üres, érvénytelen adat)
            db.session.rollback()
            print(f"Specifikus hiba az API végponton: {e}")
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": str(e),  # A ValueError üzenetét küldjük vissza
                        "game_state_hint": "CLIENT_ERROR_SPECIFIC",  # Vagy egy specifikusabb hint
                    }
                ),
                400,
            )
        except Exception as e:
            db.session.rollback()
            print(f"Váratlan szerver hiba az API végponton: {e}")
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "CRITICAL SERVER ERROR",
                        "game_state_hint": "SERVER_ERROR_GENERIC",
                    }
                ),
                500,
            )

    return decorated_function


@app.route("/")
def index():
    return render_template("index.html")


# =========================================================================
# GAME API ENDPOINTS
# =========================================================================
# 0
@app.route("/api/initialize_session", methods=["POST"])
@api_error_handler
def initialize_session():
    """
    Inicializálja a felhasználói sessiont a Postgres DB alapján.
    """
    data = request.get_json()
    client_id_from_request = data.get("client_id")

    if not client_id_from_request:
        return jsonify({"error": "Missing client_id"}), 400

    # 1. Felhasználó keresése (vagy a session-ből, vagy client_id alapján)
    user_id_in_session = session.get("user_id")
    user = None

    if user_id_in_session:
        user = db.session.get(User, user_id_in_session)

    if not user:
        # Ha a session-ben nincs meg, megkeressük client_id alapján
        user = User.query.filter_by(client_id=client_id_from_request).first()

    # 2. Új felhasználó létrehozása, ha még nem létezik
    if not user:
        try:
            # Létrehozunk egy alap játékállapotot az új usernek
            initial_game = Game()
            user = User(
                client_id=client_id_from_request,
                tokens=1000,
                current_game_state=initial_game.serialize(),
            )
            db.session.add(user)
            db.session.commit()
        except IntegrityError:
            # Ha közben valaki más létrehozta, visszagördítünk és lekérjük
            db.session.rollback()
            user = User.query.filter_by(client_id=client_id_from_request).one()

    # 3. Session és állapot frissítése
    session["user_id"] = user.id
    session.permanent = True

    # A last_activity-t a modell automatikusan frissíti az onupdate miatt,
    # de itt is beállíthatjuk.
    user.last_activity = datetime.now(timezone.utc)
    db.session.commit()

    # 4. Játékállapot előkészítése a kliensnek
    # A Postgres JSONB mezőjéből olvassuk ki
    game_instance = (
        Game.deserialize(user.current_game_state) if user.current_game_state else Game()
    )

    game_state_for_client = game_instance.serialize_for_client_init()

    return (
        jsonify(
            {
                "status": "success",
                "message": "User and game session initialized.",
                "tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "USER_SESSION_INITIALIZED",
            }
        ),
        200,
    )


# 1
@app.route("/api/bet", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def bet(user, game):
    data = request.get_json() or {}
    bet_amount = data.get("bet", 0)

    if not isinstance(bet_amount, (int, float)) or bet_amount < MINIMUM_BET:
        raise ValueError(f"Bet must be at least {MINIMUM_BET}.")

    if user.tokens < bet_amount:
        raise ValueError("Insufficient tokens.")

    game.set_bet(bet_amount)
    game.set_bet_list(bet_amount)
    user.tokens -= bet_amount

    game_state_for_client = game.serialize_for_client_bets()

    return (
        jsonify(
            {
                "status": "success",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "BET_SUCCESSFULLY_PLACED",
            }
        ),
        200,
    )


# 2
@app.route("/api/retake_bet", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def retake_bet(user, game):
    current_bet_list = game.get_bet_list()
    if not current_bet_list:
        return (
            jsonify(
                {"error": "No bet to retake.", "game_state_hint": "BET_LIST_EMPTY"}
            ),
            400,
        )

    amount_to_return = game.retake_bet_from_bet_list()
    user.tokens += amount_to_return

    game_state_for_client = game.serialize_for_client_bets()

    return (
        jsonify(
            {
                "status": "success",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "BET_SUCCESSFULLY_RETRAKEN",
            }
        ),
        200,
    )


# 3
@app.route("/api/create_deck", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def create_deck(user, game):
    game.create_deck()

    game_state_for_client = game.serialize_for_client_bets()

    return (
        jsonify(
            {
                "status": "success",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "DECK_CREATED",
            }
        ),
        200,
    )


# 4
@app.route("/api/start_game", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def start_game(user, game):
    game.initialize_new_round()

    game_state_for_client = game.serialize_initial_and_hit_state()

    return (
        jsonify(
            {
                "status": "success",
                "message": "New round initialized.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "NEW_ROUND_INITIALIZED",
            }
        ),
        200,
    )


# 5
@app.route("/api/ins_request", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def ins_request(user, game):
    bet = game.get_bet()
    insurance_amount = math.ceil(bet / 2)

    if user.tokens < insurance_amount:
        game_state_for_client = game.serialize_for_insurance()
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "Insufficient tokens.",
                    "game_state_hint": "INSUFFICIENT_FUNDS",
                    "required": insurance_amount,
                    "available": user.tokens,
                    "game_state": game_state_for_client,
                }
            ),
            402,
        )
    ins = game.insurance_request()
    user.tokens += ins

    game_state_for_client = game.serialize_for_insurance()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Insurance placed successfully.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "INSURANCE_PROCESSED",
            }
        ),
        200,
    )


# 6
@app.route("/api/hit", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def hit(user, game):
    game.hit()

    game_state_for_client = game.serialize_initial_and_hit_state()

    return (
        jsonify(
            {
                "status": "success",
                "tokens": user.tokens,
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "HIT_RECIEVED",
            }
        ),
        200,
    )


# 7
@app.route("/api/double_request", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def double_request(user, game):
    bet_amount_to_double = game.get_bet()

    if user.tokens < bet_amount_to_double:
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "Insufficient tokens.",
                    "game_state_hint": "INSUFFICIENT_FUNDS_FOR_DOUBLE",
                    "required": bet_amount_to_double,
                    "available": user.tokens,
                }
            ),
            402,
        )

    amount_deducted = game.double_request()
    user.tokens -= amount_deducted
    game.hit()

    game_state_for_client = game.serialize_double_state()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Double placed successfully.",
                "double_amount": amount_deducted,
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "DOUBLE_RECIEVED",
            }
        ),
        200,
    )


# 8
@app.route("/api/rewards", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def rewards(user, game):
    token_change = game.rewards()
    user.tokens += token_change

    game_state_for_client = game.serialize_reward_state()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Rewards processed and tokens updated.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "REWARDS_PROCESSED",
            }
        ),
        200,
    )


# 9
@app.route("/api/stand_and_rewards", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def stand_and_rewards(user, game):
    game.stand()
    token_change = game.rewards()
    user.tokens += token_change

    game_state_for_client = game.serialize_reward_state()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Rewards processed and tokens updated.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "REWARDS_PROCESSED",
            }
        ),
        200,
    )


# SPLIT part
# 10
@app.route("/api/split_request", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def split_request(user, game):
    bet_amount = game.get_bet()

    if user.tokens < bet_amount:
        # Error válasz, ha nincs elég token.
        # A 402-es státuszkód (Payment Required) is használható ilyen esetekben.
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "Insufficient tokens.",
                    "game_state_hint": "INSUFFICIENT_FUNDS",
                    "required": bet_amount,
                    "available": user.tokens,
                }
            ),
            402,
        )
    if not game.can_split(game.player["hand"]):
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "Split not possible.",
                    "game_state_hint": "SPLIT_NOT_POSSIBLE_RULES",
                }
            ),
            400,
        )
    if len(game.players) > 3:
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "Split not possible.",
                    "game_state_hint": "MAX_SPLIT_HANDS_REACHED",
                }
            ),
            400,
        )

    game.split_hand()
    user.tokens -= bet_amount

    game_state_for_client = game.serialize_split_hand()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Split hand placed successfully.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "SPLIT_SUCCESS",
            }
        ),
        200,
    )


# 11
@app.route("/api/add_to_players_list_by_stand", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def add_to_players_list_by_stand(user, game):
    game.add_to_players_list_by_stand()

    game_state_for_client = game.serialize_add_to_players_list_by_stand()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Split hand placed successfully.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "NEXT_SPLIT_HAND_ACTIVATED",
            }
        ),
        200,
    )


# 14
@app.route("/api/add_split_player_to_game", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def add_split_player_to_game(user, game):
    if not game.players:
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "Nincs több splitelt kéz, amit aktiválni lehetne.",
                    "game_state_hint": "NO_MORE_SPLIT_HANDS",
                }
            ),
            400,
        )

    game.add_split_player_to_game()

    game_state_for_client = game.serialize_split_hand()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Split hand placed successfully.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "NEXT_SPLIT_HAND_ACTIVATED",
            }
        ),
        200,
    )


# 15
@app.route("/api/add_player_from_players", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def add_player_from_players(user, game):
    if not game.players:
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "No more split hands.",
                    "game_state_hint": "NO_MORE_SPLIT_HANDS",
                }
            ),
            400,
        )

    game.add_player_from_players()

    game_state_for_client = game.serialize_add_player_from_players()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Split hand placed successfully.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "NEXT_SPLIT_HAND_ACTIVATED",
            }
        ),
        200,
    )


# 16
@app.route("/api/split_hit", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def split_hit(user, game):
    game.hit()

    game_state_for_client = game.serialize_split_hand()

    return (
        jsonify(
            {
                "status": "success",
                "tokens": user.tokens,
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "HIT_RECIEVED",
            }
        ),
        200,
    )


# 17
@app.route("/api/split_double_request", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def split_double_request(user, game):
    bet_amount_to_double = game.get_bet()

    if user.tokens < bet_amount_to_double:
        return (
            jsonify(
                {
                    "status": "error",
                    "error": "Insufficient tokens.",
                    "game_state_hint": "INSUFFICIENT_FUNDS_FOR_DOUBLE",
                    "required": bet_amount_to_double,
                    "available": user.tokens,
                }
            ),
            402,
        )

    amount_deducted = game.double_request()
    user.tokens -= amount_deducted
    game.hit()

    game_state_for_client = game.serialize_split_hand()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Double placed successfully.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "DOUBLE_RECIEVED",
            }
        ),
        200,
    )


# 18
@app.route("/api/split_stand_and_rewards", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def double_stand_and_rewards(user, game):
    game.stand()
    token_change = game.rewards()

    user.tokens += token_change

    game_state_for_client = game.serialize_split_stand_and_rewards()

    return (
        jsonify(
            {
                "status": "success",
                "message": "Rewards processed and tokens updated.",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "REWARDS_PROCESSED",
            }
        ),
        200,
    )


# 19
@app.route("/api/set_restart", methods=["POST"])
@login_required
@with_game_state
@api_error_handler
def set_restart(user, game):
    game.restart_game()

    user.tokens = 1000

    game_state_for_client = game.serialize_for_client_bets()

    return (
        jsonify(
            {
                "status": "success",
                "current_tokens": user.tokens,
                "game_state": game_state_for_client,
                "game_state_hint": "HIT_RESTART",
            }
        ),
        200,
    )


# 20
@app.route("/api/force_restart", methods=["POST"])
@api_error_handler
def force_restart_by_client_id():
    """
    Ez az útvonal kezeli a játék újraindítását a kliensoldali hibák esetén.
    A client_id alapján azonosítja a felhasználót, és visszaállítja a játékállapotot
    a tokenek elvesztése nélkül.
    """
    data = request.get_json() or {}
    client_id = data.get("client_id")

    if not client_id:
        return jsonify({"error": "client_id is required"}), 400

    # Megkeressük a felhasználót a client_id alapján
    stmt = select(User).filter_by(client_id=client_id)
    user = db.session.execute(stmt).scalar_one_or_none()

    if not user:
        return jsonify({"error": "User not found"}), 404

    # === Új session létrehozása a felhasználó számára ===
    session.clear()  # Töröljük a régi, potenciálisan hibás játék sessiont
    session["user_id"] = user.id
    session.permanent = True

    # A játék egy új, alapértelmezett állapotból indul.
    game = Game()
    game.restart_game()

    user.current_game_state = game.serialize()
    user.idempotency_key = None

    db.session.commit()

    return (
        jsonify(
            {
                "status": "success",
                "current_tokens": user.tokens,
                "game_state": game.serialize_for_client_bets(),
                "game_state_hint": "FORCE_RESTART_SUCCESSFUL",
            }
        ),
        200,
    )


# 21
@app.route("/error_page", methods=["GET"])
def error_page():
    return render_template("error.html")
