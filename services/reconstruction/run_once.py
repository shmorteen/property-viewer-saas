"""Process one queued job; useful for development and one-off worker checks."""

import logging
import sys
from datetime import datetime, timezone

from app import client, process_job

logging.basicConfig(level=logging.INFO)


def main() -> int:
    db = client()
    jobs = db.rpc("claim_processing_job").execute().data or []
    if not jobs:
        print("No queued reconstruction jobs")
        return 0
    job = jobs[0]
    print(f"Processing job {job['id']} for property {job['property_id']}")
    try:
        process_job(db, job)
    except Exception as exc:
        db.table("processing_jobs").update({
            "status": "failed", "error_message": str(exc)[:1000],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job["id"]).execute()
        raise
    print(f"Completed job {job['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
