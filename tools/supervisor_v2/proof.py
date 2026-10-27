"""Real separate-process no-model proof. Does not mark tasks ACCEPTED."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from .runtime import Store, GateError, independently_verify, require


def prove(repo):
    repo = Path(repo).resolve()
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True, capture_output=True, check=True).stdout.strip()
    with tempfile.TemporaryDirectory(prefix='supervisor-v2-proof-') as directory:
        store = Store(Path(directory) / 'state')
        worker = store.register('real-offline-worker-process')
        task = store.enqueue({'kind': 'git-smoke', 'issue': 95, 'base_sha': head,
                              'files': ['docs/supervisor-v2'], 'risk': 'NONE', 'priority': 100,
                              'acceptance': 'Exact assigned HEAD and clean isolated snapshot; both Git commands exit 0'})
        store.assign(task, worker)
        argv = [sys.executable, '-m', 'tools.supervisor_v2.cli', '--repo', str(repo),
                '--state', str(store.root), 'worker', worker, '--once']
        started = time.time()
        p = subprocess.run(argv, cwd=repo, text=True, capture_output=True, timeout=60)
        require(p.returncode == 0, 'real worker process failed: ' + p.stderr)
        snapshot = store.snapshot(); row = snapshot['tasks'][0]
        require(row['state'] == 'REVIEW', 'receipt did not reach REVIEW')
        verification = independently_verify(repo, row)
        require(verification['passed'], 'independent replay failed')
        return {'classification': 'REAL_PROCESS_OFFLINE_NO_MODEL', 'system_status': 'NOT_OPERATIONAL',
                'tested_sha': head, 'started_at': started, 'finished_at': time.time(),
                'worker_process': {'argv': argv, 'exit_code': p.returncode, 'stderr': p.stderr},
                'worker_id': worker, 'task_id': task, 'receipt': json.loads(row['report']),
                'events': snapshot['events'], 'independent_replay': verification,
                'task_state': row['state'], 'ai_acceptance': 'NOT_RUN', 'paid_requests': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--repo', default='.')
    args = parser.parse_args()
    result = prove(args.repo)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ('classification', 'tested_sha', 'worker_id', 'task_id', 'task_state', 'ai_acceptance')}))


if __name__ == '__main__': main()
