from backend.api.deps import SessionLocal
from backend.models import User
from backend.core.security import get_password_hash
from backend.core.config import settings

def init_superuser() -> None:
    """Crea l'utente admin di default al primo avvio dell'app."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == settings.FIRST_SUPERUSER_EMAIL).first()
        if not user:
            # Protezione limite bcrypt: tronca a 72 caratteri se necessario
            raw_password = settings.FIRST_SUPERUSER_PASSWORD
            if len(raw_password.encode('utf-8')) > 72:
                print("⚠️  Warning: La password nel .env supera i 72 byte. Verrà troncata.")
                raw_password = raw_password[:72]

            new_user = User(
                email=settings.FIRST_SUPERUSER_EMAIL,
                hashed_password=get_password_hash(raw_password),
                is_active=True
            )
            db.add(new_user)
            db.commit()
            print(f"✅ Setup: Superuser {settings.FIRST_SUPERUSER_EMAIL} creato con successo.")
        else:
            print(f"ℹ️  Setup: Superuser {settings.FIRST_SUPERUSER_EMAIL} già esistente.")
    except Exception as e:
        print(f"❌ Errore durante l'inizializzazione del database: {e}")
        db.rollback()
    finally:
        db.close()