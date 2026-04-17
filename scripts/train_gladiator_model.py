#!/usr/bin/env python3
"""
Train a per-gladiator XGBoost model and export to ONNX.

Usage:
  python scripts/train_gladiator_model.py --gladiator-id <id> [--output-dir ./models]

Requirements:
  pip install xgboost scikit-learn onnxmltools skl2onnx supabase pandas numpy

Architecture:
  1. Fetch trades from Supabase `experience_memory` table
  2. Build feature matrix (11 features) + binary labels (WIN=1, LOSS=0)
  3. Walk-forward split (70/30 per fold, 5 folds)
  4. Train XGBoost classifier on train splits
  5. Evaluate on test splits (report OOS metrics)
  6. Export final model to ONNX format

ASSUMPTION: experience_memory table has enough data (min 50 trades).
ASSUMPTION: Features match the 11-dim vector in microML.ts.
"""

import argparse
import os
import sys
import json
import numpy as np
import pandas as pd

def fetch_trades(gladiator_id: str) -> pd.DataFrame:
    """Fetch trades from Supabase experience_memory table."""
    from supabase import create_client

    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    if not url or not key:
        print("ERROR: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    client = create_client(url, key)
    response = client.table('experience_memory') \
        .select('*') \
        .eq('gladiator_id', gladiator_id) \
        .order('timestamp', desc=False) \
        .limit(5000) \
        .execute()

    if not response.data:
        print(f"No trades found for gladiator {gladiator_id}")
        sys.exit(1)

    return pd.DataFrame(response.data)


REGIME_MAP = {
    'BULL': 1.0, 'trend_up': 1.0,
    'BEAR': -1.0, 'trend_down': -1.0,
    'RANGE': 0.0, 'ranging': 0.0,
    'HIGH_VOL': -0.5, 'volatile': -0.5,
    'TRANSITION': 0.3,
}


def build_features(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Build feature matrix and labels from trades DataFrame."""
    features = []
    labels = []

    for _, row in df.iterrows():
        indicators = row.get('indicators', {}) or {}
        if isinstance(indicators, str):
            try:
                indicators = json.loads(indicators)
            except:
                indicators = {}

        ts = pd.Timestamp(row['timestamp'])
        regime = row.get('regime', 'unknown') or 'unknown'

        feat = [
            (float(indicators.get('rsi', 50)) - 50) / 50,
            max(-1, min(1, float(indicators.get('vwapDeviation', 0)) * 50)),
            max(-3, min(3, float(indicators.get('volumeZ', 0)))) / 3,
            max(-1, min(1, float(indicators.get('fundingRate', 0)) * 1000)),
            max(-1, min(1, float(indicators.get('sentimentScore', 0)))),
            max(-1, min(1, float(indicators.get('momentumScore', 0)))),
            REGIME_MAP.get(regime, 0.0),
            float(row.get('confidence', 0.5)),  # proxy for rolling WR
            0.0,  # loss streak not stored per-row; use 0
            ts.hour / 23.0,
            ts.dayofweek / 6.0,
        ]

        features.append(feat)
        labels.append(1 if row['outcome'] == 'WIN' else 0)

    return np.array(features, dtype=np.float32), np.array(labels, dtype=np.int32)


def walk_forward_train(X: np.ndarray, y: np.ndarray, n_folds: int = 5):
    """Train with walk-forward validation. Returns best model and OOS metrics."""
    import xgboost as xgb
    from sklearn.metrics import accuracy_score, roc_auc_score

    fold_size = len(X) // n_folds
    oos_metrics = []
    best_model = None
    best_auc = 0

    for i in range(n_folds):
        start = i * fold_size
        end = (i + 1) * fold_size if i < n_folds - 1 else len(X)
        fold_X = X[start:end]
        fold_y = y[start:end]

        split = int(len(fold_X) * 0.7)
        if split < 10 or len(fold_X) - split < 5:
            continue

        X_train, X_test = fold_X[:split], fold_X[split:]
        y_train, y_test = fold_y[:split], fold_y[split:]

        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric='logloss',
            use_label_encoder=False,
            random_state=42 + i,
        )

        model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)[:, 1]

        acc = accuracy_score(y_test, y_pred)
        try:
            auc = roc_auc_score(y_test, y_prob)
        except ValueError:
            auc = 0.5

        oos_metrics.append({'fold': i, 'accuracy': acc, 'auc': auc, 'test_size': len(y_test)})
        print(f"  Fold {i}: ACC={acc:.3f} AUC={auc:.3f} (train={len(y_train)}, test={len(y_test)})")

        if auc > best_auc:
            best_auc = auc
            best_model = model

    return best_model, oos_metrics


def export_to_onnx(model, output_path: str, n_features: int = 11):
    """Export XGBoost model to ONNX format."""
    from onnxmltools import convert_xgboost
    from onnxmltools.convert.common.data_types import FloatTensorType

    initial_type = [('input', FloatTensorType([None, n_features]))]
    onnx_model = convert_xgboost(model, initial_types=initial_type)

    with open(output_path, 'wb') as f:
        f.write(onnx_model.SerializeToString())

    print(f"  ONNX model saved: {output_path} ({os.path.getsize(output_path)} bytes)")


def main():
    parser = argparse.ArgumentParser(description='Train per-gladiator XGBoost model')
    parser.add_argument('--gladiator-id', required=True, help='Gladiator ID')
    parser.add_argument('--output-dir', default='./models', help='Output directory for .onnx files')
    parser.add_argument('--min-trades', type=int, default=50, help='Minimum trades required')
    parser.add_argument('--folds', type=int, default=5, help='Walk-forward folds')
    args = parser.parse_args()

    print(f"[MicroML Training] Gladiator: {args.gladiator_id}")

    # 1. Fetch data
    print("  Fetching trades from Supabase...")
    df = fetch_trades(args.gladiator_id)
    print(f"  Found {len(df)} trades")

    if len(df) < args.min_trades:
        print(f"  ERROR: Need at least {args.min_trades} trades, got {len(df)}")
        sys.exit(1)

    # 2. Build features
    print("  Building feature matrix...")
    X, y = build_features(df)
    win_rate = y.mean()
    print(f"  Features: {X.shape}, Labels: WIN={y.sum()}/{len(y)} ({win_rate:.1%})")

    # 3. Train with walk-forward
    print(f"  Walk-forward training ({args.folds} folds)...")
    model, metrics = walk_forward_train(X, y, args.folds)

    if model is None:
        print("  ERROR: No valid model produced")
        sys.exit(1)

    avg_auc = np.mean([m['auc'] for m in metrics])
    avg_acc = np.mean([m['accuracy'] for m in metrics])
    print(f"  Average OOS: ACC={avg_acc:.3f} AUC={avg_auc:.3f}")

    # Sanity check: if AUC < 0.52, model is basically random
    if avg_auc < 0.52:
        print(f"  WARNING: AUC={avg_auc:.3f} is near-random. Model may not add value.")

    # 4. Export to ONNX
    os.makedirs(args.output_dir, exist_ok=True)
    output_path = os.path.join(args.output_dir, f"{args.gladiator_id}.onnx")
    print("  Exporting to ONNX...")
    export_to_onnx(model, output_path)

    # 5. Save metadata
    meta = {
        'gladiator_id': args.gladiator_id,
        'total_trades': len(df),
        'win_rate': float(win_rate),
        'folds': args.folds,
        'avg_oos_auc': float(avg_auc),
        'avg_oos_accuracy': float(avg_acc),
        'feature_count': 11,
        'fold_metrics': metrics,
    }
    meta_path = os.path.join(args.output_dir, f"{args.gladiator_id}_meta.json")
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"  Metadata saved: {meta_path}")

    print(f"\n[DONE] Model ready at {output_path}")


if __name__ == '__main__':
    main()
