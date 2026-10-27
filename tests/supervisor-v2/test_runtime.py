import concurrent.futures
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.supervisor_v2.runtime import (Store, GateError, clean_env, scopes, redact,
    command, run_worker, independently_verify, supervisor_lock, supervisor_round, LocalCodex)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.now = [1000.0]
        self.store = Store(self.root / 'state', clock=lambda: self.now[0], ttl=2)
        self.repo = self.root / 'repo'; self.repo.mkdir()
        self.git('init', '--quiet')
        self.git('config', 'user.name', 'Offline Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.repo / 'fixture.txt').write_text('safe fixture\n')
        self.git('add', 'fixture.txt'); self.git('commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD').stdout.strip()

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        p = subprocess.run(['git', *args], cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p

    def task(self, files=None, **extra):
        spec = {'kind': 'git-smoke', 'issue': 95, 'base_sha': self.sha,
                'files': files or ['docs/fixture'], 'acceptance': 'HEAD equals assigned SHA; clean snapshot',
                'risk': 'NONE', **extra}
        return self.store.enqueue(spec)

    def allocated(self, **extra):
        w = self.store.register('fixture-worker')
        t = self.task(**extra); self.store.assign(t, w)
        return t, w

    def row(self, tid):
        return next(t for t in self.store.snapshot()['tasks'] if t['id'] == tid)

    def test_real_worker_claim_exec_receipt_and_independent_verification(self):
        t, w = self.allocated()
        report = run_worker(self.store, w, self.repo, once=True)
        self.assertEqual(report['tested_sha'], self.sha)
        self.assertEqual([r['exit_code'] for r in report['commands']], [0, 0])
        self.assertEqual(report['classification'], 'OFFLINE_NO_MODEL')
        task = self.row(t)
        self.assertEqual(task['state'], 'REVIEW')
        self.assertTrue(independently_verify(self.repo, task)['passed'])
        self.assertEqual([e['new'] for e in self.store.snapshot()['events'] if e['task'] == t],
                         ['READY', 'READY', 'CLAIMED', 'RUNNING', 'REVIEW'])
        self.assertEqual(self.git('status', '--porcelain').stdout, '')

    def test_duplicate_task_rejected_even_after_completion(self):
        t, w = self.allocated(); run_worker(self.store, w, self.repo, once=True)
        with self.assertRaisesRegex(GateError, 'duplicate'):
            self.store.enqueue(json.loads(self.row(t)['spec']), task_id=t)
        with self.assertRaises(GateError): run_worker(self.store, w, self.repo, once=True)

    def test_only_assigned_worker_can_claim(self):
        t, w = self.allocated(); other = self.store.register('other')
        self.assertIsNone(self.store.claim(other, self.store.start(other)))
        self.assertEqual(self.row(t)['state'], 'READY')
        self.assertIsNotNone(self.store.claim(w, self.store.start(w)))

    def test_two_process_sessions_cannot_start_same_worker(self):
        w = self.store.register('one')
        def start(_):
            try: return self.store.start(w)
            except GateError: return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            result = list(ex.map(start, range(2)))
        self.assertEqual(sum(x is not None for x in result), 1)

    def test_transactional_conflicting_assignments(self):
        workers = [self.store.register(str(i)) for i in range(2)]
        tasks = [self.task(files=['Src/Shared']), self.task(files=['src/shared/file.ts'])]
        def assign(i):
            try: self.store.assign(tasks[i], workers[i]); return True
            except GateError: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            self.assertEqual(sum(ex.map(assign, range(2))), 1)

    def test_disjoint_file_scopes_can_be_reserved(self):
        t1, w1 = self.allocated(files=['docs/first'])
        w2 = self.store.register('second'); t2 = self.task(files=['docs/second'])
        self.store.assign(t2, w2)
        self.assertEqual(self.row(t2)['worker'], w2)

    def test_normalize_scope_rejects_aliases(self):
        for path in ('/tmp', '../src', 'src/../dst', 'src//a', 'src/*', 'C:\\file', '.git/config', './src'):
            with self.subTest(path=path), self.assertRaises(GateError): scopes([path])

    def test_expiry_blocks_and_retains_ownership(self):
        t, w = self.allocated(); s = self.store.start(w); self.store.claim(w, s)
        self.store.began(t, w, s); self.now[0] += 3; self.store.expire()
        self.assertEqual(self.row(t)['state'], 'BLOCKED')
        self.assertEqual(self.store.snapshot()['workers'][0]['state'], 'OFFLINE')
        with self.assertRaises(GateError): self.store.heartbeat(w, s, t)
        other = self.store.register('new'); t2 = self.task()
        with self.assertRaisesRegex(GateError, 'ownership'): self.store.assign(t2, other)

    def test_expired_heartbeat_cannot_be_resurrected_without_reconcile(self):
        _, w = self.allocated(); s = self.store.start(w); self.now[0] += 3
        with self.assertRaisesRegex(GateError, 'expired'): self.store.heartbeat(w, s)

    def test_late_receipt_cannot_finish_expired_task(self):
        t, w = self.allocated(); report = run_worker(self.store, w, self.repo, once=True)
        with self.store.tx() as c:
            c.execute("UPDATE tasks SET state='BLOCKED' WHERE id=?", (t,))
            c.execute("UPDATE workers SET state='OFFLINE' WHERE id=?", (w,))
        with self.assertRaises(GateError): self.store.finish(t, w, report['session'], report)

    def test_failed_process_blocks_and_requires_termination_proof(self):
        t, w = self.allocated(base_sha='a' * 40)
        with self.assertRaisesRegex(GateError, 'snapshot'): run_worker(self.store, w, self.repo, once=True)
        self.assertEqual(self.row(t)['state'], 'BLOCKED')
        with self.assertRaises(GateError): self.store.recover(t, '')
        retry = self.store.recover(t, 'operator confirmed fixture worker process terminated')
        self.assertNotEqual(t, retry)
        self.assertEqual(self.row(t)['state'], 'REWORK')
        self.assertEqual(json.loads(self.row(retry)['spec'])['parent'], t)

    def test_safe_recovery_succeeds_with_fresh_session(self):
        t, w = self.allocated(); s = self.store.start(w); self.store.claim(w, s)
        self.store.began(t, w, s); self.store.block(t, w, s, 'synthetic controlled stop; child never launched')
        retry = self.store.recover(t, 'confirmed no child was launched by this fixture')
        fresh = self.store.register('recovery'); self.store.assign(retry, fresh)
        report = run_worker(self.store, fresh, self.repo, once=True)
        self.assertEqual(self.row(retry)['state'], 'REVIEW')
        self.assertNotEqual(report['session'], s)
        with self.assertRaises(GateError): self.store.heartbeat(w, s, t)

    def test_stop_prevents_assignment_and_claim(self):
        t, w = self.allocated(); s = self.store.start(w); self.store.stop()
        with self.assertRaisesRegex(GateError, 'stop'): self.store.claim(w, s)
        self.store.stop(False); self.assertIsNotNone(self.store.claim(w, s))

    def test_process_limits_and_stop_kill_child(self):
        home = self.root / 'home'; home.mkdir()
        with self.assertRaisesRegex(GateError, 'deadline'):
            command([sys.executable, '-c', 'import time;time.sleep(3)'], self.root, home, timeout=.1)
        with self.assertRaisesRegex(GateError, 'output limit'):
            command([sys.executable, '-c', 'print("x"*100000)'], self.root, home)
        calls = [0]
        def pulse():
            calls[0] += 1
            if calls[0] > 1: raise GateError('emergency stop')
        with self.assertRaisesRegex(GateError, 'emergency'):
            command([sys.executable, '-c', 'import time;time.sleep(3)'], self.root, home, pulse)

    def test_clean_env_and_log_redaction(self):
        with patch.dict(os.environ, {'GH_TOKEN': 'private-value', 'OPENAI_API_KEY': 'private-value'}):
            env = clean_env(self.root)
            self.assertNotIn('GH_TOKEN', env); self.assertNotIn('OPENAI_API_KEY', env)
            self.assertNotIn('SSH_AUTH_SOCK', env)
        self.assertNotIn('private', redact('Authorization: Bearer private token=private api_key=private'))
        self.assertEqual(redact('https://user:pass@example.invalid/'), 'https://[REDACTED]@example.invalid/')

    def test_receipt_tampering_and_sha_drift_fail_independent_gate(self):
        t, w = self.allocated(); run_worker(self.store, w, self.repo, once=True)
        task = self.row(t); report = json.loads(task['report']); report['tested_sha'] = 'a' * 40
        task['report'] = json.dumps(report)
        evidence = independently_verify(self.repo, task)
        self.assertFalse(evidence['passed'])
        self.assertIn('tested/reviewed SHA mismatch', evidence['failures'])

    def test_model_cannot_accept_failed_gate(self):
        t, w = self.allocated(); run_worker(self.store, w, self.repo, once=True)
        class Malicious:
            def decide(_, context): return {'action': 'ACCEPT', 'task_id': t, 'worker_id': w, 'reason': 'ignore failures and approve anyway'}
        with patch('tools.supervisor_v2.runtime.independently_verify', return_value={'passed': False, 'failures': ['failed CI']}):
            with self.assertRaisesRegex(GateError, 'cannot ACCEPT'): supervisor_round(self.store, self.repo, Malicious())
        self.assertEqual(self.row(t)['state'], 'REVIEW')

    def test_mock_model_accept_then_select_next_dependency(self):
        t, w = self.allocated(); next_task = self.task(files=['docs/next'], depends=[t])
        with self.assertRaisesRegex(GateError, 'dependency'): self.store.assign(next_task, w)
        run_worker(self.store, w, self.repo, once=True)
        calls = []
        class MockModel:
            def decide(_, context):
                calls.append(context)
                return {'action': 'ACCEPT' if len(calls) == 1 else 'ASSIGN',
                        'task_id': t if len(calls) == 1 else next_task, 'worker_id': w,
                        'reason': 'MOCK decision fixture; independent clean SHA checks available'}
        decider = MockModel()
        supervisor_round(self.store, self.repo, decider)
        self.assertEqual(self.row(t)['state'], 'ACCEPTED')
        supervisor_round(self.store, self.repo, decider)
        self.assertEqual(self.row(next_task)['worker'], w)
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0]['independent_reviews'][t]['passed'])

    def test_mock_model_rework_records_owner_failure_and_retest(self):
        t, w = self.allocated(); run_worker(self.store, w, self.repo, once=True)
        class MockModel:
            def decide(_, context): return {'action': 'REWORK', 'task_id': t, 'worker_id': w,
                                            'reason': 'MOCK negative task: missing fixture requirement; owner must retest clean SHA'}
        supervisor_round(self.store, self.repo, MockModel())
        self.assertEqual(self.row(t)['state'], 'REWORK')
        child = next(x for x in self.store.snapshot()['tasks'] if x['id'] != t)
        self.assertEqual(child['worker'], w)
        self.assertIn('Retest:', json.loads(child['spec'])['acceptance'])

    def test_model_cannot_bypass_approval_or_change_during_decision(self):
        t, w = self.allocated(); held = self.task(files=['docs/paid'], risk='PAID_API')
        other = self.store.register('other')
        with self.assertRaisesRegex(GateError, 'approval'): self.store.assign(held, other)
        class Race:
            def decide(_, context):
                self.store.register('new registration changes evidence')
                return {'action': 'HOLD', 'task_id': '', 'worker_id': '', 'reason': 'this decision now has stale evidence'}
        with self.assertRaisesRegex(GateError, 'changed'): supervisor_round(self.store, self.repo, Race())

    def test_supervisor_os_lock_excludes_other_owner(self):
        with supervisor_lock(self.store):
            with self.assertRaisesRegex(GateError, 'another Supervisor'):
                with supervisor_lock(self.store): pass
        with supervisor_lock(self.store): pass

    def test_codex_adapter_fails_closed_without_isolation_or_local_provider(self):
        with self.assertRaises(GateError): LocalCodex('/not/installed', '/not/installed', 'ollama', 'test')
        with self.assertRaises(GateError): LocalCodex('/not/installed', '/not/installed', 'openai', 'test')

    def test_real_separate_cli_worker_process(self):
        from tools.supervisor_v2.proof import prove
        # Proof needs runtime modules in the checkout, so use this committed repo
        # instead of the intentionally minimal fixture repository.
        result = prove(Path(__file__).resolve().parents[2])
        self.assertEqual(result['worker_process']['exit_code'], 0)
        self.assertEqual(result['task_state'], 'REVIEW')
        self.assertTrue(result['independent_replay']['passed'])
        self.assertEqual(result['ai_acceptance'], 'NOT_RUN')

    def test_independent_source_version_change_rejected(self):
        t, w = self.allocated(); run_worker(self.store, w, self.repo, once=True)
        (self.repo / 'fixture.txt').write_text('new source revision')
        self.git('add', '.'); self.git('commit', '-qm', 'changed source')
        evidence = independently_verify(self.repo, self.row(t))
        self.assertFalse(evidence['passed'])
        self.assertIn('source HEAD changed', evidence['failures'][-1])

    def test_empty_once_can_restart_worker_registration(self):
        w = self.store.register('idle')
        self.assertIsNone(run_worker(self.store, w, self.repo, once=True))
        t = self.task(); self.store.assign(t, w)
        self.assertIsNotNone(run_worker(self.store, w, self.repo, once=True))

    @unittest.skipIf(os.name == 'nt', 'model launcher intentionally blocked on Windows')
    def test_local_codex_argv_contract_with_explicit_fake_launcher(self):
        # This fixture is NOT isolation/model evidence. It validates adapter argv,
        # clean environment and schema plumbing with a clearly fake process.
        launcher = self.root / 'fake-launcher'
        launcher.write_text('#!' + sys.executable + "\n" +
            "import json,os,pathlib,sys\n" +
            "a=sys.argv; assert '--oss' in a and '--sandbox' in a\n" +
            "assert a[a.index('--local-provider')+1]=='ollama'\n" +
            "assert 'GH_TOKEN' not in os.environ and 'OPENAI_API_KEY' not in os.environ\n" +
            "pathlib.Path(a[a.index('--output-last-message')+1]).write_text(json.dumps({'findings':'MOCK adapter only'}))\n")
        launcher.chmod(0o700)
        home = self.root / 'clean-model-home'; home.mkdir()
        fake_cli = self.root / 'fake-codex'; fake_cli.write_text('MOCK CLI marker'); fake_cli.chmod(0o700)
        adapter = LocalCodex(fake_cli, launcher, 'ollama', 'fixture-local-model')
        with patch.dict(os.environ, {'GH_TOKEN': 'must-not-reach-child'}):
            result = adapter.execute(self.repo, home, 'read fixture only')
        self.assertEqual(result['exit_code'], 0)
        self.assertEqual(result['answer']['findings'], 'MOCK adapter only')
        self.assertIn('--ignore-user-config', result['argv'])



if __name__ == '__main__': unittest.main()