from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.core.config import settings
from backend.api.deps import engine
from backend.models import Base
from backend.api.routers import auth, networks, stimuli, simulations
from backend.core.init_db import init_superuser

@asynccontextmanager
async def lifespan(app: FastAPI):
    # questo va commentato in prod ovviamente :D
    # Base.metadata.drop_all(bind=engine)
    
    # Startup: Assicura che le tabelle esistano nel database
    Base.metadata.create_all(bind=engine)
    
    # Startup: Assicura che esista l'utente di default
    init_superuser()
    
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

# Configurazione CORS (Allow All per lo sviluppo, da restringere in produzione)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusione dei Router
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(networks.router, prefix=settings.API_V1_STR)
app.include_router(stimuli.router, prefix=settings.API_V1_STR)
app.include_router(simulations.router, prefix=settings.API_V1_STR)