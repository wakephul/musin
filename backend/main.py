from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routers import auth, files, networks, simulations, stimuli
from backend.core.config import settings
from backend.core.init_db import init_superuser
from backend.core.migrations import upgrade_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    upgrade_database()
    init_superuser()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

for router in (auth.router, networks.router, stimuli.router, simulations.router, files.router):
    app.include_router(router, prefix=settings.API_V1_STR)
