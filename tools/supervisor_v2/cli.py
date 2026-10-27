"""Run from repo root: python3 -m tools.supervisor_v2.cli --help."""
import argparse
import json
from pathlib import Path
import sys
import time

from .runtime import (GateError, Store, LocalCodex, collect_github, independently_verify,
                      run_worker, supervisor_lock, supervisor_round)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state', required=True, help='private operator directory OUTSIDE repository')
    p.add_argument('--repo', default='.')
    sub = p.add_subparsers(dest='command', required=True)
    reg = sub.add_parser('register'); reg.add_argument('--name', required=True)
    task = sub.add_parser('enqueue'); task.add_argument('spec', type=Path); task.add_argument('--id')
    assign = sub.add_parser('assign'); assign.add_argument('task'); assign.add_argument('worker')
    worker = sub.add_parser('worker'); worker.add_argument('worker'); worker.add_argument('--once', action='store_true')
    worker.add_argument('--codex-config', type=Path)
    sup = sub.add_parser('supervise'); sup.add_argument('--codex-config', type=Path, required=True)
    sup.add_argument('--once', action='store_true'); sup.add_argument('--poll', type=float, default=5)
    verify = sub.add_parser('verify'); verify.add_argument('task')
    recovery = sub.add_parser('recover'); recovery.add_argument('task'); recovery.add_argument('--termination-evidence', required=True)
    sub.add_parser('snapshot'); sub.add_parser('reconcile'); sub.add_parser('stop'); sub.add_parser('resume')
    args = p.parse_args()
    repo, state = Path(args.repo).resolve(), Path(args.state).resolve()
    if state.is_relative_to(repo): p.error('state must be outside repository')
    store = Store(state)
    def config(path):
        if path is None: return None
        if path.resolve().is_relative_to(repo): p.error('isolation config must be operator-owned outside repository')
        return LocalCodex(**json.loads(path.read_text()))
    if args.command == 'register': result = store.register(args.name)
    elif args.command == 'enqueue':
        with supervisor_lock(store): result = store.enqueue(json.loads(args.spec.read_text()), args.id)
    elif args.command == 'assign':
        with supervisor_lock(store): result = store.assign(args.task, args.worker)
    elif args.command == 'worker': result = run_worker(store, args.worker, repo, args.once, codex=config(args.codex_config))
    elif args.command == 'supervise':
        codex = config(args.codex_config)
        with supervisor_lock(store):
            while True:
                result = supervisor_round(store, repo, codex, collect_github())
                print(json.dumps(result), flush=True)
                if args.once: return
                time.sleep(max(1, args.poll))
    elif args.command == 'verify':
        task = next(t for t in store.snapshot()['tasks'] if t['id'] == args.task)
        result = independently_verify(repo, task)  # Does NOT mark ACCEPTED without Codex.
    elif args.command == 'recover':
        with supervisor_lock(store): result = store.recover(args.task, args.termination_evidence)
    elif args.command == 'reconcile': result = store.expire()
    elif args.command in ('stop', 'resume'): result = store.stop(args.command == 'stop')
    else: result = store.snapshot()
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (GateError, OSError, ValueError, KeyError, StopIteration) as exc:
        from .runtime import redact
        print('BLOCKED: ' + redact(f'{type(exc).__name__}: {exc}'), file=sys.stderr)
        sys.exit(1)
