"""
Upload locally trained model files to the deployed Railway backend.

Usage:
    python scripts/upload_models.py --url https://your-backend.railway.app --secret your_secret

Requirements:
    pip install requests
"""

import argparse
import os
import sys
import requests

MODEL_FILES = [
    "lr_model.pkl",
    "rf_model.pkl",
    "xgb_model.pkl",
    "pipeline.pkl",
    "metrics.json",
]


def upload(backend_url: str, secret: str, model_dir: str):
    url = backend_url.rstrip("/") + "/api/models/upload"
    headers = {}
    if secret:
        headers["X-Upload-Secret"] = secret

    missing = [f for f in MODEL_FILES if not os.path.exists(os.path.join(model_dir, f))]
    if missing:
        print(f"ERROR: Missing files in {model_dir}: {missing}")
        print("Train the models first: cd backend && python -m models.train")
        sys.exit(1)

    print(f"Uploading {len(MODEL_FILES)} files to {url} ...")
    file_handles = []
    try:
        for name in MODEL_FILES:
            path = os.path.join(model_dir, name)
            mime = "application/json" if name.endswith(".json") else "application/octet-stream"
            file_handles.append((name, (name, open(path, "rb"), mime)))

        resp = requests.post(url, headers=headers, files=file_handles, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        print(f"SUCCESS — uploaded: {data['uploaded']}")
        print(f"Models loaded on server: {data['models_loaded']}")
    except requests.HTTPError as e:
        print(f"ERROR {e.response.status_code}: {e.response.text}")
        sys.exit(1)
    finally:
        for _, (_, fh, _) in file_handles:
            fh.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload trained models to Railway backend")
    parser.add_argument("--url", required=True, help="Backend URL, e.g. https://your-app.railway.app")
    parser.add_argument("--secret", default=os.getenv("UPLOAD_SECRET", ""), help="Value of UPLOAD_SECRET env var")
    parser.add_argument("--model-dir", default="./backend/saved_models", help="Local path to saved_models/")
    args = parser.parse_args()

    upload(args.url, args.secret, args.model_dir)
