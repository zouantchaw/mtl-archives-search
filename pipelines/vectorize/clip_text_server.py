#!/usr/bin/env python3
"""
Simple CLIP text embedding server for visual search.

Run with: python3 pipelines/vectorize/clip_text_server.py
Server listens on http://localhost:8787/embed

Example request:
  curl -X POST http://localhost:8787/embed \
    -H "Content-Type: application/json" \
    -d '{"text": "park with trees"}'

Response: {"embedding": [0.1, 0.2, ...]}  (512-dim vector)
"""

import json
from http.server import HTTPServer, BaseHTTPRequestHandler

import torch
from transformers import CLIPModel, CLIPProcessor, CLIPTokenizer

# Load model once at startup
print("Loading CLIP model (openai/clip-vit-base-patch32)...")
device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
print(f"Using device: {device}")

model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32", use_safetensors=True).to(device)
tokenizer = CLIPTokenizer.from_pretrained("openai/clip-vit-base-patch32")
model.eval()
print("Model loaded!")


def generate_text_embedding(text: str) -> list[float]:
    """Generate CLIP text embedding (512-dim)."""
    with torch.no_grad():
        inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=77)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        text_features = model.get_text_features(**inputs)
        # Normalize
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        return text_features.cpu().tolist()[0]


class ClipHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/embed":
            self.send_error(404, "Not Found")
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")

        try:
            data = json.loads(body)
            text = data.get("text", "")
            if not text:
                self.send_error(400, "Missing 'text' field")
                return

            embedding = generate_text_embedding(text)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"embedding": embedding}).encode())

        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
        except Exception as e:
            print(f"Error: {e}")
            self.send_error(500, str(e))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")


if __name__ == "__main__":
    port = 8787
    server = HTTPServer(("0.0.0.0", port), ClipHandler)
    print(f"CLIP text embedding server running on http://localhost:{port}/embed")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()
