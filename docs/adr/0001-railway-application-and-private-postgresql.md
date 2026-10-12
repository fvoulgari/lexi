# One Railway application service and private PostgreSQL

Deploy the built React frontend and FastAPI API together in one application Docker service on Railway, with a separate privately connected PostgreSQL service. This follows the requested container deployment while keeping durable database storage independent of application replacement and avoiding cross-origin browser requests. Railway terminates HTTPS; Docker Compose supports local development rather than defining the production topology.
