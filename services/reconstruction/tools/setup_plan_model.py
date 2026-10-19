"""Fetch pinned safetensors and export locally. Never fetch executable project code."""
import argparse
from pathlib import Path
from urllib.request import urlopen
from export_yytsi import REVISION, export

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    args.destination.mkdir(parents=True, exist_ok=True)
    weights = args.destination / 'best.safetensors'
    url = f'https://huggingface.co/Yytsi/floorplan-to-3d-walls/resolve/{REVISION}/best.safetensors'
    if not weights.exists():
        with urlopen(url, timeout=120) as response, weights.open('wb') as output:
            while chunk := response.read(1024*1024): output.write(chunk)
    export(weights, args.destination)
